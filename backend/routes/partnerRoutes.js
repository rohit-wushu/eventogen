const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { requireSection } = require('../middleware/permissions');
// Per-employee section gate. Inline protect already runs first; this just
// adds the section check. Admins/managers always pass; employees pass when
// their permissions column is NULL or includes 'partners'.
const guard = [protect, requireSection('partners')];
const { notifyAdminsAndManagers } = require('../utils/notify');
const { createUpload, fileUrl } = require('../utils/storage');

const upload = createUpload('partner');

// Multi-event aware access. The local `employeeAllowed` shim adds the
// per-event 'partners' section check on top of basic event assignment.
const { hasSectionForEvent, assignedIdsOf, assignedIdsForSql, eventIdsForSection } = require('../utils/eventAccess');
const employeeAllowed = (req, event_id) => hasSectionForEvent(req.user, event_id, 'partners');
const empPartnerEventIds = (req) => eventIdsForSection(req.user, 'partners');

router.get('/', guard, async (req, res) => {
    try {
        let query = `SELECT p.*, e.title as event_title, pc.name as category_name,
                       COUNT(pw.speaker_id) as wishlist_speaker_count,
                       GROUP_CONCAT(ws.name SEPARATOR '|||') as wishlist_speaker_names,
                       GROUP_CONCAT(IFNULL(ws.photo_url, '') SEPARATOR '|||') as wishlist_speaker_photos
            FROM partners p
            LEFT JOIN events e ON p.event_id = e.id AND e.tenant_id = p.tenant_id
            LEFT JOIN partner_categories pc ON p.category_id = pc.id AND pc.tenant_id = p.tenant_id
            LEFT JOIN partner_wishlist pw ON p.id = pw.partner_id AND pw.tenant_id = p.tenant_id
            LEFT JOIN speakers ws ON pw.speaker_id = ws.id AND ws.tenant_id = p.tenant_id AND ws.deleted_at IS NULL
            WHERE p.tenant_id = ? AND p.deleted_at IS NULL`;
        let params = [req.tenantId];

        if (req.user.role === 'manager') {
            query += ` AND (e.created_by = ? OR p.event_id IN (?))`;
            params.push(req.user.id, assignedIdsForSql(req.user));
        } else if (req.user.role === 'employee') {
            if (assignedIdsOf(req.user).length === 0) return res.json([]);
            query += ` AND p.event_id IN (?)`;
            params.push(empPartnerEventIds(req));
        }

        query += ` GROUP BY p.id ORDER BY p.sequence ASC, p.name ASC`;
        const [partners] = await db.query(query, params);
        res.json(partners);
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
            const [cur] = await connection.query('SELECT p.event_id, e.created_by FROM partners p LEFT JOIN events e ON p.event_id = e.id AND e.tenant_id = p.tenant_id WHERE p.id = ? AND p.tenant_id = ? AND p.deleted_at IS NULL', [update.id, req.tenantId]);
            const isManagerAllowed = req.user.role === 'manager' && cur.length > 0 &&
                (cur[0].created_by === req.user.id || assignedIdsOf(req.user).includes(Number(cur[0].event_id)));

            if (req.user.role === 'manager' && !isManagerAllowed) {
                throw new Error('You do not have permission for this partner');
            }
            if (req.user.role === 'employee' && cur.length > 0 && !employeeAllowed(req, cur[0].event_id)) {
                throw new Error('Unauthorized for this event');
            }

            await connection.query('UPDATE partners SET sequence=? WHERE id=? AND tenant_id=?',
                [update.sequence, update.id, req.tenantId]);
        }
        await connection.commit();
        res.json({ message: 'Partners reordered successfully' });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        connection.release();
    }
});

