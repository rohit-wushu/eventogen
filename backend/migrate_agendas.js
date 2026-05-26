require('dotenv').config();
const db = require('./config/db');

async function migrate() {
    try {
        console.log('Adding sequence column to agendas table...');
        await db.query('ALTER TABLE agendas ADD COLUMN sequence INT DEFAULT 0');
        console.log('Success!');
        process.exit(0);
    } catch (err) {
        if (err.code === 'ER_DUP_COLUMN_NAMES' || err.message.includes('Duplicate column')) {
            console.log('Column already exists.');
            process.exit(0);
        }
        console.error('Migration failed:', err.message);
        process.exit(1);
    }
}

migrate();
