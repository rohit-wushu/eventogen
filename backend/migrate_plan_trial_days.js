require('dotenv').config();
const db = require('./config/db');

// Adds a per-plan `trial_days` column so the trial length is editable from
// the super-admin Plans page instead of being hardcoded in signup. Default
// 7 — matches the new Free-plan trial length. Existing rows are backfilled
// to 7 so behavior doesn't change implicitly.
async function migrate() {
    try {
        console.log('Adding plans.trial_days...');
        try {
            await db.query(`ALTER TABLE plans ADD COLUMN trial_days INT NOT NULL DEFAULT 7`);
            console.log('  + trial_days');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('  = trial_days already exists');
            } else {
                throw err;
            }
        }
        await db.query(`UPDATE plans SET trial_days = 7 WHERE trial_days IS NULL OR trial_days = 0`);
        console.log('  backfilled existing rows to 7');
        console.log('Done.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err.message);
        process.exit(1);
    }
}

migrate();
