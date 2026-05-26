const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Razorpay = require('razorpay');
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { encrypt, decrypt, maskSecret } = require('../utils/encryption');
const { sendMail } = require('../utils/mailer');
const { sendCustomerPaymentEmail, buildRetryUrl, buildAbsoluteBase } = require('../utils/formPaymentEmails');

// ──────────────────────────────────────────────────────────────
// Payments — tenant-level Razorpay keys + per-form checkout flow.
// ──────────────────────────────────────────────────────────────

const requireAdmin = (req, res, next) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
};

const parseJsonMaybe = (v) => {
    if (v == null) return null;
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch { return null; }
};

// Resolve a tenant's Razorpay credentials (decrypted). Returns null if the
// tenant hasn't configured keys yet so callers can short-circuit cleanly.
const getTenantRazorpay = async (tenantId) => {
    const [[row]] = await db.query(
        `SELECT key_id, key_secret_encrypted, is_active
         FROM tenant_payment_gateways
         WHERE tenant_id = ? AND gateway = 'razorpay'`,
        [tenantId]
    );
    if (!row || !row.is_active || !row.key_id || !row.key_secret_encrypted) return null;
    const secret = decrypt(row.key_secret_encrypted);
    if (!secret) return null;
    return { keyId: row.key_id, keySecret: secret };
};

// ──────────────────────────────────────────────────────────────
// Admin: read / update tenant gateway keys
// ──────────────────────────────────────────────────────────────

