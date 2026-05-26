require('dotenv').config();
const db = require('./config/db');

async function migrate() {
    try {
        console.log('Adding captcha_enabled to forms...');
        try {
            await db.query(`ALTER TABLE forms ADD COLUMN captcha_enabled TINYINT(1) NOT NULL DEFAULT 0`);
            console.log('  + captcha_enabled');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('  = captcha_enabled already exists');
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
