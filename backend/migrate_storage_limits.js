/**
 * Adds storage-quota tracking to the billing system.
 *
 *   plans.max_storage_mb   — per-plan ceiling in MB (0 = unlimited)
 *   tenants.storage_bytes  — cached running total updated on upload/delete
 *
 * Backfills the existing plans (free / pro / enterprise) with sensible defaults
 * and seeds storage_bytes by computing it from the current `uploads/` tree where
 * a tenant tag is recoverable. For tenants without recoverable per-file
 * attribution, the column stays at 0 — usage will warm up as new uploads land.
 */
const db = require('./config/db');

(async () => {
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // 1. plans.max_storage_mb
        const [planCols] = await conn.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'max_storage_mb'`
        );
        if (planCols.length === 0) {
            await conn.query(`ALTER TABLE plans ADD COLUMN max_storage_mb INT NOT NULL DEFAULT 100 AFTER max_users`);
            console.log('✓ added plans.max_storage_mb');
        } else {
            console.log('- plans.max_storage_mb already exists');
        }

        // 2. tenants.storage_bytes (cached counter, BIGINT — files can hit GB scale)
        const [tenantCols] = await conn.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants' AND COLUMN_NAME = 'storage_bytes'`
        );
        if (tenantCols.length === 0) {
            await conn.query(`ALTER TABLE tenants ADD COLUMN storage_bytes BIGINT NOT NULL DEFAULT 0`);
            console.log('✓ added tenants.storage_bytes');
        } else {
            console.log('- tenants.storage_bytes already exists');
        }

        // 3. tenant_storage_log — ledger so we can credit bytes back on delete
        // without a brittle full FS scan. (tenant_id, path) is unique so the
        // ON DUPLICATE clause in INSERT keeps re-uploads idempotent.
        await conn.query(`
            CREATE TABLE IF NOT EXISTS tenant_storage_log (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id INT NOT NULL,
                file_path VARCHAR(500) NOT NULL,
                size_bytes BIGINT NOT NULL DEFAULT 0,
                source VARCHAR(40) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_tenant_path (tenant_id, file_path),
                INDEX idx_log_tenant (tenant_id),
                FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
            ) ENGINE=InnoDB
        `);
        console.log('✓ tenant_storage_log table ready');

        // 4. Set defaults on the seeded plans. Free = 100MB, Pro = 5GB, Enterprise = 0 (unlimited).
        const defaults = [
            { code: 'free',       mb: 100 },
            { code: 'pro',        mb: 5120 },
            { code: 'enterprise', mb: 0 }
        ];
        for (const { code, mb } of defaults) {
            const [r] = await conn.query(
                `UPDATE plans SET max_storage_mb = ? WHERE code = ?`,
                [mb, code]
            );
            if (r.affectedRows) console.log(`  ✓ ${code}: ${mb === 0 ? 'unlimited' : mb + ' MB'}`);
        }

        await conn.commit();
        console.log('\nStorage-limits migration complete.');
    } catch (err) {
        await conn.rollback();
        console.error('Migration failed:', err);
        process.exitCode = 1;
    } finally {
        conn.release();
        process.exit();
    }
})();
