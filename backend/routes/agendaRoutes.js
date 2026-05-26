const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { requireSection } = require('../middleware/permissions');
// Per-employee section gate. Inline protect already runs first; this just
// adds the section check. Admins/managers always pass; employees pass when
// their permissions column is NULL or includes 'agendas'.
const guard = [protect, requireSection('agendas')];
const { notifyEventTeam } = require('../utils/notify');

const mergeSpeakers = async (agendas, tenantId) => {
    if (agendas.length === 0) return [];
    const agendaIds = agendas.map(a => a.id);
    const [speakerMappings] = await db.query(`
        SELECT asp.agenda_id, s.id, s.name, s.photo_url, s.designation, s.company
        FROM agenda_speakers asp
        JOIN speakers s ON asp.speaker_id = s.id AND s.tenant_id = asp.tenant_id AND s.deleted_at IS NULL
        WHERE asp.agenda_id IN (?) AND asp.tenant_id = ?`, [agendaIds, tenantId]);
    return agendas.map(a => ({
        ...a,
        speakers: speakerMappings.filter(sm => sm.agenda_id === a.id)
            .map(sm => ({ id: sm.id, name: sm.name, photo_url: sm.photo_url, designation: sm.designation, company: sm.company }))
    }));
};

// Multi-event aware access. The local `employeeAllowed` shim also enforces
// the per-event 'agendas' section flag.
const { hasSectionForEvent, assignedIdsOf, assignedIdsForSql, eventIdsForSection } = require('../utils/eventAccess');
const employeeAllowed = (req, event_id) => hasSectionForEvent(req.user, event_id, 'agendas');
const empAgendaEventIds = (req) => eventIdsForSection(req.user, 'agendas');

