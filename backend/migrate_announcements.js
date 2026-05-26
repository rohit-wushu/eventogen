/**
 * Platform announcements — messages broadcast by the super admin that show as
 * a dismissible banner at the top of every tenant's app. Idempotent.
 *
 * Columns of note:
 *   type      — banner color (info/warning/danger/success)
 *   is_active — master on/off switch, independent of start/end dates
 *   starts_at / ends_at — optional schedule window (both nullable = "show now")
 *   dismissible — whether users can close the banner for their own session
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

    await c.query(`
        CREATE TABLE IF NOT EXISTS platform_announcements (
            id INT AUTO_INCREMENT PRIMARY KEY,
            title VARCHAR(200) NOT NULL,
            message TEXT NOT NULL,
            type ENUM('info', 'warning', 'danger', 'success') NOT NULL DEFAULT 'info',
            is_active TINYINT(1) NOT NULL DEFAULT 1,
            dismissible TINYINT(1) NOT NULL DEFAULT 1,
            starts_at TIMESTAMP NULL,
            ends_at TIMESTAMP NULL,
            created_by INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_active (is_active, starts_at, ends_at)
        ) ENGINE=InnoDB;
    `);
    console.log('✓ platform_announcements table ready');

    await c.end();
    console.log('\n✓ Announcements migration complete.');
}

run().catch(err => { console.error('MIGRATION FAILED:', err); process.exit(1); });
