// ─── Redis cache adapter ────────────────────────────────────────────
// Cuts repeated DB work for hot polling endpoints (chat conversations,
// groups, unread count). Same pattern as the storage adapter: graceful
// no-op when Redis isn't configured, so the app runs anywhere with no
// extra setup.
//
// Selection logic, run once at startup:
//   • If REDIS_URL is set AND `ioredis` is installed → connect to Redis.
//   • Otherwise → no-op (cacheGet returns null, cacheSet/cacheDel swallow).
//
// Routes use:
//   await cacheGet(key)            // returns parsed value or null
//   await cacheSet(key, value, ttl)// value is JSON-serializable, ttl in seconds
//   await cacheDel(...keys)        // bust one or more exact keys
//
// Connection-level errors are swallowed and counted toward a circuit
// breaker — if Redis becomes flaky we stop calling it for a minute
// rather than hanging every request.

const REDIS_URL = process.env.REDIS_URL;
let client = null;
let healthy = false;
let backoffUntil = 0;
let failureCount = 0;
const FAILURE_THRESHOLD = 5;
const BACKOFF_MS = 60_000;

if (REDIS_URL) {
    try {
        const Redis = require('ioredis');
        client = new Redis(REDIS_URL, {
            // Don't crash the process if Redis is unreachable. Commands
            // queue while reconnecting; we still fall back gracefully.
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
            lazyConnect: false,
            connectTimeout: 2000,
            // Reconnect on most errors. ioredis defaults are fine but
            // we cap retry delay so we don't back off forever.
            retryStrategy: (times) => Math.min(times * 200, 5000)
        });
        client.on('ready', () => {
            healthy = true;
            failureCount = 0;
            backoffUntil = 0;
            console.log(`📦 Redis cache enabled — ${REDIS_URL.replace(/:\/\/[^@]*@/, '://***@')}`);
        });
        client.on('error', (err) => {
            // Don't spam — print once per outage.
            if (healthy) console.warn('⚠️ Redis error:', err.message);
            healthy = false;
        });
        client.on('end', () => { healthy = false; });
    } catch (e) {
        console.warn(
            '⚠️ REDIS_URL is set but the ioredis package is not installed.\n' +
            '   Falling back to no-cache mode. To enable: cd backend && npm install ioredis'
        );
    }
}

const usable = () => {
    if (!client) return false;
    if (!healthy) return false;
    if (Date.now() < backoffUntil) return false;
    return true;
};

// Track failures opportunistically — if Redis starts misbehaving on a
// per-command basis (timeouts, etc) without dropping the connection,
// open the breaker so the rest of the app stays fast.
const recordFailure = (err) => {
    failureCount++;
    if (failureCount >= FAILURE_THRESHOLD) {
        backoffUntil = Date.now() + BACKOFF_MS;
        failureCount = 0;
        console.warn(`⚠️ Redis circuit breaker open for ${BACKOFF_MS / 1000}s after repeated failures (${err?.message || 'unknown'})`);
    }
};

const cacheGet = async (key) => {
    if (!usable()) return null;
    try {
        const raw = await client.get(key);
        if (raw == null) return null;
        try { return JSON.parse(raw); } catch { return raw; }
    } catch (err) {
        recordFailure(err);
        return null;
    }
};

const cacheSet = async (key, value, ttlSeconds = 3) => {
    if (!usable()) return;
    try {
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);
        await client.set(key, serialized, 'EX', Math.max(1, ttlSeconds));
    } catch (err) {
        recordFailure(err);
    }
};

const cacheDel = async (...keys) => {
    if (!usable()) return;
    const flat = keys.flat().filter(Boolean);
    if (flat.length === 0) return;
    try {
        await client.del(flat);
    } catch (err) {
        recordFailure(err);
    }
};

// ─── Key builders ──────────────────────────────────────────────────
// Centralized so we never have a typo-driven cache miss. All keys are
// prefixed with the tenant id so eviction can be tenant-scoped if the
// keyspace ever grows.

const K = {
    conv:   (tenantId, userId) => `chat:conv:${tenantId}:${userId}`,
    groups: (tenantId, userId) => `chat:groups:${tenantId}:${userId}`,
    unread: (tenantId, userId) => `chat:unread:${tenantId}:${userId}`,
};

const isEnabled = () => !!(client && healthy);

module.exports = { cacheGet, cacheSet, cacheDel, K, isEnabled };
