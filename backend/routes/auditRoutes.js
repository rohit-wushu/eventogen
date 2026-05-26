const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');

// Admin-only audit log viewer for the current tenant. Paginated, most recent first.
router.get('/', protect, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can view the audit log' });
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = parseInt(req.query.offset, 10) || 0;
    try {
        const [rows] = await db.query(
            `SELECT id, actor_user_id, actor_name, actor_role, action,
                    resource_type, resource_id, meta, ip, created_at
             FROM audit_log WHERE tenant_id = ?
             ORDER BY id DESC LIMIT ? OFFSET ?`,
            [req.tenantId, limit, offset]
        );
        const parsed = rows.map(r => ({
            ...r,
            meta: typeof r.meta === 'string' ? (() => { try { return JSON.parse(r.meta); } catch { return null; } })() : r.meta
        }));
        res.json(parsed);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
