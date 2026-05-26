const db = require('./config/db');

// Adds per-event section ("module") restrictions to the user_events junction.
//
//   sections IS NULL  → full access on this event (default; matches the four
//                       existing rows so nothing changes for current users).
//   sections IS JSON  → array of section keys (subset of permissions.SECTIONS)
//                       the employee may use on this event. Intersected with
//                       the tenant-wide users.permissions column at check time.
//
// Applies to employees only. Admins/managers always pass — this column has no
// effect on their access. Keeping the default NULL means every current
// assignment continues to grant full per-event access; admins/managers can
// narrow it after the fact from the Users page.

const migrate = async () => {
    console.log('🚀 Adding sections column to user_events...');
    try {
        // Detect first so re-runs are a no-op. information_schema lookup is
        // cheaper than catching a duplicate-column error.
        const [rows] = await db.query(`
            SELECT COUNT(*) AS c FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'user_events'
              AND COLUMN_NAME = 'sections'
        `);
        if (rows[0].c > 0) {
            console.log('✅ user_events.sections already exists — nothing to do.');
            process.exit();
        }

        await db.query(`ALTER TABLE user_events ADD COLUMN sections JSON NULL`);
        console.log('✅ Added user_events.sections (default NULL = full access).');
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
        process.exit(1);
    }
    process.exit();
};

migrate();