router.get('/', guard, async (req, res) => {
    try {
        let query = `SELECT a.* FROM agendas a JOIN events e ON a.event_id = e.id AND e.tenant_id = a.tenant_id WHERE a.tenant_id = ? AND a.deleted_at IS NULL`;
        let params = [req.tenantId];
        if (req.user.role === 'manager') {
            query += ` AND (e.created_by = ? OR a.event_id IN (?))`;
            params.push(req.user.id, assignedIdsForSql(req.user));
        } else if (req.user.role === 'employee') {
            if (assignedIdsOf(req.user).length === 0) return res.json([]);
            query += ` AND a.event_id IN (?)`;
            params.push(empAgendaEventIds(req));
        }
        query += ` ORDER BY a.event_id, a.day_number, a.sequence, a.start_time`;
        const [agendas] = await db.query(query, params);
        res.json(await mergeSpeakers(agendas, req.tenantId));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/speaker/:speakerId', guard, async (req, res) => {
    try {
        const [agendas] = await db.query(
            `SELECT a.* FROM agendas a
             JOIN agenda_speakers asp ON asp.agenda_id = a.id AND asp.tenant_id = a.tenant_id
             WHERE asp.speaker_id = ? AND a.tenant_id = ? AND a.deleted_at IS NULL
             ORDER BY a.day_number, a.sequence, a.start_time`,
            [req.params.speakerId, req.tenantId]
        );
        res.json(await mergeSpeakers(agendas, req.tenantId));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:eventId', guard, async (req, res) => {
    try {
        if (req.user.role === 'manager') {
            const [evts] = await db.query('SELECT created_by FROM events WHERE id=? AND tenant_id=?', [req.params.eventId, req.tenantId]);
            if (evts.length === 0 || (evts[0].created_by !== req.user.id && !assignedIdsOf(req.user).includes(Number(req.params.eventId)))) return res.json([]);
        }
        if (req.user.role === 'employee' && !employeeAllowed(req, req.params.eventId)) return res.json([]);

        const [agendas] = await db.query(`SELECT * FROM agendas WHERE event_id = ? AND tenant_id = ? AND deleted_at IS NULL ORDER BY day_number, sequence, start_time`, [req.params.eventId, req.tenantId]);
        res.json(await mergeSpeakers(agendas, req.tenantId));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/reorder', guard, async (req, res) => {
    const { updates } = req.body;
    if (!Array.isArray(updates) || updates.length === 0) return res.status(400).json({ error: 'No updates provided' });

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        for (const update of updates) {
            // Check ownership
            const [cur] = await connection.query('SELECT a.event_id, e.created_by FROM agendas a JOIN events e ON a.event_id = e.id AND e.tenant_id = a.tenant_id WHERE a.id = ? AND a.tenant_id = ? AND a.deleted_at IS NULL', [update.id, req.tenantId]);
            const isManagerAllowed = req.user.role === 'manager' && cur.length > 0 &&
                (cur[0].created_by === req.user.id || assignedIdsOf(req.user).includes(Number(cur[0].event_id)));

            if (req.user.role === 'manager' && !isManagerAllowed) {
                throw new Error('You do not have permission for this agenda');
            }
            if (req.user.role === 'employee' && cur.length > 0 && !employeeAllowed(req, cur[0].event_id)) {
                throw new Error('Unauthorized for this event');
            }

            const [result] = await connection.query('UPDATE agendas SET sequence=?, start_time=?, end_time=? WHERE id=? AND tenant_id=?',
                [update.sequence, update.start_time, update.end_time, update.id, req.tenantId]);
            if (result.affectedRows === 0) {
                throw new Error('Agenda not found');
            }
        }
        await connection.commit();
        res.json({ message: 'Agendas reordered successfully' });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

router.post('/', guard, async (req, res) => {
    const { event_id, day_number, start_time, end_time, title, description, speaker_ids } = req.body;
    const cleanTitle = (title || '').trim();
    if (!cleanTitle) return res.status(400).json({ error: 'Session title is required' });
    if (!event_id) return res.status(400).json({ error: 'Event is required' });
    if (!start_time || !end_time) return res.status(400).json({ error: 'Start and end times are required' });
    try {
        if (req.user.role === 'manager') {
            const [evts] = await db.query('SELECT created_by FROM events WHERE id=? AND tenant_id=?', [event_id, req.tenantId]);
            if (evts.length === 0 || (evts[0].created_by !== req.user.id && !assignedIdsOf(req.user).includes(Number(event_id))))
                return res.status(403).json({ error: 'You can only add agendas to your own or assigned events' });
        }
        if (req.user.role === 'employee' && !employeeAllowed(req, event_id))
            return res.status(403).json({ error: 'You can only add agendas to your assigned event' });

        const [result] = await db.query('INSERT INTO agendas (tenant_id, event_id, day_number, start_time, end_time, title, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [req.tenantId, event_id, day_number, start_time, end_time, cleanTitle, description]);
        const agendaId = result.insertId;
        if (Array.isArray(speaker_ids) && speaker_ids.length > 0) {
            await db.query('INSERT INTO agenda_speakers (tenant_id, agenda_id, speaker_id) VALUES ?', [speaker_ids.map(sid => [req.tenantId, agendaId, sid])]);
        }
        res.status(201).json({ message: 'Agenda created', id: agendaId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', guard, async (req, res) => {
    const { day_number, start_time, end_time, title, description, speaker_ids } = req.body;
    const cleanTitle = (title || '').trim();
    if (!cleanTitle) return res.status(400).json({ error: 'Session title is required' });
    if (!start_time || !end_time) return res.status(400).json({ error: 'Start and end times are required' });
    try {
        const [cur] = await db.query('SELECT a.event_id, e.created_by FROM agendas a JOIN events e ON a.event_id = e.id AND e.tenant_id = a.tenant_id WHERE a.id = ? AND a.tenant_id = ? AND a.deleted_at IS NULL', [req.params.id, req.tenantId]);
        const isManagerAllowed = req.user.role === 'manager' && cur.length > 0 &&
            (cur[0].created_by === req.user.id || assignedIdsOf(req.user).includes(Number(cur[0].event_id)));

        if (req.user.role === 'manager' && !isManagerAllowed)
            return res.status(403).json({ error: 'You do not have permission to edit this agenda' });
        if (req.user.role === 'employee' && cur.length > 0 && !employeeAllowed(req, cur[0].event_id))
            return res.status(403).json({ error: 'You can only edit agendas in your assigned event' });

        const [updRes] = await db.query('UPDATE agendas SET day_number=?, start_time=?, end_time=?, title=?, description=? WHERE id=? AND tenant_id=?',
            [day_number, start_time, end_time, cleanTitle, description, req.params.id, req.tenantId]);
        if (updRes.affectedRows === 0) return res.status(404).json({ error: 'Agenda not found' });

        await db.query('DELETE FROM agenda_speakers WHERE agenda_id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
        if (Array.isArray(speaker_ids) && speaker_ids.length > 0) {
            await db.query('INSERT INTO agenda_speakers (tenant_id, agenda_id, speaker_id) VALUES ?', [speaker_ids.map(sid => [req.tenantId, req.params.id, sid])]);
        }

        // Fire-and-forget notification
        const eventId = cur.length > 0 ? cur[0].event_id : null;
        if (eventId) {
            notifyEventTeam(eventId, 'agenda_updated', 'Agenda Updated', `${title} schedule was updated`, '/agendas', req.user.id, { actorName: req.user.name }).catch(() => {});
        }

        res.json({ message: 'Agenda updated' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', guard, async (req, res) => {
    try {
        const [cur] = await db.query('SELECT a.event_id, e.created_by FROM agendas a JOIN events e ON a.event_id = e.id AND e.tenant_id = a.tenant_id WHERE a.id = ? AND a.tenant_id = ? AND a.deleted_at IS NULL', [req.params.id, req.tenantId]);
        const isManagerAllowed = req.user.role === 'manager' && cur.length > 0 &&
            (cur[0].created_by === req.user.id || assignedIdsOf(req.user).includes(Number(cur[0].event_id)));

        if (req.user.role === 'manager' && !isManagerAllowed)
            return res.status(403).json({ error: 'You do not have permission to delete this agenda' });
        if (req.user.role === 'employee' && cur.length > 0 && !employeeAllowed(req, cur[0].event_id))
            return res.status(403).json({ error: 'You can only delete agendas in your assigned event' });

        const [agd] = await db.query('SELECT title FROM agendas WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [req.params.id, req.tenantId]);
        // Soft delete — restored from the Recycle Bin or hard-purged after 30 days.
        // Junction rows in agenda_speakers stay intact so restore re-attaches the same speaker set.
        const [delRes] = await db.query('UPDATE agendas SET deleted_at = NOW(), deleted_by = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [req.user.id, req.params.id, req.tenantId]);
        if (delRes.affectedRows === 0) return res.status(404).json({ error: 'Agenda not found' });
        if (agd.length > 0) {
            const eventId = cur.length > 0 ? cur[0].event_id : null;
            if (eventId) {
                notifyEventTeam(eventId, 'agenda_deleted', 'Agenda Removed', `"${agd[0].title}" was removed from the schedule`, '/agendas', req.user.id, { actorName: req.user.name }).catch(() => {});
            }
        }
        res.json({ message: 'Agenda deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
