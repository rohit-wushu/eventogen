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

        await conn.query(`
            CREATE TABLE IF NOT EXISTS message_hides (
                message_id INT NOT NULL,
                user_id INT NOT NULL,
                PRIMARY KEY (message_id, user_id),
                FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        `);
        console.log('Table message_hides ready');

        const [col] = await conn.query("SHOW COLUMNS FROM messages LIKE 'deleted_for_everyone'");
        if (col.length === 0) {
            await conn.query(`ALTER TABLE messages ADD COLUMN deleted_for_everyone TINYINT(1) NOT NULL DEFAULT 0`);
            console.log('Added deleted_for_everyone');
        }

        await conn.end();
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
})();
