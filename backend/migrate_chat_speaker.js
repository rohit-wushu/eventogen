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

        const [col] = await conn.query("SHOW COLUMNS FROM messages LIKE 'speaker_id'");
        if (col.length === 0) {
            await conn.query(`ALTER TABLE messages ADD COLUMN speaker_id INT NULL,
                ADD FOREIGN KEY (speaker_id) REFERENCES speakers(id) ON DELETE SET NULL`);
            console.log('Added speaker_id');
        } else {
            console.log('speaker_id already exists');
        }

        await conn.end();
        process.exit(0);
    } catch (err) { console.error(err); process.exit(1); }
})();
