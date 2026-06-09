const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { requireSection } = require('../middleware/permissions');
// Per-employee section gate. Inline protect already runs first; this just
// adds the section check. Admins/managers always pass; employees pass when
// their permissions column is NULL or includes 'awards'.
const guard = [protect, requireSection('awards')];
const { notifyAdminsAndManagers } = require('../utils/notify');
const { createUpload, fileUrl } = require('../utils/storage');

const upload = createUpload((req, file) => `award-${file.fieldname}`, { source: 'awards' });
const uploadFields = upload.fields([{ name: 'photo', maxCount: 1 }, { name: 'company_logo', maxCount: 1 }]);

// Multi-event aware access. The local `employeeAllowed` shim also enforces
// the per-event 'awards' section flag.
const { hasSectionForEvent, assignedIdsOf, assignedIdsForSql, eventIdsForSection } = require('../utils/eventAccess');
const employeeAllowed = (req, event_id) => hasSectionForEvent(req.user, event_id, 'awards');
const empAwardEventIds = (req) => eventIdsForSection(req.user, 'awards');

router.get('/', guard, async (req, res) => {
    try {
        let query = `SELECT a.*, e.title as event_title, ac.name as category_name
            FROM awards a
            LEFT JOIN events e ON a.event_id = e.id AND e.tenant_id = a.tenant_id
            LEFT JOIN award_categories ac ON a.category_id = ac.id AND ac.tenant_id = a.tenant_id
            WHERE a.tenant_id = ? AND a.deleted_at IS NULL`;
        let params = [req.tenantId];

        if (req.user.role === 'manager') {
            query += ` AND (e.created_by = ? OR a.event_id IN (?) OR a.event_id IS NULL)`;
            params.push(req.user.id, assignedIdsForSql(req.user));
        } else if (req.user.role === 'employee') {
            if (assignedIdsOf(req.user).length === 0) return res.json([]);
            query += ` AND a.event_id IN (?)`;
            params.push(empAwardEventIds(req));
        }

        query += ` ORDER BY a.sequence ASC, a.created_at DESC`;
        const [awards] = await db.query(query, params);
        res.json(awards);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', guard, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT a.*, e.title as event_title, ac.name as category_name
            FROM awards a
            LEFT JOIN events e ON a.event_id = e.id AND e.tenant_id = a.tenant_id
            LEFT JOIN award_categories ac ON a.category_id = ac.id AND ac.tenant_id = a.tenant_id
            WHERE a.id = ? AND a.tenant_id = ? AND a.deleted_at IS NULL`, [req.params.id, req.tenantId]);

        if (rows.length === 0) return res.status(404).json({ error: 'Award not found' });
        res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', guard, uploadFields, async (req, res) => {
    const { recipient_name, category_id, event_id, company_name, company_website } = req.body;
    let photo_url = req.body.photo_url;
    let company_logo_url = req.body.company_logo_url;
    if (req.files?.photo?.[0]) photo_url = fileUrl(req.files.photo[0]);
    if (req.files?.company_logo?.[0]) company_logo_url = fileUrl(req.files.company_logo[0]);

    if (!recipient_name) {
        return res.status(400).json({ error: 'Recipient name is required' });
    }

    try {
        if (req.user.role === 'manager' && event_id) {
            const [evts] = await db.query('SELECT created_by FROM events WHERE id=? AND tenant_id=?', [event_id, req.tenantId]);
            if (evts.length === 0 || (evts[0].created_by !== req.user.id && !assignedIdsOf(req.user).includes(Number(event_id)))) {
                return res.status(403).json({ error: 'You can only add awards to your own or assigned events' });
            }
        }
        if (req.user.role === 'employee' && !employeeAllowed(req, event_id)) {
            return res.status(403).json({ error: 'You can only add awards to your assigned event' });
        }

        const [result] = await db.query(
            'INSERT INTO awards (tenant_id, recipient_name, photo_url, category_id, event_id, company_name, company_website, company_logo_url, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [req.tenantId, recipient_name, photo_url || null, category_id || null, event_id || null, company_name || null, company_website || null, company_logo_url || null, req.user.id]
        );

        notifyAdminsAndManagers('award_added', 'New Award', `${recipient_name}${company_name ? ` (${company_name})` : ''} recognized`, '/awards', req.user.id, { actorName: req.user.name }).catch(() => {});

        res.status(201).json({ message: 'Award added', id: result.insertId });
    } catch (err) {
        console.error('Error in POST /awards:', err);
        res.status(500).json({ error: err.message });
    }
});

router.put('/:id', guard, uploadFields, async (req, res) => {
    const { recipient_name, category_id, event_id, company_name, company_website } = req.body;
    let photo_url = req.body.photo_url;
    let company_logo_url = req.body.company_logo_url;
    if (req.files?.photo?.[0]) photo_url = fileUrl(req.files.photo[0]);
    if (req.files?.company_logo?.[0]) company_logo_url = fileUrl(req.files.company_logo[0]);

    try {
        const [cur] = await db.query('SELECT a.event_id, e.created_by FROM awards a LEFT JOIN events e ON a.event_id = e.id AND e.tenant_id = a.tenant_id WHERE a.id = ? AND a.tenant_id = ? AND a.deleted_at IS NULL', [req.params.id, req.tenantId]);

        if (cur.length === 0) return res.status(404).json({ error: 'Award not found' });

        const isManagerAllowed = req.user.role === 'manager' && cur.length > 0 &&
            (cur[0].created_by === req.user.id || assignedIdsOf(req.user).includes(Number(cur[0].event_id)) || cur[0].event_id === null);

        if (req.user.role === 'manager' && !isManagerAllowed) {
            return res.status(403).json({ error: 'You do not have permission to edit this award' });
        }
        if (req.user.role === 'employee' && cur.length > 0 && !employeeAllowed(req, cur[0].event_id)) {
            return res.status(403).json({ error: 'You can only edit awards in your assigned event' });
        }

        const [result] = await db.query(
            'UPDATE awards SET recipient_name=?, photo_url=?, category_id=?, event_id=?, company_name=?, company_website=?, company_logo_url=? WHERE id=? AND tenant_id=?',
            [recipient_name, photo_url || null, category_id || null, event_id || null, company_name || null, company_website || null, company_logo_url || null, req.params.id, req.tenantId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Award not found' });

        res.json({ message: 'Award updated' });
    } catch (err) {
        console.error('Error in PUT /awards/:id:', err);
        res.status(500).json({ error: err.message });
    }
});

router.delete('/:id', guard, async (req, res) => {
    try {
        const [cur] = await db.query('SELECT a.event_id, e.created_by, a.recipient_name, a.photo_url FROM awards a LEFT JOIN events e ON a.event_id = e.id AND e.tenant_id = a.tenant_id WHERE a.id = ? AND a.tenant_id = ? AND a.deleted_at IS NULL', [req.params.id, req.tenantId]);

        if (cur.length === 0) return res.status(404).json({ error: 'Award not found' });

        const isManagerAllowed = req.user.role === 'manager' && cur.length > 0 &&
            (cur[0].created_by === req.user.id || assignedIdsOf(req.user).includes(Number(cur[0].event_id)) || cur[0].event_id === null);

        if (req.user.role === 'manager' && !isManagerAllowed)
            return res.status(403).json({ error: 'You do not have permission to delete this award' });
        if (req.user.role === 'employee' && cur.length > 0 && !employeeAllowed(req, cur[0].event_id))
            return res.status(403).json({ error: 'You can only delete awards in your assigned event' });

        // Soft delete — restored from the Recycle Bin or hard-purged after 30 days.
        const [result] = await db.query('UPDATE awards SET deleted_at = NOW(), deleted_by = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [req.user.id, req.params.id, req.tenantId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Award not found' });

        if (cur.length > 0) {
            notifyAdminsAndManagers('award_deleted', 'Award Removed', `${cur[0].recipient_name}'s award was removed`, '/awards', req.user.id, { imageUrl: cur[0].photo_url, actorName: req.user.name }).catch(() => {});
        }
        res.json({ message: 'Award deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
