const db = require('./config/db');

// Per-event override for the delegate confirmation email template. Null
// means "use the tenant default" (settings.attendee_confirmation_template);
// when populated, this template wins for that event so different events
// can carry different branding / copy.
async function migrate() {
    try {
        console.log('Adding events.confirmation_email_template...');
        await db.query(`ALTER TABLE events ADD COLUMN confirmation_email_template JSON DEFAULT NULL`);
        console.log('  ok: events.confirmation_email_template added.');
        process.exit(0);
    } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_COLUMN_NAME') {
            console.log('  skip: events.confirmation_email_template already exists.');
            process.exit(0);
        }
        console.error('  fail:', err);
        process.exit(1);
    }
}

migrate();
