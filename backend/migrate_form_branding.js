require('dotenv').config();
const db = require('./config/db');

async function migrate() {
    try {
        console.log('Adding header_image_url and background_color to forms...');
        const cols = [
            { name: 'header_image_url', ddl: 'VARCHAR(500) NULL' },
            { name: 'background_color', ddl: 'VARCHAR(20) NULL' },
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
