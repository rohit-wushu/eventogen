const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');

// GET all notifications for current user
router.get('/', protect, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT * FROM notifications WHERE user_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 50',
            [req.user.id, req.tenantId]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET unread count
router.get('/unread-count', protect, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND tenant_id = ? AND is_read = 0',
            [req.user.id, req.tenantId]
        );
        res.json({ count: rows[0].count });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Mark one as read
router.put('/:id/read', protect, async (req, res) => {
    try {
        const [result] = await db.query(
            'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ? AND tenant_id = ?',
            [req.params.id, req.user.id, req.tenantId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Notification not found' });
        res.json({ message: 'Marked as read' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Mark all as read
router.put('/read-all', protect, async (req, res) => {
    try {
        await db.query(
            'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND tenant_id = ? AND is_read = 0',
            [req.user.id, req.tenantId]
        );
        res.json({ message: 'All marked as read' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete one
router.delete('/:id', protect, async (req, res) => {
    try {
        const [result] = await db.query(
            'DELETE FROM notifications WHERE id = ? AND user_id = ? AND tenant_id = ?',
            [req.params.id, req.user.id, req.tenantId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Notification not found' });
        res.json({ message: 'Deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
