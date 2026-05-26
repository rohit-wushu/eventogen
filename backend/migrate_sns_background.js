const db = require('./config/db');

async function migrate() {
    try {
        console.log('Adding sns_card_bg_url column to events table...');
        try {
            await db.query(`ALTER TABLE events ADD COLUMN sns_card_bg_url VARCHAR(255) DEFAULT NULL`);
            console.log('Column sns_card_bg_url added.');
        } catch (e) {
            if (e.code === 'ER_DUP_COLUMN_NAME') console.log('Column sns_card_bg_url already exists.');
            else throw e;
        }

        console.log('Checking sns_card_template column...');
        try {
            await db.query(`ALTER TABLE events ADD COLUMN sns_card_template JSON DEFAULT NULL`);
            console.log('Column sns_card_template added.');
        } catch (e) {
            if (e.code === 'ER_DUP_COLUMN_NAME') console.log('Column sns_card_template already exists.');
            else throw e;
        }

        console.log('Migration successful.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
