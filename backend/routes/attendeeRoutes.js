const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const QRCode = require('qrcode');
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { requireSection } = require('../middleware/permissions');
// Per-employee section gate. Inline protect already runs first; this just
// adds the section check. Admins/managers always pass; employees pass when
// their permissions column is NULL or includes 'attendees'.
const guard = [protect, requireSection('attendees')];
const { checkLimit } = require('../middleware/limits');
const { notifyAdminsAndManagers } = require('../utils/notify');
const { sendMail } = require('../utils/mailer');
const { createUpload } = require('../utils/storage');
const csv = require('csv-parser');
const fs = require('fs');

// Random URL-safe token used as the QR payload. 16 bytes = 128 bits, more
// than enough entropy that a guesser can't enumerate valid tokens, and
// short enough to keep the QR low-density (easier scan in poor light).
const genCheckinToken = () => crypto.randomBytes(16).toString('hex');

// Generate a QR PNG buffer for embedding in emails as a cid attachment.
// Returned buffer is ready for nodemailer's `attachments: [{ content, cid }]`.
const buildQrPngBuffer = async (token) => {
    return await QRCode.toBuffer(token, {
        type: 'png',
        width: 280,
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#0f172a', light: '#ffffff' },
    });
};

// Default confirmation email template. Anything the tenant doesn't override
// in their saved template falls back here, so we always render something
// presentable even if the editor was never opened.
const DEFAULT_TEMPLATE = {
    subject: 'Registration confirmed — {{event_title}}',
    hero_title: "You're confirmed!",
    hero_subtitle: 'Registration confirmed by {{org_name}}',
    greeting: 'Hi {{name}},',
    intro: 'Thanks for registering. Your spot at the event is reserved — here are the details:',
    closing_1: 'Please save this email as your confirmation. Show it (or the QR code, if any) at check-in.',
    closing_2: 'Looking forward to seeing you there.',
    footer: "This is a one-time confirmation from {{org_name}}. If you didn't register for this event, please ignore this email.",
    brand_color: '',                 // empty = use event's primary_color, then fall back to #8b5cf6
    show_event: true,
    show_when: true,
    show_venue: true,
    show_ticket: true,
    show_status: true,
};

const TEMPLATE_VARIABLES = ['name', 'event_title', 'event_date', 'venue', 'ticket_type', 'status', 'org_name'];

const escapeHtml = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// {{variable}} substitution. Unknown variables are left as-is so the operator
// notices them in the preview rather than silently swallowing typos.
const fillVariables = (str, vars) => {
    if (!str) return '';
    return String(str).replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) =>
        Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? '') : m
    );
};

