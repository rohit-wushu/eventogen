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
        const [rows] = await conn.query("SHOW COLUMNS FROM users LIKE 'profile_photo_url'");
        if (rows.length === 0) {
            await conn.query(`ALTER TABLE users ADD COLUMN profile_photo_url VARCHAR(500) NULL`);
            console.log('Added profile_photo_url');
        } else {
            console.log('profile_photo_url already exists');
        }
        await conn.end();
        process.exit(0);
    } catch (err) { console.error(err); process.exit(1); }
})();
