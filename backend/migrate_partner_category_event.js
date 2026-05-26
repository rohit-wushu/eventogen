require('dotenv').config();
const db = require('./config/db');

async function migrate() {
    try {
        console.log('Linking partner_categories to events...');

        // 1. Add event_id column if not present
        try {
            await db.query('ALTER TABLE partner_categories ADD COLUMN event_id INT NULL');
            console.log('  + event_id');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('  = event_id already exists');
            } else {
                throw err;
            }
        }

        // 2. Drop the old global UNIQUE on name (if present) so two events can both have e.g. "Diamond Sponsor".
        // The original schema declared `name VARCHAR(255) UNIQUE`, which MySQL stores as an index named `name`.
        try {
            await db.query('ALTER TABLE partner_categories DROP INDEX name');
            console.log('  - dropped global UNIQUE(name)');
        } catch (err) {
            if (err.code === 'ER_CANT_DROP_FIELD_OR_KEY' || err.message.includes("check that column/key exists")) {
                console.log('  = no global UNIQUE(name) to drop');
            } else {
                throw err;
            }
        }

        // 3. Add a composite UNIQUE on (tenant_id, event_id, name) so each event has its own namespace.
        try {
            await db.query('ALTER TABLE partner_categories ADD UNIQUE KEY uniq_tenant_event_name (tenant_id, event_id, name)');
            console.log('  + UNIQUE(tenant_id, event_id, name)');
        } catch (err) {
            if (err.code === 'ER_DUP_KEYNAME' || err.message.includes('Duplicate key name')) {
                console.log('  = composite unique already exists');
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
