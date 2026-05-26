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
        const [rows] = await conn.query("SHOW COLUMNS FROM speakers LIKE 'sequence'");
        if (rows.length === 0) {
            await conn.query(`ALTER TABLE speakers ADD COLUMN sequence INT DEFAULT 0`);
            console.log('Added sequence to speakers');
            // seed existing rows with their current row order
            const [all] = await conn.query('SELECT id FROM speakers ORDER BY id ASC');
            let i = 1;
            for (const row of all) {
                await conn.query('UPDATE speakers SET sequence=? WHERE id=?', [i++, row.id]);
            }
            console.log(`Seeded sequence for ${all.length} speakers`);
        } else {
            console.log('sequence already exists on speakers');
        }
        await conn.end();
        process.exit(0);
    } catch (err) { console.error(err); process.exit(1); }
})();
