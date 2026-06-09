const db = require('./config/db');

// Adds a per-event JSON column for the certificate email template
// (subject + body, with {{name}} / {{event_title}} / {{event_date}}
// substitution). Null = "use the hardcoded default" — no UI gymnastics
// needed for events that haven't been customised yet.
async function migrate() {
    try {
        console.log('Adding events.certificate_email_template...');
        await db.query(`ALTER TABLE events ADD COLUMN certificate_email_template JSON DEFAULT NULL`);
        console.log('  ok: events.certificate_email_template added.');
        process.exit(0);
    } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_COLUMN_NAME') {
            console.log('  skip: events.certificate_email_template already exists.');
            process.exit(0);
        }
        console.error('  fail:', err);
        process.exit(1);
    }
}

migrate();
