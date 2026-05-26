require('dotenv').config();
const db = require('./config/db');

async function migrate() {
    try {
        console.log('Adding logo_width and logo_height columns to partners table...');
        for (const col of ['logo_width', 'logo_height']) {
            try {
                await db.query(`ALTER TABLE partners ADD COLUMN ${col} INT DEFAULT NULL`);
                console.log(`  + ${col}`);
            } catch (err) {
                if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                    console.log(`  = ${col} already exists`);
                } else {
                    throw err;
                }
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
