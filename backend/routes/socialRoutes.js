const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { encrypt, decrypt } = require('../utils/tokenCrypto');
const { getConnector, isPlatformConfigured, configuredMap, PLATFORMS } = require('../services/social');

// Multi-tenant social publishing routes. Every authenticated endpoint is
// scoped to req.tenantId; the OAuth callback (which is NOT authenticated —
// the browser pop-up isn't carrying our JWT) reconstructs the tenant from
// a signed `state` parameter passed through to the platform and back.
//
// Only admins + managers can manage social accounts; employees may view
// posts they themselves created but can't connect/disconnect.

const requireAdminOrManager = (req, res, next) => {
    if (!['admin', 'manager'].includes(req.user?.role)) {
        return res.status(403).json({ error: 'Forbidden' });
    }
    next();
};

// === OAuth state ===
//
// Signed payload that survives the round-trip through the platform's auth
// server. Carries tenant_id + user_id + platform + a random nonce. HMAC
// with SOCIAL_STATE_SECRET so a forged state can't slip through.

function signState({ tenantId, userId, platform }) {
    const secret = process.env.SOCIAL_STATE_SECRET || process.env.JWT_SECRET;
    if (!secret) throw new Error('SOCIAL_STATE_SECRET / JWT_SECRET missing');
    const payload = {
        tenantId, userId, platform,
        nonce: crypto.randomBytes(8).toString('hex'),
        ts: Date.now(),
    };
    const json = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(json).digest('base64url');
    return `${json}.${sig}`;
}

function verifyState(state) {
    const secret = process.env.SOCIAL_STATE_SECRET || process.env.JWT_SECRET;
    if (!secret) throw new Error('SOCIAL_STATE_SECRET / JWT_SECRET missing');
    const [json, sig] = String(state || '').split('.');
    if (!json || !sig) throw new Error('invalid state');
    const expected = crypto.createHmac('sha256', secret).update(json).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error('state signature mismatch');
    const payload = JSON.parse(Buffer.from(json, 'base64url').toString());
    // 15-minute window — covers the round-trip-via-platform but rejects replay later.
    if (Date.now() - payload.ts > 15 * 60 * 1000) throw new Error('state expired');
    return payload;
}

function callbackUrl(req, platform) {
    // Use the request origin so dev (http://localhost:5000) and prod work the
    // same. NOTE: whatever URL you register with each platform MUST exactly
    // match this. Set SOCIAL_PUBLIC_URL in production to override.
    const base = process.env.SOCIAL_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    return `${base.replace(/\/$/, '')}/api/social/callback/${platform}`;
}

// Strip token columns before returning an account to the frontend. NEVER
// return access_token_enc / refresh_token_enc.
function publicAccount(row) {
    if (!row) return null;
    const { access_token_enc, refresh_token_enc, ...safe } = row;
    return {
        ...safe,
        is_active: !!safe.is_active,
        scopes: typeof safe.scopes === 'string' ? safeJsonParse(safe.scopes) : safe.scopes,
        account_meta: typeof safe.account_meta === 'string' ? safeJsonParse(safe.account_meta) : safe.account_meta,
        // Surfaced flag so the UI knows whether the token's near expiry.
        token_expires_soon: safe.token_expires_at
            ? new Date(safe.token_expires_at).getTime() - Date.now() < 7 * 24 * 3600 * 1000
            : false,
    };
}
function safeJsonParse(s) { try { return JSON.parse(s); } catch { return null; } }

async function logEvent({ tenantId, accountId, event, userId, platform, accountName, metadata }) {
    try {
        await db.query(
            'INSERT INTO social_account_events (tenant_id, social_account_id, event, user_id, platform, account_name, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [tenantId, accountId || null, event, userId || null, platform, accountName || null, metadata ? JSON.stringify(metadata) : null]
        );
    } catch (err) {
        console.warn('[social] event log failed:', err.message);
    }
}

// Resolve the account object from a row + platform-specific overrides. The
// raw DB row uses string column names; connectors expect a flat object with
// the meta blob already parsed.
function rowToAccount(row) {
    return {
        ...row,
        meta: typeof row.account_meta === 'string' ? safeJsonParse(row.account_meta) : row.account_meta,
    };
}

