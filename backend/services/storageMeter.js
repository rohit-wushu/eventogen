/**
 * Tracks bytes per tenant for plan-quota enforcement on storage.
 *
 *   recordTenantUpload(tenantId, filePath, sizeBytes, source)
 *       → inserts (or refreshes) a row in `tenant_storage_log` and bumps the
 *         cached counter on `tenants.storage_bytes`.
 *
 *   releaseTenantUpload(tenantId, filePath)
 *       → invoked when a file is deleted from disk/S3. Decrements the cached
 *         counter by the row's size and removes the ledger entry.
 *
 *   meterUpload(source)
 *       → Express middleware that runs AFTER multer's `upload.single(...)` /
 *         `upload.fields(...)`, reads req.file(s), and records each one against
 *         the current tenant. No-op if the tenant has no id (super admin etc).
 *
 * The ledger keeps (tenant_id, file_path) unique so re-uploads with the same key
 * are idempotent. Failures here NEVER block the request — quota will drift
 * before user-visible writes fail because of an accounting hiccup.
 */
const db = require('../config/db');

const sizeFromFile = (f) => {
    if (!f) return 0;
    if (typeof f.size === 'number') return f.size;            // multer disk + memory
    if (typeof f.contentLength === 'number') return f.contentLength;
    if (typeof f.ContentLength === 'number') return f.ContentLength; // multer-s3
    return 0;
};

const pathFromFile = (f) => {
    if (!f) return null;
    if (f.key) return f.key;                                  // S3
    if (f.path) return f.path;                                // disk full path
    if (f.filename) return `uploads/${f.filename}`;           // disk relative
    return null;
};

async function recordTenantUpload(tenantId, filePath, sizeBytes, source) {
    if (!tenantId || !filePath || !sizeBytes) return;
    try {
        // ON DUPLICATE so re-upload of the same key updates the size delta
        // instead of double-counting. Diff = new_size - old_size.
        const [existing] = await db.query(
            `SELECT size_bytes FROM tenant_storage_log WHERE tenant_id = ? AND file_path = ?`,
            [tenantId, filePath]
        );
        const oldSize = existing[0]?.size_bytes || 0;
        const delta = sizeBytes - oldSize;

        if (existing.length === 0) {
            await db.query(
                `INSERT INTO tenant_storage_log (tenant_id, file_path, size_bytes, source)
                 VALUES (?, ?, ?, ?)`,
                [tenantId, filePath, sizeBytes, source || 'misc']
            );
        } else if (delta !== 0) {
            await db.query(
                `UPDATE tenant_storage_log SET size_bytes = ?, source = ? WHERE tenant_id = ? AND file_path = ?`,
                [sizeBytes, source || 'misc', tenantId, filePath]
            );
        }
        if (delta !== 0) {
            await db.query(
                `UPDATE tenants SET storage_bytes = GREATEST(0, COALESCE(storage_bytes,0) + ?) WHERE id = ?`,
                [delta, tenantId]
            );
        }
    } catch (err) {
        console.error('[storageMeter] recordTenantUpload failed (non-blocking):', err.message);
    }
}

async function releaseTenantUpload(tenantId, filePath) {
    if (!tenantId || !filePath) return;
    try {
        const [rows] = await db.query(
            `SELECT size_bytes FROM tenant_storage_log WHERE tenant_id = ? AND file_path = ?`,
            [tenantId, filePath]
        );
        if (rows.length === 0) return;
        const bytes = rows[0].size_bytes || 0;
        await db.query(
            `DELETE FROM tenant_storage_log WHERE tenant_id = ? AND file_path = ?`,
            [tenantId, filePath]
        );
        if (bytes > 0) {
            await db.query(
                `UPDATE tenants SET storage_bytes = GREATEST(0, COALESCE(storage_bytes,0) - ?) WHERE id = ?`,
                [bytes, tenantId]
            );
        }
    } catch (err) {
        console.error('[storageMeter] releaseTenantUpload failed (non-blocking):', err.message);
    }
}

// Express middleware — slot right after `upload.single(...)` / `.fields(...)`.
// Works with either single or multi-field uploads, S3 or local disk.
function meterUpload(source) {
    return async (req, res, next) => {
        try {
            const tenantId = req.tenantId;
            if (!tenantId) return next();

            const files = [];
            if (req.file) files.push(req.file);
            if (req.files) {
                if (Array.isArray(req.files)) files.push(...req.files);
                else {
                    for (const k of Object.keys(req.files)) {
                        const v = req.files[k];
                        if (Array.isArray(v)) files.push(...v);
                        else if (v) files.push(v);
                    }
                }
            }
            // Fire-and-forget — never block the response on accounting.
            for (const f of files) {
                const fp = pathFromFile(f);
                const sz = sizeFromFile(f);
                if (fp && sz) recordTenantUpload(tenantId, fp, sz, source);
            }
        } catch (err) {
            console.error('[storageMeter] meterUpload errored (non-blocking):', err.message);
        }
        next();
    };
}

// Convenience for delete handlers that own multiple image columns. Pass any
// mix of URLs (`/uploads/foo.png`), keys (`speaker-…-abc.png`), or absolute
// disk paths (`uploads/foo.png`) — we normalise to the form the ledger uses
// and try several variants so historical inconsistencies don't leak bytes.
async function releaseTenantFiles(tenantId, ...rawPaths) {
    if (!tenantId) return;
    const candidates = new Set();
    for (const p of rawPaths) {
        if (!p || typeof p !== 'string') continue;
        const trimmed = p.trim();
        if (!trimmed) continue;

        // Skip absolute URLs that aren't ours (e.g. S3 CDN absolutes still
        // pass through because the ledger stores their `key` form).
        const noLeading = trimmed.replace(/^https?:\/\/[^/]+/, '');

        candidates.add(noLeading);
        if (noLeading.startsWith('/')) candidates.add(noLeading.slice(1));
        if (noLeading.startsWith('/uploads/')) candidates.add(noLeading.replace('/uploads/', 'uploads/'));
        if (noLeading.startsWith('uploads/'))  candidates.add('/' + noLeading);

        // Bare filename → multer disk full path
        const bare = noLeading.replace(/^\/?uploads\//, '');
        candidates.add(`uploads/${bare}`);
        candidates.add(`/uploads/${bare}`);
        candidates.add(bare);
    }
    for (const c of candidates) {
        // eslint-disable-next-line no-await-in-loop
        await releaseTenantUpload(tenantId, c);
    }
}

module.exports = { recordTenantUpload, releaseTenantUpload, releaseTenantFiles, meterUpload };
