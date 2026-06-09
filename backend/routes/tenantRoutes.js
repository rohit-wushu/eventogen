const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { createUpload, fileUrl } = require('../utils/storage');

const upload = createUpload('tenant-logo', { source: 'tenant' });

// Current tenant — everyone in the tenant can read, only admins can update.
router.get('/me', protect, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT id, name, slug, plan, status, trial_ends_at, primary_color, logo_url,
                    owner_user_id, created_at
             FROM tenants WHERE id = ?`,
            [req.tenantId]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });

        const t = rows[0];
        // Derived: trial_days_left (null when not on trial).
        const trialDaysLeft = t.trial_ends_at
            ? Math.max(0, Math.ceil((new Date(t.trial_ends_at) - Date.now()) / (24 * 60 * 60 * 1000)))
            : null;
        res.json({ ...t, trial_days_left: trialDaysLeft });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/me', protect, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only the tenant admin can edit org settings' });
    const { name, primary_color } = req.body || {};
    try {
        const fields = [];
        const params = [];
        if (typeof name === 'string' && name.trim()) { fields.push('name = ?'); params.push(name.trim()); }
        if (typeof primary_color === 'string' && /^#[0-9a-fA-F]{6}$/.test(primary_color)) {
            fields.push('primary_color = ?');
            params.push(primary_color);
        }
        if (fields.length === 0) return res.status(400).json({ error: 'No editable fields provided' });

        params.push(req.tenantId);
        await db.query(`UPDATE tenants SET ${fields.join(', ')} WHERE id = ?`, params);
        res.json({ message: 'Org settings updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/me/logo', protect, upload.single('logo'), async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only the tenant admin can upload a logo' });
    if (!req.file) return res.status(400).json({ error: 'No file' });
    try {
        const url = fileUrl(req.file);
        await db.query('UPDATE tenants SET logo_url = ? WHERE id = ?', [url, req.tenantId]);
        res.json({ logo_url: url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
