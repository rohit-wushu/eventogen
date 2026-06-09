const db = require('../config/db');

// One-time check (cached after first call) so we don't hit INFORMATION_SCHEMA
// on every quota query. If the storage migration hasn't run on this deployment,
// we want every storage lookup to silently skip rather than 500 the whole
// /billing/subscription call.
let _storageCols = null;
async function storageColsExist() {
    if (_storageCols !== null) return _storageCols;
    try {
        const [tenants] = await db.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants' AND COLUMN_NAME = 'storage_bytes'`
        );
        const [plans] = await db.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'max_storage_mb'`
        );
        _storageCols = tenants.length > 0 && plans.length > 0;
    } catch { _storageCols = false; }
    return _storageCols;
}

// Map a resource key to the table and plan-limit column. Add new resources here
// when introducing a quota on them. `0` in max_* means unlimited.
// `storage` is special: usage comes from tenants.storage_bytes (a cached running
// total updated on upload/delete) and the limit is reported in MB.
const LIMITS = {
    events:    { table: 'events',    planColumn: 'max_events' },
    speakers:  { table: 'speakers',  planColumn: 'max_speakers' },
    attendees: { table: 'attendees', planColumn: 'max_attendees' },
    users:     { table: 'users',     planColumn: 'max_users' },
    storage:   { custom: 'storage',  planColumn: 'max_storage_mb', unit: 'MB' }
};

async function usageAndLimit(tenantId, resource) {
    const cfg = LIMITS[resource];
    if (!cfg) return null;

    let used;
    if (cfg.custom === 'storage') {
        // Storage migration hasn't run yet → silently skip so the caller doesn't
        // 500 the whole billing/subscription call.
        if (!(await storageColsExist())) return null;
        // Storage is metered in BYTES on the tenants table but the plan limit is
        // stored in MB. Convert used → MB so the caller can compare apples to apples.
        const [[row]] = await db.query(
            `SELECT COALESCE(storage_bytes, 0) AS b FROM tenants WHERE id = ?`,
            [tenantId]
        );
        used = Math.round(((row?.b || 0) / (1024 * 1024)) * 100) / 100; // MB, 2dp
    } else {
        const [[{ c }]] = await db.query(
            `SELECT COUNT(*) AS c FROM \`${cfg.table}\` WHERE tenant_id = ?`,
            [tenantId]
        );
        used = c;
    }

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
        unit: cfg.unit || 'count',     // 'MB' for storage, 'count' for rows
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

// Used by bulk-create paths (CSV / Google Sheet imports) where the row count
// isn't known until after the file has been parsed — so the standard
// `checkLimit` middleware can't decide. Returns either { ok: true } or a
// `{ ok: false, status, body }` ready to send to the client.
async function capacityCheck(tenantId, resource, incoming) {
    const info = await usageAndLimit(tenantId, resource);
    if (!info) return { ok: true };

    if (info.sub_status === 'cancelled' || info.sub_status === 'expired') {
        return { ok: false, status: 402, body: {
            error: 'subscription_inactive',
            message: 'Your subscription is not active. Please upgrade to continue creating resources.',
            plan: info.plan_name
        }};
    }
    if (info.unlimited) return { ok: true };

    const projected = info.used + Number(incoming || 0);
    if (projected > info.limit) {
        const remaining = Math.max(0, info.limit - info.used);
        return { ok: false, status: 402, body: {
            error: 'plan_limit_reached',
            message: `Importing ${incoming} ${resource} would exceed your ${info.plan_name} plan limit of ${info.limit}. You have ${remaining} ${resource} remaining — upgrade to add more.`,
            resource, used: info.used, limit: info.limit, incoming, remaining, plan: info.plan_name
        }};
    }
    return { ok: true };
}

// Pre-multer guard for upload routes. Reads the request's Content-Length and
// rejects with 402 if the upload would push the tenant over their storage cap.
// Mounted BEFORE multer so we don't waste bandwidth on a doomed transfer.
//
// Note: Content-Length is an upper bound — it includes multipart boundaries
// and form fields, not just the file body. That's fine for quota — being a
// few hundred bytes generous on the gate side is better than a false 402.
function storageGuard() {
    return async (req, res, next) => {
        try {
            if (!req.tenantId) return next();
            const len = Number(req.headers['content-length'] || 0);
            if (!len) return next();

            const info = await usageAndLimit(req.tenantId, 'storage');
            if (!info || info.unlimited) return next();
            if (info.sub_status === 'cancelled' || info.sub_status === 'expired') {
                return res.status(402).json({
                    error: 'subscription_inactive',
                    message: 'Your subscription is not active. Please upgrade to continue uploading.',
                    plan: info.plan_name
                });
            }
            const incomingMb = len / (1024 * 1024);
            if (info.used + incomingMb > info.limit) {
                const remainingMb = Math.max(0, info.limit - info.used);
                return res.status(402).json({
                    error: 'storage_limit_reached',
                    message: `This upload (${incomingMb.toFixed(2)} MB) would exceed your ${info.plan_name} plan's ${info.limit} MB storage limit. You have ${remainingMb.toFixed(2)} MB remaining — upgrade to upload more.`,
                    resource: 'storage', used: info.used, limit: info.limit, incoming_mb: Number(incomingMb.toFixed(2)),
                    remaining_mb: Number(remainingMb.toFixed(2)), plan: info.plan_name
                });
            }
            next();
        } catch (err) {
            console.error('storageGuard error:', err);
            // Fail-open on infra hiccups so a billing-table burp doesn't block uploads.
            next();
        }
    };
}

module.exports = { checkLimit, usageAndLimit, capacityCheck, storageGuard, LIMITS };