router.post('/', guard, upload.single('logo'), async (req, res) => {
    const { name, website, event_id, category_id, sequence, wishlist, wishlist_speakers, logo_width, logo_height } = req.body;
    let logo_url = req.body.logo_url;
    if (req.file) logo_url = fileUrl(req.file);
    const logoW = logo_width ? parseInt(logo_width, 10) || null : null;
    const logoH = logo_height ? parseInt(logo_height, 10) || null : null;

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        if (req.user.role === 'manager') {
            const [evts] = await connection.query('SELECT created_by FROM events WHERE id=? AND tenant_id=?', [event_id, req.tenantId]);
            if (evts.length === 0 || (evts[0].created_by !== req.user.id && !assignedIdsOf(req.user).includes(Number(event_id)))) {
                await connection.rollback();
                return res.status(403).json({ error: 'You can only add partners to your own or assigned events' });
            }
        }
        if (req.user.role === 'employee' && !employeeAllowed(req, event_id)) {
            await connection.rollback();
            return res.status(403).json({ error: 'You can only add partners to your assigned event' });
        }

        const [result] = await connection.query(
            'INSERT INTO partners (tenant_id, name, website, logo_url, logo_width, logo_height, category_id, event_id, sequence, wishlist, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [req.tenantId, name, website, logo_url, logoW, logoH, category_id || null, event_id || null, sequence || 0, wishlist || null, req.user.id]
        );
        const partnerId = result.insertId;

        // Save wishlist speakers
        if (wishlist_speakers) {
            console.log('Saving wishlist speakers:', wishlist_speakers);
            const speakerIds = Array.isArray(wishlist_speakers) ? wishlist_speakers : JSON.parse(wishlist_speakers);
            if (speakerIds.length > 0) {
                const values = speakerIds.map(sid => [req.tenantId, partnerId, sid]);
                await connection.query('INSERT INTO partner_wishlist (tenant_id, partner_id, speaker_id) VALUES ?', [values]);
            }
        }

        await connection.commit();

        // Fire-and-forget notification
        notifyAdminsAndManagers('partner_added', 'New Partner', `${name} added as partner`, '/partners', req.user.id, { actorName: req.user.name }).catch(() => {});

        res.status(201).json({ message: 'Partner added', id: partnerId });
    } catch (err) {
        console.error('Error in POST /partners:', err);
        await connection.rollback();
        res.status(500).json({ error: err.message }); 
    } finally {
        connection.release();
    }
});

