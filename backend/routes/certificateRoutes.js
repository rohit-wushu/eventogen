const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { createUpload, fileUrl } = require('../utils/storage');

// Bulk certificate template management.
//   - Templates are scoped per (tenant, event)
//   - elements_json holds a free-form array of text boxes:
//     [{ id, key, x, y, fontFamily, fontSize, color, fontWeight, align, content }]
//     where `key` is one of: 'name' | 'designation' | 'company' | 'event_title'
//                            | 'event_date' | 'custom' (with literal `content`)
//
// Admin / manager only. Employees can render certificates from a template
// but cannot edit them (we'll wire that gate when needed).

const requireAdminOrManager = (req, res, next) => {
    if (req.user?.role !== 'admin' && req.user?.role !== 'manager') {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
};

// Per-tenant feature gate. Super admin can flip bulk_certificate_enabled off
// from the Platform Console; when off we 403 every cert route so a stale tab
// can't keep designing/saving after access was revoked.
const requireBulkCertificateEnabled = async (req, res, next) => {
    try {
        if (!req.tenantId) return res.status(403).json({ error: 'feature_disabled' });
        const [[row]] = await db.query(
            'SELECT bulk_certificate_enabled FROM tenants WHERE id = ?',
            [req.tenantId]
        );
        if (!row || row.bulk_certificate_enabled === 0) {
            return res.status(403).json({
                error: 'feature_disabled',
                message: 'Bulk certificates are not enabled for this organization.'
            });
        }
        next();
    } catch (err) { res.status(500).json({ error: err.message }); }
};

router.use(protect, requireBulkCertificateEnabled);

const parseJsonMaybe = (v) => {
    if (v == null) return null;
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch { return null; }
};

// Background image uploader — routed through the shared storage adapter
// so it falls back to disk or hits S3 depending on env config.
const upload = createUpload('cert-bg', { limits: { fileSize: 20 * 1024 * 1024 } });

// GET /api/certificate-templates?event_id=N — list templates, scoped by tenant.
router.get('/', async (req, res) => {
    try {
        const params = [req.tenantId];
        let where = 'WHERE tenant_id = ?';
        if (req.query.event_id) {
            where += ' AND event_id = ?';
            params.push(req.query.event_id);
        }
        const [rows] = await db.query(
            `SELECT id, event_id, name, bg_image_url, canvas_width, canvas_height,
                    elements_json, created_at, updated_at
             FROM cert_templates ${where}
             ORDER BY updated_at DESC`,
            params
        );
        res.json(rows.map(r => ({
            ...r,
            elements: parseJsonMaybe(r.elements_json) || [],
            elements_json: undefined,
        })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/certificate-templates/:id — single template detail.
router.get('/:id', async (req, res) => {
    try {
        const [[row]] = await db.query(
            `SELECT id, event_id, name, bg_image_url, canvas_width, canvas_height,
                    elements_json, created_at, updated_at
             FROM cert_templates WHERE id = ? AND tenant_id = ?`,
            [req.params.id, req.tenantId]
        );
        if (!row) return res.status(404).json({ error: 'Template not found' });
        res.json({
            ...row,
            elements: parseJsonMaybe(row.elements_json) || [],
            elements_json: undefined,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/certificate-templates — create.
router.post('/', requireAdminOrManager, async (req, res) => {
    const { event_id, name, bg_image_url, canvas_width, canvas_height, elements } = req.body || {};
    if (!event_id) return res.status(400).json({ error: 'event_id is required' });
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
    try {
        const [[evt]] = await db.query(
            'SELECT id FROM events WHERE id = ? AND tenant_id = ?',
            [event_id, req.tenantId]
        );
        if (!evt) return res.status(404).json({ error: 'Event not found' });
        const [r] = await db.query(
            `INSERT INTO cert_templates
             (tenant_id, event_id, name, bg_image_url, canvas_width, canvas_height, elements_json, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.tenantId, event_id, String(name).trim(),
                bg_image_url || null,
                Number(canvas_width) || 1200,
                Number(canvas_height) || 850,
                Array.isArray(elements) ? JSON.stringify(elements) : null,
                req.user?.id || null,
            ]
        );
        res.status(201).json({ id: r.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/certificate-templates/:id — update.
router.put('/:id', requireAdminOrManager, async (req, res) => {
    const { name, bg_image_url, canvas_width, canvas_height, elements } = req.body || {};
    try {
        const [r] = await db.query(
            `UPDATE cert_templates
             SET name           = COALESCE(?, name),
                 bg_image_url   = ?,
                 canvas_width   = COALESCE(?, canvas_width),
                 canvas_height  = COALESCE(?, canvas_height),
                 elements_json  = ?
             WHERE id = ? AND tenant_id = ?`,
            [
                name ? String(name).trim() : null,
                bg_image_url || null,
                canvas_width ? Number(canvas_width) : null,
                canvas_height ? Number(canvas_height) : null,
                Array.isArray(elements) ? JSON.stringify(elements) : null,
                req.params.id, req.tenantId,
            ]
        );
        if (r.affectedRows === 0) return res.status(404).json({ error: 'Template not found' });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/certificate-templates/:id
router.delete('/:id', requireAdminOrManager, async (req, res) => {
    try {
        const [r] = await db.query(
            'DELETE FROM cert_templates WHERE id = ? AND tenant_id = ?',
            [req.params.id, req.tenantId]
        );
        if (r.affectedRows === 0) return res.status(404).json({ error: 'Template not found' });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/certificate-templates/upload-bg — background image upload.
// Returns { url } that the client immediately attaches to the template draft.
router.post('/upload-bg', requireAdminOrManager, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!req.file.mimetype?.startsWith('image/')) {
        return res.status(400).json({ error: 'File must be an image' });
    }
    res.status(201).json({ url: fileUrl(req.file) });
});

module.exports = router;