// Build the variable bag from an attendee + event + tenant. Used both at send
// time (real attendee) and during preview (sample placeholders).
const buildVariables = ({ attendee, event, tenant }) => {
    const dateRange = (() => {
        if (!event?.start_date) return '';
        const fmt = (d) => new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        if (!event.end_date || event.start_date === event.end_date) return fmt(event.start_date);
        return `${fmt(event.start_date)} – ${fmt(event.end_date)}`;
    })();
    const ticketLabel = (attendee?.ticket_type || 'general')
        .split(/[_\s]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return {
        name: attendee?.name || '',
        event_title: event?.title || '',
        event_date: dateRange,
        venue: event?.venue || '',
        ticket_type: ticketLabel,
        status: (attendee?.status || 'registered').replace(/_/g, ' '),
        org_name: tenant?.name || 'EventHub',
    };
};

// Merge any saved tenant template with defaults. Always returns a fully-
// populated template object so callers don't need to coalesce.
const mergeTemplate = (saved) => ({ ...DEFAULT_TEMPLATE, ...(saved || {}) });

// Render the confirmation email. `tplOverride` lets the test endpoint render
// a draft that hasn't been saved yet; otherwise we fetch from settings.
// Pass either `qrCid` (for outgoing emails — paired with a cid attachment)
// or `qrDataUrl` (for browser previews, where cid: can't resolve) to render
// the "Show this at check-in" panel. Pass neither to omit the QR.
const renderConfirmationEmail = ({ attendee, event, tenant, template, qrCid = null, qrDataUrl = null }) => {
    const tpl = mergeTemplate(template);
    const vars = buildVariables({ attendee, event, tenant });
    const fill = (s) => escapeHtml(fillVariables(s, vars));
    const accent = tpl.brand_color || event?.primary_color || '#8b5cf6';

    const detailRow = (show, label, value) => (show && value)
        ? `<tr><td style="padding: 8px 0; color: #64748b; font-size: 13px; width: 110px;">${label}</td>
                <td style="padding: 8px 0; color: #1e293b; font-size: 14px; font-weight: 600;">${escapeHtml(value)}</td></tr>`
        : '';

    // The QR block — centred on a light card so it stands out against the
    // email body. cid: resolves via nodemailer attachments; data: is used
    // for in-browser previews.
    const qrSrc = qrCid ? `cid:${qrCid}` : qrDataUrl;
    const qrBlock = qrSrc ? `
        <div style="text-align: center; padding: 24px 22px; margin-bottom: 22px; border-radius: 12px; background: #ffffff; border: 1px dashed ${accent};">
            <div style="font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: ${accent}; font-weight: 700; margin-bottom: 12px;">
                Show this at check-in
            </div>
            <img src="${qrSrc}" alt="Check-in QR" width="200" height="200" style="display: inline-block; width: 200px; height: 200px; border-radius: 8px;" />
            <div style="margin-top: 12px; color: #64748b; font-size: 12px;">
                Our team will scan this to mark you present.
            </div>
        </div>
    ` : '';

    return `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px; background: #f8fafc;">
            <div style="background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
                <div style="background: linear-gradient(135deg, ${accent}, #ec4899); padding: 36px 32px; text-align: center;">
                    <div style="width: 56px; height: 56px; border-radius: 14px; background: rgba(255,255,255,0.2); display: inline-flex; align-items: center; justify-content: center; font-size: 28px; color: #fff; margin-bottom: 14px;">✓</div>
                    <h2 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 700; letter-spacing: -0.01em;">${fill(tpl.hero_title)}</h2>
                    <p style="margin: 6px 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">${fill(tpl.hero_subtitle)}</p>
                </div>
                <div style="padding: 32px;">
                    <p style="color: #1e293b; font-size: 16px; line-height: 1.6; margin: 0 0 6px;">${fill(tpl.greeting)}</p>
                    <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">${fill(tpl.intro)}</p>
                    <div style="background: #f8fafc; border-radius: 12px; padding: 20px 22px; margin-bottom: 22px; border: 1px solid #e2e8f0;">
                        <table style="width: 100%; border-collapse: collapse;">
                            ${detailRow(tpl.show_event,  'Event',  vars.event_title)}
                            ${detailRow(tpl.show_when,   'When',   vars.event_date)}
                            ${detailRow(tpl.show_venue,  'Venue',  vars.venue)}
                            ${detailRow(tpl.show_ticket, 'Ticket', vars.ticket_type)}
                            ${detailRow(tpl.show_status, 'Status', vars.status)}
                        </table>
                    </div>
                    ${qrBlock}
                    <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 8px;">${fill(tpl.closing_1)}</p>
                    <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0;">${fill(tpl.closing_2)}</p>
                </div>
                <div style="background: #f8fafc; padding: 18px 32px; text-align: center; border-top: 1px solid #e2e8f0;">
                    <p style="color: #94a3b8; font-size: 12px; margin: 0;">${fill(tpl.footer)}</p>
                </div>
            </div>
        </div>
    `;
};

// Read the tenant's saved template (or null if never set). Stored as JSON in
// the existing settings (tenant_id, setting_key) table under one key.
const TEMPLATE_KEY = 'attendee_confirmation_template';
const loadTenantTemplate = async (tenantId) => {
    const [[row]] = await db.query(
        'SELECT setting_value FROM settings WHERE tenant_id = ? AND setting_key = ?',
        [tenantId, TEMPLATE_KEY]
    );
    if (!row?.setting_value) return null;
    try { return JSON.parse(row.setting_value); }
    catch { return null; }
};

const upload = createUpload('attendees-import');

// Multi-event aware access. The local `employeeAllowed` shim adds the
// per-event 'attendees' section check on top of basic event assignment.
const { hasSectionForEvent, assignedIdsOf, assignedIdsForSql, eventIdsForSection } = require('../utils/eventAccess');
const employeeAllowed = (req, event_id) => hasSectionForEvent(req.user, event_id, 'attendees');
const empAttendeeEventIds = (req) => eventIdsForSection(req.user, 'attendees');

// GET all attendees (optional ?event_id= filter)
router.get('/', guard, async (req, res) => {
    try {
        // Join `users` on checked_in_by so the row carries the name of the
        // staffer who scanned the delegate in. Lets the table show a "by
        // <name> at <time>" line under the Checked In status without an
        // extra round-trip.
        let query = `
            SELECT a.*, e.title as event_title, u.name as checked_in_by_name
            FROM attendees a
            LEFT JOIN events e ON a.event_id = e.id AND e.tenant_id = a.tenant_id
            LEFT JOIN users u ON a.checked_in_by = u.id
            WHERE a.tenant_id = ? AND a.deleted_at IS NULL
        `;
        const params = [req.tenantId];

        if (req.user.role === 'manager') {
            query += ' AND (e.created_by = ? OR a.event_id IN (?))';
            params.push(req.user.id, assignedIdsForSql(req.user));
        } else if (req.user.role === 'employee') {
            if (assignedIdsOf(req.user).length === 0) return res.json([]);
            query += ' AND a.event_id IN (?)';
            params.push(empAttendeeEventIds(req));
        }

        if (req.query.event_id) {
            query += ' AND a.event_id = ?';
            params.push(req.query.event_id);
        }
        if (req.query.ticket_type) {
            query += ' AND a.ticket_type = ?';
            params.push(req.query.ticket_type);
        }
        if (req.query.status) {
            query += ' AND a.status = ?';
            params.push(req.query.status);
        }
        query += ' ORDER BY a.created_at DESC';
        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// EXPORT attendees
router.get('/export', guard, async (req, res) => {
    try {
        let query = `
            SELECT a.*, e.title as event_title
            FROM attendees a
            LEFT JOIN events e ON a.event_id = e.id AND e.tenant_id = a.tenant_id
            WHERE a.tenant_id = ? AND a.deleted_at IS NULL
        `;
        const params = [req.tenantId];
        if (req.query.event_id) { query += ' AND a.event_id = ?'; params.push(req.query.event_id); }
        if (req.user.role === 'manager') { query += ' AND (e.created_by = ? OR a.event_id IN (?))'; params.push(req.user.id, assignedIdsForSql(req.user)); }
        else if (req.user.role === 'employee') { query += ' AND a.event_id IN (?)'; params.push(empAttendeeEventIds(req)); }

        const [rows] = await db.query(query, params);

        const csvHeader = 'Name,Email,Phone,Company,Designation,Ticket Type,Status,Event,Notes\n';
        const csvRows = rows.map(a =>
            `"${a.name}","${a.email || ''}","${a.phone || ''}","${a.company || ''}","${a.designation || ''}","${a.ticket_type}","${a.status}","${a.event_title || ''}","${(a.notes || '').replace(/"/g, '""')}"`
        ).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=attendees.csv');
        res.send(csvHeader + csvRows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// IMPORT attendees
router.post('/import', guard, upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const event_id = req.query.event_id || null;
    const tenantId = req.tenantId;
    const attendees = [];

    fs.createReadStream(req.file.path)
        .pipe(csv())
        .on('data', (data) => {
            attendees.push({
                name: data.Name || data.name || '',
                email: data.Email || data.email || null,
                phone: data.Phone || data.phone || null,
                company: data.Company || data.company || null,
                designation: data.Designation || data.designation || null,
                ticket_type: (data['Ticket Type'] || data.ticket_type || 'general').toLowerCase(),
                status: (data.Status || data.status || 'registered').toLowerCase(),
                notes: data.Notes || data.notes || '',
                event_id: event_id,
                created_by: req.user.id
            });
        })
        .on('end', async () => {
            try {
                if (attendees.length === 0) return res.status(400).json({ error: 'CSV is empty' });

                // Duplicate detection: check existing attendees by name+email in same event
                const [existing] = await db.query(
                    'SELECT LOWER(TRIM(name)) as name_key, LOWER(TRIM(COALESCE(email, ""))) as email_key FROM attendees WHERE event_id = ? AND tenant_id = ? AND deleted_at IS NULL',
                    [event_id, tenantId]
                );
                const existingSet = new Set(existing.map(e => `${e.name_key}||${e.email_key}`));

                const newAttendees = attendees.filter(a => {
                    const key = `${(a.name || '').trim().toLowerCase()}||${(a.email || '').trim().toLowerCase()}`;
                    return !existingSet.has(key);
                });
                const skipped = attendees.length - newAttendees.length;

                if (newAttendees.length > 0) {
                    const query = 'INSERT INTO attendees (tenant_id, name, email, phone, company, designation, ticket_type, status, notes, event_id, created_by, checkin_token) VALUES ?';
                    // Each imported row gets a fresh check-in token so it can
                    // be scanned on event day just like manually-added rows.
                    const values = newAttendees.map(a => [tenantId, a.name, a.email, a.phone, a.company, a.designation, a.ticket_type, a.status, a.notes, a.event_id, a.created_by, genCheckinToken()]);
                    await db.query(query, [values]);
                }
                fs.unlinkSync(req.file.path);
                let message = `${newAttendees.length} attendees imported successfully`;
                if (skipped > 0) message += ` (${skipped} duplicates skipped)`;
                res.json({ message, imported: newAttendees.length, skipped });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });
});

// GET attendee stats summary
router.get('/stats/summary', guard, async (req, res) => {
    try {
        let joinClause = '';
        let whereClause = 'WHERE a.tenant_id = ? AND a.deleted_at IS NULL';
        let params = [req.tenantId];

        if (req.user.role === 'manager') {
            joinClause = 'JOIN events e ON a.event_id = e.id AND e.tenant_id = a.tenant_id';
            whereClause += ' AND (e.created_by = ? OR a.event_id IN (?))';
            params.push(req.user.id, assignedIdsForSql(req.user));
        } else if (req.user.role === 'employee') {
            if (assignedIdsOf(req.user).length === 0) return res.json({ total: 0, byStatus: [], byTicketType: [] });
            whereClause += ' AND a.event_id IN (?)';
            params.push(empAttendeeEventIds(req));
        }

        const [statusStats] = await db.query(`
            SELECT a.status, COUNT(a.id) as count FROM attendees a ${joinClause} ${whereClause} GROUP BY a.status
        `, params);
        const [ticketStats] = await db.query(`
            SELECT a.ticket_type, COUNT(a.id) as count FROM attendees a ${joinClause} ${whereClause} GROUP BY a.ticket_type
        `, params);
        const [total] = await db.query(`SELECT COUNT(a.id) as total FROM attendees a ${joinClause} ${whereClause}`, params);

        res.json({
            total: total[0].total || 0,
            byStatus: statusStats,
            byTicketType: ticketStats
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/attendees/reports/breakdown — per-event registration vs check-in
// breakdown for the Reports page. Returns one row per event the caller can
// see, plus an `overall` summary, so the charts can render without doing
// extra grouping client-side.
//
// Same role scoping as the rest of the file: managers see only events they
// own or are assigned to; employees see only their assigned event.
router.get('/reports/breakdown', guard, async (req, res) => {
    try {
        let where = 'WHERE a.tenant_id = ? AND a.deleted_at IS NULL';
        const params = [req.tenantId];

        if (req.user.role === 'manager') {
            where += ' AND (e.created_by = ? OR a.event_id IN (?))';
            params.push(req.user.id, assignedIdsForSql(req.user));
        } else if (req.user.role === 'employee') {
            if (assignedIdsOf(req.user).length === 0) return res.json({ events: [], overall: { total: 0, checked_in: 0 } });
            where += ' AND a.event_id IN (?)';
            params.push(empAttendeeEventIds(req));
        }

        // Optional event_id filter so the inline Reports panel can scope the
        // breakdown to whatever's selected in the page-level Event filter —
        // applied AFTER role scoping so a manager can't peek at an event
        // they don't own by passing an id in the URL.
        if (req.query.event_id) {
            where += ' AND a.event_id = ?';
            params.push(req.query.event_id);
        }

        // Per-event aggregation. NULL event_id (unassigned attendees) is
        // grouped under a single "No event" bucket so the chart still shows
        // them rather than dropping them silently.
        const [rows] = await db.query(`
            SELECT
                a.event_id,
                COALESCE(e.title, 'No event') AS event_title,
                COUNT(a.id) AS total,
                SUM(CASE WHEN a.status = 'checked_in' OR a.checked_in_at IS NOT NULL THEN 1 ELSE 0 END) AS checked_in,
                SUM(CASE WHEN a.status = 'registered' THEN 1 ELSE 0 END) AS registered,
                SUM(CASE WHEN a.status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
                SUM(CASE WHEN a.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
            FROM attendees a
            LEFT JOIN events e ON a.event_id = e.id AND e.tenant_id = a.tenant_id
            ${where}
            GROUP BY a.event_id, e.title
            ORDER BY total DESC
        `, params);

        // Ticket-type breakdown across the visible scope.
        const [ticketRows] = await db.query(`
            SELECT a.ticket_type, COUNT(a.id) AS count
            FROM attendees a
            LEFT JOIN events e ON a.event_id = e.id AND e.tenant_id = a.tenant_id
            ${where}
            GROUP BY a.ticket_type
        `, params);

        const overall = rows.reduce((acc, r) => {
            acc.total += Number(r.total) || 0;
            acc.checked_in += Number(r.checked_in) || 0;
            acc.registered += Number(r.registered) || 0;
            acc.confirmed += Number(r.confirmed) || 0;
            acc.cancelled += Number(r.cancelled) || 0;
            return acc;
        }, { total: 0, checked_in: 0, registered: 0, confirmed: 0, cancelled: 0 });

        res.json({
            events: rows.map(r => ({
                event_id: r.event_id,
                event_title: r.event_title,
                total: Number(r.total) || 0,
                checked_in: Number(r.checked_in) || 0,
                not_checked_in: Math.max(0, (Number(r.total) || 0) - (Number(r.checked_in) || 0)),
                registered: Number(r.registered) || 0,
                confirmed: Number(r.confirmed) || 0,
                cancelled: Number(r.cancelled) || 0,
            })),
            overall,
            byTicketType: ticketRows.map(t => ({ ticket_type: t.ticket_type, count: Number(t.count) || 0 })),
        });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Failed to load reports breakdown' });
    }
});

// ─── Email template editor ───
// Admin + manager only; employees can send confirmations but can't edit the
// template. Routes live BEFORE /:id so Express doesn't treat "email-template"
// as an attendee id.
const requireAdminOrManager = (req, res, next) => {
    if (req.user?.role !== 'admin' && req.user?.role !== 'manager') {
        return res.status(403).json({ error: 'Only admin or manager can edit the email template' });
    }
    next();
};
const templateGuard = [protect, requireSection('attendees'), requireAdminOrManager];

// GET /api/attendees/email-template — returns the merged template (saved on
// top of defaults) plus the defaults and the variable list, so the editor
// can render placeholders, the "Reset" button, and the variable chips.
router.get('/email-template', templateGuard, async (req, res) => {
    try {
        const saved = await loadTenantTemplate(req.tenantId);
        res.json({
            template: mergeTemplate(saved),
            defaults: DEFAULT_TEMPLATE,
            variables: TEMPLATE_VARIABLES,
            is_customised: !!saved,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/attendees/email-template — save (or partially update) the
// tenant's template. Pass `{ template: null }` to reset to defaults.
router.put('/email-template', templateGuard, async (req, res) => {
    try {
        const incoming = req.body?.template;
        if (incoming === null) {
            await db.query('DELETE FROM settings WHERE tenant_id = ? AND setting_key = ?', [req.tenantId, TEMPLATE_KEY]);
            return res.json({ ok: true, template: DEFAULT_TEMPLATE, is_customised: false });
        }
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
            return res.status(400).json({ error: 'template must be an object or null' });
        }
        // Whitelist only the keys the renderer knows about — silently drop
        // anything else so a stale field can't bloat the row over time.
        const cleaned = {};
        for (const k of Object.keys(DEFAULT_TEMPLATE)) {
            if (Object.prototype.hasOwnProperty.call(incoming, k)) cleaned[k] = incoming[k];
        }
        const merged = mergeTemplate(cleaned);
        await db.query(
            'INSERT INTO settings (tenant_id, setting_key, setting_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
            [req.tenantId, TEMPLATE_KEY, JSON.stringify(merged)]
        );
        res.json({ ok: true, template: merged, is_customised: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/attendees/email-template/test — send a test email to the current
// user using the supplied draft template (or the saved one if none provided)
// and sample placeholder values. Lets the operator verify formatting / SMTP
// delivery without bothering a real attendee.
router.post('/email-template/test', templateGuard, async (req, res) => {
    try {
        const targetEmail = (req.body?.to || req.user.email || '').trim();
        if (!targetEmail) return res.status(400).json({ error: 'no email on file to send the test to' });

        const draft = (req.body?.template && typeof req.body.template === 'object') ? req.body.template : null;
        const tpl = mergeTemplate(draft || (await loadTenantTemplate(req.tenantId)));

        const [[tenant]] = await db.query('SELECT name FROM tenants WHERE id = ?', [req.tenantId]);
        // Sample data so the placeholders render with realistic content.
        const sampleAttendee = { name: req.user.name || 'Sample Delegate', ticket_type: 'vip', status: 'confirmed' };
        const sampleEvent = {
            title: 'Annual Tech Summit 2026',
            start_date: '2026-09-12',
            end_date: '2026-09-13',
            venue: 'Bharat Mandapam, New Delhi',
            primary_color: tpl.brand_color || '#8b5cf6',
        };
        // Throwaway QR for the test send so operators see the rendered
        // check-in panel without us having to invent an attendee row.
        const sampleToken = genCheckinToken();
        const sampleCid = `checkin-qr-sample@eventhub`;
        const sampleBuf = await buildQrPngBuffer(sampleToken);
        const html = renderConfirmationEmail({ attendee: sampleAttendee, event: sampleEvent, tenant, template: tpl, qrCid: sampleCid });
        const vars = buildVariables({ attendee: sampleAttendee, event: sampleEvent, tenant });
        const subject = `[TEST] ${fillVariables(tpl.subject, vars) || 'Registration confirmed'}`;
        const result = await sendMail({
            to: targetEmail, subject, html, tenantId: req.tenantId,
            attachments: [{ filename: 'checkin-qr.png', content: sampleBuf, cid: sampleCid }],
        });
        if (result?.skipped) return res.json({ ok: false, sent: false, skipped: result.reason });
        res.json({ ok: true, sent: true, to: targetEmail });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Test failed' });
    }
});

// POST /api/attendees/checkin — staff scanner endpoint.
//
// Body: { token, event_id? }. Returns 200 in all three semantic cases so
// the scanner UI can treat them uniformly without try/catch noise:
//
//   { status: 'success', attendee, checked_in_at } — first valid scan
//   { status: 'already', attendee, checked_in_at, checked_in_by_name } — repeat
//   { status: 'invalid', reason } — unknown token, wrong event, or no access
//
// Defined BEFORE any /:id route so '/checkin' isn't interpreted as an id.
router.post('/checkin', guard, async (req, res) => {
    try {
        const { token, event_id } = req.body || {};
        const cleanToken = String(token || '').trim();
        if (!cleanToken) {
            return res.status(400).json({ status: 'invalid', reason: 'Missing token' });
        }

        // Lookup is scoped to the caller's tenant so a stale QR from another
        // tenant can never check anyone in by mistake.
        const [[attendee]] = await db.query(
            `SELECT a.id, a.name, a.email, a.phone, a.company, a.designation,
                    a.ticket_type, a.status, a.event_id, a.checked_in_at, a.checked_in_by,
                    e.title AS event_title, e.created_by AS event_created_by,
                    u.name AS checked_in_by_name
             FROM attendees a
             LEFT JOIN events e ON a.event_id = e.id AND e.tenant_id = a.tenant_id
             LEFT JOIN users u ON a.checked_in_by = u.id
             WHERE a.checkin_token = ? AND a.tenant_id = ? AND a.deleted_at IS NULL`,
            [cleanToken, req.tenantId]
        );

        if (!attendee) {
            return res.json({ status: 'invalid', reason: 'Unknown QR — this code is not in the system.' });
        }

        // If the scanner page is locked to a specific event (which it should
        // be, so staff at "World AI Summit" don't accidentally admit someone
        // holding a ticket for a different event), enforce that here.
        if (event_id && String(attendee.event_id) !== String(event_id)) {
            return res.json({
                status: 'invalid',
                reason: `This ticket is for a different event (${attendee.event_title || 'unknown'}).`,
                attendee: { name: attendee.name, event_title: attendee.event_title },
            });
        }

        // Same scope rules as the rest of attendeeRoutes — managers can only
        // check in delegates for events they own or are assigned to,
        // employees only for their assigned event.
        if (req.user.role === 'manager') {
            const ok = attendee.event_created_by === req.user.id ||
                       assignedIdsOf(req.user).includes(Number(attendee.event_id));
            if (!ok) return res.json({ status: 'invalid', reason: 'You do not have access to this event.' });
        } else if (req.user.role === 'employee') {
            if (!employeeAllowed(req, attendee.event_id)) {
                return res.json({ status: 'invalid', reason: 'You can only check in delegates for your assigned event.' });
            }
        }

        // Already checked in — report who/when so staff can wave them through.
        if (attendee.checked_in_at) {
            return res.json({
                status: 'already',
                attendee: {
                    id: attendee.id,
                    name: attendee.name,
                    company: attendee.company,
                    designation: attendee.designation,
                    ticket_type: attendee.ticket_type,
                    event_title: attendee.event_title,
                },
                checked_in_at: attendee.checked_in_at,
                checked_in_by_name: attendee.checked_in_by_name,
            });
        }

        // Race-safe: only mark if it's still NULL. If two scanners hit the
        // same token simultaneously, the loser's UPDATE affects 0 rows and
        // we re-read to return the "already" payload.
        const [upd] = await db.query(
            `UPDATE attendees SET checked_in_at = NOW(), checked_in_by = ?, status = 'checked_in'
             WHERE id = ? AND tenant_id = ? AND checked_in_at IS NULL`,
            [req.user.id, attendee.id, req.tenantId]
        );
        if (upd.affectedRows === 0) {
            // Someone else won the race — fetch the winner and report.
            const [[fresh]] = await db.query(
                `SELECT a.checked_in_at, u.name AS checked_in_by_name
                 FROM attendees a LEFT JOIN users u ON a.checked_in_by = u.id
                 WHERE a.id = ? AND a.tenant_id = ?`,
                [attendee.id, req.tenantId]
            );
            return res.json({
                status: 'already',
                attendee: {
                    id: attendee.id, name: attendee.name,
                    company: attendee.company, designation: attendee.designation,
                    ticket_type: attendee.ticket_type, event_title: attendee.event_title,
                },
                checked_in_at: fresh?.checked_in_at,
                checked_in_by_name: fresh?.checked_in_by_name,
            });
        }

        res.json({
            status: 'success',
            attendee: {
                id: attendee.id,
                name: attendee.name,
                company: attendee.company,
                designation: attendee.designation,
                ticket_type: attendee.ticket_type,
                event_title: attendee.event_title,
            },
            checked_in_at: new Date().toISOString(),
        });
    } catch (err) {
        res.status(500).json({ status: 'invalid', reason: err.message || 'Check-in failed' });
    }
});

// GET single attendee
router.get('/:id', guard, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT a.*, e.title as event_title
            FROM attendees a
            LEFT JOIN events e ON a.event_id = e.id AND e.tenant_id = a.tenant_id
            WHERE a.id = ? AND a.tenant_id = ? AND a.deleted_at IS NULL
        `, [req.params.id, req.tenantId]);
        if (rows.length === 0) return res.status(404).json({ error: 'Attendee not found' });
        res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// CREATE attendee
router.post('/', guard, checkLimit('attendees'), async (req, res) => {
    const { name, email, phone, company, designation, ticket_type, status, event_id, notes } = req.body;
    const cleanName = (name || '').trim();
    const cleanEmail = (email || '').trim();
    if (!cleanName) return res.status(400).json({ error: 'Attendee name is required' });
    if (!event_id) return res.status(400).json({ error: 'Event is required' });
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ error: 'Invalid email address' });
    }
    try {
        if (req.user.role === 'manager') {
            const [evts] = await db.query('SELECT created_by FROM events WHERE id=? AND tenant_id=?', [event_id, req.tenantId]);
            if (evts.length === 0 || (evts[0].created_by !== req.user.id && !assignedIdsOf(req.user).includes(Number(event_id)))) {
                return res.status(403).json({ error: 'You can only add attendees to your own or assigned events' });
            }
        } else if (req.user.role === 'employee') {
            if (!employeeAllowed(req, event_id)) {
                return res.status(403).json({ error: 'You can only add attendees to your assigned event' });
            }
        }

        // Generate the check-in token at creation so every attendee has a
        // scannable QR from day one — no separate "enable check-in" step.
        const checkinToken = genCheckinToken();
        const [result] = await db.query(
            'INSERT INTO attendees (tenant_id, name, email, phone, company, designation, ticket_type, status, event_id, notes, created_by, checkin_token) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [req.tenantId, cleanName, cleanEmail || null, phone, company, designation, ticket_type || 'general', status || 'registered', event_id || null, notes, req.user.id, checkinToken]
        );

        // Fire-and-forget notification
        const [evtRows] = await db.query('SELECT title FROM events WHERE id = ? AND tenant_id = ?', [event_id, req.tenantId]);
        const eventTitle = evtRows.length > 0 ? evtRows[0].title : 'an event';
        notifyAdminsAndManagers('attendee_added', 'New Attendee', `${cleanName} registered for ${eventTitle}`, '/attendees', req.user.id, { actorName: req.user.name }).catch(() => {});

        res.status(201).json({ message: 'Attendee added', id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// UPDATE attendee
router.put('/:id', guard, async (req, res) => {
    const { name, email, phone, company, designation, ticket_type, status, event_id, notes } = req.body;
    const cleanName = (name || '').trim();
    const cleanEmail = (email || '').trim();
    if (!cleanName) return res.status(400).json({ error: 'Attendee name is required' });
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ error: 'Invalid email address' });
    }
    try {
        const [cur] = await db.query('SELECT event_id FROM attendees WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [req.params.id, req.tenantId]);
        if (cur.length === 0) return res.status(404).json({ error: 'Attendee not found' });

        if (req.user.role === 'manager') {
            const [currentEntity] = await db.query('SELECT a.event_id, e.created_by FROM attendees a JOIN events e ON a.event_id = e.id AND e.tenant_id = a.tenant_id WHERE a.id = ? AND a.tenant_id = ? AND a.deleted_at IS NULL', [req.params.id, req.tenantId]);
            const isAllowed = currentEntity.length > 0 && (currentEntity[0].created_by === req.user.id || assignedIdsOf(req.user).includes(Number(currentEntity[0].event_id)));
            if (!isAllowed) {
                return res.status(403).json({ error: 'You do not own this attendee' });
            }
        } else if (req.user.role === 'employee') {
            if (!employeeAllowed(req, cur[0].event_id)) {
                return res.status(403).json({ error: 'You can only edit attendees in your assigned event' });
            }
        }

        const [updRes] = await db.query(
            'UPDATE attendees SET name=?, email=?, phone=?, company=?, designation=?, ticket_type=?, status=?, event_id=?, notes=? WHERE id=? AND tenant_id=?',
            [cleanName, cleanEmail || null, phone, company, designation, ticket_type, status, event_id || null, notes, req.params.id, req.tenantId]
        );
        if (updRes.affectedRows === 0) return res.status(404).json({ error: 'Attendee not found' });
        res.json({ message: 'Attendee updated' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE attendee
router.delete('/:id', guard, async (req, res) => {
    try {
        const [cur] = await db.query('SELECT event_id FROM attendees WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [req.params.id, req.tenantId]);
        if (cur.length === 0) return res.status(404).json({ error: 'Attendee not found' });

        if (req.user.role === 'manager') {
            const [currentEntity] = await db.query('SELECT a.event_id, e.created_by FROM attendees a JOIN events e ON a.event_id = e.id AND e.tenant_id = a.tenant_id WHERE a.id = ? AND a.tenant_id = ? AND a.deleted_at IS NULL', [req.params.id, req.tenantId]);
            const isAllowed = currentEntity.length > 0 && (currentEntity[0].created_by === req.user.id || assignedIdsOf(req.user).includes(Number(currentEntity[0].event_id)));
            if (!isAllowed) {
                return res.status(403).json({ error: 'You do not own this attendee' });
            }
        } else if (req.user.role === 'employee') {
            if (!employeeAllowed(req, cur[0].event_id)) {
                return res.status(403).json({ error: 'You can only delete attendees in your assigned event' });
            }
        }

        // Soft delete — restored from the Recycle Bin or hard-purged after 30 days.
        const [delRes] = await db.query('UPDATE attendees SET deleted_at = NOW(), deleted_by = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [req.user.id, req.params.id, req.tenantId]);
        if (delRes.affectedRows === 0) return res.status(404).json({ error: 'Attendee not found' });
        res.json({ message: 'Attendee deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/attendees/:id/qr.png — returns the attendee's check-in QR as a
// PNG image. Used by the AttendeesPage row's "Show QR" button and as a
// fallback in case the emailed inline-cid image gets stripped by a client.
// Scoped to the same role rules as the rest of the file.
router.get('/:id/qr.png', guard, async (req, res) => {
    try {
        const [[row]] = await db.query(
            `SELECT a.checkin_token, a.event_id, e.created_by AS event_created_by
             FROM attendees a
             LEFT JOIN events e ON a.event_id = e.id AND e.tenant_id = a.tenant_id
             WHERE a.id = ? AND a.tenant_id = ? AND a.deleted_at IS NULL`,
            [req.params.id, req.tenantId]
        );
        if (!row || !row.checkin_token) return res.status(404).json({ error: 'Attendee or token not found' });

        if (req.user.role === 'manager') {
            const ok = row.event_created_by === req.user.id ||
                       assignedIdsOf(req.user).includes(Number(row.event_id));
            if (!ok) return res.status(403).json({ error: 'You do not own this attendee' });
        } else if (req.user.role === 'employee') {
            if (!employeeAllowed(req, row.event_id)) {
                return res.status(403).json({ error: 'Unauthorized for this event' });
            }
        }

        const buf = await buildQrPngBuffer(row.checkin_token);
        res.setHeader('Content-Type', 'image/png');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.send(buf);
    } catch (err) {
        res.status(500).json({ error: err.message || 'Failed to render QR' });
    }
});

// GET /api/attendees/:id/email-preview — returns the rendered confirmation
// email for a specific attendee without sending it. Used by the AttendeesPage
// to show "what they'll receive" before the operator hits Send. Same scope
// rules as the send endpoint.
router.get('/:id/email-preview', guard, async (req, res) => {
    try {
        const [[attendee]] = await db.query(
            `SELECT a.*, e.title AS event_title, e.start_date, e.end_date, e.venue, e.primary_color, e.created_by AS event_created_by
             FROM attendees a
             LEFT JOIN events e ON a.event_id = e.id AND e.tenant_id = a.tenant_id
             WHERE a.id = ? AND a.tenant_id = ? AND a.deleted_at IS NULL`,
            [req.params.id, req.tenantId]
        );
        if (!attendee) return res.status(404).json({ error: 'Attendee not found' });

        if (req.user.role === 'manager') {
            const ok = attendee.event_created_by === req.user.id ||
                       assignedIdsOf(req.user).includes(Number(attendee.event_id));
            if (!ok) return res.status(403).json({ error: 'You do not own this attendee' });
        } else if (req.user.role === 'employee') {
            if (!employeeAllowed(req, attendee.event_id)) {
                return res.status(403).json({ error: 'You can only preview attendees in your assigned event' });
            }
        }

        const [[tenant]] = await db.query('SELECT name FROM tenants WHERE id = ?', [req.tenantId]);
        const tpl = mergeTemplate(await loadTenantTemplate(req.tenantId));
        const eventCtx = {
            title: attendee.event_title,
            start_date: attendee.start_date,
            end_date: attendee.end_date,
            venue: attendee.venue,
            primary_color: attendee.primary_color,
        };
        // Preview is shown in an iframe / div in the browser, where cid: can't
        // resolve — embed the QR as a data URL so the panel renders correctly.
        let qrDataUrl = null;
        if (attendee.checkin_token) {
            qrDataUrl = await QRCode.toDataURL(attendee.checkin_token, {
                width: 280, margin: 1, errorCorrectionLevel: 'M',
                color: { dark: '#0f172a', light: '#ffffff' },
            });
        }
        const html = renderConfirmationEmail({ attendee, event: eventCtx, tenant, template: tpl, qrDataUrl });
        const vars = buildVariables({ attendee, event: eventCtx, tenant });
        const subject = fillVariables(tpl.subject, vars) || `Registration confirmed — ${attendee.event_title || 'your event'}`;
        res.json({
            html,
            subject,
            to: attendee.email || null,
            attendee_name: attendee.name,
            event_title: attendee.event_title,
        });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Failed to render preview' });
    }
});

// POST /api/attendees/:id/send-confirmation — send a registration-
// confirmation email to the attendee. Useful both right after creation
// (the AttendeesPage prompts when an email was provided) and later as a
// resend. Returns { ok, sent: bool, skipped?: reason } so the UI can
// distinguish "no SMTP configured" from a hard failure.
router.post('/:id/send-confirmation', guard, async (req, res) => {
    try {
        const [[attendee]] = await db.query(
            `SELECT a.*, e.title AS event_title, e.start_date, e.end_date, e.venue, e.primary_color, e.created_by AS event_created_by
             FROM attendees a
             LEFT JOIN events e ON a.event_id = e.id AND e.tenant_id = a.tenant_id
             WHERE a.id = ? AND a.tenant_id = ? AND a.deleted_at IS NULL`,
            [req.params.id, req.tenantId]
        );
        if (!attendee) return res.status(404).json({ error: 'Attendee not found' });

        // Same scope rules as edit/delete — managers can only touch attendees
        // belonging to events they own or are assigned to; employees only
        // their assigned event.
        if (req.user.role === 'manager') {
            const ok = attendee.event_created_by === req.user.id ||
                       assignedIdsOf(req.user).includes(Number(attendee.event_id));
            if (!ok) return res.status(403).json({ error: 'You do not own this attendee' });
        } else if (req.user.role === 'employee') {
            if (!employeeAllowed(req, attendee.event_id)) {
                return res.status(403).json({ error: 'You can only email attendees in your assigned event' });
            }
        }

        if (!attendee.email) {
            return res.status(400).json({ error: 'Attendee has no email on file' });
        }

        const [[tenant]] = await db.query('SELECT name FROM tenants WHERE id = ?', [req.tenantId]);
        const saved = await loadTenantTemplate(req.tenantId);
        const tpl = mergeTemplate(saved);
        const eventCtx = {
            title: attendee.event_title,
            start_date: attendee.start_date,
            end_date: attendee.end_date,
            venue: attendee.venue,
            primary_color: attendee.primary_color,
        };

        // Build the QR as a cid attachment. cid: is more reliably rendered
        // than data: URLs across Gmail / Outlook / Apple Mail. We only
        // attach when the attendee has a token (older rows might not, if
        // the migration ran but inserts pre-dated this code).
        let attachments;
        let qrCid = null;
        if (attendee.checkin_token) {
            qrCid = `checkin-qr-${attendee.id}@eventhub`;
            const qrBuf = await buildQrPngBuffer(attendee.checkin_token);
            attachments = [{ filename: 'checkin-qr.png', content: qrBuf, cid: qrCid }];
        }

        const html = renderConfirmationEmail({ attendee, event: eventCtx, tenant, template: tpl, qrCid });
        const vars = buildVariables({ attendee, event: eventCtx, tenant });
        const subject = fillVariables(tpl.subject, vars) || `Registration confirmed — ${attendee.event_title || 'your event'}`;
        const result = await sendMail({ to: attendee.email, subject, html, tenantId: req.tenantId, attachments });

        if (result?.skipped) {
            return res.json({ ok: false, sent: false, skipped: result.reason });
        }
        res.json({ ok: true, sent: true, to: attendee.email });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Failed to send confirmation email' });
    }
});

module.exports = router;
