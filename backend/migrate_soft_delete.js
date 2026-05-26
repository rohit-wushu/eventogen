require('dotenv').config();
const db = require('./config/db');

// Recycle Bin support — every list/get query gets `deleted_at IS NULL` after
// this migration, every DELETE becomes a soft delete (UPDATE deleted_at).
// The Recycle Bin page reads rows where deleted_at IS NOT NULL and the
// scheduled cleanup hard-deletes anything older than 30 days.
const TABLES = ['speakers', 'partners', 'awards', 'agendas', 'attendees'];

async function migrate() {
    try {
        for (const t of TABLES) {
            const [a] = await db.query(`SHOW COLUMNS FROM ${t} LIKE 'deleted_at'`);
            if (a.length === 0) {
                console.log(`+ ${t}.deleted_at`);
                await db.query(`ALTER TABLE ${t} ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL`);
            } else {
                console.log(`= ${t}.deleted_at already exists`);
            }
            const [b] = await db.query(`SHOW COLUMNS FROM ${t} LIKE 'deleted_by'`);
            if (b.length === 0) {
                console.log(`+ ${t}.deleted_by`);
                await db.query(`ALTER TABLE ${t} ADD COLUMN deleted_by INT NULL DEFAULT NULL`);
            } else {
                console.log(`= ${t}.deleted_by already exists`);
            }
            // Index the column so the recycle-bin filter (and the
            // deleted_at IS NULL filter on every live read) stays cheap.
            const [idx] = await db.query(
                `SELECT 1 FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
                [t, `idx_${t}_deleted_at`]
            );
            if (idx.length === 0) {
                console.log(`+ idx_${t}_deleted_at`);
                await db.query(`CREATE INDEX idx_${t}_deleted_at ON ${t}(tenant_id, deleted_at)`);
            }
        }
        console.log('Done.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err.message);
        process.exit(1);
    }
}

migrate();
