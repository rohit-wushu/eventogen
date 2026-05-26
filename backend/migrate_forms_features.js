const db = require('./config/db');

// Adds the feature-pack columns: email notification target, submission cap,
// close-on-date, per-field help text. Idempotent — safe to re-run.

const migrate = async () => {
    console.log('🚀 Starting Forms features migration...');

    const alters = [
        ['forms', 'notify_email', `ALTER TABLE forms ADD COLUMN notify_email VARCHAR(255) NULL AFTER submit_label`],
        ['forms', 'max_submissions', `ALTER TABLE forms ADD COLUMN max_submissions INT NULL AFTER notify_email`],
        ['forms', 'close_at', `ALTER TABLE forms ADD COLUMN close_at DATETIME NULL AFTER max_submissions`],
        ['form_fields', 'help_text', `ALTER TABLE form_fields ADD COLUMN help_text VARCHAR(500) NULL AFTER placeholder`],
    ];

    for (const [table, col, sql] of alters) {
        try {
            await db.query(sql);
            console.log(`✅ Added '${col}' to '${table}'.`);
        } catch (err) {
            if (err.errno === 1060) {
                console.log(`ℹ️  Column '${col}' already exists on '${table}'.`);
            } else {
                console.error(`❌ Error adding '${col}' to '${table}':`, err.message);
            }
        }
    }

    console.log('✅ Forms features migration complete!');
    process.exit();
};

migrate();
