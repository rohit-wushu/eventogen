/**
 * Multi-tenancy Stage 1 migration.
 *
 * - Creates the `tenants` table.
 * - Seeds a single default tenant (id=1) so existing rows have a home.
 * - Adds `tenant_id INT NOT NULL DEFAULT 1` + index + FK to every user-owned table.
 *
 * Safe to re-run — every step checks for existence first.
 * Stage 2 (app-layer query scoping) is separate.
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

// Every table that holds customer-owned rows. Anything a tenant creates, reads,
// or is billed for belongs here. Lookup/system tables would be excluded — we
// have none currently.
const TENANTED_TABLES = [
    'events', 'speakers', 'partners', 'partner_categories', 'partner_wishlist',
    'awards', 'award_categories', 'agendas', 'agenda_speakers', 'attendees',
    'speaker_travel', 'notifications', 'chat_groups', 'chat_group_members',
    'chat_group_reads', 'messages', 'message_hides', 'message_reactions',
    'invitations', 'settings'
];

async function columnExists(conn, table, col) {
    const [r] = await conn.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, [col]);
    return r.length > 0;
}

async function indexExists(conn, table, indexName) {
    const [r] = await conn.query(`SHOW INDEX FROM \`${table}\` WHERE Key_name = ?`, [indexName]);
    return r.length > 0;
}

async function fkExists(conn, table, fkName) {
    const [r] = await conn.query(
        `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
        [table, fkName]
    );
    return r.length > 0;
}

async function run() {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });
    console.log('Connected to DB\n');

    // 1. tenants table
    await conn.query(`
        CREATE TABLE IF NOT EXISTS tenants (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            slug VARCHAR(100) NOT NULL UNIQUE,
            plan VARCHAR(50) NOT NULL DEFAULT 'free',
            status ENUM('active','trial','past_due','suspended','deleted') NOT NULL DEFAULT 'active',
            trial_ends_at TIMESTAMP NULL,
            razorpay_customer_id VARCHAR(255) NULL,
            razorpay_subscription_id VARCHAR(255) NULL,
            primary_color VARCHAR(20) DEFAULT '#8b5cf6',
            logo_url VARCHAR(500) NULL,
            owner_user_id INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB;
    `);
    console.log('✓ tenants table ready');

    // 2. Seed default tenant (id=1)
    const [existing] = await conn.query('SELECT id FROM tenants WHERE id = 1');
    if (existing.length === 0) {
        await conn.query(
            `INSERT INTO tenants (id, name, slug, plan, status) VALUES (1, 'Default Organization', 'default', 'free', 'active')`
        );
        console.log('✓ seeded default tenant (id=1)');
    } else {
        console.log('- default tenant already exists');
    }

    // 3. users.tenant_id — handle first so FK on other tables can reference it indirectly
    if (!(await columnExists(conn, 'users', 'tenant_id'))) {
        await conn.query(`ALTER TABLE users ADD COLUMN tenant_id INT NOT NULL DEFAULT 1 AFTER id`);
        console.log('✓ users.tenant_id added');
    } else {
        console.log('- users.tenant_id already exists');
    }
    if (!(await indexExists(conn, 'users', 'idx_users_tenant'))) {
        await conn.query(`ALTER TABLE users ADD INDEX idx_users_tenant (tenant_id)`);
    }
    if (!(await fkExists(conn, 'users', 'fk_users_tenant'))) {
        await conn.query(`ALTER TABLE users ADD CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT`);
        console.log('✓ users → tenants FK added');
    }

    // 4. Set tenant owner from first admin
    const [admins] = await conn.query(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`);
    if (admins.length > 0) {
        await conn.query(
            `UPDATE tenants SET owner_user_id = ? WHERE id = 1 AND owner_user_id IS NULL`,
            [admins[0].id]
        );
        console.log(`✓ tenant 1 owner = user ${admins[0].id}`);
    } else {
        console.log('! no admin user found — tenant owner left NULL');
    }

    // 5. Add tenant_id to every tenant-owned table
    console.log('\nAdding tenant_id to tables...');
    for (const table of TENANTED_TABLES) {
        const colName = 'tenant_id';
        const indexName = `idx_${table}_tenant`;
        const fkName = `fk_${table}_tenant`;

        if (!(await columnExists(conn, table, colName))) {
            await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN ${colName} INT NOT NULL DEFAULT 1`);
            process.stdout.write(`  ✓ ${table}`);
        } else {
            process.stdout.write(`  - ${table}`);
        }
        if (!(await indexExists(conn, table, indexName))) {
            await conn.query(`ALTER TABLE \`${table}\` ADD INDEX ${indexName} (tenant_id)`);
            process.stdout.write(' [+idx]');
        }
        if (!(await fkExists(conn, table, fkName))) {
            try {
                await conn.query(
                    `ALTER TABLE \`${table}\` ADD CONSTRAINT ${fkName} FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT`
                );
                process.stdout.write(' [+fk]');
            } catch (err) {
                process.stdout.write(` [fk failed: ${err.code}]`);
            }
        }
        process.stdout.write('\n');
    }

    // 6. Final counts
    const [[{ c: tenantCount }]] = await conn.query('SELECT COUNT(*) c FROM tenants');
    const [[{ c: userCount }]] = await conn.query('SELECT COUNT(*) c FROM users WHERE tenant_id = 1');
    console.log(`\n✓ Stage 1 complete. tenants=${tenantCount}, users in tenant 1=${userCount}`);

    await conn.end();
}

run().catch(err => { console.error('MIGRATION FAILED:', err); process.exit(1); });
