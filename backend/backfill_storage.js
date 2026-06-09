/**
 * Backfill `tenant_storage_log` and `tenants.storage_bytes` from existing data.
 *
 * Walks every table that holds a (tenant_id, *_url) tuple, locates the file on
 * disk, stats it, and records the bytes against the tenant. Idempotent — re-
 * running it produces no double-counting because the ledger is unique on
 * (tenant_id, file_path) and the recompute step rebuilds the cached counter
 * from the ledger total.
 *
 * Usage:   node backfill_storage.js [--dry-run]
 *
 * Notes:
 *  • Files in S3 are skipped — there's no cheap way to stat them in bulk.
 *    Run a separate ListObjectsV2 sync if you need S3 backfill.
 *  • Files referenced in the DB but missing on disk are skipped silently.
 */
const path = require('path');
const fs = require('fs');
const db = require('./config/db');

const DRY = process.argv.includes('--dry-run');

// Tables to scan: { table, image columns, source label, tenant column }.
// Add a row here when introducing a new image column anywhere.
const SOURCES = [
    { table: 'speakers',   cols: ['photo_url', 'sns_card_url', 'attending_card_url'], source: 'speakers' },
    { table: 'partners',   cols: ['logo_url'],                                        source: 'partners' },
    { table: 'awards',     cols: ['photo_url', 'company_logo_url'],                   source: 'awards' },
    { table: 'events',     cols: ['event_logo_url', 'company_logo_url', 'sns_card_bg_url'], source: 'events' },
    { table: 'users',      cols: ['profile_photo_url'],                               source: 'users' },
    { table: 'tenants',    cols: ['logo_url'],                                        source: 'tenant' },
    { table: 'chat_groups', cols: ['photo_url'],                                      source: 'chat' }
];

// Resolve a stored *_url to a relative-to-cwd disk path. Returns null when the
// URL is an absolute S3/CDN URL (those can't be stat'd locally).
const toDiskPath = (url) => {
    if (!url || typeof url !== 'string') return null;
    if (/^https?:\/\//.test(url)) return null;
    return url.startsWith('/uploads/') ? url.slice(1) : (url.startsWith('uploads/') ? url : null);
};

// A column referenced in SOURCES may not actually exist on every deployment
// (different migration sets). Filter to columns that exist in INFORMATION_SCHEMA
// so the SELECT doesn't 1054 out.
async function existingCols(table, candidates) {
    const [rows] = await db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME IN (?)`,
        [table, candidates]
    );
    return rows.map(r => r.COLUMN_NAME);
}

async function tableExists(table) {
    const [rows] = await db.query(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [table]
    );
    return rows.length > 0;
}

(async () => {
    console.log(DRY ? '[dry-run] Backfilling storage ledger...' : 'Backfilling storage ledger...');

    let totalFiles = 0;
    let totalBytes = 0;
    let skippedMissing = 0;
    let skippedRemote = 0;

    for (const { table, cols: wantCols, source } of SOURCES) {
        if (!(await tableExists(table))) {
            console.log(`  ${table}: table not found, skipping`);
            continue;
        }
        const cols = await existingCols(table, wantCols);
        if (cols.length === 0) {
            console.log(`  ${table}: no image columns present, skipping`);
            continue;
        }
        // tenants table doesn't have a `tenant_id` column — its id IS the tenant_id.
        const tenantCol = table === 'tenants' ? 'id' : 'tenant_id';
        const select = `SELECT ${tenantCol} AS tenant_id, ${cols.join(', ')} FROM ${table} WHERE ${cols.map(c => `${c} IS NOT NULL`).join(' OR ')}`;
        const [rows] = await db.query(select);

        let tableFiles = 0;
        let tableBytes = 0;
        for (const r of rows) {
            const tenantId = r.tenant_id;
            if (!tenantId) continue;
            for (const c of cols) {
                const url = r[c];
                if (!url) continue;
                const disk = toDiskPath(url);
                if (!disk) { skippedRemote++; continue; }
                const abs = path.join(__dirname, disk);
                try {
                    const stat = fs.statSync(abs);
                    if (!stat.isFile()) continue;

                    if (!DRY) {
                        // INSERT IGNORE so re-runs don't dupe; if the row exists we
                        // leave its existing size in place. Counter recompute below
                        // will reconcile from the ledger as the source of truth.
                        await db.query(
                            `INSERT IGNORE INTO tenant_storage_log (tenant_id, file_path, size_bytes, source)
                             VALUES (?, ?, ?, ?)`,
                            [tenantId, disk, stat.size, source]
                        );
                    }
                    tableFiles++;
                    tableBytes += stat.size;
                } catch (e) {
                    if (e.code === 'ENOENT') skippedMissing++;
                    else console.warn(`  stat failed for ${disk}: ${e.message}`);
                }
            }
        }
        console.log(`  ${table}: ${tableFiles} files (${(tableBytes / (1024 * 1024)).toFixed(2)} MB)`);
        totalFiles += tableFiles;
        totalBytes += tableBytes;
    }

    if (!DRY) {
        // Recompute the cached counter on each tenant from the ledger total, so
        // any prior drift is wiped. This is the moment of truth.
        await db.query(`
            UPDATE tenants t
            LEFT JOIN (
                SELECT tenant_id, SUM(size_bytes) AS total
                FROM tenant_storage_log
                GROUP BY tenant_id
            ) l ON l.tenant_id = t.id
            SET t.storage_bytes = COALESCE(l.total, 0)
        `);
        console.log('  ✓ recomputed tenants.storage_bytes from ledger');
    }

    console.log(`\nDone. ${totalFiles} files, ${(totalBytes / (1024 * 1024)).toFixed(2)} MB total.`);
    if (skippedRemote) console.log(`Skipped ${skippedRemote} remote URLs (S3/CDN — not stat-able locally).`);
    if (skippedMissing) console.log(`Skipped ${skippedMissing} missing files (referenced in DB but absent on disk).`);

    process.exit();
})().catch(err => {
    console.error('Backfill failed:', err);
    process.exit(1);
});
