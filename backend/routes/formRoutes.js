const express = require('express');
const router = express.Router();
const { createUpload, fileUrl } = require('../utils/storage');
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { sendMail } = require('../utils/mailer');
const { generateMathCaptcha, verifyMathCaptcha } = require('../utils/captcha');

// ──────────────────────────────────────────────────────────────
// Forms — Typeform-style form builder + public fill flow.
//
// Routes split into two groups:
//   - AUTHENTICATED (uses `protect` + `requireAdminOrManager`)
//   - PUBLIC (no middleware) — fetch form, submit responses, upload files
// ──────────────────────────────────────────────────────────────

const VALID_FIELD_TYPES = new Set([
    'text', 'email', 'phone', 'textarea', 'number', 'date', 'time',
    'dropdown', 'radio', 'checkbox',
    'consent',
    'name', 'address',
    'file',
    'award_category'
]);

const requireAdminOrManager = (req, res, next) => {
    if (req.user?.role !== 'admin' && req.user?.role !== 'manager') {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
};

const parseJsonMaybe = (v) => {
    if (v == null) return null;
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch { return null; }
};

const normalizeWidth = (w) => (w === 'half' ? 'half' : 'full');

// `notify_email` accepts one OR multiple recipients, separated by commas,
// semicolons, whitespace, or newlines. Returns { clean, invalid }:
//   clean   → comma-joined, de-duplicated, trimmed string (safe for nodemailer `to`)
//   invalid → array of tokens that didn't look like email addresses
// Pass null/'' → returns { clean: null, invalid: [] } (notifications off).
// Validate an optional redirect URL — http(s) only. Empty/null means "off".
// Returns { clean, valid }:
//   clean → trimmed URL (or null)
//   valid → false only if a value was provided and it didn't parse
const parseRedirectUrl = (raw) => {
    const s = (raw || '').trim();
    if (!s) return { clean: null, valid: true };
    try {
        const u = new URL(s);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return { clean: null, valid: false };
        return { clean: s, valid: true };
    } catch { return { clean: null, valid: false }; }
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Normalize payment settings coming from the form-settings API. Amount is in
// the presentation unit (rupees); tiers are [{ label, amount }] where amount
// is also rupees. Returns { clean, error }.
const parsePaymentConfig = (p) => {
    const enabled = !!p.payment_enabled;
    if (!enabled) {
        return { clean: { enabled: 0, mode: null, amount: null, currency: null, tiers: null, description: null } };
    }
    const validModes = new Set(['fixed', 'tiered', 'award_category']);
    const mode = validModes.has(p.payment_mode) ? p.payment_mode : 'fixed';
    const currency = (p.payment_currency || 'INR').toUpperCase().slice(0, 10);
    const description = p.payment_description ? String(p.payment_description).slice(0, 500) : null;

    if (mode === 'award_category') {
        // Amount comes from the selected award category at submit time — no
        // fixed amount or tier list needed here. The admin is expected to set
        // per-category fees on the Award Categories page.
        return { clean: { enabled: 1, mode, amount: null, currency, tiers: null, description } };
    }
    if (mode === 'fixed') {
        const amt = Number(p.payment_amount);
        if (!(amt > 0)) return { error: 'Payment amount must be greater than 0' };
        return { clean: { enabled: 1, mode, amount: amt, currency, tiers: null, description } };
    }
    const rawTiers = Array.isArray(p.payment_tiers) ? p.payment_tiers : [];
    const tiers = rawTiers
        .map(t => {
            // Keep `valid_until` in the exact "YYYY-MM-DDTHH:MM" shape the
            // datetime-local input uses. Storing as-is means:
            //   - perfect round-trip back into the input on reload
            //   - no timezone drift (we're comparing against browser/server
            //     local time which both interpret this format as local)
            let vu = null;
            if (t?.valid_until) {
                const s = String(t.valid_until).trim();
                // Accept either "YYYY-MM-DDTHH:MM" or a parseable ISO; strip
                // to the input's canonical format so load-round-trip works.
                const d = new Date(s);
                if (!isNaN(d.getTime())) {
                    const pad = n => String(n).padStart(2, '0');
                    vu = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
                }
            }
            return {
                label: String(t?.label || '').trim(),
                amount: Number(t?.amount),
                valid_until: vu,
            };
        })
        .filter(t => t.label && t.amount > 0);
    if (tiers.length === 0) return { error: 'Tiered pricing needs at least one tier with a label and amount' };
    // De-duplicate labels — Razorpay notes and tier matching use the label as key.
    const seen = new Set();
    for (const t of tiers) {
        const k = t.label.toLowerCase();
        if (seen.has(k)) return { error: `Duplicate tier label "${t.label}"` };
        seen.add(k);
    }
    return { clean: { enabled: 1, mode, amount: null, currency, tiers, description } };
};
const parseNotifyEmails = (raw) => {
    if (!raw || !String(raw).trim()) return { clean: null, invalid: [] };
    const tokens = String(raw)
        .split(/[,;\s]+/)
        .map(t => t.trim())
        .filter(Boolean);
    const invalid = tokens.filter(t => !EMAIL_RE.test(t));
    if (invalid.length) return { clean: null, invalid };
    const unique = Array.from(new Set(tokens.map(t => t.toLowerCase())));
    return { clean: unique.join(', '), invalid: [] };
};

// Form-uploaded files go through the shared storage adapter (S3 if configured,
// else local disk) so the app can run with multiple backend instances.
const upload = createUpload('form', { limits: { fileSize: 20 * 1024 * 1024 }, source: 'forms' });

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

// Collapse a submission's { fieldId: value } payload into a readable HTML
// table for the notification email. `fields` is the authoritative field list
// so the email shows labels in the order the form was designed.
const renderSubmissionEmail = (form, fields, data) => {
    const rows = fields.map(f => {
        const v = data[f.id];
        let display;
        if (v === null || v === undefined || v === '') {
            display = '<span style="color:#94a3b8">—</span>';
        } else if (Array.isArray(v)) {
            display = v.join(', ');
        } else if (typeof v === 'object' && v.url) {
            // File upload value
            display = `<a href="${v.url}" style="color:#8b5cf6">${v.name || 'Download'}</a>`;
        } else if (typeof v === 'object' && (v.sector_name || v.category_name)) {
            // Award-category path: "Sector → Category → Subcategory"
            display = [v.sector_name, v.category_name, v.subcategory_name].filter(Boolean).join(' → ');
        } else {
            display = String(v).replace(/</g, '&lt;');
        }
        return `<tr><td style="padding:8px 12px;border-bottom:1px solid #eef0f3;color:#64748b;font-size:13px;vertical-align:top;width:40%">${f.label}</td><td style="padding:8px 12px;border-bottom:1px solid #eef0f3;color:#0f172a;font-size:14px">${display}</td></tr>`;
    }).join('');
    return `
        <div style="font-family:Inter,system-ui,sans-serif;background:#f8fafc;padding:24px">
            <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
                <div style="background:linear-gradient(135deg,#8b5cf6,#ec4899);color:#fff;padding:20px 24px">
                    <div style="font-size:12px;letter-spacing:0.1em;text-transform:uppercase;opacity:0.85">New Form Submission</div>
                    <div style="font-size:20px;font-weight:700;margin-top:4px">${form.title}</div>
                </div>
                <table style="width:100%;border-collapse:collapse">${rows || '<tr><td style="padding:20px;color:#94a3b8">No answers</td></tr>'}</table>
                <div style="padding:14px 24px;background:#f8fafc;color:#64748b;font-size:12px;text-align:center">
                    Submitted at ${new Date().toLocaleString()}
                </div>
            </div>
        </div>
    `;
};

// ──────────────────────────────────────────────────────────────
// PUBLIC ROUTES (unauthenticated)
// ──────────────────────────────────────────────────────────────

// GET /public/:id — return form + fields for the public fill page.
router.get('/public/:id', async (req, res) => {
    try {
        const [forms] = await db.query(
            `SELECT f.id, f.tenant_id, f.title, f.description, f.thank_you_message, f.redirect_url,
                    f.submit_label, f.is_active, f.max_submissions, f.close_at,
                    f.payment_enabled, f.payment_mode, f.payment_amount, f.payment_currency,
                    f.payment_tiers_json, f.payment_description,
                    f.header_image_url, f.background_color, f.captcha_enabled,
                    f.theme, f.theme_config,
                    f.event_id, e.title AS event_title,
                    e.primary_color, e.secondary_color, e.font_family, e.event_logo_url
             FROM forms f
             LEFT JOIN events e ON f.event_id = e.id AND f.tenant_id = e.tenant_id
             WHERE f.id = ?`,
            [req.params.id]
        );
        if (forms.length === 0 || !forms[0].is_active) {
            return res.status(404).json({ error: 'Form not found' });
        }
        const form = forms[0];

        // Evaluate "can still accept responses?" so the public UI can show a
        // clean closed state instead of erroring only on submit.
        const [[{ cnt } = {}]] = await db.query(
            'SELECT COUNT(*) AS cnt FROM form_submissions WHERE form_id = ?',
            [req.params.id]
        );
        const now = new Date();
        const isClosedByDate = form.close_at && new Date(form.close_at) < now;
        const isFull = form.max_submissions && cnt >= form.max_submissions;
        form.is_open = !isClosedByDate && !isFull;
        form.close_reason = isClosedByDate ? 'closed_by_date'
            : isFull ? 'full' : null;

        const [fields] = await db.query(
            `SELECT id, field_type, label, placeholder, help_text, required, options_json, condition_json, width, sequence
             FROM form_fields WHERE form_id = ? ORDER BY sequence ASC, id ASC`,
            [req.params.id]
        );

        // If any field is an award-category selector, include the event's
        // categories + subcategories so the client can render cascading
        // dropdowns without a second authenticated call.
        let awardCategories = [];
        const hasAwardField = fields.some(f => f.field_type === 'award_category');
        if (hasAwardField && form.event_id) {
            const [rows] = await db.query(
                `SELECT id, name, parent_id, amount
                 FROM award_categories
                 WHERE tenant_id = ? AND event_id = ?
                 ORDER BY COALESCE(parent_id, id), parent_id IS NOT NULL, name ASC`,
                [form.tenant_id || null, form.event_id]
            );
            awardCategories = rows;
        }

        // Strip tenant_id before responding — it's used internally only.
        // eslint-disable-next-line no-unused-vars
        const { tenant_id, payment_tiers_json, theme_config, ...publicForm } = form;
        const payment_tiers = parseJsonMaybe(payment_tiers_json) || [];
        // Hand the client a captcha challenge if the admin enabled it.
        const captcha = publicForm.captcha_enabled ? generateMathCaptcha() : null;
        res.json({
            ...publicForm,
            payment_enabled: !!publicForm.payment_enabled,
            captcha_enabled: !!publicForm.captcha_enabled,
            theme: publicForm.theme || 'classic',
            theme_config: parseJsonMaybe(theme_config) || {},
            captcha,
            payment_tiers,
            award_categories: awardCategories,
            fields: fields.map(f => ({
                ...f,
                required: !!f.required,
                width: f.width || 'full',
                options: parseJsonMaybe(f.options_json) || [],
                condition: parseJsonMaybe(f.condition_json) || null,
                options_json: undefined,
                condition_json: undefined,
            })),
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /public/:id/upload — accept a single file for a file-type field.
// Returns { url, name, size, mime } that the client then sticks into the
// `data` payload under the field id when it submits.
router.post('/public/:id/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const [[form]] = await db.query('SELECT id, is_active FROM forms WHERE id = ?', [req.params.id]);
        if (!form || !form.is_active) {
            return res.status(404).json({ error: 'Form not found or closed' });
        }
        res.status(201).json({
            url: fileUrl(req.file),
            name: req.file.originalname,
            size: req.file.size,
            mime: req.file.mimetype,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /public/:id/submit — anyone with the form URL can submit.
router.post('/public/:id/submit', async (req, res) => {
    try {
        const formId = req.params.id;
        const [forms] = await db.query(
            `SELECT id, tenant_id, event_id, title, is_active, notify_email, max_submissions, close_at, redirect_url, payment_enabled, captcha_enabled
             FROM forms WHERE id = ?`,
            [formId]
        );
        if (forms.length === 0 || !forms[0].is_active) {
            return res.status(404).json({ error: 'Form not found or closed' });
        }
        const form = forms[0];
        const tenantId = form.tenant_id;
        // Paid forms must go through /api/payments/public/verify instead.
        if (form.payment_enabled) {
            return res.status(400).json({ error: 'This form requires payment — use the Pay & Submit flow' });
        }

        // Math captcha — verify the signed token + answer the client sent
        // before doing any other work. Wrong/missing/expired → 400.
        if (form.captcha_enabled) {
            const ok = verifyMathCaptcha(req.body?.captcha_token, req.body?.captcha_answer);
            if (!ok) {
                return res.status(400).json({ error: 'Captcha answer is incorrect or has expired. Please refresh and try again.' });
            }
        }

        // Close-date guard.
        if (form.close_at && new Date(form.close_at) < new Date()) {
            return res.status(403).json({ error: 'This form is closed and no longer accepting responses.' });
        }

        // Submission-cap guard.
        if (form.max_submissions) {
            const [[{ cnt } = {}]] = await db.query(
                'SELECT COUNT(*) AS cnt FROM form_submissions WHERE form_id = ?',
                [formId]
            );
            if (cnt >= form.max_submissions) {
                return res.status(403).json({ error: 'This form has reached its submission limit.' });
            }
        }

        const [fields] = await db.query(
            'SELECT id, field_type, label, required, options_json, condition_json FROM form_fields WHERE form_id = ?',
            [formId]
        );
        const incoming = req.body?.data || {};
        const cleaned = {};

        // Evaluates `cond` ({ field_id, op, value }) against the incoming data.
        // Falls open (returns true) when no condition is set or referenced
        // field is missing — matches the public form's behavior.
        const evalCondition = (cond) => {
            if (!cond || !cond.field_id) return true;
            const v = incoming[cond.field_id];
            const isEmpty = v === undefined || v === null ||
                (typeof v === 'string' && v.trim() === '') ||
                (Array.isArray(v) && v.length === 0) ||
                v === false;
            switch (cond.op) {
                case 'is_filled': return !isEmpty;
                case 'is_empty':  return isEmpty;
                case 'not_equals':
                    if (Array.isArray(v)) return !v.includes(cond.value);
                    return String(v ?? '') !== String(cond.value ?? '');
                case 'equals':
                default:
                    if (Array.isArray(v)) return v.includes(cond.value);
                    if (typeof v === 'boolean') return String(v) === String(cond.value);
                    return String(v ?? '') === String(cond.value ?? '');
            }
        };

        for (const f of fields) {
            const cond = parseJsonMaybe(f.condition_json);
            const visible = evalCondition(cond);
            if (!visible) { cleaned[f.id] = null; continue; }
            const raw = incoming[f.id];
            const isEmpty = raw === undefined || raw === null ||
                (typeof raw === 'string' && raw.trim() === '') ||
                (Array.isArray(raw) && raw.length === 0);
            if (f.required && isEmpty) {
                return res.status(400).json({ error: `"${f.label}" is required` });
            }
            if (isEmpty) { cleaned[f.id] = null; continue; }

            if (f.field_type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(raw).trim())) {
                return res.status(400).json({ error: `"${f.label}" must be a valid email` });
            }
            if (f.field_type === 'number' && isNaN(Number(raw))) {
                return res.status(400).json({ error: `"${f.label}" must be a number` });
            }
            if (f.field_type === 'checkbox') {
                cleaned[f.id] = Array.isArray(raw) ? raw : [raw];
            } else if (f.field_type === 'file') {
                // Expected shape is { url, name, size, mime } from /upload.
                if (typeof raw === 'object' && raw.url) cleaned[f.id] = raw;
                else cleaned[f.id] = null;
            } else if (f.field_type === 'award_category') {
                // Client sends { sector_id, category_id?, subcategory_id? }.
                // Resolve to a full readable path and keep ids so admins can
                // still sort / group by either level later.
                const sectorId = raw && raw.sector_id ? Number(raw.sector_id) : null;
                const catId = raw && raw.category_id ? Number(raw.category_id) : null;
                const subId = raw && raw.subcategory_id ? Number(raw.subcategory_id) : null;
                if (!sectorId) { cleaned[f.id] = null; continue; }
                const ids = [sectorId, catId, subId].filter(Boolean);
                const [cats] = await db.query(
                    `SELECT id, name, parent_id FROM award_categories
                     WHERE tenant_id = ? AND event_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
                    [tenantId, form.event_id || null, ...ids]
                );
                const sector = cats.find(c => c.id === sectorId && c.parent_id == null);
                const cat = catId ? cats.find(c => c.id === catId && Number(c.parent_id) === sectorId) : null;
                const sub = subId && cat ? cats.find(c => c.id === subId && Number(c.parent_id) === catId) : null;
                if (!sector) return res.status(400).json({ error: `"${f.label}" sector is invalid` });
                if (catId && !cat) return res.status(400).json({ error: `"${f.label}" category is invalid` });
                if (subId && !sub) return res.status(400).json({ error: `"${f.label}" subcategory is invalid` });
                cleaned[f.id] = {
                    sector_id: sector.id, sector_name: sector.name,
                    category_id: cat ? cat.id : null, category_name: cat ? cat.name : null,
                    subcategory_id: sub ? sub.id : null, subcategory_name: sub ? sub.name : null,
                };
            } else {
                cleaned[f.id] = typeof raw === 'string' ? raw.trim() : raw;
            }
        }

        const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
            .toString().split(',')[0].trim().slice(0, 45);
        await db.query(
            'INSERT INTO form_submissions (tenant_id, form_id, data_json, submitter_ip) VALUES (?, ?, ?, ?)',
            [tenantId, formId, JSON.stringify(cleaned), ip || null]
        );

        // Fire-and-forget email notification. Failure never blocks the
        // submission response. If SMTP isn't configured we log and move on.
        if (form.notify_email) {
            const absoluteBase = `${req.headers['x-forwarded-proto'] || req.protocol || 'http'}://${req.headers['x-forwarded-host'] || req.get('host')}`;
            // Rewrite /uploads/... file-field URLs to absolute for the email.
            const dataForEmail = Object.fromEntries(Object.entries(cleaned).map(([k, v]) => {
                if (v && typeof v === 'object' && v.url && v.url.startsWith('/')) {
                    return [k, { ...v, url: `${absoluteBase}${v.url}` }];
                }
                return [k, v];
            }));
            sendMail({
                to: form.notify_email,
                subject: `New response on "${form.title}"`,
                html: renderSubmissionEmail(form, fields, dataForEmail),
                tenantId,
            }).then(r => {
                if (r?.skipped) console.warn('Form notification email skipped:', r.reason);
            }).catch(err => console.error('Form notification email failed:', err.message));
        }

        res.status(201).json({ ok: true, redirect_url: form.redirect_url || null });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ──────────────────────────────────────────────────────────────
// AUTHENTICATED ROUTES
// ──────────────────────────────────────────────────────────────

router.get('/', protect, requireAdminOrManager, async (req, res) => {
    try {
        const [forms] = await db.query(
            `SELECT f.id, f.title, f.description, f.is_active, f.event_id, f.created_at,
                    e.title AS event_title,
                    (SELECT COUNT(*) FROM form_fields ff WHERE ff.form_id = f.id) AS field_count,
                    (SELECT COUNT(*) FROM form_submissions fs WHERE fs.form_id = f.id) AS submission_count
             FROM forms f
             LEFT JOIN events e ON f.event_id = e.id AND f.tenant_id = e.tenant_id
             WHERE f.tenant_id = ?
             ORDER BY f.created_at DESC`,
            [req.tenantId]
        );
        res.json(forms);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', protect, requireAdminOrManager, async (req, res) => {
    const { title, description, event_id, thank_you_message, redirect_url,
        submit_label, notify_email, max_submissions, close_at } = req.body;
    const cleanTitle = (title || '').trim();
    if (!cleanTitle) return res.status(400).json({ error: 'Form title is required' });
    const parsedEmail = parseNotifyEmails(notify_email);
    if (parsedEmail.invalid.length) {
        return res.status(400).json({ error: `Invalid email address: ${parsedEmail.invalid.join(', ')}` });
    }
    const parsedRedirect = parseRedirectUrl(redirect_url);
    if (!parsedRedirect.valid) return res.status(400).json({ error: 'Redirect URL must be a valid http(s) URL' });
    const parsedPayment = parsePaymentConfig(req.body);
    if (parsedPayment.error) return res.status(400).json({ error: parsedPayment.error });
    const pc = parsedPayment.clean;
    try {
        const [result] = await db.query(
            `INSERT INTO forms (tenant_id, title, description, event_id, thank_you_message, redirect_url,
                                submit_label, notify_email, max_submissions, close_at,
                                payment_enabled, payment_mode, payment_amount, payment_currency,
                                payment_tiers_json, payment_description, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.tenantId, cleanTitle, description || null, event_id || null, thank_you_message || null,
                parsedRedirect.clean, submit_label || null, parsedEmail.clean,
                max_submissions ? Math.max(1, parseInt(max_submissions, 10)) : null,
                close_at || null,
                pc.enabled, pc.mode, pc.amount, pc.currency,
                pc.tiers ? JSON.stringify(pc.tiers) : null, pc.description,
                req.user.id]
        );
        res.status(201).json({ id: result.insertId, message: 'Form created' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /:id/duplicate — deep clone (form row + all fields). Submissions are
// intentionally NOT copied so the new form starts fresh.
router.post('/:id/duplicate', protect, requireAdminOrManager, async (req, res) => {
    try {
        const [[src]] = await db.query(
            `SELECT title, description, event_id, thank_you_message, redirect_url, submit_label,
                    notify_email, max_submissions, close_at,
                    payment_enabled, payment_mode, payment_amount, payment_currency,
                    payment_tiers_json, payment_description
             FROM forms WHERE id=? AND tenant_id=?`,
            [req.params.id, req.tenantId]
        );
        if (!src) return res.status(404).json({ error: 'Form not found' });

        const [insert] = await db.query(
            `INSERT INTO forms (tenant_id, title, description, event_id, thank_you_message, redirect_url,
                                submit_label, notify_email, max_submissions, close_at,
                                payment_enabled, payment_mode, payment_amount, payment_currency,
                                payment_tiers_json, payment_description, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.tenantId, `${src.title} (copy)`, src.description, src.event_id, src.thank_you_message,
                src.redirect_url, src.submit_label, src.notify_email, src.max_submissions, src.close_at,
                src.payment_enabled, src.payment_mode, src.payment_amount, src.payment_currency,
                src.payment_tiers_json, src.payment_description,
                req.user.id]
        );
        const newId = insert.insertId;

        const [fields] = await db.query(
            `SELECT field_type, label, placeholder, help_text, required, options_json, condition_json, width, sequence
             FROM form_fields WHERE form_id = ? AND tenant_id = ?
             ORDER BY sequence ASC, id ASC`,
            [req.params.id, req.tenantId]
        );
        for (const f of fields) {
            await db.query(
                `INSERT INTO form_fields (tenant_id, form_id, field_type, label, placeholder, help_text,
                                          required, options_json, condition_json, width, sequence)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [req.tenantId, newId, f.field_type, f.label, f.placeholder, f.help_text,
                    f.required, f.options_json, f.condition_json, f.width || 'full', f.sequence]
            );
        }
        res.status(201).json({ id: newId, message: 'Form duplicated' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', protect, requireAdminOrManager, async (req, res) => {
    try {
        const [forms] = await db.query(
            `SELECT id, title, description, event_id, thank_you_message, redirect_url, submit_label,
                    notify_email, max_submissions, close_at, is_active, created_at,
                    payment_enabled, payment_mode, payment_amount, payment_currency,
                    payment_tiers_json, payment_description,
                    header_image_url, background_color, captcha_enabled,
                    theme, theme_config
             FROM forms WHERE id = ? AND tenant_id = ?`,
            [req.params.id, req.tenantId]
        );
        if (forms.length === 0) return res.status(404).json({ error: 'Form not found' });
        const [fields] = await db.query(
            `SELECT id, field_type, label, placeholder, help_text, required, options_json, condition_json, width, sequence
             FROM form_fields WHERE form_id = ? AND tenant_id = ?
             ORDER BY sequence ASC, id ASC`,
            [req.params.id, req.tenantId]
        );
        // eslint-disable-next-line no-unused-vars
        const { payment_tiers_json, theme_config, ...rest } = forms[0];
        res.json({
            ...rest,
            payment_enabled: !!rest.payment_enabled,
            captcha_enabled: !!rest.captcha_enabled,
            theme: rest.theme || 'classic',
            theme_config: parseJsonMaybe(theme_config) || {},
            payment_tiers: parseJsonMaybe(payment_tiers_json) || [],
            fields: fields.map(f => ({
                ...f,
                required: !!f.required,
                width: f.width || 'full',
                options: parseJsonMaybe(f.options_json) || [],
                condition: parseJsonMaybe(f.condition_json) || null,
                options_json: undefined,
                condition_json: undefined,
            })),
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Theme presets. Their visual rules live on the client; here we only
// validate that the chosen key is one we know about, so an unbounded
// string can't end up in the column.
const THEME_PRESETS = ['classic', 'minimal', 'gradient', 'dark', 'bordered'];

// Subset of theme_config keys we accept. Anything outside this list is
// silently dropped so an attacker can't cram arbitrary JSON into the
// rendered `<style>` tag downstream. Values are stored as-is — the
// client renders them via CSS variables, where bad values just produce
// invalid CSS that browsers ignore.
const THEME_CONFIG_KEYS = [
    'primary', 'accent', 'background', 'surface', 'text', 'mutedText',
    'fontFamily', 'fontSize', 'cardWidth', 'cardRadius', 'fieldRadius',
    'fieldSpacing', 'fieldStyle', 'headerOverlay'
];

function sanitizeThemeConfig(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const clean = {};
    for (const k of THEME_CONFIG_KEYS) {
        const v = raw[k];
        if (v === undefined || v === null || v === '') continue;
        // Strings only, capped at 80 chars to prevent absurd payloads.
        clean[k] = String(v).slice(0, 80);
    }
    return Object.keys(clean).length ? clean : null;
}

router.put('/:id', protect, requireAdminOrManager, async (req, res) => {
    const { title, description, event_id, thank_you_message, redirect_url, submit_label,
        notify_email, max_submissions, close_at, is_active,
        header_image_url, background_color, captcha_enabled,
        theme, theme_config } = req.body;
    const cleanTitle = (title || '').trim();
    if (!cleanTitle) return res.status(400).json({ error: 'Form title is required' });
    const parsedEmail = parseNotifyEmails(notify_email);
    if (parsedEmail.invalid.length) {
        return res.status(400).json({ error: `Invalid email address: ${parsedEmail.invalid.join(', ')}` });
    }
    const parsedRedirect = parseRedirectUrl(redirect_url);
    if (!parsedRedirect.valid) return res.status(400).json({ error: 'Redirect URL must be a valid http(s) URL' });
    const parsedPayment = parsePaymentConfig(req.body);
    if (parsedPayment.error) return res.status(400).json({ error: parsedPayment.error });
    const pc = parsedPayment.clean;
    const cleanTheme = THEME_PRESETS.includes(theme) ? theme : 'classic';
    const cleanThemeConfig = sanitizeThemeConfig(theme_config);
    try {
        const [result] = await db.query(
            `UPDATE forms SET title=?, description=?, event_id=?, thank_you_message=?, redirect_url=?, submit_label=?,
                              notify_email=?, max_submissions=?, close_at=?, is_active=?,
                              payment_enabled=?, payment_mode=?, payment_amount=?, payment_currency=?,
                              payment_tiers_json=?, payment_description=?,
                              header_image_url=?, background_color=?, captcha_enabled=?,
                              theme=?, theme_config=?
             WHERE id=? AND tenant_id=?`,
            [cleanTitle, description || null, event_id || null, thank_you_message || null,
                parsedRedirect.clean, submit_label || null,
                parsedEmail.clean,
                max_submissions ? Math.max(1, parseInt(max_submissions, 10)) : null,
                close_at || null,
                is_active === undefined ? 1 : (is_active ? 1 : 0),
                pc.enabled, pc.mode, pc.amount, pc.currency,
                pc.tiers ? JSON.stringify(pc.tiers) : null, pc.description,
                (header_image_url || '').trim() || null,
                (background_color || '').trim() || null,
                captcha_enabled ? 1 : 0,
                cleanTheme, cleanThemeConfig ? JSON.stringify(cleanThemeConfig) : null,
                req.params.id, req.tenantId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Form not found' });
        res.json({ message: 'Form updated' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /:id/header-image — admin/manager uploads a banner image for the form.
// Stores under /uploads, immediately persists the URL to the form row, and
// returns the URL so the builder can show a preview without an extra GET.
router.post('/:id/header-image', protect, requireAdminOrManager, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        if (!req.file.mimetype?.startsWith('image/')) {
            return res.status(400).json({ error: 'File must be an image' });
        }
        const [[form]] = await db.query(
            'SELECT id FROM forms WHERE id=? AND tenant_id=?',
            [req.params.id, req.tenantId]
        );
        if (!form) return res.status(404).json({ error: 'Form not found' });

        const url = fileUrl(req.file);
        await db.query(
            'UPDATE forms SET header_image_url=? WHERE id=? AND tenant_id=?',
            [url, req.params.id, req.tenantId]
        );
        res.status(201).json({ url, name: req.file.originalname, size: req.file.size });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', protect, requireAdminOrManager, async (req, res) => {
    try {
        const [[cur]] = await db.query('SELECT id FROM forms WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        if (!cur) return res.status(404).json({ error: 'Form not found' });

        await db.query('DELETE FROM form_submissions WHERE form_id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        await db.query('DELETE FROM form_fields WHERE form_id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        await db.query('DELETE FROM forms WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        res.json({ message: 'Form deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /:id/fields — append a field at the end.
router.post('/:id/fields', protect, requireAdminOrManager, async (req, res) => {
    const { field_type, label, placeholder, help_text, required, options, width, condition } = req.body;
    if (!VALID_FIELD_TYPES.has(field_type)) {
        return res.status(400).json({ error: 'Invalid field type' });
    }
    const cleanLabel = (label || '').trim();
    if (!cleanLabel) return res.status(400).json({ error: 'Field label is required' });

    try {
        const [[form]] = await db.query('SELECT id FROM forms WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        if (!form) return res.status(404).json({ error: 'Form not found' });

        const [[maxSeq]] = await db.query(
            'SELECT COALESCE(MAX(sequence), 0) AS s FROM form_fields WHERE form_id=?',
            [req.params.id]
        );
        const nextSeq = (maxSeq?.s || 0) + 1;
        const [result] = await db.query(
            `INSERT INTO form_fields (tenant_id, form_id, field_type, label, placeholder, help_text,
                                      required, options_json, condition_json, width, sequence)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.tenantId, req.params.id, field_type, cleanLabel, placeholder || null, help_text || null,
                required ? 1 : 0, Array.isArray(options) && options.length ? JSON.stringify(options) : null,
                condition && typeof condition === 'object' ? JSON.stringify(condition) : null,
                normalizeWidth(width), nextSeq]
        );
        res.status(201).json({ id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/fields/:fieldId', protect, requireAdminOrManager, async (req, res) => {
    const { field_type, label, placeholder, help_text, required, options, width, condition } = req.body;
    if (field_type && !VALID_FIELD_TYPES.has(field_type)) {
        return res.status(400).json({ error: 'Invalid field type' });
    }
    const cleanLabel = (label || '').trim();
    if (label !== undefined && !cleanLabel) return res.status(400).json({ error: 'Field label is required' });

    try {
        const [result] = await db.query(
            `UPDATE form_fields
             SET field_type = COALESCE(?, field_type),
                 label      = COALESCE(?, label),
                 placeholder= ?,
                 help_text  = ?,
                 required   = ?,
                 options_json = ?,
                 condition_json = ?,
                 width      = ?
             WHERE id=? AND form_id=? AND tenant_id=?`,
            [field_type || null, cleanLabel || null, placeholder || null, help_text || null,
                required ? 1 : 0, Array.isArray(options) && options.length ? JSON.stringify(options) : null,
                condition && typeof condition === 'object' ? JSON.stringify(condition) : null,
                normalizeWidth(width),
                req.params.fieldId, req.params.id, req.tenantId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Field not found' });
        res.json({ message: 'Field updated' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/fields/:fieldId', protect, requireAdminOrManager, async (req, res) => {
    try {
        const [result] = await db.query(
            'DELETE FROM form_fields WHERE id=? AND form_id=? AND tenant_id=?',
            [req.params.fieldId, req.params.id, req.tenantId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Field not found' });
        res.json({ message: 'Field deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/fields/reorder', protect, requireAdminOrManager, async (req, res) => {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be an array of field ids' });
    try {
        for (let i = 0; i < order.length; i++) {
            await db.query(
                'UPDATE form_fields SET sequence=? WHERE id=? AND form_id=? AND tenant_id=?',
                [i + 1, order[i], req.params.id, req.tenantId]
            );
        }
        res.json({ message: 'Reordered' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/submissions', protect, requireAdminOrManager, async (req, res) => {
    try {
        const [[form]] = await db.query('SELECT id FROM forms WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        if (!form) return res.status(404).json({ error: 'Form not found' });

        const [subs] = await db.query(
            `SELECT id, data_json, submitter_ip, submitted_at,
                    payment_status, payment_id, payment_order_id, payment_amount,
                    payment_currency, payment_tier_label, payment_retry_token
             FROM form_submissions
             WHERE form_id=? AND tenant_id=?
             ORDER BY submitted_at DESC`,
            [req.params.id, req.tenantId]
        );
        res.json(subs.map(s => ({
            ...s,
            data: parseJsonMaybe(s.data_json) || {},
            data_json: undefined,
        })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id/submissions/:subId', protect, requireAdminOrManager, async (req, res) => {
    try {
        const [result] = await db.query(
            'DELETE FROM form_submissions WHERE id=? AND form_id=? AND tenant_id=?',
            [req.params.subId, req.params.id, req.tenantId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Submission not found' });
        res.json({ message: 'Submission deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
