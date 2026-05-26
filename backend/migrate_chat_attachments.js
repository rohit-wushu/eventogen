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
            const [rows] = await conn.query(`SHOW COLUMNS FROM messages LIKE '${col}'`);
            if (rows.length === 0) {
                await conn.query(`ALTER TABLE messages ADD COLUMN ${ddl}`);
                console.log(`Added ${col}`);
            }
        };

        await add('attachment_url', 'attachment_url VARCHAR(500) NULL');
        await add('attachment_name', 'attachment_name VARCHAR(255) NULL');
        await add('attachment_type', "attachment_type VARCHAR(50) NULL");
        await add('attachment_size', 'attachment_size INT NULL');

        // body must allow NULL when only an attachment is sent
        try { await conn.query(`ALTER TABLE messages MODIFY COLUMN body TEXT NULL`); } catch (e) {}

        await conn.end();
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
})();
