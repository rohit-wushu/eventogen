const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');

// Active announcements for the logged-in user. Available to every tenant user
// (not just super admins) because platform-wide announcements must surface to
// every workspace. Filtering rules:
//   - is_active = 1
//   - now is within [starts_at, ends_at] if those are set (NULLs mean "no bound")
router.get('/active', protect, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT id, title, message, image_url, type, dismissible, starts_at, ends_at, created_at
            FROM platform_announcements
            WHERE is_active = 1
              AND (starts_at IS NULL OR starts_at <= NOW())
              AND (ends_at IS NULL OR ends_at >= NOW())
            ORDER BY id DESC
        `);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
