const jwt = require('jsonwebtoken');
const db = require('../config/db');

// Writes are blocked when the tenant is in one of these subscription states.
// Reads stay open so users can still log in, view data, and fix their plan.
const BLOCKING_STATUSES = new Set(['past_due', 'cancelled', 'expired']);

// Routes that must stay writable even when the subscription is blocking — so
// admins can get out of a past-due state without being locked out of the UI.
// `/api/platform` is exempt because super admins are platform-level, not
// tenant-level — they should never be blocked by a tenant's sub status.
const WRITE_EXEMPT_PREFIXES = ['/api/auth', '/api/billing', '/api/tenants', '/api/platform'];

function isExemptFromWriteGate(req) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;
    const url = req.originalUrl || req.url || '';
    return WRITE_EXEMPT_PREFIXES.some(p => url.startsWith(p));
}

const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            // Fetch fresh user from DB to handle dynamic assignment/role changes.
            // tenant_id must never be trusted from the JWT — always read from DB so
            // a compromised/stale token can't be used to pivot across tenants.
            const [users] = await db.query('SELECT id, name, email, role, assigned_event_id, assigned_task, tenant_id, is_super_admin FROM users WHERE id = ?', [decoded.id]);
            if (users.length === 0) return res.status(401).json({ error: 'User no longer exists' });

            req.user = users[0];
            req.tenantId = users[0].tenant_id;
            req.isSuperAdmin = !!users[0].is_super_admin;

            // Load the full set of events this user is assigned to (multi-event
            // support). `assigned_event_id` is kept as the "primary" event for
            // backward compatibility; `assignedEventIds` is the authoritative
            // list used by hasEventAccess(). Falls back to the single column if
            // the junction has no rows yet (pre-migration data).
            //
            // `eventSections` is the per-event module restriction: a map of
            // eventId → array of allowed section keys, or null for "full". It
            // lives in user_events.sections; missing column (older schema) is
            // tolerated by the try/catch and degrades to "full on every event".
            try {
                const [ue] = await db.query(
                    'SELECT event_id, sections FROM user_events WHERE user_id = ? AND tenant_id = ?',
                    [users[0].id, users[0].tenant_id]
                );
                let ids = ue.map(r => r.event_id);
                if (ids.length === 0 && users[0].assigned_event_id != null) {
                    ids = [users[0].assigned_event_id];
                }
                req.user.assignedEventIds = ids;

                const sections = {};
                for (const row of ue) {
                    // mysql2 may return JSON pre-parsed or as a string depending
                    // on driver/server version — handle both shapes.
                    let s = row.sections;
                    if (typeof s === 'string') {
                        try { s = JSON.parse(s); } catch { s = null; }
                    }
                    sections[row.event_id] = Array.isArray(s) ? s : null; // null = full
                }
                req.user.eventSections = sections;
            } catch (_) {
                // If the junction table or `sections` column doesn't exist yet,
                // degrade to the single-event column with full access so auth
                // still works.
                req.user.assignedEventIds = users[0].assigned_event_id != null
                    ? [users[0].assigned_event_id] : [];
                req.user.eventSections = {};
                if (users[0].assigned_event_id != null) {
                    req.user.eventSections[users[0].assigned_event_id] = null;
                }
            }

            // Super admins bypass the tenant write-gate entirely — they operate
            // above any single tenant's subscription state.
            if (req.isSuperAdmin) return next();

            // Past-due / cancelled / expired → block mutations app-wide, but
            // keep auth/billing/tenants writable so the admin can recover.
            if (!isExemptFromWriteGate(req)) {
                const [subs] = await db.query(
                    'SELECT status FROM subscriptions WHERE tenant_id = ? ORDER BY id DESC LIMIT 1',
                    [req.tenantId]
                );
                const subStatus = subs[0]?.status;
                if (subStatus && BLOCKING_STATUSES.has(subStatus)) {
                    return res.status(402).json({
                        error: 'subscription_' + subStatus,
                        message: subStatus === 'past_due'
                            ? 'Your subscription payment is past due. Update billing to continue making changes.'
                            : 'Your subscription is not active. Upgrade to continue making changes.',
                        status: subStatus
                    });
                }
            }

            next();
        } catch (error) {
            res.status(401).json({ error: 'Not authorized, token failed' });
        }
        return;
    }

    if (!token) {
        res.status(401).json({ error: 'Not authorized, no token' });
    }
};

// Guard for /api/platform routes — must run AFTER protect so req.isSuperAdmin
// is populated. Returns 403 with a generic message so we don't leak the
// existence of platform routes to tenant users.
const requireSuperAdmin = (req, res, next) => {
    if (!req.isSuperAdmin) return res.status(403).json({ error: 'forbidden' });
    next();
};

module.exports = { protect, requireSuperAdmin };
