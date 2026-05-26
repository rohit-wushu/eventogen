const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
dotenv.config();

const migrate = async () => {
    const db = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    try {
        // Add assigned_event_id to users
        await db.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS assigned_event_id INT NULL DEFAULT NULL
        `);
        console.log('✅ users.assigned_event_id added');

        // Add assigned_task to users
        await db.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS assigned_task TEXT NULL DEFAULT NULL
        `);
        console.log('✅ users.assigned_task added');

        // Add event_id to invitations
        await db.query(`
            ALTER TABLE invitations 
            ADD COLUMN IF NOT EXISTS event_id INT NULL DEFAULT NULL
        `);
        console.log('✅ invitations.event_id added');

        // Add assigned_task to invitations
        await db.query(`
            ALTER TABLE invitations 
            ADD COLUMN IF NOT EXISTS assigned_task TEXT NULL DEFAULT NULL
        `);
        console.log('✅ invitations.assigned_task added');

        console.log('\n✅ Migration complete!');
    } catch (err) {
        console.error('Migration error:', err.message);
    }
    process.exit();
};

migrate();
