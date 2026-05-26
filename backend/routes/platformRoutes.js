const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('../config/db');
const { protect, requireSuperAdmin } = require('../middleware/authMiddleware');
const { createUpload, fileUrl } = require('../utils/storage');

// Poster upload for platform announcements — routed through the shared
// storage adapter so it works with S3 or local disk transparently.
const posterUpload = createUpload('announcement', { limits: { fileSize: 8 * 1024 * 1024 } });

// Every route here bypasses tenant scoping — these are platform-level views
// meant for the SaaS operator, not workspace admins. protect populates
// req.isSuperAdmin; requireSuperAdmin enforces.
router.use(protect, requireSuperAdmin);

// Platform-wide headline stats for the super admin dashboard.
router.get('/stats', async (req, res) => {
    try {
        const [[tenantStats]] = await db.query(
            `SELECT COUNT(*) AS total_tenants,
                    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_tenants,
                    SUM(CASE WHEN status = 'trial' THEN 1 ELSE 0 END) AS trial_tenants,
                    SUM(CASE WHEN status = 'suspended' THEN 1 ELSE 0 END) AS suspended_tenants
             FROM tenants`
        );

        // MRR = sum of price_inr across active paid subscriptions. Rough (doesn't
        // prorate yearly plans, doesn't subtract cancellations) but close enough
        // for a live revenue snapshot.
        const [[mrr]] = await db.query(
            `SELECT COALESCE(SUM(p.price_inr), 0) AS mrr_inr
             FROM subscriptions s JOIN plans p ON p.id = s.plan_id
             WHERE s.status = 'active' AND p.price_inr > 0`
        );

        const [planDist] = await db.query(
            `SELECT p.code, p.name, COUNT(s.id) AS tenant_count
             FROM plans p LEFT JOIN subscriptions s ON s.plan_id = p.id AND s.status IN ('active','trial')
             GROUP BY p.id ORDER BY p.price_inr ASC`
        );

        const [[invoiceStats]] = await db.query(
            `SELECT COUNT(*) AS total_invoices,
                    COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_inr ELSE 0 END), 0) AS total_revenue_inr,
                    SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) AS paid_count,
                    SUM(CASE WHEN status = 'stub' THEN 1 ELSE 0 END) AS stub_count
             FROM invoices`
        );

        const [[userStats]] = await db.query(
            `SELECT COUNT(*) AS total_users,
                    SUM(CASE WHEN is_super_admin = 1 THEN 1 ELSE 0 END) AS super_admins
             FROM users`
        );

        res.json({
            tenants: tenantStats,
            mrr_inr: Number(mrr.mrr_inr || 0),
            plan_distribution: planDist,
            invoices: invoiceStats,
            users: userStats
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// All tenants with subscription + admin + usage summary. The default list view.
router.get('/tenants', async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT t.id, t.name, t.status AS tenant_status, t.trial_ends_at, t.created_at,
                    t.logo_url, t.primary_color, t.bulk_certificate_enabled,
                    p.code AS plan_code, p.name AS plan_name, p.price_inr,
                    s.status AS sub_status, s.current_period_end, s.cancelled_at,
                    (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS user_count,
                    (SELECT COUNT(*) FROM events e WHERE e.tenant_id = t.id) AS event_count,
                    (SELECT COUNT(*) FROM speakers sp WHERE sp.tenant_id = t.id AND sp.deleted_at IS NULL) AS speaker_count,
                    (SELECT email FROM users u WHERE u.tenant_id = t.id AND u.role = 'admin' ORDER BY u.id ASC LIMIT 1) AS admin_email,
                    (SELECT name FROM users u WHERE u.tenant_id = t.id AND u.role = 'admin' ORDER BY u.id ASC LIMIT 1) AS admin_name
             FROM tenants t
             LEFT JOIN subscriptions s ON s.id = (
                 SELECT id FROM subscriptions WHERE tenant_id = t.id ORDER BY id DESC LIMIT 1
             )
             LEFT JOIN plans p ON p.id = s.plan_id
             ORDER BY t.id DESC`
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Deep detail on a single tenant: all users, recent events, invoice history,
// audit log tail. Used for the "Organization detail" drill-down.
router.get('/tenants/:id', async (req, res) => {
    const id = Number(req.params.id);
    try {
        const [[tenant]] = await db.query(
            `SELECT t.*, p.code AS plan_code, p.name AS plan_name, p.price_inr,
                    s.id AS subscription_id, s.status AS sub_status,
                    s.current_period_start, s.current_period_end, s.cancelled_at
             FROM tenants t
             LEFT JOIN subscriptions s ON s.id = (
                 SELECT id FROM subscriptions WHERE tenant_id = t.id ORDER BY id DESC LIMIT 1
             )
             LEFT JOIN plans p ON p.id = s.plan_id
             WHERE t.id = ?`, [id]
        );
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        const [users] = await db.query(
            `SELECT id, name, email, role, created_at FROM users WHERE tenant_id = ? ORDER BY id ASC`, [id]
        );
        const [invoices] = await db.query(
            `SELECT id, invoice_number, plan_name, amount_inr, status, created_at
             FROM invoices WHERE tenant_id = ? ORDER BY id DESC LIMIT 50`, [id]
        );
        const [events] = await db.query(
            `SELECT id, title, start_date, end_date FROM events WHERE tenant_id = ? ORDER BY id DESC LIMIT 20`, [id]
        );
        const [audit] = await db.query(
            `SELECT id, actor_name, actor_role, action, resource_type, created_at
             FROM audit_log WHERE tenant_id = ? ORDER BY id DESC LIMIT 30`, [id]
        );

        res.json({ tenant, users, invoices, events, audit });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Edit a tenant's own info (name, slug, branding). Doesn't touch subscription
// state — use change-plan / suspend / activate for that.
router.put('/tenants/:id', async (req, res) => {
    const id = Number(req.params.id);
    const { name, slug, primary_color, logo_url } = req.body || {};
    try {
        // Slug uniqueness — skip if the provided slug is the tenant's own or blank.
        if (slug) {
            const [[clash]] = await db.query(
                'SELECT id FROM tenants WHERE slug = ? AND id != ? LIMIT 1', [slug, id]
            );
            if (clash) return res.status(409).json({ error: 'slug already in use' });
        }
        await db.query(
            `UPDATE tenants SET
                name = COALESCE(?, name),
                slug = COALESCE(?, slug),
                primary_color = COALESCE(?, primary_color),
                logo_url = COALESCE(?, logo_url)
             WHERE id = ?`,
            [name ?? null, slug ?? null, primary_color ?? null, logo_url ?? null, id]
        );
        const [[updated]] = await db.query('SELECT id, name, slug, primary_color, logo_url FROM tenants WHERE id = ?', [id]);
        res.json({ ok: true, tenant: updated });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Extend a trial by N days. Updates both tenants.trial_ends_at and the active
// subscription's current_period_end so the workspace stops seeing "trial
// ending soon" banners.
router.post('/tenants/:id/extend-trial', async (req, res) => {
    const id = Number(req.params.id);
    const days = Math.max(1, Math.min(365, Number(req.body?.days) || 30));
    try {
        await db.query(
            `UPDATE tenants SET trial_ends_at = DATE_ADD(COALESCE(trial_ends_at, NOW()), INTERVAL ? DAY) WHERE id = ?`,
            [days, id]
        );
        await db.query(
            `UPDATE subscriptions SET current_period_end = DATE_ADD(COALESCE(current_period_end, NOW()), INTERVAL ? DAY)
             WHERE tenant_id = ? ORDER BY id DESC LIMIT 1`,
            [days, id]
        );
        res.json({ ok: true, extended_by_days: days });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Suspend a tenant — sets tenant status + subscription status so the write-gate
// in protect kicks in and blocks all mutations from their users.
router.post('/tenants/:id/suspend', async (req, res) => {
    const id = Number(req.params.id);
    try {
        await db.query(`UPDATE tenants SET status = 'suspended' WHERE id = ?`, [id]);
        await db.query(
            `UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW()
             WHERE tenant_id = ? ORDER BY id DESC LIMIT 1`, [id]
        );
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Reactivate a previously-suspended tenant.
router.post('/tenants/:id/activate', async (req, res) => {
    const id = Number(req.params.id);
    try {
        await db.query(`UPDATE tenants SET status = 'active' WHERE id = ?`, [id]);
        await db.query(
            `UPDATE subscriptions SET status = 'active', cancelled_at = NULL
             WHERE tenant_id = ? ORDER BY id DESC LIMIT 1`, [id]
        );
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Hard-delete a tenant + every scrap of their data. Irreversible — guarded
// by a name-match confirmation so an accidental click can't take out a real
// workspace. Most FKs are RESTRICT, so we wipe each tenanted table in
// dependency order inside a transaction.
router.delete('/tenants/:id', async (req, res) => {
    const id = Number(req.params.id);
    const { confirm } = req.body || {};

    const conn = await db.getConnection();
    try {
        const [[tenant]] = await conn.query('SELECT id, name FROM tenants WHERE id = ? LIMIT 1', [id]);
        if (!tenant) return res.status(404).json({ error: 'Tenant not found' });

        // Require the super admin to re-type the org name exactly, the same
        // pattern GitHub/Stripe use for destructive repo/account ops.
        if (!confirm || confirm.trim() !== tenant.name) {
            return res.status(400).json({ error: `Type the organization name exactly to confirm: "${tenant.name}"` });
        }

        await conn.beginTransaction();

        // Order matters — child tables with intra-tenant FKs go first so we
        // don't hit RESTRICT constraints deleting their parents.
        const tables = [
            'agenda_speakers',
            'partner_wishlist',
            'message_reactions',
            'message_hides',
            'chat_group_reads',
            'chat_group_members',
            'messages',
            'chat_groups',
            'speaker_travel',
            'invitations',
            'notifications',
            'agendas',
            'attendees',
            'awards',
            'speakers',
            'partners',
            'award_categories',
            'partner_categories',
            'events',
            'settings',
            'users'
        ];
        for (const t of tables) {
            await conn.query(`DELETE FROM ${t} WHERE tenant_id = ?`, [id]);
        }
        // audit_log, invoices, subscriptions cascade on tenant delete — still
        // fine to drop them via the tenants row.
        await conn.query('DELETE FROM tenants WHERE id = ?', [id]);

        await conn.commit();
        res.json({ ok: true, deleted_tenant: tenant.name });
    } catch (err) {
        try { await conn.rollback(); } catch {}
        res.status(500).json({ error: err.message });
    } finally {
        conn.release();
    }
});

// Toggle per-tenant feature flags. Today there's only one — bulk certificates —
// but new flags slot in here without touching the wider tenants PUT endpoint.
router.put('/tenants/:id/features', async (req, res) => {
    const id = Number(req.params.id);
    const { bulk_certificate_enabled } = req.body || {};
    if (typeof bulk_certificate_enabled === 'undefined') {
        return res.status(400).json({ error: 'no feature flags provided' });
    }
    try {
        await db.query(
            `UPDATE tenants SET bulk_certificate_enabled = ? WHERE id = ?`,
            [bulk_certificate_enabled ? 1 : 0, id]
        );
        res.json({ ok: true, bulk_certificate_enabled: !!bulk_certificate_enabled });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Manually flip a tenant to a specific plan (e.g. to honour a sales deal or
// grandfather a plan). Doesn't create an invoice — this is a comp.
router.post('/tenants/:id/change-plan', async (req, res) => {
    const id = Number(req.params.id);
    const { plan_code } = req.body || {};
    if (!plan_code) return res.status(400).json({ error: 'plan_code required' });
    try {
        const [[plan]] = await db.query(`SELECT id FROM plans WHERE code = ? LIMIT 1`, [plan_code]);
        if (!plan) return res.status(404).json({ error: 'Plan not found' });
        await db.query(
            `UPDATE subscriptions SET plan_id = ?, status = 'active', cancelled_at = NULL
             WHERE tenant_id = ? ORDER BY id DESC LIMIT 1`,
            [plan.id, id]
        );
        res.json({ ok: true, plan: plan_code });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Reset any user's password across any tenant. Used by the platform owner to
// unblock locked-out customers or rotate a known-compromised credential.
// Refuses to touch super admins themselves via this route — platform admins
// must rotate their own passwords through the create_super_admin script to
// avoid accidental lockouts.
router.post('/users/:id/reset-password', async (req, res) => {
    const id = Number(req.params.id);
    const { new_password } = req.body || {};
    if (!new_password || new_password.length < 6) {
        return res.status(400).json({ error: 'new_password must be at least 6 characters' });
    }
    try {
        const [[target]] = await db.query('SELECT id, email, is_super_admin FROM users WHERE id = ? LIMIT 1', [id]);
        if (!target) return res.status(404).json({ error: 'user not found' });
        if (target.is_super_admin) return res.status(403).json({ error: 'cannot reset another super admin from the console' });

        const hashed = await bcrypt.hash(new_password, 10);
        await db.query('UPDATE users SET password = ? WHERE id = ?', [hashed, id]);
        res.json({ ok: true, email: target.email });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// All invoices across every tenant — for revenue reconciliation.
router.get('/invoices', async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT i.id, i.invoice_number, i.plan_name, i.amount_inr, i.status,
                    i.razorpay_payment_id, i.billing_email, i.created_at,
                    t.id AS tenant_id, t.name AS tenant_name
             FROM invoices i JOIN tenants t ON t.id = i.tenant_id
             ORDER BY i.id DESC LIMIT 500`
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Global plan management — list, edit price/limits. Mirrors the billing /plans
// endpoint but includes non-public ones and allows mutation.
router.get('/plans', async (req, res) => {
    try {
        const [plans] = await db.query(
            `SELECT id, code, name, price_inr, billing_cycle, max_events, max_speakers,
                    max_attendees, max_users, features, is_public, created_at
             FROM plans ORDER BY price_inr ASC`
        );
        const parsed = plans.map(p => ({
            ...p,
            features: typeof p.features === 'string' ? JSON.parse(p.features) : (p.features || [])
        }));
        res.json(parsed);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Analytics ───
// Returns 12 months of aggregates (signups, MRR progression, churn, invoice
// totals). Computed in-query so the chart render doesn't need to reduce N rows
// on the client.
router.get('/analytics', async (req, res) => {
    try {
        // Build a rolling 12-month series. DATE_FORMAT groups by YYYY-MM which
        // makes sorting + labeling trivial on the client.
        const [signups] = await db.query(`
            SELECT DATE_FORMAT(created_at, '%Y-%m') AS month,
                   COUNT(*) AS signups
            FROM tenants
            WHERE created_at >= DATE_SUB(CURRENT_DATE, INTERVAL 12 MONTH)
            GROUP BY month ORDER BY month ASC
        `);

        const [revenue] = await db.query(`
            SELECT DATE_FORMAT(created_at, '%Y-%m') AS month,
                   COALESCE(SUM(CASE WHEN status = 'paid' THEN amount_inr ELSE 0 END), 0) AS revenue_inr,
                   COUNT(CASE WHEN status = 'paid' THEN 1 END) AS paid_invoices
            FROM invoices
            WHERE created_at >= DATE_SUB(CURRENT_DATE, INTERVAL 12 MONTH)
            GROUP BY month ORDER BY month ASC
        `);

        // "Churn" for our purposes = subscriptions cancelled this month. Not
        // true accounting churn (no reactivation logic) but close enough for
        // a live operational dashboard.
        const [churn] = await db.query(`
            SELECT DATE_FORMAT(cancelled_at, '%Y-%m') AS month,
                   COUNT(*) AS churn
            FROM subscriptions
            WHERE cancelled_at IS NOT NULL
              AND cancelled_at >= DATE_SUB(CURRENT_DATE, INTERVAL 12 MONTH)
            GROUP BY month ORDER BY month ASC
        `);

        // Stitch into a single month-indexed series so the frontend only needs
        // one array to render 3 lines.
        const months = [];
        const now = new Date();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = d.toLocaleString('en-IN', { month: 'short', year: '2-digit' });
            months.push({
                month: key,
                label,
                signups: Number(signups.find(r => r.month === key)?.signups || 0),
                revenue_inr: Number(revenue.find(r => r.month === key)?.revenue_inr || 0),
                paid_invoices: Number(revenue.find(r => r.month === key)?.paid_invoices || 0),
                churn: Number(churn.find(r => r.month === key)?.churn || 0)
            });
        }

        // Topline totals across the window — useful for the chart's summary chips.
        const totals = {
            total_signups: months.reduce((s, m) => s + m.signups, 0),
            total_revenue_inr: months.reduce((s, m) => s + m.revenue_inr, 0),
            total_churn: months.reduce((s, m) => s + m.churn, 0),
            peak_month_revenue: months.reduce((max, m) => m.revenue_inr > max ? m.revenue_inr : max, 0)
        };

        res.json({ months, totals });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Platform announcements ───
// Super-admin broadcasts. Shown as a dismissible banner on top of every tenant's
// app via /api/announcements/active (mounted outside requireSuperAdmin).
router.get('/announcements', async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT a.*, u.name AS created_by_name FROM platform_announcements a
             LEFT JOIN users u ON u.id = a.created_by
             ORDER BY a.id DESC`
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/announcements', async (req, res) => {
    const { title, message, image_url, type = 'info', is_active = 1, dismissible = 1, starts_at, ends_at } = req.body || {};
    if (!title || !message) return res.status(400).json({ error: 'title and message required' });
    if (!['info', 'warning', 'danger', 'success'].includes(type)) {
        return res.status(400).json({ error: 'invalid type' });
    }
    try {
        const [r] = await db.query(
            `INSERT INTO platform_announcements (title, message, image_url, type, is_active, dismissible, starts_at, ends_at, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [title, message, image_url || null, type, is_active ? 1 : 0, dismissible ? 1 : 0, starts_at || null, ends_at || null, req.user.id]
        );
        res.json({ ok: true, id: r.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/announcements/:id', async (req, res) => {
    const id = Number(req.params.id);
    const { title, message, image_url, type, is_active, dismissible, starts_at, ends_at } = req.body || {};
    try {
        await db.query(
            `UPDATE platform_announcements SET
                title = COALESCE(?, title),
                message = COALESCE(?, message),
                image_url = ?,
                type = COALESCE(?, type),
                is_active = COALESCE(?, is_active),
                dismissible = COALESCE(?, dismissible),
                starts_at = ?,
                ends_at = ?
             WHERE id = ?`,
            [
                title ?? null,
                message ?? null,
                // Explicit null clears the poster; undefined would wipe it too,
                // but the frontend always sends the current value back so
                // "clear poster" = send empty string / null.
                image_url === undefined ? null : (image_url || null),
                type ?? null,
                typeof is_active === 'number' || typeof is_active === 'boolean' ? (is_active ? 1 : 0) : null,
                typeof dismissible === 'number' || typeof dismissible === 'boolean' ? (dismissible ? 1 : 0) : null,
                starts_at || null,
                ends_at || null,
                id
            ]
        );
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Upload a poster image. Returns the URL path so the caller can save it on
// the announcement record via POST/PUT.
router.post('/announcements/poster', posterUpload.single('poster'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ image_url: fileUrl(req.file) });
});

router.delete('/announcements/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM platform_announcements WHERE id = ?', [Number(req.params.id)]);
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Create a new plan. `code` must be unique + URL-safe (lowercase, no spaces)
// because it's referenced in every checkout / subscription row.
router.post('/plans', async (req, res) => {
    const {
        code, name, price_inr = 0, billing_cycle = 'monthly',
        max_events = 0, max_speakers = 0, max_attendees = 0, max_users = 0,
        features = [], is_public = 1
    } = req.body || {};

    if (!code || !name) return res.status(400).json({ error: 'code and name are required' });
    if (!/^[a-z0-9_-]+$/.test(code)) {
        return res.status(400).json({ error: 'code must be lowercase letters, numbers, hyphens or underscores only' });
    }
    if (!['monthly', 'yearly'].includes(billing_cycle)) {
        return res.status(400).json({ error: 'billing_cycle must be monthly or yearly' });
    }

    try {
        const [[existing]] = await db.query('SELECT id FROM plans WHERE code = ? LIMIT 1', [code]);
        if (existing) return res.status(409).json({ error: 'A plan with this code already exists' });

        const [r] = await db.query(
            `INSERT INTO plans (code, name, price_inr, billing_cycle, max_events, max_speakers,
                                max_attendees, max_users, features, is_public)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                code, name, Number(price_inr), billing_cycle,
                Number(max_events), Number(max_speakers), Number(max_attendees), Number(max_users),
                JSON.stringify(Array.isArray(features) ? features : []),
                is_public ? 1 : 0
            ]
        );
        res.json({ ok: true, id: r.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete a plan. Refuses if any subscription still references it (FK is
// ON DELETE RESTRICT anyway, but this lets us return a useful message instead
// of a raw "constraint failed" surface). Super admin should migrate those
// tenants to a different plan first via change-plan.
//
// Historical invoices use ON DELETE SET NULL — they keep their denormalized
// plan_name/plan_code so the audit trail isn't lost when a plan goes away.
router.delete('/plans/:id', async (req, res) => {
    const id = Number(req.params.id);
    try {
        const [[plan]] = await db.query('SELECT id, name, code FROM plans WHERE id = ? LIMIT 1', [id]);
        if (!plan) return res.status(404).json({ error: 'Plan not found' });

        const [[{ in_use }]] = await db.query(
            `SELECT COUNT(*) AS in_use FROM subscriptions WHERE plan_id = ?`, [id]
        );
        if (in_use > 0) {
            return res.status(409).json({
                error: 'plan_in_use',
                message: `Can't delete "${plan.name}" — ${in_use} subscription${in_use === 1 ? '' : 's'} still reference it. Move those tenants to another plan first, or hide this plan instead.`,
                in_use_count: in_use,
            });
        }

        const [[{ invoice_count }]] = await db.query(
            `SELECT COUNT(*) AS invoice_count FROM invoices WHERE plan_id = ?`, [id]
        );

        await db.query('DELETE FROM plans WHERE id = ?', [id]);
        res.json({ ok: true, deleted_plan: plan.code, invoices_unlinked: invoice_count });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/plans/:id', async (req, res) => {
    const id = Number(req.params.id);
    const { name, price_inr, max_events, max_speakers, max_attendees, max_users, features, is_public } = req.body || {};
    try {
        await db.query(
            `UPDATE plans SET
                name = COALESCE(?, name),
                price_inr = COALESCE(?, price_inr),
                max_events = COALESCE(?, max_events),
                max_speakers = COALESCE(?, max_speakers),
                max_attendees = COALESCE(?, max_attendees),
                max_users = COALESCE(?, max_users),
                features = COALESCE(?, features),
                is_public = COALESCE(?, is_public)
             WHERE id = ?`,
            [
                name ?? null,
                price_inr ?? null,
                max_events ?? null,
                max_speakers ?? null,
                max_attendees ?? null,
                max_users ?? null,
                features != null ? JSON.stringify(features) : null,
                is_public != null ? (is_public ? 1 : 0) : null,
                id
            ]
        );
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
