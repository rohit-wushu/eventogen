require('dotenv').config();
const db = require('./config/db');

// Adds a per-form opt-out for the "Powered by …" footer on the public fill page.
async function migrate() {
    try {
        console.log('Adding hide_footer to forms...');
        try {
            await db.query(`ALTER TABLE forms ADD COLUMN hide_footer TINYINT(1) NOT NULL DEFAULT 0`);
            console.log('  + hide_footer');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('  = hide_footer already exists');
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
