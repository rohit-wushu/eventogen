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

        await connection.query(`
            CREATE TABLE IF NOT EXISTS award_categories (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                event_id INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
            );
        `);
        console.log('Table award_categories ready');

        // Add event_id column if upgrading from older schema
        const [cols] = await connection.query('SHOW COLUMNS FROM award_categories LIKE "event_id"');
        if (cols.length === 0) {
            await connection.query(`ALTER TABLE award_categories ADD COLUMN event_id INT, ADD FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE`);
            console.log('Added event_id to award_categories');
        }

        // Drop unique constraint on name alone if present; replace with composite
        try {
            await connection.query(`ALTER TABLE award_categories DROP INDEX name`);
            console.log('Dropped old unique index on name');
        } catch (e) { /* index may not exist */ }

        try {
            await connection.query(`ALTER TABLE award_categories ADD UNIQUE KEY uniq_name_event (name, event_id)`);
            console.log('Added composite unique (name, event_id)');
        } catch (e) { /* already exists */ }

        // Add parent_id for subcategory support
        const [parentCol] = await connection.query('SHOW COLUMNS FROM award_categories LIKE "parent_id"');
        if (parentCol.length === 0) {
            await connection.query(`ALTER TABLE award_categories ADD COLUMN parent_id INT NULL, ADD FOREIGN KEY (parent_id) REFERENCES award_categories(id) ON DELETE CASCADE`);
            console.log('Added parent_id to award_categories');
        }

        // Add company info columns to awards if missing
        const addAwardCol = async (col, ddl) => {
            const [exists] = await connection.query(`SHOW COLUMNS FROM awards LIKE '${col}'`);
            if (exists.length === 0) {
                await connection.query(`ALTER TABLE awards ADD COLUMN ${ddl}`);
                console.log(`Added ${col} to awards`);
            }
        };

        await connection.query(`
            CREATE TABLE IF NOT EXISTS awards (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                recipient_name VARCHAR(255) NOT NULL,
                description TEXT,
                photo_url VARCHAR(500),
                category_id INT,
                event_id INT,
                sequence INT DEFAULT 0,
                created_by INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (category_id) REFERENCES award_categories(id) ON DELETE SET NULL,
                FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
            );
        `);
        console.log('Table awards ready');

        await addAwardCol('company_name', 'company_name VARCHAR(255)');
        await addAwardCol('company_website', 'company_website VARCHAR(500)');
        await addAwardCol('company_logo_url', 'company_logo_url VARCHAR(500)');
        // Title was previously required; make it nullable since the category now acts as the award name
        try { await connection.query(`ALTER TABLE awards MODIFY COLUMN title VARCHAR(255) NULL`); } catch (e) {}

        await connection.end();
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
};

migrate();
