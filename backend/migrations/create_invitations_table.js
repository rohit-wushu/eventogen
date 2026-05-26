const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const migrate = async () => {
    try {
        const db = await mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        console.log('Connected to Database. Creating invitations table...');

        const query = `
            CREATE TABLE IF NOT EXISTS invitations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                role ENUM('admin', 'manager', 'employee') NOT NULL,
                token VARCHAR(255) UNIQUE NOT NULL,
                created_by INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NULL,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            )
        `;

        await db.query(query);
        console.log('invitations table created successfully!');

        process.exit(0);
    } catch (error) {
        console.error('Error creating invitations table:', error);
        process.exit(1);
    }
};

migrate();
