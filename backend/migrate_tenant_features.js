require('dotenv').config();
const db = require('./config/db');

// Per-tenant feature toggles flipped from the Platform Console. Defaults to 1
// so existing tenants keep what they had — super admin can opt them out.
async function migrate() {
    try {
        const [cols] = await db.query("SHOW COLUMNS FROM tenants LIKE 'bulk_certificate_enabled'");
        if (cols.length === 0) {
            console.log('Adding tenants.bulk_certificate_enabled...');
            await db.query(`ALTER TABLE tenants ADD COLUMN bulk_certificate_enabled TINYINT(1) NOT NULL DEFAULT 1`);
            console.log('  + bulk_certificate_enabled');
        } else {
            console.log('tenants.bulk_certificate_enabled already exists, skipping.');
        }
        console.log('Done.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err.message);
        process.exit(1);
    }
}

migrate();
