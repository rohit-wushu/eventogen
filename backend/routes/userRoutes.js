const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const bcrypt = require('bcryptjs');
const { createUpload, fileUrl } = require('../utils/storage');
const { assignedIdsOf, assignedIdsForSql } = require('../utils/eventAccess');
// SECTIONS is the allowlist of section keys we accept on the user_events
// junction's `sections` column (per-event module gating). Re-exported here at
// the top so setUserEvents() — defined immediately below — can reference it.
const { SECTIONS } = require('../middleware/permissions');

const userPhotoUpload = createUpload((req) => `user-${req.user.id}`);

// Replace a user's event assignments in the junction table and keep
// `assigned_event_id` pointing at the first one (the "primary") for
// backward compatibility. Runs inside the caller's flow (own connection).
//
// `eventSections` is an optional map of { [eventId]: string[] | null } —
// the per-event "modules" the employee may use. `null` (or a missing entry)
// means full access on that event. Unknown section keys are dropped silently
// against the SECTIONS allowlist so the JSON column stays well-formed.
const setUserEvents = async (userId, tenantId, eventIds, eventSections) => {
    const ids = Array.from(new Set((eventIds || []).map(Number).filter(Number.isFinite)));
    await db.query('DELETE FROM user_events WHERE user_id = ? AND tenant_id = ?', [userId, tenantId]);
    if (ids.length > 0) {
        const sectionsFor = (eid) => {
            if (!eventSections || !(eid in eventSections)) return null;
            const v = eventSections[eid];
            if (v === null) return null;
            if (!Array.isArray(v)) return null;
            const clean = v.filter(s => SECTIONS.includes(s));
            // Empty array means "no modules" — store [] (block all). Distinct
            // from null (full access) so the UI can express "remove all".
            return JSON.stringify(clean);
        };
        const values = ids.map(eid => [userId, eid, tenantId, sectionsFor(eid)]);
        await db.query('INSERT IGNORE INTO user_events (user_id, event_id, tenant_id, sections) VALUES ?', [values]);
    }
    // Primary = first assigned event (or NULL when cleared).
    await db.query('UPDATE users SET assigned_event_id = ? WHERE id = ? AND tenant_id = ?',
        [ids[0] ?? null, userId, tenantId]);
    return ids;
};

// Attach `assigned_event_ids` (array) and `event_sections` (map) to each
// user row by one batched lookup against the junction table. Keeps
// `assigned_event_id` for back-compat.
const attachEventIds = async (rows, tenantId) => {
    const realIds = rows.filter(r => r.id).map(r => r.id);
    if (realIds.length === 0) {
        return rows.map(r => ({
            ...r,
            assigned_event_ids: r.assigned_event_id ? [r.assigned_event_id] : [],
            event_sections: {},
        }));
    }
    const [ue] = await db.query(
        'SELECT user_id, event_id, sections FROM user_events WHERE user_id IN (?) AND tenant_id = ?',
        [realIds, tenantId]
    );
    const byUser = {};
    const sectionsByUser = {};
    for (const row of ue) {
        (byUser[row.user_id] ||= []).push(row.event_id);
        // mysql2 may pre-parse JSON columns; normalise both shapes.
        let s = row.sections;
        if (typeof s === 'string') {
            try { s = JSON.parse(s); } catch { s = null; }
        }
        (sectionsByUser[row.user_id] ||= {})[row.event_id] = Array.isArray(s) ? s : null;
    }
    return rows.map(r => ({
        ...r,
        assigned_event_ids: byUser[r.id] || (r.assigned_event_id ? [r.assigned_event_id] : []),
        event_sections: sectionsByUser[r.id] || {},
    }));
};

