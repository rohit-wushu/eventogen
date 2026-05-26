const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');

// Get all categories. Pass ?event_id=N to scope to a single event;
// rows with event_id IS NULL are legacy "global" categories and are always returned
// so existing partners that reference them keep working.
router.get('/', protect, async (req, res) => {
    try {
        const { event_id } = req.query;
        let query = `SELECT pc.*, e.title as event_title
                     FROM partner_categories pc
                     LEFT JOIN events e ON pc.event_id = e.id AND e.tenant_id = pc.tenant_id
                     WHERE pc.tenant_id = ?`;
        const params = [req.tenantId];
        if (event_id) {
            query += ' AND (pc.event_id = ? OR pc.event_id IS NULL)';
            params.push(event_id);
        }
        query += ' ORDER BY pc.name ASC';
        const [categories] = await db.query(query, params);
        res.json(categories);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create category — must be associated to a specific event.
router.post('/', protect, async (req, res) => {
    const { name, event_id } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (!event_id) return res.status(400).json({ error: 'Event is required' });

    try {
        await db.query('INSERT INTO partner_categories (tenant_id, name, event_id) VALUES (?, ?, ?)', [req.tenantId, name, event_id]);
        res.status(201).json({ message: 'Category created' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'A category with this name already exists for this event' });
        }
        res.status(500).json({ error: err.message });
    }
});

// Update category
router.put('/:id', protect, async (req, res) => {
    const { name, event_id } = req.body;
    try {
        const [result] = await db.query('UPDATE partner_categories SET name = ?, event_id = ? WHERE id = ? AND tenant_id = ?', [name, event_id || null, req.params.id, req.tenantId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Category not found' });
        res.json({ message: 'Category updated' });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'A category with this name already exists for this event' });
        }
        res.status(500).json({ error: err.message });
    }
});

// Delete category
router.delete('/:id', protect, async (req, res) => {
    try {
        const [result] = await db.query('DELETE FROM partner_categories WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Category not found' });
        res.json({ message: 'Category deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
