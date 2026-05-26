const db = require('../config/db');

// Fire-and-forget audit writer. Never throws — a broken audit row must never
// break the request path. Callers: logAudit(req, 'event.create', 'event', id, { title })
async function logAudit(req, action, resourceType, resourceId = null, meta = null) {
    try {
        const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim();
        await db.query(
            `INSERT INTO audit_log (tenant_id, actor_user_id, actor_name, actor_role, action, resource_type, resource_id, meta, ip)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.tenantId || null,
                req.user?.id || null,
                req.user?.name || null,
                req.user?.role || null,
                action,
                resourceType,
                resourceId != null ? String(resourceId) : null,
                meta ? JSON.stringify(meta) : null,
                ip || null
            ]
        );
    } catch (err) {
        console.error('audit log failed:', err.message);
    }
}

module.exports = { logAudit };
