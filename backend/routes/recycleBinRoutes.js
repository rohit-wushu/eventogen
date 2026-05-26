const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { assignedIdsForSql } = require('../utils/eventAccess');

// Recycle Bin — soft-deleted speakers/partners/awards/agendas/attendees stay
// here for 30 days and can be restored or permanently purged. Admins +
// managers only; employees can soft-delete via their own pages but not see
// or restore from the bin.
//
// Each entity exposes a small "summary" so the bin list can render rows
// without joining the world. Restore = clear deleted_at/deleted_by. Purge =
// the original DELETE that the soft-delete replaced.

const RETENTION_DAYS = 30;

// `type` from the URL is the table name, but we don't accept arbitrary input —
// only the five whitelisted entities have soft-delete columns and a sensible
// summary. Anything else returns 400 so a typo can't drop arbitrary tables.
const ENTITIES = {
    speakers: {
        label: 'Speaker',
        // Columns to surface in the recycle bin list. Each entity returns the
        // same shape so the frontend renders a single uniform table.
        select: `id, name AS title, designation AS subtitle, photo_url AS image_url,
                 event_id, deleted_at, deleted_by`,
    },
    partners: {
        label: 'Partner',
        select: `id, name AS title, website AS subtitle, logo_url AS image_url,
                 event_id, deleted_at, deleted_by`,
    },
    awards: {
        label: 'Award',
        select: `id, recipient_name AS title, company_name AS subtitle, photo_url AS image_url,
                 event_id, deleted_at, deleted_by`,
    },
    agendas: {
        label: 'Agenda',
        select: `id, title AS title, CONCAT('Day ', day_number, COALESCE(CONCAT(' · ', start_time, ' – ', end_time), '')) AS subtitle, NULL AS image_url,
                 event_id, deleted_at, deleted_by`,
    },
    attendees: {
        label: 'Attendee',
        select: `id, name AS title, email AS subtitle, NULL AS image_url,
                 event_id, deleted_at, deleted_by`,
    },
};

