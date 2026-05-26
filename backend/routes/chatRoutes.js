const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { createUpload, fileUrl } = require('../utils/storage');
const { cacheGet, cacheSet, cacheDel, K } = require('../utils/cache');
const { parseTrigger, generateGroupReport, errorPayload } = require('../services/reportEngine');

// 3s TTL — short enough that the chat still feels live even when an
// invalidation race slips through; long enough that the 5s polling loop
// hits cache the second time through.
const CACHE_TTL = 3;

// For a group write, every member's `groups` + `unread` cache becomes
// stale. Pull the membership list so we can bust each member's keys.
// Cheap query (small table, indexed on group_id).
const groupMemberIds = async (groupId, tenantId) => {
    try {
        const [rows] = await db.query(
            'SELECT user_id FROM chat_group_members WHERE group_id=? AND tenant_id=?',
            [groupId, tenantId]
        );
        return rows.map(r => r.user_id);
    } catch (_) { return []; }
};

// Convenience: bust a DM-related write so both sides see fresh state.
const bustDmCaches = (tenantId, a, b) => cacheDel(
    K.conv(tenantId, a), K.conv(tenantId, b),
    K.unread(tenantId, a), K.unread(tenantId, b)
);

// Convenience: bust a group-related write for every member.
const bustGroupCaches = async (tenantId, groupId, alsoGroupsList = false) => {
    const ids = await groupMemberIds(groupId, tenantId);
    const keys = [];
    for (const uid of ids) {
        keys.push(K.unread(tenantId, uid));
        if (alsoGroupsList) keys.push(K.groups(tenantId, uid));
    }
    return cacheDel(keys);
};

// Typing freshness window. Anything older than this in `chat_typing` is
// treated as "stopped typing". Matches the previous in-memory TTL.
const TYPING_TTL_SECONDS = 4;

const upload = createUpload('chat', { limits: { fileSize: 25 * 1024 * 1024 } }); // 25 MB

const classifyAttachment = (mimetype = '') => {
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype === 'application/pdf') return 'pdf';
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
    return 'file';
};

