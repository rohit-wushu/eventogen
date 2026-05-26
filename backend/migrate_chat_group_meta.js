const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

(async () => {
    try {
        const conn = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });
        console.log('Connected');

        const add = async (col, ddl) => {
            const [rows] = await conn.query(`SHOW COLUMNS FROM chat_groups LIKE '${col}'`);
            if (rows.length === 0) {
                await conn.query(`ALTER TABLE chat_groups ADD COLUMN ${ddl}`);
                console.log(`Added ${col}`);
            }
        };
        await add('description', 'description TEXT NULL');
        await add('drive_link', 'drive_link VARCHAR(500) NULL');

        await conn.end();
        process.exit(0);
    } catch (err) { console.error(err); process.exit(1); }
})();
