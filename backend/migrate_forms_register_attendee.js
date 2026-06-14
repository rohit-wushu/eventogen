require('dotenv').config();
const db = require('./config/db');

// When ON, each successful submission to a form linked to an event also
// creates an attendee row (best-effort field mapping: name / email / phone /
// company / designation). Default OFF — forms keep behaving as plain
// submission collectors.
async function migrate() {
    try {
        console.log('Adding register_as_attendee to forms...');
        try {
            await db.query(`ALTER TABLE forms ADD COLUMN register_as_attendee TINYINT(1) NOT NULL DEFAULT 0`);
            console.log('  + register_as_attendee');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('  = register_as_attendee already exists');
            } else {
                throw err;
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
