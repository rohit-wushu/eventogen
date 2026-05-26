const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { requireSection } = require('../middleware/permissions');
// Per-employee section gate. Inline protect already runs first; this just
// adds the section check. Admins/managers always pass; employees pass when
// their permissions column is NULL or includes 'travel'.
const guard = [protect, requireSection('travel')];
const { notifyAdminsAndManagers, notifyUser } = require('../utils/notify');
const { assignedIdsOf, assignedIdsForSql, eventIdsForSection, hasSectionForEvent } = require('../utils/eventAccess');
const empTravelEventIds = (req) => eventIdsForSection(req.user, 'travel');

// Helper: check if employee is allowed for given speaker's event. Looks up
// the speaker's event_id and verifies the employee has the travel section on
// that event — same grain as the rest of the file.
const employeeAllowedForSpeaker = async (req, speaker_id) => {
    if (req.user.role !== 'employee') return true;
    if (assignedIdsOf(req.user).length === 0) return false;
    const [rows] = await db.query('SELECT event_id FROM speakers WHERE id = ? AND tenant_id = ?', [speaker_id, req.tenantId]);
    return rows.length > 0 && hasSectionForEvent(req.user, rows[0].event_id, 'travel');
};

// GET all travel records (with speaker name)
router.get('/', guard, async (req, res) => {
    try {
        let query = `
            SELECT t.*, s.name as speaker_name, s.photo_url as speaker_photo
            FROM speaker_travel t
            JOIN speakers s ON t.speaker_id = s.id AND s.tenant_id = t.tenant_id AND s.deleted_at IS NULL
            LEFT JOIN events e ON s.event_id = e.id AND e.tenant_id = t.tenant_id
            WHERE t.tenant_id = ?
        `;
        const params = [req.tenantId];

        if (req.user.role === 'manager') {
            query += ' AND (e.created_by = ? OR s.event_id IN (?))';
            params.push(req.user.id, assignedIdsForSql(req.user));
        } else if (req.user.role === 'employee') {
            if (assignedIdsOf(req.user).length === 0) return res.json([]);
            query += ' AND s.event_id IN (?)';
            params.push(empTravelEventIds(req));
        }

        if (req.query.speaker_id) {
            query += ' AND t.speaker_id = ?';
            params.push(req.query.speaker_id);
        }
        query += ' ORDER BY t.departure_date ASC';
        const [rows] = await db.query(query, params);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET travel stats summary
router.get('/stats/summary', guard, async (req, res) => {
    try {
        let joinStr = 'JOIN speakers s ON t.speaker_id = s.id AND s.tenant_id = t.tenant_id AND s.deleted_at IS NULL JOIN events e ON s.event_id = e.id AND e.tenant_id = t.tenant_id';
        let whereStr = "WHERE t.tenant_id = ? AND t.status != 'cancelled'";
        let allWhereStr = 'WHERE t.tenant_id = ?';
        let paramsActive = [req.tenantId];
        let paramsAll = [req.tenantId];

        if (req.user.role === 'manager') {
            whereStr += ' AND (e.created_by = ? OR s.event_id IN (?))';
            allWhereStr += ' AND (e.created_by = ? OR s.event_id IN (?))';
            paramsActive.push(req.user.id, assignedIdsForSql(req.user));
            paramsAll.push(req.user.id, assignedIdsForSql(req.user));
        } else if (req.user.role === 'employee') {
            if (assignedIdsOf(req.user).length === 0) return res.json({ totalCost: 0, byType: [], byStatus: [] });
            whereStr += ' AND s.event_id IN (?)';
            allWhereStr += ' AND s.event_id IN (?)';
            paramsActive.push(empTravelEventIds(req));
            paramsAll.push(empTravelEventIds(req));
        }

        const [totalCost] = await db.query(`
            SELECT COALESCE(SUM(t.cost), 0) as total_cost FROM speaker_travel t ${joinStr} ${whereStr}
        `, paramsActive);
        const [byType] = await db.query(`
            SELECT t.travel_type, COUNT(t.id) as count, COALESCE(SUM(t.cost), 0) as total_cost
            FROM speaker_travel t ${joinStr} ${whereStr} GROUP BY t.travel_type
        `, paramsActive);
        const [byStatus] = await db.query(`
            SELECT t.status, COUNT(t.id) as count FROM speaker_travel t ${joinStr} ${allWhereStr} GROUP BY t.status
        `, paramsAll);

        res.json({
            totalCost: totalCost[0].total_cost,
            byType,
            byStatus
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET travel for a specific speaker
router.get('/speaker/:speakerId', guard, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT * FROM speaker_travel WHERE speaker_id = ? AND tenant_id = ? ORDER BY departure_date ASC',
            [req.params.speakerId, req.tenantId]
        );
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET single travel record
router.get('/:id', guard, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT t.*, s.name as speaker_name FROM speaker_travel t LEFT JOIN speakers s ON t.speaker_id = s.id AND s.tenant_id = t.tenant_id WHERE t.id = ? AND t.tenant_id = ?',
            [req.params.id, req.tenantId]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Travel record not found' });
        res.json(rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// CREATE travel record
router.post('/', guard, async (req, res) => {
    const { speaker_id, travel_type, title, details, from_location, to_location, departure_date, arrival_date, booking_ref, cost, currency, status, notes } = req.body;
    try {
        if (req.user.role === 'manager') {
            const [evts] = await db.query('SELECT e.id as event_id, e.created_by FROM speakers s JOIN events e ON s.event_id = e.id AND e.tenant_id = s.tenant_id WHERE s.id = ? AND s.tenant_id = ?', [speaker_id, req.tenantId]);
            if (evts.length === 0 || (evts[0].created_by !== req.user.id && !assignedIdsOf(req.user).includes(Number(evts[0].event_id)))) {
                return res.status(403).json({ error: 'You can only add travel to speakers in your own or assigned events' });
            }
        } else if (req.user.role === 'employee') {
            const allowed = await employeeAllowedForSpeaker(req, speaker_id);
            if (!allowed) {
                return res.status(403).json({ error: 'You can only add travel to speakers in your assigned event' });
            }
        }

        const [result] = await db.query(
            `INSERT INTO speaker_travel (tenant_id, speaker_id, travel_type, title, details, from_location, to_location, departure_date, arrival_date, booking_ref, cost, currency, status, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.tenantId, speaker_id, travel_type, title, details, from_location, to_location, departure_date || null, arrival_date || null, booking_ref, cost || 0, currency || 'INR', status || 'pending', notes]
        );

        // Fire-and-forget notification
        const [spkRows] = await db.query('SELECT name, photo_url FROM speakers WHERE id = ? AND tenant_id = ?', [speaker_id, req.tenantId]);
        const speakerName = spkRows.length > 0 ? spkRows[0].name : 'A speaker';
        const speakerPhoto = spkRows.length > 0 ? spkRows[0].photo_url : null;
        notifyAdminsAndManagers('travel_request', 'Travel Request', `${speakerName} - ${travel_type} travel requested`, '/travel', req.user.id, { imageUrl: speakerPhoto, actorName: req.user.name }).catch(() => {});

        res.status(201).json({ message: 'Travel record added', id: result.insertId });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// UPDATE travel record
router.put('/:id', guard, async (req, res) => {
    const { speaker_id, travel_type, title, details, from_location, to_location, departure_date, arrival_date, booking_ref, cost, currency, status, notes } = req.body;
    try {
        const [cur] = await db.query('SELECT speaker_id, status as old_status, title as old_title FROM speaker_travel WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
        if (cur.length === 0) return res.status(404).json({ error: 'Travel record not found' });

        if (req.user.role === 'manager') {
            const [currentEntity] = await db.query('SELECT s.event_id, e.created_by FROM speaker_travel t JOIN speakers s ON t.speaker_id = s.id AND s.tenant_id = t.tenant_id JOIN events e ON s.event_id = e.id AND e.tenant_id = t.tenant_id WHERE t.id = ? AND t.tenant_id = ?', [req.params.id, req.tenantId]);
            const isAllowed = currentEntity.length > 0 && (currentEntity[0].created_by === req.user.id || assignedIdsOf(req.user).includes(Number(currentEntity[0].event_id)));
            if (!isAllowed) {
                return res.status(403).json({ error: 'You do not own this travel record' });
            }
        } else if (req.user.role === 'employee') {
            const allowed = await employeeAllowedForSpeaker(req, cur[0].speaker_id);
            if (!allowed) {
                return res.status(403).json({ error: 'You can only edit travel in your assigned event' });
            }
        }

        const [updRes] = await db.query(
            `UPDATE speaker_travel SET speaker_id=?, travel_type=?, title=?, details=?, from_location=?, to_location=?, departure_date=?, arrival_date=?, booking_ref=?, cost=?, currency=?, status=?, notes=? WHERE id=? AND tenant_id=?`,
            [speaker_id, travel_type, title, details, from_location, to_location, departure_date || null, arrival_date || null, booking_ref, cost || 0, currency || 'INR', status, notes, req.params.id, req.tenantId]
        );
        if (updRes.affectedRows === 0) return res.status(404).json({ error: 'Travel record not found' });

        // Fire-and-forget notification if status changed
        if (status && cur[0].old_status !== status) {
            const [creatorRows] = await db.query('SELECT e.created_by FROM speakers s JOIN events e ON s.event_id = e.id AND e.tenant_id = s.tenant_id WHERE s.id = ? AND s.tenant_id = ?', [cur[0].speaker_id, req.tenantId]);
            const [spkInfo] = await db.query('SELECT name, photo_url FROM speakers WHERE id = ? AND tenant_id = ?', [cur[0].speaker_id, req.tenantId]);
            if (creatorRows.length > 0) {
                notifyUser(creatorRows[0].created_by, 'travel_update', 'Travel Status Updated', `${title || cur[0].old_title} status changed to ${status}`, '/travel', { imageUrl: spkInfo[0]?.photo_url, actorName: req.user.name }).catch(() => {});
            }
        }

        res.json({ message: 'Travel record updated' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE travel record
router.delete('/:id', guard, async (req, res) => {
    try {
        const [cur] = await db.query('SELECT speaker_id FROM speaker_travel WHERE id = ? AND tenant_id = ?', [req.params.id, req.tenantId]);
        if (cur.length === 0) return res.status(404).json({ error: 'Travel record not found' });

        if (req.user.role === 'manager') {
            const [currentEntity] = await db.query('SELECT s.event_id, e.created_by FROM speaker_travel t JOIN speakers s ON t.speaker_id = s.id AND s.tenant_id = t.tenant_id JOIN events e ON s.event_id = e.id AND e.tenant_id = t.tenant_id WHERE t.id = ? AND t.tenant_id = ?', [req.params.id, req.tenantId]);
            const isAllowed = currentEntity.length > 0 && (currentEntity[0].created_by === req.user.id || assignedIdsOf(req.user).includes(Number(currentEntity[0].event_id)));
            if (!isAllowed) {
                return res.status(403).json({ error: 'You do not own this travel record' });
            }
        } else if (req.user.role === 'employee') {
            const allowed = await employeeAllowedForSpeaker(req, cur[0].speaker_id);
            if (!allowed) {
                return res.status(403).json({ error: 'You can only delete travel in your assigned event' });
            }
        }

        const [delRes] = await db.query('DELETE FROM speaker_travel WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        if (delRes.affectedRows === 0) return res.status(404).json({ error: 'Travel record not found' });
        res.json({ message: 'Travel record deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
