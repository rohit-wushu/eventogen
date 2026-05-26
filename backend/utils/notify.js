const db = require('../config/db');

/**
 * Create a notification for a specific user.
 *
 * Tenant scoping: we look up the recipient's tenant_id from the users table
 * (Option B) rather than requiring callers to pass it. This is safer — it's
 * impossible for a caller to accidentally insert a notification under the
 * wrong tenant. If the user no longer exists we silently no-op.
 *
 * @param {object} opts - { imageUrl, actorName } optional extras
 */
const notifyUser = async (userId, type, title, message, link = null, opts = {}) => {
    try {
        const [users] = await db.query('SELECT tenant_id FROM users WHERE id = ?', [userId]);
        if (users.length === 0) return; // user gone; nothing to notify
        const tenantId = users[0].tenant_id;
        await db.query(
            'INSERT INTO notifications (tenant_id, user_id, type, title, message, link, image_url, actor_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [tenantId, userId, type, title, message, link, opts.imageUrl || null, opts.actorName || null]
        );
    } catch (err) {
        console.error('Notification create failed:', err.message);
    }
};

/**
 * Notify all users with a specific role, scoped to a single tenant.
 * Callers MUST pass req.tenantId as the first argument so we never fan a
 * notification out across tenant boundaries.
 */
const notifyRole = async (tenantId, role, type, title, message, link = null, excludeUserId = null, opts = {}) => {
    try {
        let query = 'SELECT id FROM users WHERE role = ? AND tenant_id = ?';
        const params = [role, tenantId];
        if (excludeUserId) { query += ' AND id != ?'; params.push(excludeUserId); }
        const [users] = await db.query(query, params);
        for (const u of users) {
            await notifyUser(u.id, type, title, message, link, opts);
        }
    } catch (err) {
        console.error('Notify role failed:', err.message);
    }
};

/**
 * Notify admins and managers
 */
const notifyAdminsAndManagers = async (type, title, message, link = null, excludeUserId = null, opts = {}) => {
    try {
        let query = 'SELECT id FROM users WHERE role IN (?, ?)';
        const params = ['admin', 'manager'];
        if (excludeUserId) { query += ' AND id != ?'; params.push(excludeUserId); }
        const [users] = await db.query(query, params);
        for (const u of users) {
            await notifyUser(u.id, type, title, message, link, opts);
        }
    } catch (err) {
        console.error('Notify admins/managers failed:', err.message);
    }
};

/**
 * Notify all users assigned to a specific event
 */
const notifyEventTeam = async (eventId, type, title, message, link = null, excludeUserId = null, opts = {}) => {
    try {
        let query = 'SELECT id FROM users WHERE assigned_event_id = ?';
        const params = [eventId];
        if (excludeUserId) { query += ' AND id != ?'; params.push(excludeUserId); }
        const [users] = await db.query(query, params);
        for (const u of users) {
            await notifyUser(u.id, type, title, message, link, opts);
        }
    } catch (err) {
        console.error('Notify event team failed:', err.message);
    }
};

module.exports = { notifyUser, notifyRole, notifyAdminsAndManagers, notifyEventTeam };
