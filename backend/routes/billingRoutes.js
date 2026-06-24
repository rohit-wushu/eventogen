const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { usageAndLimit, LIMITS } = require('../middleware/limits');
const { logAudit } = require('../utils/audit');

// Lazy Razorpay client — only required when keys are configured so the module
// still loads in dev/test without the package.
let rzpClient = null;
function rzp() {
    if (rzpClient) return rzpClient;
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return null;
    const Razorpay = require('razorpay');
    rzpClient = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
    return rzpClient;
}

// Public list of available plans. Used by the Billing page to render the
// upgrade cards. Excludes plans marked is_public=0 (e.g. grandfathered deals).
router.get('/plans', protect, async (req, res) => {
    try {
        const [plans] = await db.query(
            `SELECT id, code, name, price_inr, billing_cycle,
                    max_events, max_speakers, max_attendees, max_users, features
             FROM plans WHERE is_public = 1 ORDER BY price_inr ASC`
        );
        const parsed = plans.map(p => ({
            ...p,
            features: typeof p.features === 'string' ? JSON.parse(p.features) : (p.features || [])
        }));
        res.json(parsed);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Load the current subscription row or self-heal by seeding a Free-plan trial
// subscription if one doesn't exist. Keeps the billing page from hard-failing
// on any tenant that slipped through without a subscription row.
async function getOrCreateSubscriptionRow(tenantId) {
    const select = `SELECT s.id, s.status, s.current_period_start, s.current_period_end,
                           s.cancelled_at, s.razorpay_subscription_id,
                           p.id AS plan_id, p.code AS plan_code, p.name AS plan_name,
                           p.price_inr, p.billing_cycle,
                           p.max_events, p.max_speakers, p.max_attendees, p.max_users,
                           p.features,
                           t.status AS tenant_status, t.trial_ends_at
                    FROM subscriptions s
                    JOIN plans p ON p.id = s.plan_id
                    JOIN tenants t ON t.id = s.tenant_id
                    WHERE s.tenant_id = ? ORDER BY s.id DESC LIMIT 1`;

    let [rows] = await db.query(select, [tenantId]);
    if (rows.length > 0) return rows[0];

    // Self-heal step 1: ensure the 'free' plan row exists. Older deployments
    // that never ran migrate_billing_stage4.js have an empty plans table.
    let [freePlanRows] = await db.query(`SELECT id FROM plans WHERE code = 'free' LIMIT 1`);
    if (freePlanRows.length === 0) {
        // Detect optional storage column so the INSERT works on both schemas.
        const [hasStorage] = await db.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'max_storage_mb'`
        );
        const features = JSON.stringify(['7-day free trial', '1 active event', 'Up to 50 speakers', 'Basic support']);
        if (hasStorage.length > 0) {
            await db.query(
                `INSERT INTO plans (code, name, price_inr, max_events, max_speakers, max_attendees, max_users, max_storage_mb, features)
                 VALUES ('free', 'Free', 0, 1, 50, 200, 3, 100, ?)`,
                [features]
            );
        } else {
            await db.query(
                `INSERT INTO plans (code, name, price_inr, max_events, max_speakers, max_attendees, max_users, features)
                 VALUES ('free', 'Free', 0, 1, 50, 200, 3, ?)`,
                [features]
            );
        }
        [freePlanRows] = await db.query(`SELECT id FROM plans WHERE code = 'free' LIMIT 1`);
    }
    const freePlan = freePlanRows[0];

    // Self-heal step 2: seed the subscription row.
    const [[tenant]] = await db.query(`SELECT status, trial_ends_at FROM tenants WHERE id = ? LIMIT 1`, [tenantId]);
    const subStatus = tenant?.status === 'trial' ? 'trial' : 'active';
    await db.query(
        `INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_end)
         VALUES (?, ?, ?, ?)`,
        [tenantId, freePlan.id, subStatus, tenant?.trial_ends_at || null]
    );
    [rows] = await db.query(select, [tenantId]);
    return rows[0];
}

// Current tenant's subscription + usage snapshot. Drives the billing dashboard.
router.get('/subscription', protect, async (req, res) => {
    try {
        // Super admins (and anyone else without a tenant) don't have a
        // subscription — return a neutral response so the layout banner / UI
        // doesn't crash on 500. The Platform Console is their billing view.
        if (!req.tenantId) {
            return res.json({ subscription: null, usage: {} });
        }
        const sub = await getOrCreateSubscriptionRow(req.tenantId);
        if (!sub) return res.status(500).json({ error: 'Could not load subscription' });

        // Parse features JSON + compute usage for every tracked resource in one round-trip.
        const usage = {};
        for (const key of Object.keys(LIMITS)) {
            usage[key] = await usageAndLimit(req.tenantId, key);
        }

        res.json({
            subscription: {
                ...sub,
                features: typeof sub.features === 'string' ? JSON.parse(sub.features) : (sub.features || [])
            },
            usage
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create Razorpay Order for a plan. Frontend uses the returned { order_id, key_id,
// amount } to open Razorpay Checkout. On success frontend POSTs to /verify-payment.
// Stubs to an instant plan-switch when RAZORPAY_KEY_ID is not set.
router.post('/checkout', protect, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only the workspace admin can change the plan' });
    const { plan_code } = req.body || {};
    if (!plan_code) return res.status(400).json({ error: 'plan_code is required' });

    try {
        const [plans] = await db.query('SELECT id, code, name, price_inr FROM plans WHERE code = ?', [plan_code]);
        if (plans.length === 0) return res.status(404).json({ error: 'Plan not found' });
        const plan = plans[0];

        // Free downgrade doesn't need payment.
        if (plan.price_inr === 0) {
            await db.query(
                `UPDATE subscriptions SET plan_id = ?, status = 'active', cancelled_at = NULL
                 WHERE tenant_id = ? ORDER BY id DESC LIMIT 1`,
                [plan.id, req.tenantId]
            );
            return res.json({ free: true, plan: plan.code, message: `Switched to ${plan.name}` });
        }

        const client = rzp();
        if (!client) {
            // Dev/stub path — flip the subscription to the requested plan without
            // charging. Keeps the UI working before real keys are wired.
            await db.query(
                `UPDATE subscriptions SET plan_id = ?, status = 'active', current_period_start = NOW(),
                                          current_period_end = DATE_ADD(NOW(), INTERVAL 30 DAY), cancelled_at = NULL
                 WHERE tenant_id = ? ORDER BY id DESC LIMIT 1`,
                [plan.id, req.tenantId]
            );
            const [[stubSub]] = await db.query(
                'SELECT id, current_period_start, current_period_end FROM subscriptions WHERE tenant_id = ? ORDER BY id DESC LIMIT 1',
                [req.tenantId]
            );
            const stubInvoiceNumber = await nextInvoiceNumber(req.tenantId);
            await db.query(
                `INSERT INTO invoices (tenant_id, subscription_id, plan_id, plan_code, plan_name,
                                       amount_inr, currency, status, billing_name, billing_email,
                                       invoice_number, period_start, period_end)
                 VALUES (?, ?, ?, ?, ?, ?, 'INR', 'stub', ?, ?, ?, ?, ?)`,
                [req.tenantId, stubSub?.id || null, plan.id, plan.code, plan.name,
                 plan.price_inr, req.user.name || null, req.user.email || null,
                 stubInvoiceNumber, stubSub?.current_period_start || null, stubSub?.current_period_end || null]
            );
            logAudit(req, 'billing.plan_change_stub', 'subscription', null, { to_plan: plan.code, invoice_number: stubInvoiceNumber });
            return res.json({
                stub: true,
                message: 'Dev mode — Razorpay keys not configured. Plan switched without charge.',
                plan: plan.code,
                invoice_number: stubInvoiceNumber
            });
        }

        // Real Razorpay flow: create a one-shot Order. On success callback, the
        // frontend POSTs to /verify-payment which (a) verifies the HMAC signature
        // then (b) activates the subscription on our side.
        const order = await client.orders.create({
            amount: plan.price_inr * 100,       // paise
            currency: 'INR',
            receipt: `t${req.tenantId}-p${plan.id}-${Date.now()}`,
            notes: { tenant_id: String(req.tenantId), plan_code: plan.code, plan_id: String(plan.id) }
        });

        res.json({
            order_id: order.id,
            amount: order.amount,
            currency: order.currency,
            key_id: process.env.RAZORPAY_KEY_ID,
            plan: { code: plan.code, name: plan.name, price_inr: plan.price_inr }
        });
    } catch (err) {
        console.error('checkout failed:', err);
        res.status(500).json({ error: err.message });
    }
});

// Generates a human-readable invoice number like INV-2026-000042. The sequence
// is per-tenant so each workspace gets its own clean numbering.
async function nextInvoiceNumber(tenantId) {
    const year = new Date().getFullYear();
    const [[{ count }]] = await db.query(
        `SELECT COUNT(*) AS count FROM invoices WHERE tenant_id = ? AND YEAR(created_at) = ?`,
        [tenantId, year]
    );
    const seq = String(count + 1).padStart(6, '0');
    return `INV-${year}-${seq}`;
}

// Verify Razorpay payment signature + activate the subscription.
// Frontend calls this from the Razorpay Checkout success handler.
router.post('/verify-payment', protect, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only the workspace admin can confirm payments' });
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan_code } = req.body || {};
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !plan_code) {
        return res.status(400).json({ error: 'Missing payment fields' });
    }
    if (!process.env.RAZORPAY_KEY_SECRET) return res.status(503).json({ error: 'billing_not_configured' });

    // HMAC verification — without this anyone could claim a payment succeeded.
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');
    if (expected !== razorpay_signature) return res.status(400).json({ error: 'invalid_signature' });

    try {
        const [plans] = await db.query('SELECT id, code, name, price_inr FROM plans WHERE code = ?', [plan_code]);
        if (plans.length === 0) return res.status(404).json({ error: 'Plan not found' });
        const plan = plans[0];

        await db.query(
            `UPDATE subscriptions SET plan_id = ?, status = 'active', current_period_start = NOW(),
                                      current_period_end = DATE_ADD(NOW(), INTERVAL 30 DAY), cancelled_at = NULL
             WHERE tenant_id = ? ORDER BY id DESC LIMIT 1`,
            [plan.id, req.tenantId]
        );

        const [[sub]] = await db.query(
            'SELECT id, current_period_start, current_period_end FROM subscriptions WHERE tenant_id = ? ORDER BY id DESC LIMIT 1',
            [req.tenantId]
        );
        const invoiceNumber = await nextInvoiceNumber(req.tenantId);
        await db.query(
            `INSERT INTO invoices (tenant_id, subscription_id, plan_id, plan_code, plan_name,
                                   amount_inr, currency, status, razorpay_order_id, razorpay_payment_id,
                                   billing_name, billing_email, invoice_number, period_start, period_end)
             VALUES (?, ?, ?, ?, ?, ?, 'INR', 'paid', ?, ?, ?, ?, ?, ?, ?)`,
            [req.tenantId, sub?.id || null, plan.id, plan.code, plan.name,
             plan.price_inr, razorpay_order_id, razorpay_payment_id,
             req.user.name || null, req.user.email || null,
             invoiceNumber, sub?.current_period_start || null, sub?.current_period_end || null]
        );

        logAudit(req, 'billing.plan_change', 'subscription', razorpay_order_id, { to_plan: plan_code, payment_id: razorpay_payment_id, invoice_number: invoiceNumber });
        res.json({ ok: true, plan: plan_code, invoice_number: invoiceNumber });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List invoices for the current tenant — powers the billing history section.
router.get('/invoices', protect, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT id, invoice_number, plan_name, plan_code, amount_inr, currency, status,
                    razorpay_order_id, razorpay_payment_id, billing_name, billing_email,
                    period_start, period_end, created_at
             FROM invoices WHERE tenant_id = ? ORDER BY id DESC LIMIT 100`,
            [req.tenantId]
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Fetch a single invoice (for the receipt view). Scoped to the current tenant so
// one workspace cannot read another's invoice by guessing IDs.
router.get('/invoices/:id', protect, async (req, res) => {
    try {
        const [[inv]] = await db.query(
            `SELECT i.*, t.name AS tenant_name, t.logo_url AS tenant_logo
             FROM invoices i JOIN tenants t ON t.id = i.tenant_id
             WHERE i.id = ? AND i.tenant_id = ? LIMIT 1`,
            [req.params.id, req.tenantId]
        );
        if (!inv) return res.status(404).json({ error: 'Invoice not found' });
        res.json(inv);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Expose whether Razorpay is configured — frontend uses this to show the
// dev-mode banner and to know whether to open Checkout. Also returns whether
// the configured key is a test key (rzp_test_*) so the UI can show sandbox
// card hints only when safe.
router.get('/config', protect, (req, res) => {
    const keyId = process.env.RAZORPAY_KEY_ID || '';
    res.json({
        razorpay_enabled: !!(keyId && process.env.RAZORPAY_KEY_SECRET),
        test_mode: keyId.startsWith('rzp_test_'),
        key_id: keyId || null
    });
});

// Cancel subscription — downgrades to 'cancelled' status. Enforcement happens
// in checkLimit middleware, which blocks all creation for cancelled/expired subs.
router.post('/cancel', protect, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only the workspace admin can cancel the plan' });
    try {
        await db.query(
            `UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW()
             WHERE tenant_id = ? ORDER BY id DESC LIMIT 1`,
            [req.tenantId]
        );
        logAudit(req, 'billing.cancel', 'subscription');
        res.json({ message: 'Subscription cancelled' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Razorpay webhook — processes subscription.* events. Mounted at /api/webhooks/razorpay
// in server.js (NOT inside /billing since webhooks must be publicly reachable).
// Signature verification is CRITICAL — without it anyone could flip subscription
// statuses by POSTing to this endpoint.
router.post('/webhooks/razorpay', express.raw({ type: 'application/json' }), async (req, res) => {
    if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
        return res.status(503).json({ error: 'webhook_not_configured' });
    }
    const crypto = require('crypto');
    const sig = req.headers['x-razorpay-signature'];
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(req.body).digest('hex');
    if (sig !== expected) return res.status(400).json({ error: 'invalid_signature' });

    try {
        const event = JSON.parse(req.body.toString('utf8'));
        const sub = event.payload?.subscription?.entity;
        if (!sub) return res.json({ ok: true, ignored: true });

        // Map Razorpay status → our status column.
        const statusMap = {
            created: 'trial',
            authenticated: 'active',
            active: 'active',
            pending: 'past_due',
            halted: 'past_due',
            cancelled: 'cancelled',
            completed: 'expired',
            expired: 'expired'
        };
        const newStatus = statusMap[sub.status] || 'active';

        await db.query(
            `UPDATE subscriptions
             SET status = ?, current_period_start = FROM_UNIXTIME(?), current_period_end = FROM_UNIXTIME(?)
             WHERE razorpay_subscription_id = ?`,
            [newStatus, sub.current_start || null, sub.current_end || null, sub.id]
        );
        res.json({ ok: true });
    } catch (err) {
        console.error('webhook handler error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
