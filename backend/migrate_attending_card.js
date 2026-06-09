const db = require('./config/db');

async function migrate() {
    const adds = [
        { name: 'speakers.attending_card_url',     sql: `ALTER TABLE speakers ADD COLUMN attending_card_url VARCHAR(255) DEFAULT NULL` },
        { name: 'speakers.attending_card_design',  sql: `ALTER TABLE speakers ADD COLUMN attending_card_design JSON DEFAULT NULL` },
        { name: 'events.attending_card_template',  sql: `ALTER TABLE events ADD COLUMN attending_card_template JSON DEFAULT NULL` },
    ];
    for (const col of adds) {
        try {
            console.log(`Adding ${col.name}...`);
            await db.query(col.sql);
            console.log(`  ok: ${col.name} added.`);
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.code === 'ER_DUP_COLUMN_NAME') {
                console.log(`  skip: ${col.name} already exists.`);
                continue;
            }
            console.error(`  fail: ${col.name}`, err);
            process.exit(1);
        }
    }
    process.exit(0);
}

migrate();
