require('dotenv').config();
const db = require('./config/db');

async function migrate() {
    try {
        console.log('Adding theme + theme_config to forms...');
        const cols = [
            { name: 'theme',        ddl: `VARCHAR(40) NOT NULL DEFAULT 'classic'` },
            { name: 'theme_config', ddl: 'JSON NULL' },
        ];
        for (const col of cols) {
            try {
                await db.query(`ALTER TABLE forms ADD COLUMN ${col.name} ${col.ddl}`);
                console.log(`  + ${col.name}`);
            } catch (err) {
                if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                    console.log(`  = ${col.name} already exists`);
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
