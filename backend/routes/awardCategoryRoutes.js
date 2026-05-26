const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { assignedIdsOf, assignedIdsForSql, eventIdsForSection, hasSectionForEvent } = require('../utils/eventAccess');
// Award categories are part of the awards section, so employee scope here is
// awards-section-aware (same key as awardRoutes).
const empAwardEventIds = (req) => eventIdsForSection(req.user, 'awards');

// Helper — compute hierarchy depth of a given category (0 = root/sector).
// Accepts a pre-fetched row map to avoid extra queries.
const depthOf = (id, byId, seen = new Set()) => {
    if (!id || seen.has(id)) return 0;
    seen.add(id);
    const row = byId.get(Number(id));
    if (!row || row.parent_id == null) return 0;
    return 1 + depthOf(Number(row.parent_id), byId, seen);
};

router.get('/', protect, async (req, res) => {
    try {
        const { event_id } = req.query;
        let query = `SELECT ac.*, e.title as event_title, p.name as parent_name
            FROM award_categories ac
            LEFT JOIN events e ON ac.event_id = e.id AND e.tenant_id = ac.tenant_id
            LEFT JOIN award_categories p ON ac.parent_id = p.id AND p.tenant_id = ac.tenant_id`;
        const params = [req.tenantId];
        const where = ['ac.tenant_id = ?'];

        if (event_id) {
            where.push('ac.event_id = ?');
            params.push(event_id);
        }
        if (req.user.role === 'employee') {
            if (assignedIdsOf(req.user).length === 0) return res.json([]);
            where.push('ac.event_id IN (?)');
            params.push(empAwardEventIds(req));
        } else if (req.user.role === 'manager') {
            where.push('(ac.event_id IS NULL OR e.created_by = ? OR ac.event_id IN (?))');
            params.push(req.user.id, assignedIdsForSql(req.user));
        }

        query += ' WHERE ' + where.join(' AND ');
        query += ' ORDER BY COALESCE(ac.parent_id, ac.id), ac.parent_id IS NOT NULL, ac.name ASC';

        const [categories] = await db.query(query, params);
        res.json(categories);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/', protect, async (req, res) => {
    const { name, event_id, parent_id, amount } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (!event_id) return res.status(400).json({ error: 'Event is required' });

    try {
        if (req.user.role === 'manager') {
            const [evts] = await db.query('SELECT created_by FROM events WHERE id=? AND tenant_id=?', [event_id, req.tenantId]);
            if (evts.length === 0 || (evts[0].created_by !== req.user.id && !assignedIdsOf(req.user).includes(Number(event_id)))) {
                return res.status(403).json({ error: 'You can only add categories to your own or assigned events' });
            }
        }
        if (req.user.role === 'employee' && !hasSectionForEvent(req.user, event_id, 'awards')) {
            return res.status(403).json({ error: 'You can only add categories to events where you have the awards module' });
        }

        if (parent_id) {
            // Up to 3 levels deep: Sector → Category → Subcategory. Grandparent
            // may exist but anything above that is rejected.
            const [[parent]] = await db.query('SELECT event_id, parent_id FROM award_categories WHERE id=? AND tenant_id=?', [parent_id, req.tenantId]);
            if (!parent) return res.status(400).json({ error: 'Parent category not found' });
            if (String(parent.event_id) !== String(event_id)) {
                return res.status(400).json({ error: 'Parent category must belong to the same event' });
            }
            if (parent.parent_id) {
                const [[grandparent]] = await db.query('SELECT parent_id FROM award_categories WHERE id=? AND tenant_id=?', [parent.parent_id, req.tenantId]);
                if (grandparent && grandparent.parent_id) {
                    return res.status(400).json({ error: 'Maximum 3 levels (Sector → Category → Subcategory) supported' });
                }
            }
        }

        const cleanAmount = amount !== undefined && amount !== null && amount !== '' ? Number(amount) : null;
        if (cleanAmount !== null && (isNaN(cleanAmount) || cleanAmount < 0)) {
            return res.status(400).json({ error: 'Amount must be a non-negative number' });
        }

        await db.query(
            'INSERT INTO award_categories (tenant_id, name, event_id, parent_id, amount) VALUES (?, ?, ?, ?, ?)',
            [req.tenantId, name, event_id, parent_id || null, cleanAmount]
        );
        res.status(201).json({ message: 'Category created' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Category already exists for this event' });
        }
        res.status(500).json({ error: err.message });
    }
});

router.put('/:id', protect, async (req, res) => {
    const { name, event_id, parent_id, amount } = req.body;
    try {
        if (parent_id) {
            if (String(parent_id) === String(req.params.id)) {
                return res.status(400).json({ error: 'A category cannot be its own parent' });
            }
            const [[parent]] = await db.query('SELECT event_id, parent_id FROM award_categories WHERE id=? AND tenant_id=?', [parent_id, req.tenantId]);
            if (!parent) return res.status(400).json({ error: 'Parent category not found' });
            if (String(parent.event_id) !== String(event_id)) {
                return res.status(400).json({ error: 'Parent category must belong to the same event' });
            }
            if (parent.parent_id) {
                const [[grandparent]] = await db.query('SELECT parent_id FROM award_categories WHERE id=? AND tenant_id=?', [parent.parent_id, req.tenantId]);
                if (grandparent && grandparent.parent_id) {
                    return res.status(400).json({ error: 'Maximum 3 levels (Sector → Category → Subcategory) supported' });
                }
            }
        }
        const cleanAmount = amount !== undefined && amount !== null && amount !== '' ? Number(amount) : null;
        if (cleanAmount !== null && (isNaN(cleanAmount) || cleanAmount < 0)) {
            return res.status(400).json({ error: 'Amount must be a non-negative number' });
        }
        const [result] = await db.query(
            'UPDATE award_categories SET name = ?, event_id = ?, parent_id = ?, amount = ? WHERE id = ? AND tenant_id = ?',
            [name, event_id || null, parent_id || null, cleanAmount, req.params.id, req.tenantId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Category not found' });
        res.json({ message: 'Category updated' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'Category already exists for this event' });
        }
        res.status(500).json({ error: err.message });
    }
});

router.delete('/:id', protect, async (req, res) => {
    try {
        const [result] = await db.query('DELETE FROM award_categories WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Category not found' });
        res.json({ message: 'Category deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
