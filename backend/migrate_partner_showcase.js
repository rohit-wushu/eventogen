require('dotenv').config();
const db = require('./config/db');

async function migrate() {
    try {
        console.log('Adding partner_showcase_template + partner_showcase_config to events...');
        const cols = [
            { name: 'partner_showcase_template', ddl: `VARCHAR(40) NOT NULL DEFAULT 'tiered'` },
            { name: 'partner_showcase_config',   ddl: 'JSON NULL' },
        ];
        for (const col of cols) {
            try {
                await db.query(`ALTER TABLE events ADD COLUMN ${col.name} ${col.ddl}`);
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
