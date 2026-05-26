require('dotenv').config();
const db = require('./config/db');

async function migrate() {
    try {
        console.log('Adding condition_json to form_fields...');
        try {
            await db.query(`ALTER TABLE form_fields ADD COLUMN condition_json TEXT NULL`);
            console.log('  + condition_json');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('  = condition_json already exists');
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
