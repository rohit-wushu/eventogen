/**
 * Platform-level branding endpoints.
 *
 *   GET  /api/branding                 — public; returns global settings used by
 *                                        the login page + index <head>.
 *   POST /api/branding                 — super admin; bulk-updates text values
 *                                        (site_title, tagline, hero_*, meta_*).
 *   POST /api/branding/logo            — super admin; upload logo file.
 *   POST /api/branding/favicon         — super admin; upload favicon file.
 *
 * Branding rows live in the `settings` table with tenant_id = NULL — a single
 * platform-wide set. The tenant-scoped /api/settings routes are untouched.
 */
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { protect, requireSuperAdmin } = require('../middleware/authMiddleware');
const { createUpload, fileUrl } = require('../utils/storage');

const BRANDING_KEYS = [
    'site_title', 'portal_tagline',
    'hero_headline', 'hero_sub',
    'meta_title', 'meta_description',
    'portal_logo', 'favicon'
];

const logoUpload    = createUpload('platform-logo',    { source: 'platform' });
const faviconUpload = createUpload('platform-favicon', { source: 'platform' });

// ─── Public read ────────────────────────────────────────────────────────────
// No auth — the login page calls this before any user is signed in.
router.get('/', async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT setting_key, setting_value
             FROM settings WHERE tenant_id IS NULL AND setting_key IN (?)`,
            [BRANDING_KEYS]
        );
        const out = {};
        for (const k of BRANDING_KEYS) out[k] = '';
        for (const r of rows) out[r.setting_key] = r.setting_value || '';
        res.json(out);
    } catch (err) {
        // Don't break the login page on a DB hiccup — return empty so frontend
        // falls back to its built-in defaults.
        console.error('GET /api/branding failed:', err.message);
        res.json({});
    }
});

// ─── Super-admin guard for the rest ─────────────────────────────────────────
router.use(protect, requireSuperAdmin);

// Bulk update text values. Body: { site_title?, portal_tagline?, ... }.
// Only whitelisted keys are accepted; everything else is silently dropped.
router.post('/', async (req, res) => {
    const body = req.body || {};
    const entries = Object.entries(body)
        .filter(([k]) => BRANDING_KEYS.includes(k))
        .map(([k, v]) => [k, v == null ? '' : String(v)]);

    try {
        for (const [k, v] of entries) {
            await db.query(
                `INSERT INTO settings (tenant_id, setting_key, setting_value)
                 VALUES (NULL, ?, ?)
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                [k, v]
            );
        }
        res.json({ ok: true, updated: entries.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Upload helpers — store the URL string in the same `settings` row.
const persistFile = async (key, file, res) => {
    if (!file) return res.status(400).json({ error: 'No file uploaded' });
    const url = fileUrl(file);
    try {
        await db.query(
            `INSERT INTO settings (tenant_id, setting_key, setting_value)
             VALUES (NULL, ?, ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
            [key, url]
        );
        res.json({ ok: true, url });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

router.post('/logo',    logoUpload.single('logo'),       (req, res) => persistFile('portal_logo', req.file, res));
router.post('/favicon', faviconUpload.single('favicon'), (req, res) => persistFile('favicon',     req.file, res));

module.exports = router;
