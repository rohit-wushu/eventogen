require('dotenv').config();
const db = require('./config/db');

// Per-employee section permissions. NULL = full default access (backward
// compatible). When set to a JSON array of section keys, the employee can
// only see/use those sections. Admins and managers ignore this column.
async function migrate() {
    try {
        const [cols] = await db.query("SHOW COLUMNS FROM users LIKE 'permissions'");
        if (cols.length === 0) {
            console.log('+ users.permissions');
            await db.query(`ALTER TABLE users ADD COLUMN permissions JSON NULL DEFAULT NULL`);
        } else {
            console.log('= users.permissions already exists');
        }
        console.log('Done.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err.message);
        process.exit(1);
    }
}

migrate();