router.get('/:id', guard, async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT p.*, e.title as event_title, pc.name as category_name
            FROM partners p
            LEFT JOIN events e ON p.event_id = e.id AND e.tenant_id = p.tenant_id
            LEFT JOIN partner_categories pc ON p.category_id = pc.id AND pc.tenant_id = p.tenant_id
            WHERE p.id = ? AND p.tenant_id = ? AND p.deleted_at IS NULL`, [req.params.id, req.tenantId]);

        if (rows.length === 0) return res.status(404).json({ error: 'Partner not found' });
        const partner = rows[0];

        // Fetch wishlist speakers — skip any soft-deleted speakers so a partner
        // doesn't show ghosts after the underlying speaker is removed.
        const [speakers] = await db.query(`
            SELECT s.*
            FROM speakers s
            JOIN partner_wishlist pw ON s.id = pw.speaker_id AND pw.tenant_id = s.tenant_id
            WHERE pw.partner_id = ? AND s.tenant_id = ? AND s.deleted_at IS NULL`, [req.params.id, req.tenantId]);

        partner.wishlist_speakers = speakers;
        res.json(partner);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', guard, upload.single('logo'), async (req, res) => {
    const { name, website, event_id, category_id, sequence, wishlist, wishlist_speakers, logo_width, logo_height } = req.body;
    let logo_url = req.body.logo_url;
    if (req.file) logo_url = fileUrl(req.file);
    const logoW = logo_width ? parseInt(logo_width, 10) || null : null;
    const logoH = logo_height ? parseInt(logo_height, 10) || null : null;

    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        const [cur] = await connection.query('SELECT p.event_id, e.created_by FROM partners p LEFT JOIN events e ON p.event_id = e.id AND e.tenant_id = p.tenant_id WHERE p.id = ? AND p.tenant_id = ? AND p.deleted_at IS NULL', [req.params.id, req.tenantId]);

        const isManagerAllowed = req.user.role === 'manager' && cur.length > 0 &&
            (cur[0].created_by === req.user.id || assignedIdsOf(req.user).includes(Number(cur[0].event_id)));

        if (req.user.role === 'manager' && !isManagerAllowed) {
            await connection.rollback();
            return res.status(403).json({ error: 'You do not have permission to edit this partner' });
        }
        if (req.user.role === 'employee' && cur.length > 0 && !employeeAllowed(req, cur[0].event_id)) {
            await connection.rollback();
            return res.status(403).json({ error: 'You can only edit partners in your assigned event' });
        }

        const [upd] = await connection.query('UPDATE partners SET name=?, website=?, logo_url=?, logo_width=?, logo_height=?, event_id=?, category_id=?, sequence=?, wishlist=? WHERE id=? AND tenant_id=?',
            [name, website, logo_url, logoW, logoH, event_id || null, category_id || null, sequence || 0, wishlist || null, req.params.id, req.tenantId]);
        if (upd.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Partner not found' });
        }

        // Sync wishlist speakers
        if (wishlist_speakers) {
            console.log('Updating wishlist speakers:', wishlist_speakers);
            await connection.query('DELETE FROM partner_wishlist WHERE partner_id=? AND tenant_id=?', [req.params.id, req.tenantId]);
            const speakerIds = Array.isArray(wishlist_speakers) ? wishlist_speakers : JSON.parse(wishlist_speakers);
            if (speakerIds.length > 0) {
                const values = speakerIds.map(sid => [req.tenantId, req.params.id, sid]);
                await connection.query('INSERT INTO partner_wishlist (tenant_id, partner_id, speaker_id) VALUES ?', [values]);
            }
        }

        await connection.commit();
        res.json({ message: 'Partner updated' });
    } catch (err) { 
        console.error('Error in PUT /partners/:id:', err);
        await connection.rollback();
        res.status(500).json({ error: err.message }); 
    } finally {
        connection.release();
    }
});

router.delete('/:id', guard, async (req, res) => {
    try {
        const [cur] = await db.query('SELECT p.event_id, e.created_by FROM partners p LEFT JOIN events e ON p.event_id = e.id AND e.tenant_id = p.tenant_id WHERE p.id = ? AND p.tenant_id = ? AND p.deleted_at IS NULL', [req.params.id, req.tenantId]);

        const isManagerAllowed = req.user.role === 'manager' && cur.length > 0 &&
            (cur[0].created_by === req.user.id || assignedIdsOf(req.user).includes(Number(cur[0].event_id)));

        if (req.user.role === 'manager' && !isManagerAllowed)
            return res.status(403).json({ error: 'You do not have permission to delete this partner' });
        if (req.user.role === 'employee' && cur.length > 0 && !employeeAllowed(req, cur[0].event_id))
            return res.status(403).json({ error: 'You can only delete partners in your assigned event' });

        const [ptr] = await db.query('SELECT name, logo_url FROM partners WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [req.params.id, req.tenantId]);
        // Soft delete — restored from the Recycle Bin or hard-purged after 30 days.
        const [result] = await db.query('UPDATE partners SET deleted_at = NOW(), deleted_by = ? WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL', [req.user.id, req.params.id, req.tenantId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Partner not found' });
        if (ptr.length > 0) {
            notifyAdminsAndManagers('partner_deleted', 'Partner Removed', `${ptr[0].name} was removed`, '/partners', req.user.id, { imageUrl: ptr[0].logo_url, actorName: req.user.name }).catch(() => {});
        }
        res.json({ message: 'Partner deleted' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
