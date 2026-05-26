const db = require('./config/db');

async function migrate() {
    try {
        console.log('Adding sns_card_design column to speakers table...');
        await db.query(`
            ALTER TABLE speakers 
            ADD COLUMN sns_card_design JSON DEFAULT NULL
        `);
        console.log('Migration successful: sns_card_design added.');
        process.exit(0);
    } catch (err) {
        if (err.code === 'ER_DUP_COLUMN_NAME') {
            console.log('Column sns_card_design already exists.');
            process.exit(0);
        } else {
            console.error('Migration failed:', err);
            process.exit(1);
        }
    }
}

migrate();
