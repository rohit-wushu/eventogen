/**
 * Allows the `settings` table to also hold PLATFORM-LEVEL settings (NULL
 * tenant_id) for super-admin-managed branding shown on the login page,
 * favicon, meta tags, etc.
 *
 * Two changes:
 *   1. `settings.tenant_id` allowed NULL (was NOT NULL)
 *   2. PK changed from `setting_key` alone to (`tenant_id`, `setting_key`)
 *      via composite UNIQUE so the same key can exist per tenant AND globally.
 *
 * Seeds a default set of platform branding keys so the login page has values
 * to display on first run.
 */
const db = require('./config/db');

(async () => {
    const conn = await db.getConnection();
    try {
        console.log('🚀 Upgrading settings table for platform-level branding...');

        // 1. Make tenant_id nullable so NULL = global platform setting.
        const [tCols] = await conn.query(
            `SELECT IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'settings' AND COLUMN_NAME = 'tenant_id'`
        );
        if (tCols.length && tCols[0].IS_NULLABLE === 'NO') {
            await conn.query(`ALTER TABLE settings MODIFY COLUMN tenant_id INT NULL`);
            console.log('✓ settings.tenant_id is now NULLABLE');
        } else {
            console.log('- settings.tenant_id already nullable');
        }

        // 2. Replace single-column PK with composite uniqueness so both
        // (tenant, key) pairs AND (NULL, key) work.
        try {
            const [pkRows] = await conn.query(
                `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'settings' AND CONSTRAINT_NAME = 'PRIMARY'
                 ORDER BY ORDINAL_POSITION`
            );
            const cur = pkRows.map(r => r.COLUMN_NAME);
            if (cur.length === 1 && cur[0] === 'setting_key') {
                // Add surrogate id column if missing, then swap PK.
                const [hasId] = await conn.query(
                    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'settings' AND COLUMN_NAME = 'id'`
                );
                if (hasId.length === 0) {
                    await conn.query(`ALTER TABLE settings ADD COLUMN id INT AUTO_INCREMENT FIRST, DROP PRIMARY KEY, ADD PRIMARY KEY (id)`);
                    console.log('✓ added surrogate id, swapped PK');
                }
            }

            // Composite uniqueness covers both (tenant_id, key) and (NULL, key) thanks to
            // MySQL treating NULL as distinct in UNIQUE — exactly what we want.
            const [idxRows] = await conn.query(
                `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'settings' AND INDEX_NAME = 'uniq_tenant_setting'`
            );
            if (idxRows.length === 0) {
                await conn.query(`ALTER TABLE settings ADD UNIQUE KEY uniq_tenant_setting (tenant_id, setting_key)`);
                console.log('✓ added UNIQUE (tenant_id, setting_key)');
            } else {
                console.log('- composite unique already present');
            }
        } catch (err) {
            console.warn('PK/index restructure note:', err.message);
        }

        // 3. Seed default platform branding so the login page has something to show.
        const defaults = [
            ['site_title',       'Eventogen'],
            ['portal_tagline',   'Premium Speaker Suite'],
            ['hero_headline',    'Everything you need to run unforgettable events.'],
            ['hero_sub',         'Manage speakers, partners, agendas and travel in one elegant, secure workspace — trusted by event teams worldwide.'],
            ['meta_title',       'Eventogen — Event Management Platform'],
            ['meta_description', 'Manage speakers, partners, agendas, attendees and certificates from one workspace.'],
            ['portal_logo',      ''],
            ['favicon',          '']
        ];
        for (const [k, v] of defaults) {
            await conn.query(
                `INSERT INTO settings (tenant_id, setting_key, setting_value) VALUES (NULL, ?, ?)
                 ON DUPLICATE KEY UPDATE setting_value = setting_value`,
                [k, v]
            );
        }
        console.log(`✓ seeded ${defaults.length} platform branding defaults`);

        console.log('\nPlatform-settings migration complete.');
    } catch (err) {
        console.error('Migration failed:', err);
        process.exitCode = 1;
    } finally {
        conn.release();
        process.exit();
    }
})();