// ===========================================================================
// Capability discovery
// ===========================================================================

// Surface which platforms have credentials configured so the frontend can
// disable Connect buttons before the user clicks. Public to authenticated
// users (no admin gate) — used by the SNS share page too.
router.get('/platforms', protect, async (_req, res) => {
    res.json({ platforms: PLATFORMS, configured: configuredMap() });
});

// ===========================================================================
// Accounts CRUD
// ===========================================================================

// List all connected accounts for this tenant.
router.get('/accounts', protect, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT id, tenant_id, platform, account_kind, account_external_id,
                    account_name, account_handle, account_avatar_url,
                    token_expires_at, scopes, account_meta, connected_by_user_id,
                    is_active, last_used_at, created_at, updated_at
             FROM social_accounts
             WHERE tenant_id = ? AND is_active = 1
             ORDER BY platform, account_name`,
            [req.tenantId]
        );
        res.json(rows.map(publicAccount));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Disconnect — soft-deactivate the row. We don't hard-delete so the audit
// log keeps a stable foreign key. A real platform revoke call could go
// here too; LinkedIn doesn't require it.
router.delete('/accounts/:id', protect, requireAdminOrManager, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT id, platform, account_name FROM social_accounts WHERE id = ? AND tenant_id = ?',
            [req.params.id, req.tenantId]
        );
        if (!rows.length) return res.status(404).json({ error: 'Account not found' });
        await db.query(
            'UPDATE social_accounts SET is_active = 0, updated_at = NOW() WHERE id = ? AND tenant_id = ?',
            [req.params.id, req.tenantId]
        );
        await logEvent({
            tenantId: req.tenantId, accountId: rows[0].id, event: 'disconnected',
            userId: req.user.id, platform: rows[0].platform, accountName: rows[0].account_name,
        });
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ===========================================================================
// OAuth flow — connect a new account
// ===========================================================================

// Start: return the auth URL the front-end pops in a new window. We fail
// fast if the platform isn't configured (env vars missing) so the user gets
// a clean error instead of a redirect to a broken auth page.
router.post('/connect/:platform/start', protect, requireAdminOrManager, async (req, res) => {
    const { platform } = req.params;
    if (!PLATFORMS.includes(platform)) {
        return res.status(400).json({ error: 'Unknown platform' });
    }
    if (!isPlatformConfigured(platform)) {
        return res.status(400).json({
            error: `${platform} is not configured on this server. Ask the platform admin to add the credentials in backend/.env.`,
            code: 'PLATFORM_NOT_CONFIGURED',
        });
    }
    try {
        const conn = getConnector(platform);
        const redirectUri = callbackUrl(req, platform);
        const state = signState({
            tenantId: req.tenantId,
            userId: req.user.id,
            platform,
        });
        const authUrl = conn.buildAuthUrl({ state, redirectUri });
        res.json({ mode: 'oauth', authUrl });
    } catch (err) {
        console.error(`[social] connect/${platform}/start failed:`, err);
        res.status(500).json({ error: err.message });
    }
});

// Callback — the OAuth server redirects the browser here with ?code + ?state.
// This endpoint is unauthenticated (the browser isn't carrying our JWT) so
// it relies entirely on the signed state to know which tenant initiated.
//
// On success it serves a tiny HTML page that posts a message back to the
// opener window then closes itself — the front-end refreshes its account
// list when it receives that message.
router.get('/callback/:platform', async (req, res) => {
    const { platform } = req.params;
    const { code, state, error: oauthError, error_description } = req.query;
    const closeHtml = (status, message) => `
        <!doctype html><meta charset="utf-8"><title>Social connect</title>
        <body style="font-family:system-ui;background:#0a0e1c;color:#f1f5f9;padding:24px;text-align:center">
          <h2 style="margin:8px 0">${status === 'ok' ? '✓ Connected' : '✗ Connection failed'}</h2>
          <p>${message}</p>
          <p style="opacity:0.6">You can close this window.</p>
          <script>
            try { window.opener && window.opener.postMessage({ type: 'social_connect_result', status: ${JSON.stringify(status)}, platform: ${JSON.stringify(platform)}, message: ${JSON.stringify(message)} }, '*'); } catch (e) {}
            setTimeout(() => window.close(), 1500);
          </script>
        </body>`;

    if (oauthError) {
        return res.status(400).send(closeHtml('error', `${oauthError}: ${error_description || ''}`));
    }
    if (!code || !state) {
        return res.status(400).send(closeHtml('error', 'Missing code or state'));
    }

    let payload;
    try { payload = verifyState(state); }
    catch (err) { return res.status(400).send(closeHtml('error', `Invalid state: ${err.message}`)); }
    if (payload.platform !== platform) {
        return res.status(400).send(closeHtml('error', 'Platform mismatch'));
    }

    try {
        const conn = getConnector(platform);
        const redirectUri = callbackUrl(req, platform);
        const tokenResp = await conn.exchangeCodeForToken({ code, redirectUri });
        // fetchProfile always returns an array — single-account platforms
        // (LinkedIn) return one element; future platforms like FB Pages can
        // return many in a single connect.
        const profiles = await conn.fetchProfile(tokenResp.access_token);
        if (!Array.isArray(profiles) || profiles.length === 0) {
            return res.status(400).send(closeHtml('error', 'No accounts returned by platform'));
        }

        const expiresAt = tokenResp.expires_in
            ? new Date(Date.now() + tokenResp.expires_in * 1000)
            : null;
        const scopes = (tokenResp.scope || '').split(/[\s,]+/).filter(Boolean);
        const insertedIds = [];

        for (const profile of profiles) {
            // Per-profile token wins (FB Pages each have their own token);
            // fall back to the user token otherwise.
            const tokenToStore = profile.accessToken || tokenResp.access_token;
            const [r] = await db.query(
                `INSERT INTO social_accounts
                   (tenant_id, platform, account_kind, account_external_id, account_name,
                    account_handle, account_avatar_url, access_token_enc, refresh_token_enc,
                    token_expires_at, scopes, account_meta, connected_by_user_id, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                 ON DUPLICATE KEY UPDATE
                    account_name = VALUES(account_name),
                    account_handle = VALUES(account_handle),
                    account_avatar_url = VALUES(account_avatar_url),
                    access_token_enc = VALUES(access_token_enc),
                    refresh_token_enc = VALUES(refresh_token_enc),
                    token_expires_at = VALUES(token_expires_at),
                    scopes = VALUES(scopes),
                    account_meta = VALUES(account_meta),
                    connected_by_user_id = VALUES(connected_by_user_id),
                    token_refresh_failures = 0,
                    is_active = 1, updated_at = NOW()`,
                [
                    payload.tenantId, platform,
                    profile.account_kind || 'personal',
                    profile.external_id, profile.name, profile.handle, profile.avatar_url,
                    encrypt(tokenToStore),
                    encrypt(tokenResp.refresh_token || null),
                    expiresAt, JSON.stringify(scopes),
                    profile.meta ? JSON.stringify(profile.meta) : null,
                    payload.userId,
                ]
            );
            insertedIds.push(r.insertId);
            await logEvent({
                tenantId: payload.tenantId, accountId: r.insertId, event: 'connected',
                userId: payload.userId, platform, accountName: profile.name,
                metadata: { scopes, account_kind: profile.account_kind },
            });
        }

        const summary = profiles.length === 1
            ? `${profiles[0].name} (${platform}) connected`
            : `${profiles.length} ${platform} accounts connected`;
        res.send(closeHtml('ok', summary));
    } catch (err) {
        console.error(`[social] ${platform} callback failed:`, err);
        res.status(500).send(closeHtml('error', err.message));
    }
});

// ===========================================================================
// Posts
// ===========================================================================

// Create a post. `when` controls scheduling:
//   "now"      → publish immediately to every selected account
//   "schedule" → store with scheduled_for; worker picks it up later
//   "draft"    → stored as draft, no publish
router.post('/posts', protect, async (req, res) => {
    const { account_ids, caption, image_url, mentions, photo_tags, when, scheduled_for, speaker_id } = req.body;
    if (!Array.isArray(account_ids) || account_ids.length === 0) {
        return res.status(400).json({ error: 'Select at least one account' });
    }
    if (!['now', 'schedule', 'draft'].includes(when)) {
        return res.status(400).json({ error: 'Invalid `when` value' });
    }
    try {
        const placeholders = account_ids.map(() => '?').join(',');
        const [accounts] = await db.query(
            `SELECT * FROM social_accounts
             WHERE tenant_id = ? AND id IN (${placeholders}) AND is_active = 1`,
            [req.tenantId, ...account_ids]
        );
        if (accounts.length !== account_ids.length) {
            return res.status(400).json({ error: 'One or more accounts are invalid for this tenant' });
        }

        const status = when === 'draft' ? 'draft' : (when === 'schedule' ? 'scheduled' : 'posting');
        const schedAt = when === 'schedule' ? new Date(scheduled_for || Date.now()) : null;

        const results = [];
        for (const acctRow of accounts) {
            const acct = rowToAccount(acctRow);
            const [ins] = await db.query(
                `INSERT INTO social_posts
                   (tenant_id, social_account_id, speaker_id, caption, image_url,
                    mentions, photo_tags, scheduled_for, status, created_by_user_id)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    req.tenantId, acct.id, speaker_id || null, caption || '', image_url || null,
                    mentions ? JSON.stringify(mentions) : null,
                    photo_tags ? JSON.stringify(photo_tags) : null,
                    schedAt, status, req.user.id,
                ]
            );
            const postRow = { id: ins.insertId, account: publicAccount(acctRow), status };

            // Fire publish-now requests inline so the user gets an immediate
            // success / failure. Scheduled + draft posts wait for the worker.
            if (when === 'now') {
                try {
                    const conn = getConnector(acct.platform);
                    const accessToken = decrypt(acct.access_token_enc);
                    const result = await conn.publishPost({
                        account: acct,
                        accessToken,
                        caption,
                        imageUrl: image_url,
                    });
                    await db.query(
                        `UPDATE social_posts
                         SET status = 'posted', posted_at = NOW(),
                             platform_post_id = ?, platform_post_url = ?
                         WHERE id = ?`,
                        [result.platform_post_id || null, result.platform_post_url || null, ins.insertId]
                    );
                    await db.query('UPDATE social_accounts SET last_used_at = NOW() WHERE id = ?', [acct.id]);
                    postRow.status = 'posted';
                    postRow.platform_post_url = result.platform_post_url;
                } catch (err) {
                    console.error(`[social] publish failed for account ${acct.id}:`, err);
                    await db.query(
                        `UPDATE social_posts SET status = 'failed', error_message = ? WHERE id = ?`,
                        [String(err.message || err).slice(0, 1000), ins.insertId]
                    );
                    await logEvent({
                        tenantId: req.tenantId, accountId: acct.id, event: 'post_failed',
                        userId: req.user.id, platform: acct.platform, accountName: acct.account_name,
                        metadata: { error: String(err.message || err).slice(0, 500) },
                    });
                    postRow.status = 'failed';
                    postRow.error = err.message;
                }
            }
            results.push(postRow);
        }

        res.json({ ok: true, posts: results });
    } catch (err) {
        console.error('[social] create post failed:', err);
        res.status(500).json({ error: err.message });
    }
});

// List recent posts for the tenant — used by the dashboard + the SNS page's
// "recent posts" sidebar. Caps at 100 rows; pagination is a Phase 5 task.
router.get('/posts', protect, async (req, res) => {
    try {
        const [rows] = await db.query(
            `SELECT p.*, a.platform, a.account_name, a.account_handle
             FROM social_posts p
             LEFT JOIN social_accounts a ON a.id = p.social_account_id
             WHERE p.tenant_id = ?
             ORDER BY p.created_at DESC
             LIMIT 100`,
            [req.tenantId]
        );
        res.json(rows.map(r => ({
            ...r,
            mentions: r.mentions ? safeJsonParse(r.mentions) : null,
            photo_tags: r.photo_tags ? safeJsonParse(r.photo_tags) : null,
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
