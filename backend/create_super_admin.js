/**
 * Seed the first (or another) platform super admin.
 *
 * Usage:
 *   node create_super_admin.js <email> <password> [name]
 *
 * Example:
 *   node create_super_admin.js owner@eventhive.com S3cureP@ss "Platform Owner"
 *
 * - If the email already exists, the user is upgraded to super admin in-place
 *   (keeps their tenant_id, just flips is_super_admin to 1).
 * - If the email doesn't exist, a new super admin is created with tenant_id
 *   NULL so they aren't tied to any workspace.
 *
 * Super admins log in at the same /login page — the app auto-routes them to
 * the Platform console based on is_super_admin on the user object.
 */
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function run() {
    const [email, password, ...nameParts] = process.argv.slice(2);
    const name = nameParts.join(' ') || 'Platform Owner';

    if (!email || !password) {
        console.error('Usage: node create_super_admin.js <email> <password> [name]');
        process.exit(1);
    }
    if (password.length < 6) {
        console.error('Password must be at least 6 characters.');
        process.exit(1);
    }

    const c = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    const hashed = await bcrypt.hash(password, 10);
    const [existing] = await c.query('SELECT id, is_super_admin FROM users WHERE email = ?', [email]);

    if (existing.length > 0) {
        await c.query(
            'UPDATE users SET is_super_admin = 1, password = ?, name = ?, role = ? WHERE id = ?',
            [hashed, name, 'admin', existing[0].id]
        );
        console.log(`✓ Existing user ${email} (id=${existing[0].id}) upgraded to super admin`);
    } else {
        const [r] = await c.query(
            'INSERT INTO users (name, email, password, role, tenant_id, is_super_admin) VALUES (?, ?, ?, ?, NULL, 1)',
            [name, email, hashed, 'admin']
        );
        console.log(`✓ Created super admin ${email} (id=${r.insertId})`);
    }

    console.log('\nLog in at the usual /login page with this email and password.');
    console.log('The Platform sidebar section will appear automatically.\n');

    await c.end();
}

run().catch(err => { console.error('FAILED:', err); process.exit(1); });