// Update own profile (name / photo)
router.put('/me', protect, userPhotoUpload.single('photo'), async (req, res) => {
    const { name, remove_photo } = req.body;
    try {
        const sets = [];
        const params = [];
        if (typeof name === 'string' && name.trim()) { sets.push('name=?'); params.push(name.trim()); }
        if (req.file) { sets.push('profile_photo_url=?'); params.push(fileUrl(req.file)); }
        else if (remove_photo === 'true' || remove_photo === '1') { sets.push('profile_photo_url=NULL'); }
        if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });
        params.push(req.user.id, req.tenantId);
        await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id=? AND tenant_id=?`, params);
        const [rows] = await db.query(
            'SELECT id, name, email, role, assigned_event_id, assigned_task, profile_photo_url FROM users WHERE id=? AND tenant_id=?',
            [req.user.id, req.tenantId]
        );
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/', protect, async (req, res) => {
    try {
        // Subqueries are scoped to the same tenant as the outer user row so
        // cross-tenant speakers/partners/attendees never leak into counts.
        let userSelect = `
            u.id, u.name, u.email, u.role, u.assigned_event_id, u.assigned_task, u.created_at,
            u.permissions,
            'accepted' as status,
            (SELECT COUNT(*) FROM speakers WHERE created_by = u.id AND tenant_id = u.tenant_id AND deleted_at IS NULL) as speaker_count,
            (SELECT COUNT(*) FROM partners WHERE created_by = u.id AND tenant_id = u.tenant_id AND deleted_at IS NULL) as partner_count,
            (SELECT COUNT(*) FROM attendees WHERE created_by = u.id AND tenant_id = u.tenant_id AND deleted_at IS NULL) as attendee_count
        `;
        let userQuery = `SELECT ${userSelect} FROM users u WHERE u.tenant_id = ?`;
        let inviteQuery = `SELECT id as invite_id, 0 as id, '' as name, email, role, event_id as assigned_event_id, assigned_task, created_at, 'pending' as status, 0 as speaker_count, 0 as partner_count, 0 as attendee_count, NULL as permissions FROM invitations WHERE tenant_id = ?`;

        if (req.user.role === 'admin') {
            const [users] = await db.query(userQuery, [req.tenantId]);
            const [invites] = await db.query(inviteQuery, [req.tenantId]);
            const enriched = await attachEventIds(users, req.tenantId);
            return res.json([...enriched, ...invites.map(i => ({ ...i, assigned_event_ids: i.assigned_event_id ? [i.assigned_event_id] : [] }))]);
        } else if (req.user.role === 'manager') {
            // Managers see employees assigned (via the junction table) to any
            // event they created OR any of their own assigned events. Tenant-
            // scoped on both sides to guarantee no cross-tenant leakage.
            userQuery += `
                AND u.id IN (
                    SELECT ue.user_id FROM user_events ue
                    LEFT JOIN events e ON ue.event_id = e.id AND e.tenant_id = ue.tenant_id
                    WHERE ue.tenant_id = ?
                      AND (e.created_by = ? OR ue.event_id IN (?))
                )
                AND u.role = 'employee'
            `;
            inviteQuery += ` AND (created_by = ? OR event_id IN (?)) AND role = 'employee'`;
            const userParams = [req.tenantId, req.tenantId, req.user.id, assignedIdsForSql(req.user)];
            const inviteParams = [req.tenantId, req.user.id, assignedIdsForSql(req.user)];
            const [users] = await db.query(userQuery, userParams);
            const [invites] = await db.query(inviteQuery, inviteParams);
            const enriched = await attachEventIds(users, req.tenantId);
            return res.json([...enriched, ...invites.map(i => ({ ...i, assigned_event_ids: i.assigned_event_id ? [i.assigned_event_id] : [] }))]);
        }
        res.status(403).json({ error: 'Access denied' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', protect, async (req, res) => {
    const { name, email, role, event_id, event_ids, event_sections, assigned_task, password } = req.body;
    try {
        if (req.user.role === 'employee') return res.status(403).json({ error: 'Access denied' });

        // Accept either the new `event_ids` array (multi-event) or the legacy
        // single `event_id`. Normalize to a deduped numeric array.
        const requestedEventIds = Array.isArray(event_ids)
            ? event_ids.map(Number).filter(Number.isFinite)
            : (event_id != null && event_id !== '' ? [Number(event_id)] : []);
        const primaryEventId = requestedEventIds[0] ?? null;

        // Core user fields. `assigned_event_id` (primary) is set here; the
        // full set is written to user_events below.
        let query = 'UPDATE users SET name=?, email=?, role=?, assigned_event_id=?, assigned_task=?';
        let params = [name, email, role, primaryEventId, assigned_task || null];

        if (password) {
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);
            query += ', password=?';
            params.push(hashedPassword);
        }

        query += ' WHERE id=? AND tenant_id=?';
        params.push(req.params.id, req.tenantId);

        if (req.user.role === 'manager') {
            // Manager's valid events = events they created + their own assigned events.
            const [evts] = await db.query('SELECT id FROM events WHERE created_by = ? AND tenant_id = ?', [req.user.id, req.tenantId]);
            const validEventIds = new Set(evts.map(e => Number(e.id)));
            for (const eid of assignedIdsOf(req.user)) validEventIds.add(Number(eid));

            // The target's current assignments (junction). A manager may edit a
            // user only if the user is unassigned OR shares at least one event
            // with the manager's valid set.
            const [curRows] = await db.query('SELECT event_id FROM user_events WHERE user_id=? AND tenant_id=?', [req.params.id, req.tenantId]);
            const [exists] = await db.query('SELECT id FROM users WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
            if (exists.length === 0) return res.status(404).json({ error: 'User not found' });

            const currentIds = curRows.map(r => Number(r.event_id));
            if (currentIds.length > 0 && !currentIds.some(id => validEventIds.has(id))) {
                return res.status(403).json({ error: 'You can only edit your team members' });
            }
            // Every newly-requested event must be within the manager's scope.
            const outOfScope = requestedEventIds.filter(id => !validEventIds.has(Number(id)));
            if (outOfScope.length > 0) {
                return res.status(403).json({ error: 'Invalid event assignment' });
            }
        }

        const [result] = await db.query(query, params);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found' });

        // Only rewrite assignments when the caller actually sent event info —
        // avoids wiping a user's events on an unrelated profile edit. The
        // optional `event_sections` map is per-event module restriction,
        // keyed by event_id. Falls through to "full access on every event" if
        // omitted, matching the back-compat behavior of the column default.
        if (Array.isArray(event_ids) || event_id !== undefined) {
            await setUserEvents(
                req.params.id, req.tenantId,
                requestedEventIds,
                event_sections && typeof event_sections === 'object' ? event_sections : null,
            );
        }
        res.json({ message: 'User updated' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update an employee's section permissions. Only admins/managers can call
// this; managers may only touch their own team members. Pass `permissions`
// as either:
//   null / undefined → restore default full access (clears the column)
//   string[] of section keys → restrict to listed sections
router.put('/:id/permissions', protect, async (req, res) => {
    try {
        if (req.user.role === 'employee') return res.status(403).json({ error: 'Access denied' });

        const [target] = await db.query('SELECT id, role, assigned_event_id FROM users WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
        if (target.length === 0) return res.status(404).json({ error: 'User not found' });
        if (target[0].role !== 'employee') {
            return res.status(400).json({ error: 'Only employee permissions can be customised. Admins/managers always have full access.' });
        }

        // Manager scope check — same rules as the rest of the user routes:
        // they can only edit team members assigned to events they own/are assigned to.
        if (req.user.role === 'manager') {
            const [evts] = await db.query('SELECT id FROM events WHERE created_by = ? AND tenant_id = ?', [req.user.id, req.tenantId]);
            const valid = new Set(evts.map(e => Number(e.id)));
            for (const eid of assignedIdsOf(req.user)) valid.add(Number(eid));
            const [curRows] = await db.query('SELECT event_id FROM user_events WHERE user_id=? AND tenant_id=?', [req.params.id, req.tenantId]);
            const currentIds = curRows.map(r => Number(r.event_id));
            if (currentIds.length > 0 && !currentIds.some(id => valid.has(id))) {
                return res.status(403).json({ error: 'You can only edit your team members' });
            }
        }

        let permsJson = null;
        if (req.body.permissions != null) {
            if (!Array.isArray(req.body.permissions)) {
                return res.status(400).json({ error: 'permissions must be an array of section keys or null' });
            }
            const invalid = req.body.permissions.filter(p => !SECTIONS.includes(p));
            if (invalid.length) {
                return res.status(400).json({ error: `unknown section(s): ${invalid.join(', ')}` });
            }
            permsJson = JSON.stringify(req.body.permissions);
        }

        await db.query('UPDATE users SET permissions = ? WHERE id = ? AND tenant_id = ?', [permsJson, req.params.id, req.tenantId]);
        res.json({ ok: true, permissions: permsJson === null ? null : JSON.parse(permsJson) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', protect, async (req, res) => {
    try {
        if (req.user.role === 'employee') return res.status(403).json({ error: 'Access denied' });

        if (req.user.role === 'manager') {
            const [evts] = await db.query('SELECT id FROM events WHERE created_by = ? AND tenant_id = ?', [req.user.id, req.tenantId]);
            const valid = new Set(evts.map(e => Number(e.id)));
            for (const eid of assignedIdsOf(req.user)) valid.add(Number(eid));

            const [exists] = await db.query('SELECT id FROM users WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
            if (exists.length === 0) return res.status(404).json({ error: 'User not found' });
            const [curRows] = await db.query('SELECT event_id FROM user_events WHERE user_id=? AND tenant_id=?', [req.params.id, req.tenantId]);
            const currentIds = curRows.map(r => Number(r.event_id));
            if (currentIds.length === 0 || !currentIds.some(id => valid.has(id))) {
                return res.status(403).json({ error: 'You can only delete your team members' });
            }
        }

        const [result] = await db.query('DELETE FROM users WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ message: 'User deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
