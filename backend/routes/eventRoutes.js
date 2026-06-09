const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { checkLimit } = require('../middleware/limits');
const { notifyRole } = require('../utils/notify');
const { logAudit } = require('../utils/audit');
const { createUpload, fileUrl } = require('../utils/storage');
const { releaseTenantFiles } = require('../services/storageMeter');
const { assignedIdsOf, assignedIdsForSql } = require('../utils/eventAccess');

const upload = createUpload('event-logo', { source: 'events' });

// Get Events
router.get('/', protect, async (req, res) => {
    try {
        let selectList = `e.*, u.name as creator_name, (SELECT COUNT(*) FROM speakers WHERE event_id = e.id AND tenant_id = e.tenant_id AND deleted_at IS NULL) as speaker_count`;
        let query = `SELECT ${selectList} FROM events e LEFT JOIN users u ON e.created_by = u.id AND u.tenant_id = e.tenant_id WHERE e.tenant_id = ?`;
        let params = [req.tenantId];

        if (req.user.role === 'manager') {
            query += ` AND (e.created_by = ? OR e.id IN (?))`;
            params.push(req.user.id, assignedIdsForSql(req.user));
        } else if (req.user.role === 'employee') {
            if (assignedIdsOf(req.user).length === 0) {
                return res.json([]);
            }
            query += ` AND e.id IN (?)`;
            params.push(assignedIdsForSql(req.user));
        }

        query += ` ORDER BY e.start_date ASC`;

        const [events] = await db.query(query, params);
        res.json(events);
    } catch (err) {
        console.error('Event Fetch Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Create Event — Admin & Manager only
router.post('/', protect, checkLimit('events'), upload.fields([
    { name: 'event_logo', maxCount: 1 }, 
    { name: 'company_logo', maxCount: 1 },
    { name: 'sns_card_bg', maxCount: 1 }
]), async (req, res) => {
    if (req.user.role === 'employee') return res.status(403).json({ error: 'Employees cannot create events' });
    const { title, description, start_date, end_date, venue, status, category, primary_color, secondary_color, accent_color, font_family, is_branding_locked } = req.body;

    const event_logo_url = req.files?.event_logo ? fileUrl(req.files.event_logo[0]) : null;
    const company_logo_url = req.files?.company_logo ? fileUrl(req.files.company_logo[0]) : null;
    const sns_card_bg_url = req.files?.sns_card_bg ? fileUrl(req.files.sns_card_bg[0]) : null;

    try {
        const [result] = await db.query(
            `INSERT INTO events (
                tenant_id, title, description, start_date, end_date, venue, status, category, created_by,
                primary_color, secondary_color, accent_color, font_family,
                event_logo_url, company_logo_url, sns_card_bg_url, is_branding_locked
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.tenantId, title, description, start_date, end_date, venue, status || 'upcoming', category || null, req.user.id,
                primary_color || null, secondary_color || null, accent_color || null, font_family || null,
                event_logo_url, company_logo_url, sns_card_bg_url, is_branding_locked === 'true' || is_branding_locked === true ? 1 : 0
            ]
        );
        // Fire-and-forget notification
        notifyRole(req.tenantId, 'admin', 'event_created', 'New Event Created', `${title} was created`, '/events', req.user.id, { actorName: req.user.name }).catch(() => {});
        logAudit(req, 'event.create', 'event', result.insertId, { title });

        res.status(201).json({ message: 'Event created', id: result.insertId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Event Detail — Accessible to all protected roles
router.get('/:id', protect, async (req, res) => {
    try {
        const [events] = await db.query('SELECT * FROM events WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
        if (events.length === 0) return res.status(404).json({ error: 'Event not found' });
        
        const event = events[0];
        
        // Basic Role-Based Check (Optional: restrict employees if needed, but usually they need to see event details)
        if (req.user.role === 'employee' && assignedIdsOf(req.user).length > 0 && !assignedIdsOf(req.user).includes(Number(req.params.id))) {
            return res.status(403).json({ error: 'You are not assigned to this event' });
        }

        res.json(event);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update Event — Admin & Manager only
router.put('/:id', protect, upload.fields([
    { name: 'event_logo', maxCount: 1 }, 
    { name: 'company_logo', maxCount: 1 },
    { name: 'sns_card_bg', maxCount: 1 }
]), async (req, res) => {
    if (req.user.role === 'employee') return res.status(403).json({ error: 'Employees cannot edit events' });
    
    const {
        title, description, start_date, end_date, venue, status, category,
        primary_color, secondary_color, accent_color, font_family, is_branding_locked
    } = req.body;

    try {
        // Check permissions
        const [evts] = await db.query('SELECT created_by, is_branding_locked FROM events WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        if (evts.length === 0) return res.status(404).json({ error: 'Event not found' });
        
        const existingEvent = evts[0];

        if (req.user.role === 'manager') {
            // Managers can edit events they created OR events they are assigned to
            const isAuthorized = existingEvent.created_by === req.user.id || assignedIdsOf(req.user).includes(Number(req.params.id));
            if (!isAuthorized) {
                return res.status(403).json({ error: 'Access denied' });
            }
        }

        // Prepare updates
        let updateFields = [
            'title=?', 'description=?', 'start_date=?', 'end_date=?', 'venue=?', 'status=?', 'category=?'
        ];
        let params = [title, description, start_date, end_date, venue, status, category || null];

        // Branding updates (only if provided or if we want to allow clearing)
        updateFields.push('primary_color=?', 'secondary_color=?', 'accent_color=?', 'font_family=?');
        params.push(primary_color || null, secondary_color || null, accent_color || null, font_family || null);

        // Files
        if (req.files?.event_logo) {
            updateFields.push('event_logo_url=?');
            params.push(fileUrl(req.files.event_logo[0]));
        }
        if (req.files?.company_logo) {
            updateFields.push('company_logo_url=?');
            params.push(fileUrl(req.files.company_logo[0]));
        }
        if (req.files?.sns_card_bg) {
            updateFields.push('sns_card_bg_url=?');
            params.push(fileUrl(req.files.sns_card_bg[0]));
        }

        // Lock status (Admin and Manager only can toggle)
        if (is_branding_locked !== undefined) {
            updateFields.push('is_branding_locked=?');
            params.push(is_branding_locked === 'true' || is_branding_locked === true ? 1 : 0);
        }

        params.push(req.params.id, req.tenantId);
        const query = `UPDATE events SET ${updateFields.join(', ')} WHERE id=? AND tenant_id=?`;

        await db.query(query, params);
        res.json({ message: 'Event updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete Event — Admin only
router.delete('/:id', protect, async (req, res) => {
    if (req.user.role === 'employee') return res.status(403).json({ error: 'Employees cannot delete events' });
    try {
        if (req.user.role === 'manager') {
            const [evts] = await db.query('SELECT created_by FROM events WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
            if (evts.length === 0 || evts[0].created_by !== req.user.id) {
                return res.status(403).json({ error: 'You can only delete events you created' });
            }
        }
        // Snapshot the event's images before deletion so we can credit bytes back.
        const [evRows] = await db.query(
            `SELECT event_logo_url, company_logo_url, sns_card_bg_url
             FROM events WHERE id=? AND tenant_id=?`,
            [req.params.id, req.tenantId]
        ).catch(() => [[]]);

        const [result] = await db.query('DELETE FROM events WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Event not found' });
        if (evRows.length > 0) {
            const urls = ['event_logo_url', 'company_logo_url', 'sns_card_bg_url'].map(c => evRows[0][c]).filter(Boolean);
            if (urls.length) releaseTenantFiles(req.tenantId, ...urls).catch(() => {});
        }
        logAudit(req, 'event.delete', 'event', req.params.id);
        res.json({ message: 'Event deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Bulk apply SNS template to all speakers of this event
router.post('/:id/bulk-apply-sns-template', protect, async (req, res) => {
    if (req.user.role === 'employee') return res.status(403).json({ error: 'Not allowed' });
    try {
        const [events] = await db.query('SELECT sns_card_template FROM events WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        if (!events.length) return res.status(404).json({ error: 'Event not found' });
        if (!events[0].sns_card_template) return res.status(400).json({ error: 'No master template defined for this event. Please design one first.' });

        // Apply template design to speakers within this tenant for this event.
        // Skip soft-deleted speakers — they shouldn't get the new template applied.
        const [result] = await db.query(
            'UPDATE speakers SET sns_card_design=? WHERE event_id=? AND tenant_id=? AND deleted_at IS NULL',
            [events[0].sns_card_template, req.params.id, req.tenantId]
        );
        const [countResult] = await db.query('SELECT COUNT(*) as count FROM speakers WHERE event_id=? AND tenant_id=? AND deleted_at IS NULL', [req.params.id, req.tenantId]);
        res.json({ message: 'Template applied', affected: result.affectedRows, total: countResult[0].count });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update Event Template — Admin & Manager only
router.put('/:id/template', protect, async (req, res) => {
    if (req.user.role === 'employee') return res.status(403).json({ error: 'Employees cannot update templates' });
    const { template } = req.body;
    try {
        const [result] = await db.query('UPDATE events SET sns_card_template=? WHERE id=? AND tenant_id=?', [JSON.stringify(template), req.params.id, req.tenantId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Event not found' });
        res.json({ message: 'Event layout template saved successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === "I am attending" master template — parallel endpoints. The template
// lives on a separate column so the SNS layout and the attending layout
// can be designed independently (operators often want very different
// compositions for "speaker announcement" vs "I am attending" posts).

router.put('/:id/attending-template', protect, async (req, res) => {
    if (req.user.role === 'employee') return res.status(403).json({ error: 'Employees cannot update templates' });
    const { template } = req.body;
    try {
        const [result] = await db.query('UPDATE events SET attending_card_template=? WHERE id=? AND tenant_id=?', [JSON.stringify(template), req.params.id, req.tenantId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Event not found' });
        res.json({ message: 'Attending-card template saved successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/:id/bulk-apply-attending-template', protect, async (req, res) => {
    if (req.user.role === 'employee') return res.status(403).json({ error: 'Not allowed' });
    try {
        const [events] = await db.query('SELECT attending_card_template FROM events WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        if (!events.length) return res.status(404).json({ error: 'Event not found' });
        if (!events[0].attending_card_template) return res.status(400).json({ error: 'No attending-card master template defined for this event. Please design one first.' });

        const [result] = await db.query(
            'UPDATE speakers SET attending_card_design=? WHERE event_id=? AND tenant_id=? AND deleted_at IS NULL',
            [events[0].attending_card_template, req.params.id, req.tenantId]
        );
        const [countResult] = await db.query('SELECT COUNT(*) as count FROM speakers WHERE event_id=? AND tenant_id=? AND deleted_at IS NULL', [req.params.id, req.tenantId]);
        res.json({ message: 'Attending template applied', affected: result.affectedRows, total: countResult[0].count });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// === Certificate email template — per-event subject + body used when
// emailing certificates to delegates from BulkCertificatePage. {{name}},
// {{event_title}}, {{event_date}} are substituted at send time. Returns
// null when nothing has been customised — caller falls back to a sensible
// hardcoded default in that case.
router.get('/:id/certificate-email-template', protect, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT certificate_email_template FROM events WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        if (!rows.length) return res.status(404).json({ error: 'Event not found' });
        const raw = rows[0].certificate_email_template;
        const parsed = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
        res.json({ template: parsed });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id/certificate-email-template', protect, async (req, res) => {
    if (req.user.role === 'employee') return res.status(403).json({ error: 'Employees cannot update templates' });
    const { template } = req.body || {};
    if (!template || typeof template !== 'object') return res.status(400).json({ error: 'template object required' });
    // Whitelist what we store — accept only subject + body strings.
    const subject = String(template.subject || '').trim();
    const body    = String(template.body    || '').trim();
    if (!subject || !body) return res.status(400).json({ error: 'subject and body are both required' });
    try {
        const [result] = await db.query(
            'UPDATE events SET certificate_email_template=? WHERE id=? AND tenant_id=?',
            [JSON.stringify({ subject, body }), req.params.id, req.tenantId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Event not found' });
        res.json({ message: 'Certificate email template saved' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// === Certificate send log — one row per "Send via Email" attempt. Supports
// ?from=YYYY-MM-DD, ?to=YYYY-MM-DD, ?status=sent|skipped|failed, ?q=<search>.
// Returns three things together so the history page renders without
// chained requests: filtered rows (newest-first), aggregate counts, and
// daily aggregates for the bar chart.
router.get('/:id/certificate-send-log', protect, async (req, res) => {
    try {
        const [[evt]] = await db.query('SELECT id, created_by FROM events WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        if (!evt) return res.status(404).json({ error: 'Event not found' });
        if (req.user.role === 'manager') {
            const ok = evt.created_by === req.user.id || assignedIdsOf(req.user).includes(Number(req.params.id));
            if (!ok) return res.status(403).json({ error: 'You do not own this event' });
        } else if (req.user.role === 'employee') {
            if (!assignedIdsOf(req.user).includes(Number(req.params.id))) {
                return res.status(403).json({ error: 'You can only view your assigned event' });
            }
        }

        // Build the shared filter clause + params. Reused across all three
        // queries (rows, counts, daily) so the chart always reflects the
        // same filtered slice the table shows.
        const where = ['l.event_id = ?', 'l.tenant_id = ?'];
        const params = [req.params.id, req.tenantId];
        if (req.query.from) { where.push('l.sent_at >= ?'); params.push(`${req.query.from} 00:00:00`); }
        if (req.query.to)   { where.push('l.sent_at <= ?'); params.push(`${req.query.to} 23:59:59`); }
        if (req.query.status && ['sent','skipped','failed'].includes(req.query.status)) {
            where.push('l.status = ?'); params.push(req.query.status);
        }
        if (req.query.q) {
            where.push('(l.attendee_name LIKE ? OR l.attendee_email LIKE ?)');
            params.push(`%${req.query.q}%`, `%${req.query.q}%`);
        }
        const whereSql = `WHERE ${where.join(' AND ')}`;

        const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
        const [rows] = await db.query(
            `SELECT l.id, l.attendee_id, l.attendee_name, l.attendee_email,
                    l.status, l.reason, l.sent_at, u.name AS sent_by_name
             FROM cert_send_log l
             LEFT JOIN users u ON l.sent_by = u.id
             ${whereSql}
             ORDER BY l.sent_at DESC
             LIMIT ?`,
            [...params, limit]
        );
        const [[counts]] = await db.query(
            `SELECT
                SUM(status='sent')    AS sent,
                SUM(status='skipped') AS skipped,
                SUM(status='failed')  AS failed,
                COUNT(*) AS total
             FROM cert_send_log l ${whereSql}`,
            params
        );
        const [daily] = await db.query(
            `SELECT DATE(l.sent_at) AS day,
                    SUM(status='sent')    AS sent,
                    SUM(status='skipped') AS skipped,
                    SUM(status='failed')  AS failed
             FROM cert_send_log l ${whereSql}
             GROUP BY DATE(l.sent_at)
             ORDER BY day ASC
             LIMIT 365`,
            params
        );

        res.json({
            rows,
            counts: {
                sent:    Number(counts?.sent    || 0),
                skipped: Number(counts?.skipped || 0),
                failed:  Number(counts?.failed  || 0),
                total:   Number(counts?.total   || 0),
            },
            daily: daily.map(d => ({
                day: d.day instanceof Date ? d.day.toISOString().slice(0, 10) : String(d.day),
                sent:    Number(d.sent    || 0),
                skipped: Number(d.skipped || 0),
                failed:  Number(d.failed  || 0),
            })),
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Upload an image used by the agenda export designer (banner, footer, bg, logos).
// Writes to /uploads and returns the URL, so the designer can store a reference instead of
// stuffing the base64 payload into the events row (which blows past MySQL max_allowed_packet).
router.post('/:id/agenda-export-upload', protect, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No image provided' });

        if (req.user.role === 'employee' && !assignedIdsOf(req.user).includes(Number(req.params.id))) {
            return res.status(403).json({ error: 'You can only edit your assigned event' });
        }
        if (req.user.role === 'manager') {
            const [evts] = await db.query('SELECT created_by FROM events WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
            if (!evts.length) return res.status(404).json({ error: 'Event not found' });
            const ok = evts[0].created_by === req.user.id || assignedIdsOf(req.user).includes(Number(req.params.id));
            if (!ok) return res.status(403).json({ error: 'Access denied' });
        } else {
            const [evts] = await db.query('SELECT id FROM events WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
            if (!evts.length) return res.status(404).json({ error: 'Event not found' });
        }

        const url = fileUrl(req.file);
        res.json({ url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Save agenda export designer settings (colors, fonts, logos, banner, etc.) — all roles
router.put('/:id/agenda-export-settings', protect, async (req, res) => {
    const { settings } = req.body;
    try {
        // Permission check: employees must be assigned to this event
        if (req.user.role === 'employee' && !assignedIdsOf(req.user).includes(Number(req.params.id))) {
            return res.status(403).json({ error: 'You can only edit your assigned event' });
        }
        if (req.user.role === 'manager') {
            const [evts] = await db.query('SELECT created_by FROM events WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
            if (!evts.length) return res.status(404).json({ error: 'Event not found' });
            const ok = evts[0].created_by === req.user.id || assignedIdsOf(req.user).includes(Number(req.params.id));
            if (!ok) return res.status(403).json({ error: 'Access denied' });
        }
        const [result] = await db.query('UPDATE events SET agenda_export_settings=? WHERE id=? AND tenant_id=?', [JSON.stringify(settings || {}), req.params.id, req.tenantId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Event not found' });
        res.json({ message: 'Agenda export settings saved' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET saved QR designer config — any role that can see the event.
// Returns parsed JSON in `qr_config`, or null when the user hasn't saved
// a design yet (the page then falls back to defaults).
router.get('/:id/qr-config', protect, async (req, res) => {
    try {
        const [rows] = await db.query('SELECT qr_config FROM events WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        if (!rows.length) return res.status(404).json({ error: 'Event not found' });
        if (req.user.role === 'employee' && !assignedIdsOf(req.user).includes(Number(req.params.id))) {
            return res.status(403).json({ error: 'You are not assigned to this event' });
        }
        let parsed = null;
        if (rows[0].qr_config) {
            try { parsed = JSON.parse(rows[0].qr_config); } catch { parsed = null; }
        }
        res.json({ qr_config: parsed });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// SAVE QR designer config — admin / manager with access.
// Accepts the whole settings object as JSON in `qr_config` and stores it
// verbatim. Employees are denied because they don't create collateral.
router.put('/:id/qr-config', protect, async (req, res) => {
    if (req.user.role === 'employee') return res.status(403).json({ error: 'Employees cannot save QR designs' });
    const { qr_config } = req.body;
    try {
        if (req.user.role === 'manager') {
            const [evts] = await db.query('SELECT created_by FROM events WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
            if (!evts.length) return res.status(404).json({ error: 'Event not found' });
            const ok = evts[0].created_by === req.user.id || assignedIdsOf(req.user).includes(Number(req.params.id));
            if (!ok) return res.status(403).json({ error: 'Access denied' });
        }
        const payload = qr_config ? JSON.stringify(qr_config) : null;
        const [result] = await db.query('UPDATE events SET qr_config=? WHERE id=? AND tenant_id=?', [payload, req.params.id, req.tenantId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Event not found' });
        res.json({ message: 'QR design saved' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Public partner-showcase template config. Operators pick a layout preset
// + tweak overrides; the public showcase page reads both. Whitelist the
// preset key against PARTNER_SHOWCASE_TEMPLATES so an unbounded string
// can't end up in the column, and limit JSON keys for the same reason.
const PARTNER_SHOWCASE_TEMPLATES = ['tiered', 'wall', 'ribbon'];
// String/boolean keys we accept verbatim. Anything outside this list is
// dropped before persistence.
const PARTNER_SHOWCASE_KEYS = [
    'background', 'surface', 'accent', 'text', 'mutedText',
    'fontFamily', 'sectionTitle', 'showCategoryLabels', 'maxWidth',
    'logoScale', 'spacing', 'cardRadius'
];
// `rows` carries the operator's manual layout — array of arrays of
// partner ids — that overrides category-based grouping in the public
// page. Validate shape so we never store anything but integer ids.
function sanitizeRows(raw) {
    if (!Array.isArray(raw)) return undefined;
    const out = [];
    for (const row of raw) {
        if (!Array.isArray(row)) continue;
        const ids = row
            .map(v => Number(v))
            .filter(n => Number.isInteger(n) && n > 0);
        if (ids.length) out.push(ids);
    }
    return out;
}
function sanitizePartnerShowcaseConfig(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const clean = {};
    for (const k of PARTNER_SHOWCASE_KEYS) {
        const v = raw[k];
        if (v === undefined || v === null || v === '') continue;
        if (typeof v === 'boolean') clean[k] = v;
        else clean[k] = String(v).slice(0, 200);
    }
    const rows = sanitizeRows(raw.rows);
    if (rows && rows.length) clean.rows = rows;
    return Object.keys(clean).length ? clean : null;
}

// GET admin showcase config — any tenant user with access to this event.
router.get('/:id/partner-showcase', protect, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT partner_showcase_template, partner_showcase_config FROM events WHERE id=? AND tenant_id=?',
            [req.params.id, req.tenantId]
        );
        if (!rows.length) return res.status(404).json({ error: 'Event not found' });
        let cfg = null;
        if (rows[0].partner_showcase_config) {
            try {
                cfg = typeof rows[0].partner_showcase_config === 'string'
                    ? JSON.parse(rows[0].partner_showcase_config)
                    : rows[0].partner_showcase_config;
            } catch { cfg = null; }
        }
        res.json({
            template: rows[0].partner_showcase_template || 'tiered',
            config: cfg || {},
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// SAVE showcase config — admin / manager. Mirrors qr-config above
// (employees can't change collateral).
router.put('/:id/partner-showcase', protect, async (req, res) => {
    if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
    const { template, config } = req.body;
    const cleanTemplate = PARTNER_SHOWCASE_TEMPLATES.includes(template) ? template : 'tiered';
    const cleanConfig = sanitizePartnerShowcaseConfig(config);
    try {
        if (req.user.role === 'manager') {
            const [evts] = await db.query('SELECT created_by FROM events WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
            if (!evts.length) return res.status(404).json({ error: 'Event not found' });
            const ok = evts[0].created_by === req.user.id || assignedIdsOf(req.user).includes(Number(req.params.id));
            if (!ok) return res.status(403).json({ error: 'Access denied' });
        }
        const [result] = await db.query(
            'UPDATE events SET partner_showcase_template=?, partner_showcase_config=? WHERE id=? AND tenant_id=?',
            [cleanTemplate, cleanConfig ? JSON.stringify(cleanConfig) : null, req.params.id, req.tenantId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Event not found' });
        res.json({ message: 'Partner showcase saved' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// UPDATE event SEO / web settings
router.put('/:id/seo', protect, async (req, res) => {
    if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
    const { meta_title, meta_description, og_image_url, gtag_id, custom_head_code, favicon_url } = req.body;
    try {
        const [result] = await db.query(
            'UPDATE events SET meta_title=?, meta_description=?, og_image_url=?, gtag_id=?, custom_head_code=?, favicon_url=? WHERE id=? AND tenant_id=?',
            [meta_title || null, meta_description || null, og_image_url || null, gtag_id || null, custom_head_code || null, favicon_url || null, req.params.id, req.tenantId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Event not found' });
        res.json({ message: 'SEO settings updated' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
