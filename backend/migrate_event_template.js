const db = require('./config/db');

async function migrate() {
    try {
        console.log('Adding sns_card_template column to events table...');
        await db.query(`
            ALTER TABLE events 
            ADD COLUMN sns_card_template JSON DEFAULT NULL
        `);
        console.log('Migration successful: sns_card_template added.');
        process.exit(0);
    } catch (err) {
        if (err.code === 'ER_DUP_COLUMN_NAME') {
            console.log('Column sns_card_template already exists.');
            process.exit(0);
        } else {
            console.error('Migration failed:', err);
            process.exit(1);
        }
    }
}

migrate();
