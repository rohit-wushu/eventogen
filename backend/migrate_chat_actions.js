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

        const [col] = await conn.query("SHOW COLUMNS FROM messages LIKE 'reply_to_id'");
        if (col.length === 0) {
            await conn.query(`ALTER TABLE messages ADD COLUMN reply_to_id INT NULL,
                ADD FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL`);
            console.log('Added reply_to_id');
        }

        await conn.query(`
            CREATE TABLE IF NOT EXISTS message_reactions (
                message_id INT NOT NULL,
                user_id INT NOT NULL,
                emoji VARCHAR(16) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (message_id, user_id, emoji),
                FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        `);
        console.log('Table message_reactions ready');

        await conn.end();
        process.exit(0);
    } catch (err) { console.error(err); process.exit(1); }
})();
