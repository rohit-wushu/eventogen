const mysql = require('mysql2/promise');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const migrate = async () => {
    let connection;
    try {
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        console.log('Connected to database. Running migration...');

        // Attendees table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS attendees (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255),
                phone VARCHAR(50),
                company VARCHAR(255),
                designation VARCHAR(255),
                ticket_type ENUM('general','vip','speaker','sponsor') DEFAULT 'general',
                status ENUM('registered','confirmed','checked_in','cancelled') DEFAULT 'registered',
                event_id INT,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL
            )
        `);
        console.log('✅ attendees table created');

        // Speaker Travel table
        await connection.query(`
            CREATE TABLE IF NOT EXISTS speaker_travel (
                id INT AUTO_INCREMENT PRIMARY KEY,
                speaker_id INT NOT NULL,
                travel_type ENUM('flight','hotel','cab','train','other') NOT NULL,
                title VARCHAR(255),
                details TEXT,
                from_location VARCHAR(255),
                to_location VARCHAR(255),
                departure_date DATETIME,
                arrival_date DATETIME,
                booking_ref VARCHAR(255),
                cost DECIMAL(10,2) DEFAULT 0,
                currency VARCHAR(10) DEFAULT 'INR',
                status ENUM('pending','booked','confirmed','cancelled') DEFAULT 'pending',
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (speaker_id) REFERENCES speakers(id) ON DELETE CASCADE
            )
        `);
        console.log('✅ speaker_travel table created');

        console.log('\n🎉 Migration completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    }
};

migrate();
