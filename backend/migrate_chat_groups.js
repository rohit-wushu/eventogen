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
            CREATE TABLE IF NOT EXISTS chat_groups (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                event_id INT,
                created_by INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
            );
        `);
        console.log('Table chat_groups ready');

        await conn.query(`
            CREATE TABLE IF NOT EXISTS chat_group_members (
                group_id INT NOT NULL,
                user_id INT NOT NULL,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (group_id, user_id),
                FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        `);
        console.log('Table chat_group_members ready');

        await conn.query(`
            CREATE TABLE IF NOT EXISTS chat_group_reads (
                group_id INT NOT NULL,
                user_id INT NOT NULL,
                last_read_at TIMESTAMP NULL,
                PRIMARY KEY (group_id, user_id),
                FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        `);
        console.log('Table chat_group_reads ready');

        // Add group_id to messages and relax recipient_id for group messages
        const [cols] = await conn.query("SHOW COLUMNS FROM messages LIKE 'group_id'");
        if (cols.length === 0) {
            await conn.query(`ALTER TABLE messages ADD COLUMN group_id INT NULL, ADD FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE`);
            console.log('Added group_id to messages');
        }
        try { await conn.query(`ALTER TABLE messages MODIFY COLUMN recipient_id INT NULL`); } catch (e) {}
        try { await conn.query(`ALTER TABLE messages ADD INDEX idx_group_created (group_id, created_at)`); } catch (e) {}

        await conn.end();
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
})();
