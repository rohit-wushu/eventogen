require('dotenv').config();
const db = require('./config/db');

// invoices.plan_id was NOT NULL with FK ON DELETE RESTRICT, which blocked
// super admin from deleting plans that ever had a paid invoice — even years
// later. Switch the column to NULL + change FK to SET NULL so invoices
// survive plan deletion as historical records (plan_name/plan_code are
// already denormalized on the invoice row).
async function migrate() {
    try {
        const [[{ schema }]] = await db.query('SELECT DATABASE() AS `schema`');
        console.log(`Patching invoices.plan_id FK in schema "${schema}"...`);

        // Find the actual FK constraint name — it may not be invoices_ibfk_2
        // on every install (older migrations / re-creations rename them).
        const [fks] = await db.query(
            `SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'invoices'
               AND COLUMN_NAME = 'plan_id' AND REFERENCED_TABLE_NAME = 'plans'`,
            [schema]
        );
        for (const fk of fks) {
            console.log(`  - dropping FK ${fk.CONSTRAINT_NAME}`);
            await db.query(`ALTER TABLE invoices DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
        }

        console.log('  - making plan_id nullable');
        await db.query(`ALTER TABLE invoices MODIFY COLUMN plan_id INT NULL`);

        console.log('  - re-adding FK with ON DELETE SET NULL');
        await db.query(`
            ALTER TABLE invoices
            ADD CONSTRAINT invoices_plan_id_fk
            FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL
        `);

        console.log('Done.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err.message);
        process.exit(1);
    }
}

migrate();
