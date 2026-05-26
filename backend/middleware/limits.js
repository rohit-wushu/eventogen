const db = require('../config/db');

// Map a resource key to the table and plan-limit column. Add new resources here
// when introducing a quota on them. `0` in max_* means unlimited.
const LIMITS = {
    events:    { table: 'events',    planColumn: 'max_events' },
    speakers:  { table: 'speakers',  planColumn: 'max_speakers' },
    attendees: { table: 'attendees', planColumn: 'max_attendees' },
    users:     { table: 'users',     planColumn: 'max_users' }
};

async function usageAndLimit(tenantId, resource) {
    const cfg = LIMITS[resource];
    if (!cfg) return null;

    const [[{ c: used }]] = await db.query(
        `SELECT COUNT(*) AS c FROM \`${cfg.table}\` WHERE tenant_id = ?`,
        [tenantId]
    );
    const [rows] = await db.query(
        `SELECT p.${cfg.planColumn} AS limit_value, p.name AS plan_name, p.code AS plan_code,
                s.status AS sub_status
         FROM subscriptions s JOIN plans p ON p.id = s.plan_id
         WHERE s.tenant_id = ? ORDER BY s.id DESC LIMIT 1`,
        [tenantId]
    );
    // Missing subscription is treated as "no access" — restrictive default. A
    // tenant without a subscription row is a data-integrity bug; fail closed.
    if (rows.length === 0) {
        return { used, limit: 0, unlimited: false, plan_name: 'None', plan_code: 'none', sub_status: 'expired' };
    }
    const sub = rows[0];

    return {
        used,
        limit: sub.limit_value,        // 0 = unlimited (only valid on real plans)
        unlimited: sub.limit_value === 0,
        plan_name: sub.plan_name,
        plan_code: sub.plan_code,
        sub_status: sub.sub_status
    };
}

// Express middleware: blocks creation when the tenant's count for `resource`
// would exceed their plan limit. Use on POST endpoints that create quota-bearing
// rows. Admins cannot bypass — quota is a business constraint, not a role check.
// A cancelled/past-due subscription blocks all creation regardless of count.
function checkLimit(resource) {
    return async (req, res, next) => {
        try {
            const info = await usageAndLimit(req.tenantId, resource);
            if (!info) return next();

            if (info.sub_status === 'cancelled' || info.sub_status === 'expired') {
                return res.status(402).json({
                    error: 'subscription_inactive',
                    message: 'Your subscription is not active. Please upgrade to continue creating resources.',
                    plan: info.plan_name
                });
            }

            if (!info.unlimited && info.used >= info.limit) {
                return res.status(402).json({
                    error: 'plan_limit_reached',
                    message: `You've reached your ${info.plan_name} plan limit of ${info.limit} ${resource}. Upgrade to add more.`,
                    resource, used: info.used, limit: info.limit, plan: info.plan_name
                });
            }
            next();
        } catch (err) {
            console.error('checkLimit error:', err);
            // Fail-open on infrastructure errors: better to let a request through
            // than to take the whole app down when the billing tables hiccup.
            next();
        }
    };
}

module.exports = { checkLimit, usageAndLimit, LIMITS };