// List of teammates with last message & unread count for the current user
router.get('/conversations', protect, async (req, res) => {
    try {
        const me = req.user.id;
        const cacheKey = K.conv(req.tenantId, me);
        const cached = await cacheGet(cacheKey);
        if (cached) return res.json(cached);

        const [users] = await db.query(
            `SELECT u.id, u.name, u.email, u.role, u.profile_photo_url
             FROM users u WHERE u.id <> ? AND u.tenant_id = ? ORDER BY u.name ASC`,
            [me, req.tenantId]
        );

        // `message_hides` filter here is what powers "Clear chat / Delete chat"
        // for the sidebar: once a user hides every message in a DM, the last-message
        // preview and unread count disappear from their list too — while the other
        // party still sees their copy intact.
        const [last] = await db.query(
            `SELECT m.*
             FROM messages m
             LEFT JOIN message_hides mh ON mh.message_id = m.id AND mh.user_id = ? AND mh.tenant_id = m.tenant_id
             INNER JOIN (
               SELECT LEAST(m2.sender_id, m2.recipient_id) AS a,
                      GREATEST(m2.sender_id, m2.recipient_id) AS b,
                      MAX(m2.created_at) AS latest
               FROM messages m2
               LEFT JOIN message_hides mh2 ON mh2.message_id = m2.id AND mh2.user_id = ? AND mh2.tenant_id = m2.tenant_id
               WHERE m2.group_id IS NULL AND (m2.sender_id = ? OR m2.recipient_id = ?) AND m2.tenant_id = ?
                 AND mh2.message_id IS NULL
               GROUP BY a, b
             ) t ON LEAST(m.sender_id, m.recipient_id) = t.a
                AND GREATEST(m.sender_id, m.recipient_id) = t.b
                AND m.created_at = t.latest
             WHERE m.tenant_id = ?
               AND mh.message_id IS NULL`,
            [me, me, me, me, req.tenantId, req.tenantId]
        );

        const [unread] = await db.query(
            `SELECT m.sender_id, COUNT(*) AS cnt
             FROM messages m
             LEFT JOIN message_hides mh ON mh.message_id = m.id AND mh.user_id = ? AND mh.tenant_id = m.tenant_id
             WHERE m.recipient_id = ? AND m.read_at IS NULL AND m.tenant_id = ?
               AND mh.message_id IS NULL
             GROUP BY m.sender_id`,
            [me, me, req.tenantId]
        );
        const unreadMap = Object.fromEntries(unread.map(u => [u.sender_id, u.cnt]));

        const lastMap = {};
        for (const m of last) {
            const other = m.sender_id === me ? m.recipient_id : m.sender_id;
            lastMap[other] = m;
        }

        const enriched = users.map(u => ({
            ...u,
            last_message: lastMap[u.id] || null,
            unread_count: unreadMap[u.id] || 0
        }));

        enriched.sort((x, y) => {
            const tx = x.last_message?.created_at ? new Date(x.last_message.created_at).getTime() : 0;
            const ty = y.last_message?.created_at ? new Date(y.last_message.created_at).getTime() : 0;
            if (ty !== tx) return ty - tx;
            return x.name.localeCompare(y.name);
        });

        cacheSet(cacheKey, enriched, CACHE_TTL);
        res.json(enriched);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Thread with a specific user.
//
// Supports cursor-based pagination so the frontend can load a chat on
// demand rather than hauling the last 500 messages every time:
//   ?limit=40                 latest N messages (default 40, max 100)
//   ?before=<id>&limit=40     N messages older than <id> — used by the
//                             infinite scroll when the user scrolls up
//   ?after=<id>               all messages newer than <id> (up to 200)
//                             — used by the polling loop to fetch only
//                             deltas instead of the whole thread
router.get('/messages/:userId', protect, async (req, res) => {
    try {
        const me = req.user.id;
        const other = parseInt(req.params.userId, 10);
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 40, 1), 100);
        const beforeId = parseInt(req.query.before, 10) || null;
        const afterId  = parseInt(req.query.after, 10) || null;

        const cursorClause = beforeId ? ' AND m.id < ?' : afterId ? ' AND m.id > ?' : '';
        const cursorParams = beforeId ? [beforeId] : afterId ? [afterId] : [];
        // Older batches are fetched DESC + LIMIT for efficiency, then flipped
        // to ASC before serving so the frontend can concatenate directly.
        const order = afterId ? 'ASC' : 'DESC';
        const effectiveLimit = afterId ? Math.min(limit * 5, 200) : limit;

        const [rows] = await db.query(
            `SELECT m.*,
                    r.body AS reply_body, r.attachment_type AS reply_attachment_type,
                    r.sender_id AS reply_sender_id, ru.name AS reply_sender_name,
                    s.name AS speaker_name, s.photo_url AS speaker_photo_url,
                    s.designation AS speaker_designation, s.company AS speaker_company
             FROM messages m
             LEFT JOIN messages r ON r.id = m.reply_to_id AND r.tenant_id = m.tenant_id
             LEFT JOIN users ru ON ru.id = r.sender_id AND ru.tenant_id = m.tenant_id
             LEFT JOIN speakers s ON s.id = m.speaker_id AND s.tenant_id = m.tenant_id
             LEFT JOIN message_hides h ON h.message_id = m.id AND h.user_id = ? AND h.tenant_id = m.tenant_id
             WHERE h.message_id IS NULL
               AND m.tenant_id = ?
               AND ((m.sender_id = ? AND m.recipient_id = ?)
                OR  (m.sender_id = ? AND m.recipient_id = ?))
               ${cursorClause}
             ORDER BY m.created_at ${order}
             LIMIT ${effectiveLimit}`,
            [me, req.tenantId, me, other, other, me, ...cursorParams]
        );
        const ordered = order === 'DESC' ? rows.reverse() : rows;
        res.json(await withReactions(ordered, req.tenantId));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const withReactions = async (rows, tenantId) => {
    if (rows.length === 0) return rows;
    const ids = rows.map(r => r.id);
    const [reactions] = await db.query(
        `SELECT mr.message_id, mr.user_id, mr.emoji, u.name AS user_name
         FROM message_reactions mr
         LEFT JOIN users u ON u.id = mr.user_id AND u.tenant_id = mr.tenant_id
         WHERE mr.message_id IN (?) AND mr.tenant_id = ?`, [ids, tenantId]
    );
    const byMsg = {};
    for (const r of reactions) {
        if (!byMsg[r.message_id]) byMsg[r.message_id] = [];
        byMsg[r.message_id].push(r);
    }
    return rows.map(m => ({ ...m, reactions: byMsg[m.id] || [] }));
};

// Send message (supports optional file attachment via multipart/form-data)
router.post('/messages', protect, upload.single('attachment'), async (req, res) => {
    const { recipient_id, body, reply_to_id, speaker_id } = req.body;
    const file = req.file;
    if (!recipient_id) return res.status(400).json({ error: 'Recipient required' });
    if (!body?.trim() && !file) return res.status(400).json({ error: 'Message or attachment required' });
    if (String(recipient_id) === String(req.user.id)) {
        return res.status(400).json({ error: 'Cannot message yourself' });
    }
    try {
        // Cross-tenant DM prevention: recipient must exist in the same tenant as the sender.
        // Without this, a sender could craft a recipient_id referencing a user in another tenant.
        const [recipients] = await db.query(
            'SELECT id FROM users WHERE id = ? AND tenant_id = ?',
            [recipient_id, req.tenantId]
        );
        if (recipients.length === 0) {
            return res.status(404).json({ error: 'Recipient not found' });
        }

        const attachment_url = file ? fileUrl(file) : null;
        const attachment_name = file ? file.originalname : null;
        const attachment_type = file ? classifyAttachment(file.mimetype) : null;
        const attachment_size = file ? file.size : null;

        const [result] = await db.query(
            `INSERT INTO messages
             (tenant_id, sender_id, recipient_id, body, attachment_url, attachment_name, attachment_type, attachment_size, reply_to_id, speaker_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.tenantId, req.user.id, recipient_id, body?.trim() || null, attachment_url, attachment_name, attachment_type, attachment_size, reply_to_id || null, speaker_id || null]
        );
        const [rows] = await db.query('SELECT * FROM messages WHERE id=? AND tenant_id=?', [result.insertId, req.tenantId]);
        // Both DM participants' conversation list + unread count are now stale.
        bustDmCaches(req.tenantId, req.user.id, recipient_id);
        res.status(201).json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Mark messages from a user as read
router.put('/messages/read/:userId', protect, async (req, res) => {
    try {
        await db.query(
            'UPDATE messages SET read_at = NOW() WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL AND tenant_id = ?',
            [req.user.id, req.params.userId, req.tenantId]
        );
        // My unread count + conversation preview just changed; bust both.
        cacheDel(K.unread(req.tenantId, req.user.id), K.conv(req.tenantId, req.user.id));
        res.json({ message: 'Marked read' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Total unread count
router.get('/unread-count', protect, async (req, res) => {
    try {
        const me = req.user.id;
        const cacheKey = K.unread(req.tenantId, me);
        const cached = await cacheGet(cacheKey);
        if (cached) return res.json(cached);

        const [dm] = await db.query(
            'SELECT COUNT(*) AS cnt FROM messages WHERE recipient_id = ? AND read_at IS NULL AND tenant_id = ?',
            [me, req.tenantId]
        );
        const [gr] = await db.query(
            `SELECT COUNT(*) AS cnt
             FROM messages m
             INNER JOIN chat_group_members cm ON cm.group_id = m.group_id AND cm.user_id = ? AND cm.tenant_id = m.tenant_id
             LEFT JOIN chat_group_reads r ON r.group_id = m.group_id AND r.user_id = ? AND r.tenant_id = m.tenant_id
             WHERE m.group_id IS NOT NULL
               AND m.tenant_id = ?
               AND m.sender_id <> ?
               AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)`,
            [me, me, req.tenantId, me]
        );
        const payload = { count: (dm[0].cnt || 0) + (gr[0].cnt || 0) };
        cacheSet(cacheKey, payload, CACHE_TTL);
        res.json(payload);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ============================ GROUP CHAT ============================ */

const isManagerish = (role) => role === 'admin' || role === 'manager';

const assertMember = async (groupId, userId, tenantId) => {
    const [rows] = await db.query(
        'SELECT 1 FROM chat_group_members WHERE group_id=? AND user_id=? AND tenant_id=?',
        [groupId, userId, tenantId]
    );
    return rows.length > 0;
};

// List groups the current user belongs to, with last message & unread count
router.get('/groups', protect, async (req, res) => {
    try {
        const me = req.user.id;
        const cacheKey = K.groups(req.tenantId, me);
        const cached = await cacheGet(cacheKey);
        if (cached) return res.json(cached);

        const [groups] = await db.query(
            `SELECT g.id, g.name, g.event_id, g.created_by, g.created_at, g.photo_url,
                    e.title AS event_title,
                    (SELECT COUNT(*) FROM chat_group_members cm WHERE cm.group_id = g.id AND cm.tenant_id = g.tenant_id) AS member_count
             FROM chat_groups g
             LEFT JOIN events e ON g.event_id = e.id AND e.tenant_id = g.tenant_id
             INNER JOIN chat_group_members m ON m.group_id = g.id AND m.user_id = ? AND m.tenant_id = g.tenant_id
             WHERE g.tenant_id = ?
             ORDER BY g.created_at DESC`,
            [me, req.tenantId]
        );

        if (groups.length === 0) return res.json([]);
        const ids = groups.map(g => g.id);

        // Same `message_hides` filter as the DM sidebar — "Clear chat" inside a
        // group hides that group's messages from this user's view, so the preview
        // and unread count must drop them too.
        const [lastMsgs] = await db.query(
            `SELECT m.*, u.name AS sender_name
             FROM messages m
             LEFT JOIN message_hides mh ON mh.message_id = m.id AND mh.user_id = ? AND mh.tenant_id = m.tenant_id
             INNER JOIN (
               SELECT m2.group_id, MAX(m2.created_at) AS latest
               FROM messages m2
               LEFT JOIN message_hides mh2 ON mh2.message_id = m2.id AND mh2.user_id = ? AND mh2.tenant_id = m2.tenant_id
               WHERE m2.group_id IN (?) AND m2.tenant_id = ?
                 AND mh2.message_id IS NULL
               GROUP BY m2.group_id
             ) t ON m.group_id = t.group_id AND m.created_at = t.latest
             LEFT JOIN users u ON m.sender_id = u.id AND u.tenant_id = m.tenant_id
             WHERE m.tenant_id = ?
               AND mh.message_id IS NULL`,
            [me, me, ids, req.tenantId, req.tenantId]
        );
        const lastMap = Object.fromEntries(lastMsgs.map(m => [m.group_id, m]));

        const [reads] = await db.query(
            'SELECT group_id, last_read_at FROM chat_group_reads WHERE user_id=? AND group_id IN (?) AND tenant_id=?',
            [me, ids, req.tenantId]
        );
        const readMap = Object.fromEntries(reads.map(r => [r.group_id, r.last_read_at]));

        const [unreadRows] = await db.query(
            `SELECT m.group_id, COUNT(*) AS cnt
             FROM messages m
             LEFT JOIN chat_group_reads r ON r.group_id = m.group_id AND r.user_id = ? AND r.tenant_id = m.tenant_id
             LEFT JOIN message_hides mh ON mh.message_id = m.id AND mh.user_id = ? AND mh.tenant_id = m.tenant_id
             WHERE m.group_id IN (?)
               AND m.tenant_id = ?
               AND m.sender_id <> ?
               AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
               AND mh.message_id IS NULL
             GROUP BY m.group_id`,
            [me, me, ids, req.tenantId, me]
        );
        const unreadMap = Object.fromEntries(unreadRows.map(r => [r.group_id, r.cnt]));

        const enriched = groups.map(g => ({
            ...g,
            last_message: lastMap[g.id] || null,
            unread_count: unreadMap[g.id] || 0,
            last_read_at: readMap[g.id] || null
        }));

        enriched.sort((x, y) => {
            const tx = x.last_message?.created_at ? new Date(x.last_message.created_at).getTime() : new Date(x.created_at).getTime();
            const ty = y.last_message?.created_at ? new Date(y.last_message.created_at).getTime() : new Date(y.created_at).getTime();
            return ty - tx;
        });

        cacheSet(cacheKey, enriched, CACHE_TTL);
        res.json(enriched);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create a group (admin / manager only)
router.post('/groups', protect, async (req, res) => {
    if (!isManagerish(req.user.role)) {
        return res.status(403).json({ error: 'Only admins and managers can create groups' });
    }
    const { name, event_id, member_ids } = req.body;
    if (!event_id) return res.status(400).json({ error: 'Event is required' });
    if (!Array.isArray(member_ids) || member_ids.length === 0) {
        return res.status(400).json({ error: 'Select at least one member' });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        let groupName = name?.trim();
        // Always look up event within the caller's tenant — prevents creating a group
        // bound to an event in another tenant.
        const [ev] = await conn.query('SELECT title FROM events WHERE id=? AND tenant_id=?', [event_id, req.tenantId]);
        if (ev.length === 0) {
            await conn.rollback();
            return res.status(400).json({ error: 'Event not found' });
        }
        if (!groupName) {
            groupName = ev[0].title;
        }

        // Filter member_ids to only users in this tenant — prevents adding
        // cross-tenant users to a group.
        const candidateIds = Array.from(new Set([...member_ids.map(Number), req.user.id]));
        const [validUsers] = await conn.query(
            'SELECT id FROM users WHERE id IN (?) AND tenant_id = ?',
            [candidateIds, req.tenantId]
        );
        const validIds = validUsers.map(u => u.id);
        if (validIds.length === 0) {
            await conn.rollback();
            return res.status(400).json({ error: 'No valid members' });
        }

        const [result] = await conn.query(
            'INSERT INTO chat_groups (tenant_id, name, event_id, created_by) VALUES (?, ?, ?, ?)',
            [req.tenantId, groupName, event_id, req.user.id]
        );
        const groupId = result.insertId;

        const values = validIds.map(uid => [req.tenantId, groupId, uid]);
        await conn.query('INSERT INTO chat_group_members (tenant_id, group_id, user_id) VALUES ?', [values]);

        await conn.commit();
        // New group → every new member's groups list is stale.
        cacheDel(validIds.map(uid => K.groups(req.tenantId, uid)));
        res.status(201).json({ id: groupId, name: groupName, event_id, member_count: validIds.length });
    } catch (err) {
        await conn.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        conn.release();
    }
});

// Get group details + members
router.get('/groups/:id', protect, async (req, res) => {
    try {
        const me = req.user.id;
        if (!(await assertMember(req.params.id, me, req.tenantId))) {
            return res.status(403).json({ error: 'Not a member' });
        }
        const [rows] = await db.query(
            `SELECT g.*, e.title AS event_title FROM chat_groups g
             LEFT JOIN events e ON g.event_id = e.id AND e.tenant_id = g.tenant_id
             WHERE g.id=? AND g.tenant_id=?`,
            [req.params.id, req.tenantId]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Group not found' });

        const [members] = await db.query(
            `SELECT u.id, u.name, u.email, u.role, u.profile_photo_url
             FROM chat_group_members cm
             INNER JOIN users u ON u.id = cm.user_id AND u.tenant_id = cm.tenant_id
             WHERE cm.group_id = ? AND cm.tenant_id = ?
             ORDER BY u.name ASC`,
            [req.params.id, req.tenantId]
        );
        res.json({ ...rows[0], members });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update group (name / description / drive link / members) — admin/manager + creator
router.put('/groups/:id', protect, async (req, res) => {
    const { name, description, drive_link, member_ids } = req.body;
    const conn = await db.getConnection();
    try {
        const [g] = await conn.query('SELECT created_by FROM chat_groups WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        if (g.length === 0) return res.status(404).json({ error: 'Group not found' });
        if (!isManagerish(req.user.role) && g[0].created_by !== req.user.id) {
            return res.status(403).json({ error: 'Not allowed' });
        }

        await conn.beginTransaction();
        const sets = [];
        const params = [];
        if (typeof name === 'string' && name.trim()) { sets.push('name=?'); params.push(name.trim()); }
        if (typeof description === 'string') { sets.push('description=?'); params.push(description); }
        if (typeof drive_link === 'string') { sets.push('drive_link=?'); params.push(drive_link); }
        if (sets.length) {
            params.push(req.params.id, req.tenantId);
            const [upd] = await conn.query(`UPDATE chat_groups SET ${sets.join(', ')} WHERE id=? AND tenant_id=?`, params);
            if (upd.affectedRows === 0) {
                await conn.rollback();
                return res.status(404).json({ error: 'Group not found' });
            }
        }
        if (Array.isArray(member_ids)) {
            // Filter member_ids to only users in this tenant — prevents adding
            // cross-tenant users via update.
            const candidateIds = Array.from(new Set([...member_ids.map(Number), g[0].created_by]));
            const [validUsers] = await conn.query(
                'SELECT id FROM users WHERE id IN (?) AND tenant_id = ?',
                [candidateIds, req.tenantId]
            );
            const validIds = validUsers.map(u => u.id);

            await conn.query('DELETE FROM chat_group_members WHERE group_id=? AND tenant_id=?', [req.params.id, req.tenantId]);
            if (validIds.length > 0) {
                const values = validIds.map(uid => [req.tenantId, req.params.id, uid]);
                await conn.query('INSERT INTO chat_group_members (tenant_id, group_id, user_id) VALUES ?', [values]);
            }
        }
        await conn.commit();
        res.json({ message: 'Group updated' });
    } catch (err) {
        await conn.rollback();
        res.status(500).json({ error: err.message });
    } finally {
        conn.release();
    }
});

// Upload / replace group photo (admin / manager / creator)
router.put('/groups/:id/photo', protect, upload.single('photo'), async (req, res) => {
    try {
        const [g] = await db.query('SELECT created_by FROM chat_groups WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        if (g.length === 0) return res.status(404).json({ error: 'Group not found' });
        if (!isManagerish(req.user.role) && g[0].created_by !== req.user.id) {
            return res.status(403).json({ error: 'Not allowed' });
        }
        if (!req.file) return res.status(400).json({ error: 'Photo required' });
        const photo_url = fileUrl(req.file);
        const [result] = await db.query('UPDATE chat_groups SET photo_url=? WHERE id=? AND tenant_id=?', [photo_url, req.params.id, req.tenantId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Group not found' });
        res.json({ photo_url });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Add members to a group (admin / manager only)
router.post('/groups/:id/members', protect, async (req, res) => {
    if (!isManagerish(req.user.role)) {
        return res.status(403).json({ error: 'Only admins and managers can add members' });
    }
    const { user_ids } = req.body;
    if (!Array.isArray(user_ids) || user_ids.length === 0) {
        return res.status(400).json({ error: 'user_ids required' });
    }
    try {
        const [g] = await db.query('SELECT id FROM chat_groups WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        if (g.length === 0) return res.status(404).json({ error: 'Group not found' });

        // Filter user_ids to only users in this tenant.
        const candidateIds = user_ids.map(Number);
        const [validUsers] = await db.query(
            'SELECT id FROM users WHERE id IN (?) AND tenant_id = ?',
            [candidateIds, req.tenantId]
        );
        const validIds = validUsers.map(u => u.id);
        if (validIds.length === 0) {
            return res.status(400).json({ error: 'No valid users to add' });
        }

        const values = validIds.map(uid => [req.tenantId, req.params.id, uid]);
        await db.query('INSERT IGNORE INTO chat_group_members (tenant_id, group_id, user_id) VALUES ?', [values]);
        // Newly-added members now see the group in their list.
        cacheDel(validIds.map(uid => K.groups(req.tenantId, uid)));
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Remove a member from a group (admin / manager only). Creator cannot be removed.
router.delete('/groups/:id/members/:userId', protect, async (req, res) => {
    if (!isManagerish(req.user.role)) {
        return res.status(403).json({ error: 'Only admins and managers can remove members' });
    }
    try {
        const [g] = await db.query('SELECT created_by FROM chat_groups WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        if (g.length === 0) return res.status(404).json({ error: 'Group not found' });
        if (String(g[0].created_by) === String(req.params.userId)) {
            return res.status(400).json({ error: 'Cannot remove the creator' });
        }
        const [result] = await db.query('DELETE FROM chat_group_members WHERE group_id=? AND user_id=? AND tenant_id=?',
            [req.params.id, req.params.userId, req.tenantId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Member not found' });
        // Removed user's groups list and unread count are now stale.
        cacheDel(K.groups(req.tenantId, req.params.userId), K.unread(req.tenantId, req.params.userId));
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Media shared in a group (images + files)
router.get('/groups/:id/media', protect, async (req, res) => {
    try {
        if (!(await assertMember(req.params.id, req.user.id, req.tenantId))) {
            return res.status(403).json({ error: 'Not a member' });
        }
        const [rows] = await db.query(
            `SELECT m.id, m.attachment_url, m.attachment_name, m.attachment_type, m.attachment_size,
                    m.created_at, m.sender_id, u.name AS sender_name
             FROM messages m
             LEFT JOIN users u ON u.id = m.sender_id AND u.tenant_id = m.tenant_id
             WHERE m.group_id = ? AND m.tenant_id = ? AND m.attachment_url IS NOT NULL AND m.deleted_for_everyone = 0
             ORDER BY m.created_at DESC
             LIMIT 200`,
            [req.params.id, req.tenantId]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete group — admin/manager + creator
router.delete('/groups/:id', protect, async (req, res) => {
    try {
        const [g] = await db.query('SELECT created_by FROM chat_groups WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        if (g.length === 0) return res.status(404).json({ error: 'Group not found' });
        if (!isManagerish(req.user.role) && g[0].created_by !== req.user.id) {
            return res.status(403).json({ error: 'Not allowed' });
        }
        const [result] = await db.query('DELETE FROM chat_groups WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Group not found' });
        res.json({ message: 'Group deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Group messages — same cursor semantics as the DM fetch above.
router.get('/groups/:id/messages', protect, async (req, res) => {
    try {
        if (!(await assertMember(req.params.id, req.user.id, req.tenantId))) {
            return res.status(403).json({ error: 'Not a member' });
        }
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 40, 1), 100);
        const beforeId = parseInt(req.query.before, 10) || null;
        const afterId  = parseInt(req.query.after, 10) || null;

        const cursorClause = beforeId ? ' AND m.id < ?' : afterId ? ' AND m.id > ?' : '';
        const cursorParams = beforeId ? [beforeId] : afterId ? [afterId] : [];
        const order = afterId ? 'ASC' : 'DESC';
        const effectiveLimit = afterId ? Math.min(limit * 5, 200) : limit;

        const [rows] = await db.query(
            `SELECT m.*, u.name AS sender_name,
                    r.body AS reply_body, r.attachment_type AS reply_attachment_type,
                    r.sender_id AS reply_sender_id, ru.name AS reply_sender_name,
                    s.name AS speaker_name, s.photo_url AS speaker_photo_url,
                    s.designation AS speaker_designation, s.company AS speaker_company
             FROM messages m
             LEFT JOIN users u ON u.id = m.sender_id AND u.tenant_id = m.tenant_id
             LEFT JOIN messages r ON r.id = m.reply_to_id AND r.tenant_id = m.tenant_id
             LEFT JOIN users ru ON ru.id = r.sender_id AND ru.tenant_id = m.tenant_id
             LEFT JOIN speakers s ON s.id = m.speaker_id AND s.tenant_id = m.tenant_id
             LEFT JOIN message_hides h ON h.message_id = m.id AND h.user_id = ? AND h.tenant_id = m.tenant_id
             WHERE h.message_id IS NULL AND m.group_id = ? AND m.tenant_id = ?
               ${cursorClause}
             ORDER BY m.created_at ${order}
             LIMIT ${effectiveLimit}`,
            [req.user.id, req.params.id, req.tenantId, ...cursorParams]
        );
        const ordered = order === 'DESC' ? rows.reverse() : rows;
        res.json(await withReactions(ordered, req.tenantId));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/groups/:id/messages', protect, upload.single('attachment'), async (req, res) => {
    const { body, reply_to_id, speaker_id } = req.body;
    const file = req.file;
    if (!body?.trim() && !file) return res.status(400).json({ error: 'Message or attachment required' });
    try {
        if (!(await assertMember(req.params.id, req.user.id, req.tenantId))) {
            return res.status(403).json({ error: 'Not a member' });
        }

        // @report interceptor: a plain-text body starting with the trigger
        // becomes a bot_report card instead of a normal message. Attachments
        // or replies suppress the trigger so we never accidentally swallow
        // a real message that happens to start with "@report ".
        const trigger = !file && !reply_to_id ? parseTrigger(body) : null;
        if (trigger) {
            let payload;
            if (trigger.subcommand === '__unknown__') {
                payload = errorPayload(
                    'Unknown report',
                    `Try @report, @report speakers, @report partners, @report attendees, or @report activity.`
                );
            } else {
                try {
                    payload = await generateGroupReport({
                        groupId: req.params.id,
                        tenantId: req.tenantId,
                        requesterName: req.user.name,
                        subcommand: trigger.subcommand
                    });
                } catch (e) {
                    payload = errorPayload('Report failed', e.message);
                }
            }

            let result;
            try {
                [result] = await db.query(
                    `INSERT INTO messages
                     (tenant_id, sender_id, group_id, body, message_type)
                     VALUES (?, ?, ?, ?, 'bot_report')`,
                    [req.tenantId, req.user.id, req.params.id, JSON.stringify(payload)]
                );
            } catch (insertErr) {
                // The most common cause is the migration not having been run —
                // surface a clear hint rather than a generic 500.
                if (insertErr.errno === 1054 || /message_type/.test(insertErr.message || '')) {
                    return res.status(500).json({
                        error: 'Report feature not migrated. Run: node backend/migrate_chat_report.js'
                    });
                }
                throw insertErr;
            }
            const [rows] = await db.query(
                `SELECT m.*, u.name AS sender_name
                 FROM messages m
                 LEFT JOIN users u ON u.id = m.sender_id AND u.tenant_id = m.tenant_id
                 WHERE m.id=? AND m.tenant_id=?`, [result.insertId, req.tenantId]
            );
            // Bot report is still a message insert — every group member's
            // sidebar preview is now stale.
            bustGroupCaches(req.tenantId, req.params.id, true);
            return res.status(201).json(rows[0]);
        }

        const attachment_url = file ? fileUrl(file) : null;
        const attachment_name = file ? file.originalname : null;
        const attachment_type = file ? classifyAttachment(file.mimetype) : null;
        const attachment_size = file ? file.size : null;

        const [result] = await db.query(
            `INSERT INTO messages
             (tenant_id, sender_id, group_id, body, attachment_url, attachment_name, attachment_type, attachment_size, reply_to_id, speaker_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.tenantId, req.user.id, req.params.id, body?.trim() || null, attachment_url, attachment_name, attachment_type, attachment_size, reply_to_id || null, speaker_id || null]
        );
        const [rows] = await db.query(
            `SELECT m.*, u.name AS sender_name
             FROM messages m
             LEFT JOIN users u ON u.id = m.sender_id AND u.tenant_id = m.tenant_id
             WHERE m.id=? AND m.tenant_id=?`, [result.insertId, req.tenantId]
        );
        // Every member of this group now has stale `groups` (last-msg preview)
        // and `unread`. Bust both for all members.
        bustGroupCaches(req.tenantId, req.params.id, true);
        res.status(201).json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put('/groups/:id/read', protect, async (req, res) => {
    try {
        await db.query(
            `INSERT INTO chat_group_reads (tenant_id, group_id, user_id, last_read_at)
             VALUES (?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE last_read_at = NOW()`,
            [req.tenantId, req.params.id, req.user.id]
        );
        // My unread + groups preview just changed (read marker bumped).
        cacheDel(K.unread(req.tenantId, req.user.id), K.groups(req.tenantId, req.user.id));
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ============================ TYPING ============================ */

// Signal that the current user is typing to `recipient_id`. Stored in the
// `chat_typing` table (instead of a per-process Map) so the signal works
// when the app runs behind a load balancer with multiple Node instances.
router.post('/typing', protect, async (req, res) => {
    const { recipient_id } = req.body;
    if (!recipient_id) return res.status(400).json({ error: 'recipient_id required' });
    try {
        await db.query(
            `INSERT INTO chat_typing (sender_id, recipient_id) VALUES (?, ?)
             ON DUPLICATE KEY UPDATE updated_at = NOW()`,
            [req.user.id, recipient_id]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Check whether `:userId` is currently typing to me. Freshness is checked
// against TYPING_TTL_SECONDS so old rows naturally "expire". A stale-row
// cleanup query runs opportunistically to keep the table small.
router.get('/typing/:userId', protect, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT 1 FROM chat_typing
             WHERE sender_id = ? AND recipient_id = ?
               AND updated_at > (NOW() - INTERVAL ? SECOND)
             LIMIT 1`,
            [req.params.userId, req.user.id, TYPING_TTL_SECONDS]
        );
        // Best-effort cleanup of stale rows (runs ~1% of the time to avoid
        // hot-path overhead). Safe to skip — the freshness filter above
        // ignores them anyway.
        if (Math.random() < 0.01) {
            db.query(
                `DELETE FROM chat_typing WHERE updated_at < (NOW() - INTERVAL 60 SECOND)`
            ).catch(() => {});
        }
        res.json({ typing: rows.length > 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ============================ DELETE / REACT ============================ */

// Delete a message. ?scope=me (hide for me only) OR ?scope=everyone (sender only, tombstone)
router.delete('/messages/:id', protect, async (req, res) => {
    const scope = req.query.scope === 'everyone' ? 'everyone' : 'me';
    try {
        const [rows] = await db.query('SELECT sender_id, recipient_id, group_id FROM messages WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        if (rows.length === 0) return res.status(404).json({ error: 'Message not found' });
        const m = rows[0];

        // Must be part of the conversation
        const me = req.user.id;
        const isPart = m.sender_id === me || m.recipient_id === me
            || (m.group_id && (await assertMember(m.group_id, me, req.tenantId)));
        if (!isPart) return res.status(403).json({ error: 'Not allowed' });

        if (scope === 'everyone') {
            if (m.sender_id !== me) return res.status(403).json({ error: 'Only the sender can delete for everyone' });
            const [result] = await db.query(
                `UPDATE messages SET deleted_for_everyone=1, body=NULL,
                    attachment_url=NULL, attachment_name=NULL, attachment_type=NULL, attachment_size=NULL
                 WHERE id=? AND tenant_id=?`, [req.params.id, req.tenantId]);
            if (result.affectedRows === 0) return res.status(404).json({ error: 'Message not found' });
        } else {
            await db.query(
                `INSERT IGNORE INTO message_hides (tenant_id, message_id, user_id) VALUES (?, ?, ?)`,
                [req.tenantId, req.params.id, me]);
        }
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Forward a message to one or more targets: [{ type: 'user'|'group', id }]
router.post('/messages/:id/forward', protect, async (req, res) => {
    const { targets } = req.body;
    if (!Array.isArray(targets) || targets.length === 0) {
        return res.status(400).json({ error: 'targets required' });
    }
    try {
        const [rows] = await db.query(
            `SELECT sender_id, recipient_id, group_id, body, attachment_url, attachment_name,
                    attachment_type, attachment_size, speaker_id, deleted_for_everyone
             FROM messages WHERE id=? AND tenant_id=?`, [req.params.id, req.tenantId]);
        if (rows.length === 0) return res.status(404).json({ error: 'Message not found' });
        const m = rows[0];
        if (m.deleted_for_everyone) return res.status(400).json({ error: 'Cannot forward a deleted message' });

        // Must be a participant of the original
        const me = req.user.id;
        const canRead = m.sender_id === me || m.recipient_id === me
            || (m.group_id && (await assertMember(m.group_id, me, req.tenantId)));
        if (!canRead) return res.status(403).json({ error: 'Not allowed' });

        const created = [];
        for (const t of targets) {
            if (!t?.type || !t?.id) continue;
            if (t.type === 'user' && String(t.id) === String(me)) continue;
            if (t.type === 'user') {
                // Target user must exist in the same tenant.
                const [u] = await db.query('SELECT id FROM users WHERE id=? AND tenant_id=?', [t.id, req.tenantId]);
                if (u.length === 0) continue;
            }
            if (t.type === 'group' && !(await assertMember(t.id, me, req.tenantId))) continue;
            const [r] = await db.query(
                `INSERT INTO messages
                 (tenant_id, sender_id, recipient_id, group_id, body, attachment_url, attachment_name,
                  attachment_type, attachment_size, speaker_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [req.tenantId, me,
                 t.type === 'user' ? t.id : null,
                 t.type === 'group' ? t.id : null,
                 m.body, m.attachment_url, m.attachment_name, m.attachment_type, m.attachment_size, m.speaker_id]
            );
            created.push(r.insertId);
            // Bust caches for the target(s) of this forwarded message.
            if (t.type === 'user') {
                bustDmCaches(req.tenantId, me, t.id);
            } else {
                bustGroupCaches(req.tenantId, t.id, true);
            }
        }
        res.json({ ok: true, count: created.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Toggle a reaction with the given emoji on a message
router.post('/messages/:id/react', protect, async (req, res) => {
    const { emoji } = req.body;
    if (!emoji) return res.status(400).json({ error: 'emoji required' });
    try {
        const [rows] = await db.query('SELECT sender_id, recipient_id, group_id FROM messages WHERE id=? AND tenant_id=?', [req.params.id, req.tenantId]);
        if (rows.length === 0) return res.status(404).json({ error: 'Message not found' });
        const m = rows[0];
        const me = req.user.id;
        const isPart = m.sender_id === me || m.recipient_id === me
            || (m.group_id && (await assertMember(m.group_id, me, req.tenantId)));
        if (!isPart) return res.status(403).json({ error: 'Not allowed' });

        const [existing] = await db.query(
            'SELECT 1 FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=? AND tenant_id=?',
            [req.params.id, me, emoji, req.tenantId]);
        if (existing.length > 0) {
            await db.query('DELETE FROM message_reactions WHERE message_id=? AND user_id=? AND emoji=? AND tenant_id=?',
                [req.params.id, me, emoji, req.tenantId]);
            return res.json({ toggled: 'off' });
        }
        // One reaction per user per message — replace any prior emoji from this user
        await db.query('DELETE FROM message_reactions WHERE message_id=? AND user_id=? AND tenant_id=?',
            [req.params.id, me, req.tenantId]);
        await db.query('INSERT INTO message_reactions (tenant_id, message_id, user_id, emoji) VALUES (?, ?, ?, ?)',
            [req.tenantId, req.params.id, me, emoji]);
        res.json({ toggled: 'on' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Pin messages ───────────────────────────────────────────────────
// Scope param format accepted by the pin-list and search endpoints:
//   scope=user:<otherUserId>   → a 1-1 DM between me and <otherUserId>
//   scope=group:<groupId>      → messages in group <groupId>
// Returns { clause, params } matching either shape, or null if the scope
// string is malformed. Keeps the access check + the search filter in one
// place so pin/unpin/pinned-list/search can't drift apart.
const scopeToWhere = (scope, meId) => {
    if (!scope) return null;
    const [kind, rawId] = String(scope).split(':');
    const id = parseInt(rawId, 10);
    if (!id || Number.isNaN(id)) return null;
    if (kind === 'user') {
        return {
            clause: '((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?))',
            params: [meId, id, id, meId]
        };
    }
    if (kind === 'group') {
        return { clause: 'm.group_id = ?', params: [id] };
    }
    return null;
};

// Membership / access check — ensures the caller is actually part of the
// DM or the group before they can pin, unpin, list pins, or search in it.
const assertScopeAccess = async (scope, tenantId, meId) => {
    if (!scope) return false;
    const [kind, rawId] = String(scope).split(':');
    const id = parseInt(rawId, 10);
    if (!id || Number.isNaN(id)) return false;
    if (kind === 'user') {
        // A DM "exists" as soon as both users are in the same tenant — this
        // matches how other DM endpoints behave (no explicit DM record).
        const [rows] = await db.query('SELECT id FROM users WHERE id = ? AND tenant_id = ?', [id, tenantId]);
        return rows.length > 0;
    }
    if (kind === 'group') {
        const [rows] = await db.query(
            'SELECT 1 FROM chat_group_members WHERE group_id = ? AND user_id = ? AND tenant_id = ?',
            [id, meId, tenantId]
        );
        return rows.length > 0;
    }
    return false;
};

// Toggle pin on a message. The caller must belong to the message's
// conversation. Pin is conversation-global (matches Slack / Teams).
router.post('/messages/:id/pin', protect, async (req, res) => {
    try {
        const msgId = parseInt(req.params.id, 10);
        const [rows] = await db.query(
            'SELECT id, sender_id, recipient_id, group_id, is_pinned FROM messages WHERE id = ? AND tenant_id = ?',
            [msgId, req.tenantId]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Message not found' });
        const m = rows[0];

        // Access check — user must be a participant of this conversation.
        if (m.group_id) {
            const [mem] = await db.query(
                'SELECT 1 FROM chat_group_members WHERE group_id = ? AND user_id = ? AND tenant_id = ?',
                [m.group_id, req.user.id, req.tenantId]
            );
            if (mem.length === 0) return res.status(403).json({ error: 'Not a member of this group' });
        } else {
            const inDm = m.sender_id === req.user.id || m.recipient_id === req.user.id;
            if (!inDm) return res.status(403).json({ error: 'Not a participant of this DM' });
        }

        const next = m.is_pinned ? 0 : 1;

        // Single-pin model: when pinning, clear any existing pin in the same
        // conversation first so there's only ever one pinned message on top.
        if (next === 1) {
            if (m.group_id) {
                await db.query(
                    'UPDATE messages SET is_pinned = 0, pinned_at = NULL WHERE group_id = ? AND tenant_id = ? AND is_pinned = 1',
                    [m.group_id, req.tenantId]
                );
            } else {
                await db.query(
                    `UPDATE messages SET is_pinned = 0, pinned_at = NULL
                     WHERE tenant_id = ? AND is_pinned = 1
                       AND ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))`,
                    [req.tenantId, m.sender_id, m.recipient_id, m.recipient_id, m.sender_id]
                );
            }
        }

        await db.query(
            'UPDATE messages SET is_pinned = ?, pinned_at = ? WHERE id = ? AND tenant_id = ?',
            [next, next ? new Date() : null, msgId, req.tenantId]
        );
        res.json({ id: msgId, is_pinned: next === 1 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List pinned messages for a conversation. Same SELECT shape as the
// thread fetch so the frontend can reuse the existing message renderer.
// NOTE: path is /pins (not /messages/pins) because GET /messages/:userId
// already captures any slash-segment under /messages/ and would treat
// "pins" as a user id.
router.get('/pins', protect, async (req, res) => {
    try {
        const { scope } = req.query;
        const ok = await assertScopeAccess(scope, req.tenantId, req.user.id);
        if (!ok) return res.status(403).json({ error: 'No access to this conversation' });
        const where = scopeToWhere(scope, req.user.id);
        if (!where) return res.status(400).json({ error: 'Invalid scope' });

        const [rows] = await db.query(
            `SELECT m.*,
                    s.name AS speaker_name, s.photo_url AS speaker_photo_url,
                    s.designation AS speaker_designation, s.company AS speaker_company,
                    su.name AS sender_name
             FROM messages m
             LEFT JOIN speakers s ON s.id = m.speaker_id AND s.tenant_id = m.tenant_id
             LEFT JOIN users su ON su.id = m.sender_id AND su.tenant_id = m.tenant_id
             WHERE m.tenant_id = ?
               AND m.is_pinned = 1
               AND m.deleted_for_everyone = 0
               AND ${where.clause}
             ORDER BY m.pinned_at DESC
             LIMIT 50`,
            [req.tenantId, ...where.params]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Full-text-ish search within a conversation. MySQL's LIKE is fine for the
// typical chat history size; if threads grow huge we can add a FULLTEXT
// index later without changing the public shape.
// Path is /search (not /messages/search) for the same route-shadowing
// reason as /pins above.
router.get('/search', protect, async (req, res) => {
    try {
        const { scope, q } = req.query;
        const ok = await assertScopeAccess(scope, req.tenantId, req.user.id);
        if (!ok) return res.status(403).json({ error: 'No access to this conversation' });
        const where = scopeToWhere(scope, req.user.id);
        if (!where) return res.status(400).json({ error: 'Invalid scope' });
        const term = String(q || '').trim();
        if (term.length < 2) return res.json([]);

        // Escape LIKE wildcards so a user searching for "50%" doesn't get
        // every message back.
        const safe = term.replace(/[\\%_]/g, ch => '\\' + ch);
        const like = `%${safe}%`;

        const [rows] = await db.query(
            `SELECT m.*,
                    su.name AS sender_name,
                    s.name AS speaker_name
             FROM messages m
             LEFT JOIN users su ON su.id = m.sender_id AND su.tenant_id = m.tenant_id
             LEFT JOIN speakers s ON s.id = m.speaker_id AND s.tenant_id = m.tenant_id
             WHERE m.tenant_id = ?
               AND m.deleted_for_everyone = 0
               AND m.message_type = 'user'
               AND m.body LIKE ? ESCAPE '\\\\'
               AND ${where.clause}
             ORDER BY m.created_at DESC
             LIMIT 80`,
            [req.tenantId, like, ...where.params]
        );
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Clear a conversation *for the current user only*. Writes message_hides
// rows so the existing LEFT JOIN on the fetch queries filters them out of
// future reads — no actual message deletion, so the other party in a DM
// (or other group members) still see their side untouched.
router.post('/clear', protect, async (req, res) => {
    try {
        const { scope } = req.body;
        const ok = await assertScopeAccess(scope, req.tenantId, req.user.id);
        if (!ok) return res.status(403).json({ error: 'No access to this conversation' });
        const where = scopeToWhere(scope, req.user.id);
        if (!where) return res.status(400).json({ error: 'Invalid scope' });

        // INSERT IGNORE so re-clearing an already-cleared chat is a no-op
        // rather than an error from the composite primary key.
        const [result] = await db.query(
            `INSERT IGNORE INTO message_hides (message_id, user_id, tenant_id)
             SELECT m.id, ?, m.tenant_id
             FROM messages m
             WHERE m.tenant_id = ? AND ${where.clause}`,
            [req.user.id, req.tenantId, ...where.params]
        );
        res.json({ hidden: result.affectedRows || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
