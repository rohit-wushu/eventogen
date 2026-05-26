const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const migrate = async () => {
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        console.log('Connected to database');

        // Create partner_categories table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS partner_categories (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('Table partner_categories created');

        // Check if category_id column exists in partners
        const [columns] = await connection.query('SHOW COLUMNS FROM partners LIKE "category_id"');
        if (columns.length === 0) {
            await connection.query(`
                ALTER TABLE partners 
                ADD COLUMN category_id INT,
                ADD FOREIGN KEY (category_id) REFERENCES partner_categories(id) ON DELETE SET NULL;
            `);
            console.log('Column category_id added to partners table');
        } else {
            console.log('Column category_id already exists in partners table');
        }

        await connection.end();
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
};

migrate();
