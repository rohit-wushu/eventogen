const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const createDatabase = async () => {
    try {
        // Connect without database selected
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD
        });

        console.log('Connected to MySQL server');

        await connection.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`);
        console.log(`Database ${process.env.DB_NAME} created or already exists`);

        await connection.end();

        // Connect to the database
        const db = await mysql.createPool({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        // Create Tables
        const tables = [
            `CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                role ENUM('admin', 'manager', 'employee') DEFAULT 'employee',
                assigned_event_id INT NULL DEFAULT NULL,
                assigned_task TEXT NULL DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS events (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                start_date DATETIME,
                end_date DATETIME,
                venue VARCHAR(255),
                status ENUM('upcoming', 'ongoing', 'completed', 'canceled') DEFAULT 'upcoming',
                created_by INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            )`,
            `CREATE TABLE IF NOT EXISTS speakers (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                bio TEXT,
                photo_url VARCHAR(255),
                designation VARCHAR(255),
                company VARCHAR(255),
                email VARCHAR(255),
                role VARCHAR(255),
                event_id INT,
                FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
            )`,
            `CREATE TABLE IF NOT EXISTS partner_categories (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS partners (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                website VARCHAR(255),
                logo_url VARCHAR(255),
                category_id INT,
                event_id INT,
                FOREIGN KEY (category_id) REFERENCES partner_categories(id) ON DELETE SET NULL,
                FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
            )`,
            `CREATE TABLE IF NOT EXISTS agendas (
                id INT AUTO_INCREMENT PRIMARY KEY,
                event_id INT NOT NULL,
                day_number INT DEFAULT 1,
                start_time TIME,
                end_time TIME,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
            )`,
            `CREATE TABLE IF NOT EXISTS agenda_speakers (
                agenda_id INT,
                speaker_id INT,
                PRIMARY KEY (agenda_id, speaker_id),
                FOREIGN KEY (agenda_id) REFERENCES agendas(id) ON DELETE CASCADE,
                FOREIGN KEY (speaker_id) REFERENCES speakers(id) ON DELETE CASCADE
            )`,
            `CREATE TABLE IF NOT EXISTS invitations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                role ENUM('admin', 'manager', 'employee') NOT NULL,
                token VARCHAR(255) UNIQUE NOT NULL,
                created_by INT,
                event_id INT NULL DEFAULT NULL,
                assigned_task TEXT NULL DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NULL,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            )`,
            `CREATE TABLE IF NOT EXISTS attendees (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255),
                phone VARCHAR(50),
                company VARCHAR(255),
                designation VARCHAR(255),
                ticket_type ENUM('general','vip','speaker','sponsor','premium','gov','non-gov') DEFAULT 'general',
                status ENUM('registered','confirmed','checked_in','cancelled') DEFAULT 'registered',
                event_id INT,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
            )`,
            `CREATE TABLE IF NOT EXISTS speaker_travel (
                id INT AUTO_INCREMENT PRIMARY KEY,
                speaker_id INT NOT NULL,
                travel_type ENUM('flight','hotel','cab','train','other') NOT NULL,
                title VARCHAR(255),
                details TEXT,
                from_location VARCHAR(255),
                to_location VARCHAR(255),
                departure_date DATETIME, arrival_date DATETIME,
                booking_ref VARCHAR(255),
                cost DECIMAL(10,2) DEFAULT 0,
                currency VARCHAR(10) DEFAULT 'INR',
                status ENUM('pending','booked','confirmed','cancelled') DEFAULT 'pending',
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (speaker_id) REFERENCES speakers(id) ON DELETE CASCADE
            )`,
            `CREATE TABLE IF NOT EXISTS settings (
                setting_key VARCHAR(255) PRIMARY KEY,
                setting_value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )`
        ];

        for (const query of tables) {
            await db.query(query);
        }
        console.log('All tables verified/created successfully');

        // Handle existing table column updates
        const alterUserQueries = [
            'ALTER TABLE users ADD COLUMN assigned_event_id INT NULL DEFAULT NULL',
            'ALTER TABLE users ADD COLUMN assigned_task TEXT NULL DEFAULT NULL',
            'ALTER TABLE users ADD COLUMN reset_token VARCHAR(255) NULL DEFAULT NULL',
            'ALTER TABLE users ADD COLUMN reset_token_expires DATETIME NULL DEFAULT NULL'
        ];

        for (const q of alterUserQueries) {
            try { await db.query(q); console.log(`Executed: ${q}`); } catch (e) {}
        }

        const alterSpeakerQueries = [
            'ALTER TABLE speakers ADD COLUMN salutation VARCHAR(50) AFTER name',
            'ALTER TABLE speakers ADD COLUMN office_no VARCHAR(50) AFTER email',
            'ALTER TABLE speakers ADD COLUMN category VARCHAR(100) AFTER mobile_no',
            'ALTER TABLE speakers ADD COLUMN spokesperson_name VARCHAR(255) AFTER category',
            'ALTER TABLE speakers ADD COLUMN sns_card_url VARCHAR(255) AFTER event_id',
            'ALTER TABLE speakers ADD COLUMN topic TEXT AFTER sns_card_url',
            'ALTER TABLE speakers ADD COLUMN panel VARCHAR(255) AFTER topic',
            'ALTER TABLE speakers ADD COLUMN linkedin_url VARCHAR(255) AFTER panel',
            'ALTER TABLE speakers ADD COLUMN created_by INT AFTER linkedin_url',
            'ALTER TABLE speakers ADD COLUMN location VARCHAR(255) AFTER company'
        ];

        for (const q of alterSpeakerQueries) {
            try { await db.query(q); console.log(`Executed: ${q}`); } catch (e) {}
        }

        const alterEventQueries = [
            'ALTER TABLE events ADD COLUMN agenda_export_settings LONGTEXT NULL'
        ];

        for (const q of alterEventQueries) {
            try { await db.query(q); console.log(`Executed: ${q}`); } catch (e) {}
        }

        const alterAttendeeQueries = [
            "ALTER TABLE attendees MODIFY COLUMN ticket_type ENUM('general','vip','speaker','sponsor','premium','gov','non-gov') DEFAULT 'general'"
        ];

        for (const q of alterAttendeeQueries) {
            try { await db.query(q); console.log(`Executed: ${q}`); } catch (e) {}
        }

        // Seed Admin User
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', ['admin@example.com']);
        if (users.length === 0) {
            const bcrypt = require('bcryptjs');
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash('admin123', salt);
            await db.query('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
                ['Admin User', 'admin@example.com', hashedPassword, 'admin']);
            console.log('Default Admin User Created: admin@example.com / admin123');
        } else {
            console.log('Admin user already exists');
        }

        process.exit();
    } catch (error) {
        console.error('Error setting up database:', error);
        process.exit(1);
    }
};

createDatabase();
