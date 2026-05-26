/**
 * Super admin migration — adds the is_super_admin flag so platform operators
 * can log in to a privileged cross-tenant console without being tied to any
 * one workspace's data.
 *
 * - users.is_super_admin: TINYINT(1) DEFAULT 0 — off by default
 * - users.tenant_id: now NULLABLE so a super admin doesn't have to be tethered
 *   to a real tenant. All existing users keep their tenant_id intact.
 *
 * Safe to re-run.
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
    const c = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });
    console.log('Connected\n');

    const [cols] = await c.query('SHOW COLUMNS FROM users');
    const names = cols.map(col => col.Field);

    if (!names.includes('is_super_admin')) {
        await c.query('ALTER TABLE users ADD COLUMN is_super_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER role');
        console.log('✓ added users.is_super_admin');
    } else {
        console.log('- users.is_super_admin already exists');
    }

    // Make tenant_id nullable. MySQL's MODIFY will keep existing defaults so
    // we re-issue with explicit DEFAULT NULL and drop any NOT NULL constraint.
    const tenantCol = cols.find(c => c.Field === 'tenant_id');
    if (tenantCol && tenantCol.Null === 'NO') {
        await c.query('ALTER TABLE users MODIFY COLUMN tenant_id INT NULL');
        console.log('✓ users.tenant_id is now nullable');
    } else {
        console.log('- users.tenant_id already nullable');
    }

    await c.end();
    console.log('\n✓ Super admin migration complete.');
}

run().catch(err => { console.error('MIGRATION FAILED:', err); process.exit(1); });