const requireAdminOrManager = (req, res, next) => {
    if (req.user?.role !== 'admin' && req.user?.role !== 'manager') {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
};

router.use(protect, requireAdminOrManager);

// Lazy purge for the requesting tenant — runs on every list call so a busy
// tenant's bin always stays clean. Cheap because the (tenant_id, deleted_at)
// index makes the scan trivial.
const purgeExpired = async (tenantId) => {
    for (const t of Object.keys(ENTITIES)) {
        await db.query(
            `DELETE FROM ${t}
             WHERE tenant_id = ? AND deleted_at IS NOT NULL
               AND deleted_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
            [tenantId, RETENTION_DAYS]
        );
    }
};

// Global purge across every tenant — fires from a setInterval at boot so the
// 30-day promise holds even for tenants that never open the Recycle Bin.
// Idempotent; safe to run on top of the per-tenant lazy purge above.
const purgeExpiredGlobal = async () => {
    let total = 0;
    for (const t of Object.keys(ENTITIES)) {
        const [r] = await db.query(
            `DELETE FROM ${t}
             WHERE deleted_at IS NOT NULL
               AND deleted_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
            [RETENTION_DAYS]
        );
        total += r.affectedRows || 0;
    }
    if (total > 0) console.log(`[recycle-bin] purged ${total} expired item(s)`);
    return total;
};

// Schedule the sweep:
//  - once shortly after boot so a long-down server catches up immediately
//  - then every 6 hours, which is plenty for a 30-day retention window
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
let sweepStarted = false;
function startScheduledSweep() {
    if (sweepStarted) return;
    sweepStarted = true;
    setTimeout(() => purgeExpiredGlobal().catch(err =>
        console.error('[recycle-bin] initial sweep failed:', err.message)
    ), 30 * 1000); // first sweep 30s after boot
    setInterval(() => purgeExpiredGlobal().catch(err =>
        console.error('[recycle-bin] sweep failed:', err.message)
    ), SWEEP_INTERVAL_MS);
}
startScheduledSweep();

// Manager-scoped WHERE clause: managers can only see/restore items they deleted
// themselves OR that belong to events they own/are assigned to. Admins see all.
const scopeForRole = (req, alias = '') => {
    const a = alias ? `${alias}.` : '';
    if (req.user.role === 'admin') return { where: '', params: [] };
    // Manager: deleted_by matches them OR the event is one of their assigned
    // events OR the event is one they created.
    return {
        where: ` AND (${a}deleted_by = ? OR ${a}event_id IN (?) OR ${a}event_id IN (SELECT id FROM events WHERE created_by = ? AND tenant_id = ?))`,
        params: [req.user.id, assignedIdsForSql(req.user), req.user.id, req.tenantId],
    };
};

// GET /api/recycle-bin — flat list across all 5 entity types, scoped to tenant.
router.get('/', async (req, res) => {
    try {
        await purgeExpired(req.tenantId);

        const results = [];
        for (const [type, def] of Object.entries(ENTITIES)) {
            const { where, params } = scopeForRole(req);
            const [rows] = await db.query(
                `SELECT ${def.select}, '${type}' AS entity_type
                 FROM ${type}
                 WHERE tenant_id = ? AND deleted_at IS NOT NULL${where}
                 ORDER BY deleted_at DESC`,
                [req.tenantId, ...params]
            );
            for (const r of rows) {
                results.push({
                    ...r,
                    entity_label: def.label,
                    expires_at: new Date(new Date(r.deleted_at).getTime() + RETENTION_DAYS * 86400000).toISOString(),
                });
            }
        }

        // Hydrate event_title + deleted_by_name in a couple of follow-up
        // queries instead of joining inside every entity SELECT — keeps each
        // entity query simple and the join cost predictable.
        const eventIds = [...new Set(results.map(r => r.event_id).filter(Boolean))];
        const userIds = [...new Set(results.map(r => r.deleted_by).filter(Boolean))];
        const eventMap = {};
        const userMap = {};
        if (eventIds.length) {
            const [evts] = await db.query(
                `SELECT id, title FROM events WHERE id IN (?) AND tenant_id = ?`,
                [eventIds, req.tenantId]
            );
            for (const e of evts) eventMap[e.id] = e.title;
        }
        if (userIds.length) {
            const [usrs] = await db.query(
                `SELECT id, name FROM users WHERE id IN (?) AND tenant_id = ?`,
                [userIds, req.tenantId]
            );
            for (const u of usrs) userMap[u.id] = u.name;
        }
        for (const r of results) {
            r.event_title = eventMap[r.event_id] || null;
            r.deleted_by_name = userMap[r.deleted_by] || null;
        }

        // Sort the merged list by deletion time so newest-removed appears first
        // regardless of which entity it came from.
        results.sort((a, b) => new Date(b.deleted_at) - new Date(a.deleted_at));

        res.json({ retention_days: RETENTION_DAYS, items: results });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/recycle-bin/:type/:id/restore — clear deleted_at/deleted_by so
// the row is "live" again everywhere it used to appear.
router.post('/:type/:id/restore', async (req, res) => {
    const { type, id } = req.params;
    if (!ENTITIES[type]) return res.status(400).json({ error: 'invalid entity type' });
    try {
        const { where, params } = scopeForRole(req);
        const [r] = await db.query(
            `UPDATE ${type}
             SET deleted_at = NULL, deleted_by = NULL
             WHERE id = ? AND tenant_id = ? AND deleted_at IS NOT NULL${where}`,
            [id, req.tenantId, ...params]
        );
        if (r.affectedRows === 0) return res.status(404).json({ error: 'Item not found in recycle bin' });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/recycle-bin/:type/:id — permanently purge a single item now,
// without waiting for the 30-day window. Same role scope as restore.
router.delete('/:type/:id', async (req, res) => {
    const { type, id } = req.params;
    if (!ENTITIES[type]) return res.status(400).json({ error: 'invalid entity type' });
    try {
        const { where, params } = scopeForRole(req);
        const [r] = await db.query(
            `DELETE FROM ${type}
             WHERE id = ? AND tenant_id = ? AND deleted_at IS NOT NULL${where}`,
            [id, req.tenantId, ...params]
        );
        if (r.affectedRows === 0) return res.status(404).json({ error: 'Item not found in recycle bin' });
        res.json({ ok: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/recycle-bin/empty — purge everything currently in the bin for
// this tenant (still respecting the manager scope). Used by the "Empty bin"
// button in the UI.
router.post('/empty', async (req, res) => {
    try {
        let total = 0;
        for (const t of Object.keys(ENTITIES)) {
            const { where, params } = scopeForRole(req);
            const [r] = await db.query(
                `DELETE FROM ${t} WHERE tenant_id = ? AND deleted_at IS NOT NULL${where}`,
                [req.tenantId, ...params]
            );
            total += r.affectedRows || 0;
        }
        res.json({ ok: true, purged: total });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
