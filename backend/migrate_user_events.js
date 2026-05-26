const db = require('./config/db');

// Moves user→event assignment from a single `users.assigned_event_id`
// column to a many-to-many `user_events` junction so an admin/manager can
// assign multiple events to one user.
//
// `users.assigned_event_id` is KEPT and treated as the "primary" event
// (first assigned) for backward compatibility — the JWT, the frontend,
// and any auth check not yet migrated still read it and fail safe.
//
// Backfill: every existing non-null assigned_event_id becomes one
// user_events row, so current assignments carry over unchanged.

const migrate = async () => {
    console.log('🚀 Starting User-Events Migration...');

    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS user_events (
                user_id INT NOT NULL,
                event_id INT NOT NULL,
                tenant_id INT NOT NULL DEFAULT 1,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, event_id),
                INDEX idx_user_events_user (user_id),
                INDEX idx_user_events_event (event_id),
                INDEX idx_user_events_tenant (tenant_id)
            ) ENGINE=InnoDB
        `);
        console.log("✅ Table 'user_events' ready.");
    } catch (err) {
        console.error("❌ Error creating user_events:", err.message);
        process.exit(1);
    }

    // Backfill from the existing single-event column. INSERT IGNORE so
    // re-running the migration is a no-op.
    try {
        const [result] = await db.query(`
            INSERT IGNORE INTO user_events (user_id, event_id, tenant_id)
            SELECT id, assigned_event_id, tenant_id
            FROM users
            WHERE assigned_event_id IS NOT NULL
        `);
        console.log(`✅ Backfilled ${result.affectedRows || 0} existing assignment(s) into user_events.`);
    } catch (err) {
        console.error("❌ Error backfilling user_events:", err.message);
    }

    console.log('✅ User-Events Migration complete!');
    process.exit();
};

migrate();