router.get('/settings', protect, requireAdmin, async (req, res) => {
    try {
        const [[row]] = await db.query(
            `SELECT gateway, key_id, key_secret_encrypted, is_active, updated_at
             FROM tenant_payment_gateways
             WHERE tenant_id = ? AND gateway = 'razorpay'`,
            [req.tenantId]
        );
        if (!row) return res.json({ gateway: 'razorpay', key_id: '', key_secret_masked: '', is_active: false, configured: false });
        const decrypted = decrypt(row.key_secret_encrypted);
        res.json({
            gateway: row.gateway,
            key_id: row.key_id || '',
            key_secret_masked: maskSecret(decrypted),
            is_active: !!row.is_active,
            configured: !!(row.key_id && decrypted),
            updated_at: row.updated_at,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/settings', protect, requireAdmin, async (req, res) => {
    const { key_id, key_secret, is_active } = req.body;
    const cleanKeyId = (key_id || '').trim();
    const cleanKeySecret = key_secret != null ? String(key_secret).trim() : '';

    if (cleanKeyId && !/^rzp_(test|live)_[A-Za-z0-9]+$/.test(cleanKeyId)) {
        return res.status(400).json({ error: 'Key ID should look like rzp_test_XXXX or rzp_live_XXXX' });
    }
    try {
        const [[existing]] = await db.query(
            `SELECT id, key_secret_encrypted FROM tenant_payment_gateways
             WHERE tenant_id = ? AND gateway = 'razorpay'`,
            [req.tenantId]
        );
        // When admin leaves the secret blank we keep the already-stored one —
        // the UI shows a masked preview so this is the natural "don't change
        // secret" gesture.
        const secretToStore = cleanKeySecret
            ? encrypt(cleanKeySecret)
            : (existing ? existing.key_secret_encrypted : null);

        if (existing) {
            await db.query(
                `UPDATE tenant_payment_gateways
                 SET key_id = ?, key_secret_encrypted = ?, is_active = ?
                 WHERE id = ?`,
                [cleanKeyId || null, secretToStore, is_active ? 1 : 0, existing.id]
            );
        } else {
            await db.query(
                `INSERT INTO tenant_payment_gateways (tenant_id, gateway, key_id, key_secret_encrypted, is_active)
                 VALUES (?, 'razorpay', ?, ?, ?)`,
                [req.tenantId, cleanKeyId || null, secretToStore, is_active ? 1 : 0]
            );
        }
        res.json({ message: 'Razorpay settings saved' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Smoke-test the stored keys by hitting Razorpay's /v1/payments endpoint.
// Returns 200 with { ok: true } on success so the UI can show a green tick.
router.post('/settings/test', protect, requireAdmin, async (req, res) => {
    try {
        const creds = await getTenantRazorpay(req.tenantId);
        if (!creds) return res.status(400).json({ error: 'No Razorpay keys configured' });
        const rzp = new Razorpay({ key_id: creds.keyId, key_secret: creds.keySecret });
        // The simplest zero-side-effect Razorpay call: list payments with count=1.
        await rzp.payments.all({ count: 1 });
        res.json({ ok: true, message: 'Razorpay credentials are valid' });
    } catch (err) {
        const msg = err?.error?.description || err?.message || 'Razorpay rejected the credentials';
        res.status(400).json({ error: msg });
    }
});

// ──────────────────────────────────────────────────────────────
// Public: create order + verify payment
// ──────────────────────────────────────────────────────────────

// Resolve the charge amount (in smallest currency unit, i.e. paise for INR).
// For tiered forms `tier_label` must match one of the configured tiers.
// For `award_category` mode, the caller must pass `awardCategoryId` — we walk
// up the sector/category/subcategory chain from the deepest selection until we
// find a node with a non-null amount.
const resolveCharge = async (form, { tierLabel, awardCategoryId } = {}) => {
    const mode = form.payment_mode || 'fixed';
    if (mode === 'award_category') {
        if (!awardCategoryId) return { error: 'Pick a category before paying' };
        // Walk up the hierarchy (max 3 hops) until we find an amount.
        let cursor = Number(awardCategoryId);
        let found = null;
        let labelPath = [];
        for (let i = 0; i < 4 && cursor; i++) {
            const [[row]] = await db.query(
                `SELECT id, name, parent_id, amount FROM award_categories
                 WHERE id = ? AND tenant_id = ? AND event_id = ?`,
                [cursor, form.tenant_id, form.event_id || null]
            );
            if (!row) break;
            labelPath.unshift(row.name);
            if (found == null && row.amount != null) found = row;
            cursor = row.parent_id;
        }
        if (!found) return { error: 'No nomination fee is configured for this selection' };
        const amount = Math.round(Number(found.amount) * 100);
        if (!(amount > 0)) return { error: 'Nomination fee is invalid' };
        return { amount, label: labelPath.join(' → ') || found.name };
    }
    if (mode === 'tiered') {
        const tiers = parseJsonMaybe(form.payment_tiers_json) || [];
        if (tiers.length === 0) return { error: 'No pricing tiers configured' };
        // Time-based auto-selection: order by valid_until ascending (null/blank
        // sorts last so "always-valid" tiers act as the fallback). The first
        // tier whose valid_until is null or still in the future is the active
        // one. If every tier has a date and all dates have passed, registration
        // is closed.
        const now = Date.now();
        const ordered = tiers.slice().sort((a, b) => {
            const da = a.valid_until ? new Date(a.valid_until).getTime() : Number.POSITIVE_INFINITY;
            const db = b.valid_until ? new Date(b.valid_until).getTime() : Number.POSITIVE_INFINITY;
            return da - db;
        });
        const pick = ordered.find(t => !t.valid_until || new Date(t.valid_until).getTime() >= now);
        if (!pick) return { error: 'Registration has closed — all pricing tiers have expired' };
        const amount = Math.round(Number(pick.amount) * 100);
        if (!(amount > 0)) return { error: 'Active tier has an invalid amount' };
        // `tierLabel` from the client is now only used as a sanity check; if
        // provided it must match the active tier the server resolved.
        if (tierLabel && String(tierLabel) !== String(pick.label)) {
            // Client had a stale tier; silently use the server's current tier.
        }
        return { amount, label: pick.label };
    }
    const amount = Math.round(Number(form.payment_amount) * 100);
    if (!(amount > 0)) return { error: 'Form has no valid price configured' };
    return { amount, label: null };
};

// Shared helper — validate form answers the same way /public/:id/submit does.
// Exported as a function so both /public/order (pending row) and /public/verify
// (as a double-check) can use it without duplication.
const cleanAnswers = async (form, fields, incoming) => {
    const cleaned = {};
    for (const f of fields) {
        const raw = incoming ? incoming[f.id] : undefined;
        const isEmpty = raw === undefined || raw === null ||
            (typeof raw === 'string' && raw.trim() === '') ||
            (Array.isArray(raw) && raw.length === 0);
        if (f.required && isEmpty) return { error: `"${f.label}" is required` };
        if (isEmpty) { cleaned[f.id] = null; continue; }
        if (f.field_type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw).trim())) {
            return { error: `"${f.label}" must be a valid email` };
        }
        if (f.field_type === 'number' && isNaN(Number(raw))) {
            return { error: `"${f.label}" must be a number` };
        }
        if (f.field_type === 'checkbox') {
            cleaned[f.id] = Array.isArray(raw) ? raw : [raw];
        } else if (f.field_type === 'file') {
            cleaned[f.id] = (typeof raw === 'object' && raw.url) ? raw : null;
        } else if (f.field_type === 'award_category') {
            const sectorId = raw && raw.sector_id ? Number(raw.sector_id) : null;
            const catId = raw && raw.category_id ? Number(raw.category_id) : null;
            const subId = raw && raw.subcategory_id ? Number(raw.subcategory_id) : null;
            if (!sectorId) { cleaned[f.id] = null; continue; }
            const ids = [sectorId, catId, subId].filter(Boolean);
            const [cats] = await db.query(
                `SELECT id, name, parent_id FROM award_categories
                 WHERE tenant_id = ? AND event_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
                [form.tenant_id, form.event_id || null, ...ids]
            );
            const sector = cats.find(c => c.id === sectorId && c.parent_id == null);
            const cat = catId ? cats.find(c => c.id === catId && Number(c.parent_id) === sectorId) : null;
            const sub = subId && cat ? cats.find(c => c.id === subId && Number(c.parent_id) === catId) : null;
            if (!sector) return { error: `"${f.label}" sector is invalid` };
            if (catId && !cat) return { error: `"${f.label}" category is invalid` };
            if (subId && !sub) return { error: `"${f.label}" subcategory is invalid` };
            cleaned[f.id] = {
                sector_id: sector.id, sector_name: sector.name,
                category_id: cat ? cat.id : null, category_name: cat ? cat.name : null,
                subcategory_id: sub ? sub.id : null, subcategory_name: sub ? sub.name : null,
            };
        } else {
            cleaned[f.id] = typeof raw === 'string' ? raw.trim() : raw;
        }
    }
    return { cleaned };
};

// POST /public/order — create a Razorpay order AND persist a PENDING
// submission row so cancelled/failed/abandoned attempts are still visible to
// admins (e.g. for follow-up emails). Expects the full `data` payload upfront;
// on payment success /public/verify only needs to flip the status to 'paid'.
router.post('/public/order', async (req, res) => {
    try {
        const { form_id, tier_label, award_category_id, data, captcha_token, captcha_answer } = req.body || {};
        if (!form_id) return res.status(400).json({ error: 'form_id is required' });

        const [[form]] = await db.query(
            `SELECT id, tenant_id, title, event_id, is_active, payment_enabled, payment_mode,
                    payment_amount, payment_currency, payment_tiers_json, captcha_enabled
             FROM forms WHERE id = ?`,
            [form_id]
        );

        if (!form || !form.is_active) return res.status(404).json({ error: 'Form not found' });
        if (!form.payment_enabled) return res.status(400).json({ error: 'This form is not accepting payments' });

        // Verify the math captcha BEFORE creating a Razorpay order, otherwise
        // bots could rack up orphan orders on the linked merchant account.
        if (form.captcha_enabled) {
            const { verifyMathCaptcha } = require('../utils/captcha');
            if (!verifyMathCaptcha(captcha_token, captcha_answer)) {
                return res.status(400).json({ error: 'Captcha answer is incorrect or has expired. Please refresh and try again.' });
            }
        }

        const creds = await getTenantRazorpay(form.tenant_id);
        if (!creds) return res.status(500).json({ error: 'Razorpay is not configured for this organisation' });

        const charge = await resolveCharge(form, { tierLabel: tier_label, awardCategoryId: award_category_id });
        if (charge.error) return res.status(400).json({ error: charge.error });

        // Pre-validate the answer payload so we don't create a Razorpay order
        // for a submission that'll fail validation later.
        const [fields] = await db.query(
            'SELECT id, field_type, label, required, options_json FROM form_fields WHERE form_id = ?',
            [form.id]
        );
        const result = await cleanAnswers(form, fields, data || {});
        if (result.error) return res.status(400).json({ error: result.error });

        const rzp = new Razorpay({ key_id: creds.keyId, key_secret: creds.keySecret });
        const order = await rzp.orders.create({
            amount: charge.amount,
            currency: form.payment_currency || 'INR',
            receipt: `f${form.id}-${Date.now().toString(36)}`.slice(0, 40),
            notes: {
                form_id: String(form.id),
                form_title: String(form.title || '').slice(0, 200),
                tier: charge.label || '',
            },
        });

        // Persist a pending submission immediately — the row is updated (not
        // replaced) on verify, fail, or cancel so the admin always sees every
        // attempt. `payment_retry_token` backs the public /pay/:token link the
        // admin can share with a visitor to re-attempt payment.
        const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
            .toString().split(',')[0].trim().slice(0, 45);
        const retryToken = crypto.randomBytes(24).toString('hex');
        const [ins] = await db.query(
            `INSERT INTO form_submissions (
                tenant_id, form_id, data_json, submitter_ip,
                payment_status, payment_order_id, payment_amount, payment_currency,
                payment_tier_label, payment_retry_token
             ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
            [
                form.tenant_id, form.id, JSON.stringify(result.cleaned), ip || null,
                order.id, charge.amount, form.payment_currency || 'INR', charge.label || null,
                retryToken,
            ]
        );

        res.json({
            order_id: order.id,
            amount: order.amount,
            currency: order.currency,
            key_id: creds.keyId,
            tier_label: charge.label,
            submission_id: ins.insertId,
            retry_token: retryToken,
        });

        // Fire the pre-confirmation email to the visitor (best-effort, async).
        // Carries the retry link so an abandoned checkout is still recoverable.
        sendCustomerPaymentEmail({
            type: 'pending',
            form,
            fields,
            data: result.cleaned,
            amountPaise: charge.amount,
            currency: form.payment_currency || 'INR',
            tierLabel: charge.label,
            retryUrl: buildRetryUrl(req, retryToken),
            absoluteBase: buildAbsoluteBase(req),
            tenantId: form.tenant_id,
        }).catch(() => {});
    } catch (err) {
        const msg = err?.error?.description || err?.message || 'Failed to create order';
        res.status(500).json({ error: msg });
    }
});

// POST /public/payment-status — mark the pending submission tied to an order
// as `failed` or `cancelled`. Called from the client when Razorpay fires
// `payment.failed` or the checkout modal is dismissed.
router.post('/public/payment-status', async (req, res) => {
    try {
        const { razorpay_order_id, status, reason } = req.body || {};
        if (!razorpay_order_id) return res.status(400).json({ error: 'razorpay_order_id is required' });
        if (!['failed', 'cancelled'].includes(status)) {
            return res.status(400).json({ error: 'status must be failed or cancelled' });
        }
        // Don't clobber a row that's already been marked paid by /verify.
        const [upd] = await db.query(
            `UPDATE form_submissions
             SET payment_status = ?,
                 data_json = JSON_SET(COALESCE(data_json, '{}'), '$._payment_note', ?)
             WHERE payment_order_id = ? AND payment_status = 'pending'`,
            [status, String(reason || '').slice(0, 200), razorpay_order_id]
        );
        res.json({ ok: true });

        // Customer follow-up email with the retry link — best-effort.
        if (upd.affectedRows > 0) {
            try {
                const [[row]] = await db.query(
                    `SELECT form_id, data_json, payment_amount, payment_currency,
                            payment_tier_label, payment_retry_token
                     FROM form_submissions
                     WHERE payment_order_id = ? LIMIT 1`,
                    [razorpay_order_id]
                );
                if (row) {
                    const [[form]] = await db.query(
                        'SELECT id, tenant_id, title, payment_currency FROM forms WHERE id = ?',
                        [row.form_id]
                    );
                    const [fields] = await db.query(
                        'SELECT id, field_type, label FROM form_fields WHERE form_id = ? ORDER BY sequence ASC, id ASC',
                        [row.form_id]
                    );
                    sendCustomerPaymentEmail({
                        type: status,
                        form,
                        fields,
                        data: parseJsonMaybe(row.data_json) || {},
                        amountPaise: row.payment_amount,
                        currency: row.payment_currency || 'INR',
                        tierLabel: row.payment_tier_label,
                        retryUrl: buildRetryUrl(req, row.payment_retry_token),
                        reason,
                        absoluteBase: buildAbsoluteBase(req),
                        tenantId: form?.tenant_id,
                    }).catch(() => {});
                }
            } catch (mailErr) {
                console.error('[payment-status email lookup]', mailErr.message);
            }
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST /public/verify — verify Razorpay's HMAC signature AND persist the
// submission in one atomic step. The client never submits the form data via
// the usual /public/:id/submit path when payment is required; this endpoint
// does both.
router.post('/public/verify', async (req, res) => {
    try {
        const {
            form_id,
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            tier_label,
            award_category_id,
            data,   // field-answer payload
        } = req.body || {};

        if (!form_id || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ error: 'Missing payment parameters' });
        }

        const [[form]] = await db.query(
            `SELECT id, tenant_id, title, is_active, notify_email,
                    payment_enabled, payment_mode, payment_amount, payment_currency,
                    payment_tiers_json, redirect_url, event_id
             FROM forms WHERE id = ?`,
            [form_id]
        );
        if (!form || !form.is_active) return res.status(404).json({ error: 'Form not found' });
        if (!form.payment_enabled) return res.status(400).json({ error: 'This form is not accepting payments' });

        const creds = await getTenantRazorpay(form.tenant_id);
        if (!creds) return res.status(500).json({ error: 'Razorpay is not configured' });

        // HMAC verification — the canonical "did Razorpay really send this?" check.
        const expected = crypto
            .createHmac('sha256', creds.keySecret)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');
        if (expected !== razorpay_signature) {
            return res.status(400).json({ error: 'Payment signature check failed' });
        }

        // Confirm with Razorpay that the payment is actually captured (not just
        // authorised). Also serves as a second sanity check against spoofed ids.
        const rzp = new Razorpay({ key_id: creds.keyId, key_secret: creds.keySecret });
        const pay = await rzp.payments.fetch(razorpay_payment_id);
        if (!pay || pay.order_id !== razorpay_order_id) {
            return res.status(400).json({ error: 'Payment / order id mismatch' });
        }
        if (pay.status !== 'captured' && pay.status !== 'authorized') {
            return res.status(400).json({ error: `Payment status is ${pay.status}` });
        }

        const charge = await resolveCharge(form, { tierLabel: tier_label, awardCategoryId: award_category_id });
        if (charge.error) return res.status(400).json({ error: charge.error });

        // Pull fields for the notification email render below.
        const [fields] = await db.query(
            'SELECT id, field_type, label, required, options_json FROM form_fields WHERE form_id = ?',
            [form.id]
        );

        // The pending submission row was created at /public/order time. Flip it
        // to 'paid' and attach the Razorpay payment id. If the row isn't there
        // (stale client, direct call, etc) fall back to an INSERT so we don't
        // silently lose a paid submission.
        const [updateResult] = await db.query(
            `UPDATE form_submissions
             SET payment_status = 'paid', payment_id = ?
             WHERE payment_order_id = ? AND form_id = ?`,
            [razorpay_payment_id, razorpay_order_id, form.id]
        );
        let cleaned = null;
        if (updateResult.affectedRows === 0) {
            // Fallback path — re-validate data and insert fresh.
            const fallback = await cleanAnswers(form, fields, data || {});
            if (fallback.error) return res.status(400).json({ error: fallback.error });
            cleaned = fallback.cleaned;
            const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
                .toString().split(',')[0].trim().slice(0, 45);
            await db.query(
                `INSERT INTO form_submissions (
                    tenant_id, form_id, data_json, submitter_ip,
                    payment_status, payment_id, payment_order_id, payment_amount,
                    payment_currency, payment_tier_label
                 ) VALUES (?, ?, ?, ?, 'paid', ?, ?, ?, ?, ?)`,
                [
                    form.tenant_id, form.id, JSON.stringify(cleaned), ip || null,
                    razorpay_payment_id, razorpay_order_id, charge.amount,
                    form.payment_currency || 'INR', charge.label || null,
                ]
            );
        } else {
            // Read the row back so the notification email has the data.
            const [[row]] = await db.query(
                'SELECT data_json FROM form_submissions WHERE payment_order_id = ? LIMIT 1',
                [razorpay_order_id]
            );
            cleaned = parseJsonMaybe(row?.data_json) || {};
        }

        // Notification email (fire-and-forget — same pattern as plain submits).
        if (form.notify_email) {
            const absoluteBase = `${req.headers['x-forwarded-proto'] || req.protocol || 'http'}://${req.headers['x-forwarded-host'] || req.get('host')}`;
            const paymentSummary = `<p style="margin:0;padding:12px 16px;background:#ecfdf5;color:#065f46;border-radius:8px;font-size:13px">
                ✅ Payment received: <strong>${(charge.amount / 100).toFixed(2)} ${form.payment_currency || 'INR'}</strong>
                ${charge.label ? ` · Tier: <strong>${String(charge.label).replace(/</g, '&lt;')}</strong>` : ''}<br>
                Razorpay Payment ID: <code>${razorpay_payment_id}</code>
            </p>`;
            const dataForEmail = Object.fromEntries(Object.entries(cleaned).map(([k, v]) => {
                if (v && typeof v === 'object' && v.url && v.url.startsWith('/')) {
                    return [k, { ...v, url: `${absoluteBase}${v.url}` }];
                }
                return [k, v];
            }));
            // Inline email render — deliberately not reusing formRoutes' helper
            // to avoid a circular require.
            const rows = fields.map(f => {
                const v = dataForEmail[f.id];
                let disp;
                if (v == null || v === '') disp = '<span style="color:#94a3b8">—</span>';
                else if (Array.isArray(v)) disp = v.join(', ');
                else if (typeof v === 'object' && v.url) disp = `<a href="${v.url}" style="color:#8b5cf6">${v.name || 'Download'}</a>`;
                else if (typeof v === 'object' && (v.sector_name || v.category_name)) disp = [v.sector_name, v.category_name, v.subcategory_name].filter(Boolean).join(' → ');
                else disp = String(v).replace(/</g, '&lt;');
                return `<tr><td style="padding:8px 12px;border-bottom:1px solid #eef0f3;color:#64748b;font-size:13px;width:40%">${f.label}</td><td style="padding:8px 12px;border-bottom:1px solid #eef0f3;color:#0f172a;font-size:14px">${disp}</td></tr>`;
            }).join('');
            const html = `<div style="font-family:Inter,system-ui,sans-serif;background:#f8fafc;padding:24px">
                <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
                    <div style="background:linear-gradient(135deg,#8b5cf6,#ec4899);color:#fff;padding:20px 24px">
                        <div style="font-size:12px;letter-spacing:0.1em;text-transform:uppercase;opacity:0.85">New Paid Submission</div>
                        <div style="font-size:20px;font-weight:700;margin-top:4px">${form.title}</div>
                    </div>
                    <div style="padding:16px 24px">${paymentSummary}</div>
                    <table style="width:100%;border-collapse:collapse">${rows}</table>
                    <div style="padding:14px 24px;background:#f8fafc;color:#64748b;font-size:12px;text-align:center">
                        Submitted at ${new Date().toLocaleString()}
                    </div>
                </div>
            </div>`;
            sendMail({
                to: form.notify_email,
                subject: `Paid submission on "${form.title}"`,
                html,
                tenantId: form.tenant_id,
            }).catch(err => console.error('Payment notification email failed:', err.message));
        }

        res.status(201).json({
            ok: true,
            redirect_url: form.redirect_url || null,
            payment_id: razorpay_payment_id,
        });

        // Customer receipt — best-effort, don't delay the response.
        sendCustomerPaymentEmail({
            type: 'paid',
            form,
            fields,
            data: cleaned,
            amountPaise: charge.amount,
            currency: form.payment_currency || 'INR',
            tierLabel: charge.label,
            paymentId: razorpay_payment_id,
            absoluteBase: buildAbsoluteBase(req),
            tenantId: form.tenant_id,
        }).catch(() => {});
    } catch (err) {
        console.error('Payment verify error:', err);
        res.status(500).json({ error: err?.error?.description || err?.message || 'Payment verification failed' });
    }
});

// ──────────────────────────────────────────────────────────────
// Public: retry link — admin shares /pay/:token with a visitor whose
// payment attempt failed, was cancelled, or is still pending. The token is
// written when /public/order creates the initial pending submission.
// ──────────────────────────────────────────────────────────────

// Load the pending/failed/cancelled/paid submission + enough form context to
// render the retry page. No auth — the token IS the credential.
router.get('/public/retry/:token', async (req, res) => {
    try {
        const [[sub]] = await db.query(
            `SELECT id, form_id, payment_status, payment_order_id, payment_id,
                    payment_amount, payment_currency, payment_tier_label,
                    submitted_at
             FROM form_submissions
             WHERE payment_retry_token = ? LIMIT 1`,
            [req.params.token]
        );
        if (!sub) return res.status(404).json({ error: 'Payment link not found' });

        const [[form]] = await db.query(
            `SELECT f.id, f.tenant_id, f.title, f.payment_enabled, f.payment_currency,
                    f.payment_description, f.redirect_url,
                    e.title AS event_title, e.event_logo_url AS event_logo_url,
                    e.primary_color, e.secondary_color, e.font_family
             FROM forms f
             LEFT JOIN events e ON e.id = f.event_id
             WHERE f.id = ?`,
            [sub.form_id]
        );
        if (!form) return res.status(404).json({ error: 'Form not found' });

        res.json({
            status: sub.payment_status,
            amount: sub.payment_amount,
            currency: sub.payment_currency || form.payment_currency || 'INR',
            tier_label: sub.payment_tier_label,
            payment_id: sub.payment_id,
            submitted_at: sub.submitted_at,
            form: {
                id: form.id,
                title: form.title,
                payment_description: form.payment_description,
                redirect_url: form.redirect_url,
                primary_color: form.primary_color,
                secondary_color: form.secondary_color,
                font_family: form.font_family,
                event_title: form.event_title,
                event_logo_url: form.event_logo_url,
            },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create a fresh Razorpay order for the same submission. Refuses once the row
// is already paid — nothing to retry.
router.post('/public/retry/:token/order', async (req, res) => {
    try {
        const [[sub]] = await db.query(
            `SELECT id, tenant_id, form_id, payment_status, payment_amount,
                    payment_currency, payment_tier_label
             FROM form_submissions
             WHERE payment_retry_token = ? LIMIT 1`,
            [req.params.token]
        );
        if (!sub) return res.status(404).json({ error: 'Payment link not found' });
        if (sub.payment_status === 'paid') {
            return res.status(400).json({ error: 'This submission is already paid' });
        }
        if (!(sub.payment_amount > 0)) {
            return res.status(400).json({ error: 'No amount on this submission' });
        }

        const creds = await getTenantRazorpay(sub.tenant_id);
        if (!creds) return res.status(500).json({ error: 'Razorpay is not configured' });

        const rzp = new Razorpay({ key_id: creds.keyId, key_secret: creds.keySecret });
        const order = await rzp.orders.create({
            amount: sub.payment_amount,
            currency: sub.payment_currency || 'INR',
            receipt: `retry-${sub.id}-${Date.now().toString(36)}`.slice(0, 40),
            notes: {
                form_id: String(sub.form_id),
                submission_id: String(sub.id),
                retry: '1',
            },
        });

        // Point the submission at the new order + flip back to pending so the
        // next verify/cancel/failed call touches the right row.
        await db.query(
            `UPDATE form_submissions
             SET payment_order_id = ?, payment_status = 'pending'
             WHERE id = ?`,
            [order.id, sub.id]
        );

        res.json({
            order_id: order.id,
            amount: order.amount,
            currency: order.currency,
            key_id: creds.keyId,
            tier_label: sub.payment_tier_label,
        });
    } catch (err) {
        const msg = err?.error?.description || err?.message || 'Failed to create order';
        res.status(500).json({ error: msg });
    }
});

// Verify the retry payment. Mirrors /public/verify but scoped to a submission
// resolved via the retry token, so we don't re-validate form data (the row
// already passed validation at initial-order time).
router.post('/public/retry/:token/verify', async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({ error: 'Missing payment parameters' });
        }

        const [[sub]] = await db.query(
            `SELECT id, tenant_id, form_id, payment_order_id, payment_status
             FROM form_submissions
             WHERE payment_retry_token = ? LIMIT 1`,
            [req.params.token]
        );
        if (!sub) return res.status(404).json({ error: 'Payment link not found' });
        if (sub.payment_order_id !== razorpay_order_id) {
            return res.status(400).json({ error: 'Order id mismatch' });
        }

        const creds = await getTenantRazorpay(sub.tenant_id);
        if (!creds) return res.status(500).json({ error: 'Razorpay is not configured' });

        const expected = crypto
            .createHmac('sha256', creds.keySecret)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');
        if (expected !== razorpay_signature) {
            return res.status(400).json({ error: 'Payment signature check failed' });
        }

        const rzp = new Razorpay({ key_id: creds.keyId, key_secret: creds.keySecret });
        const pay = await rzp.payments.fetch(razorpay_payment_id);
        if (!pay || pay.order_id !== razorpay_order_id) {
            return res.status(400).json({ error: 'Payment / order id mismatch' });
        }
        if (pay.status !== 'captured' && pay.status !== 'authorized') {
            return res.status(400).json({ error: `Payment status is ${pay.status}` });
        }

        await db.query(
            `UPDATE form_submissions
             SET payment_status = 'paid', payment_id = ?
             WHERE id = ?`,
            [razorpay_payment_id, sub.id]
        );

        const [[form]] = await db.query(
            'SELECT id, tenant_id, title, redirect_url, payment_currency FROM forms WHERE id = ?',
            [sub.form_id]
        );
        res.json({ ok: true, payment_id: razorpay_payment_id, redirect_url: form?.redirect_url || null });

        // Receipt email on successful retry.
        try {
            const [[row]] = await db.query(
                `SELECT data_json, payment_amount, payment_currency, payment_tier_label
                 FROM form_submissions WHERE id = ?`,
                [sub.id]
            );
            const [fields] = await db.query(
                'SELECT id, field_type, label FROM form_fields WHERE form_id = ? ORDER BY sequence ASC, id ASC',
                [sub.form_id]
            );
            sendCustomerPaymentEmail({
                type: 'paid',
                form,
                fields,
                data: parseJsonMaybe(row?.data_json) || {},
                amountPaise: row?.payment_amount,
                currency: row?.payment_currency || 'INR',
                tierLabel: row?.payment_tier_label,
                paymentId: razorpay_payment_id,
                absoluteBase: buildAbsoluteBase(req),
                tenantId: form?.tenant_id,
            }).catch(() => {});
        } catch (mailErr) {
            console.error('[retry verify email]', mailErr.message);
        }
    } catch (err) {
        res.status(500).json({ error: err?.error?.description || err?.message || 'Verification failed' });
    }
});

module.exports = router;
module.exports.getTenantRazorpay = getTenantRazorpay;
