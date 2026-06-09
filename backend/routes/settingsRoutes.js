const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { createUpload, fileUrl } = require('../utils/storage');

const upload = createUpload('logo', { source: 'settings' });

// GET all settings — now tenant-scoped, so it requires auth to know the tenant.
router.get('/', protect, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT setting_key, setting_value FROM settings WHERE tenant_id = ?',
            [req.tenantId]
        );
        const settings = rows.reduce((acc, row) => {
            acc[row.setting_key] = row.setting_value;
            return acc;
        }, {});
        res.json(settings);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST to update logo (admin only)
router.post('/logo', protect, upload.single('logo'), async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can change the portal logo' });
    }

    if (!req.file) {
        return res.status(400).json({ error: 'No logo file provided' });
    }

    const logoUrl = fileUrl(req.file);

    try {
        // Upsert is keyed on (tenant_id, setting_key) — assumes the unique index
        // was updated in Stage 1 to include tenant_id. Without that, different
        // tenants would overwrite each other's logo.
        await db.query(
            'INSERT INTO settings (tenant_id, setting_key, setting_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            [req.tenantId, 'portal_logo', logoUrl, logoUrl]
        );
        res.json({ message: 'Portal logo updated successfully', logoUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST to update favicon (admin only)
const faviconUpload = createUpload('favicon', { source: 'settings' });

router.post('/favicon', protect, faviconUpload.single('favicon'), async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can change the favicon' });
    }
    if (!req.file) {
        return res.status(400).json({ error: 'No favicon file provided' });
    }
    const faviconUrl = fileUrl(req.file);
    try {
        await db.query(
            'INSERT INTO settings (tenant_id, setting_key, setting_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            [req.tenantId, 'favicon', faviconUrl, faviconUrl]
        );
        res.json({ message: 'Favicon updated successfully', faviconUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST to update any setting (admin only)
router.post('/', protect, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can update settings' });
    }

    const { key, value } = req.body;

    if (!key) {
        return res.status(400).json({ error: 'Setting key is required' });
    }

    try {
        await db.query(
            'INSERT INTO settings (tenant_id, setting_key, setting_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            [req.tenantId, key, String(value), String(value)]
        );
        res.json({ message: `Setting ${key} updated successfully` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
