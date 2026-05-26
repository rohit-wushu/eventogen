const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const migrate = async () => {
    try {
        const db = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        console.log('Connected to database');

        // 1. Create agenda_speakers join table
        await db.query(`
            CREATE TABLE IF NOT EXISTS agenda_speakers (
                agenda_id INT,
                speaker_id INT,
                PRIMARY KEY (agenda_id, speaker_id),
                FOREIGN KEY (agenda_id) REFERENCES agendas(id) ON DELETE CASCADE,
                FOREIGN KEY (speaker_id) REFERENCES speakers(id) ON DELETE CASCADE
            )
        `);
        console.log('Created agenda_speakers table');

        // 2. Migrate existing data
        const [agendas] = await db.query('SELECT id, speaker_id FROM agendas WHERE speaker_id IS NOT NULL');
        for (const agenda of agendas) {
            await db.query('INSERT IGNORE INTO agenda_speakers (agenda_id, speaker_id) VALUES (?, ?)', [agenda.id, agenda.speaker_id]);
        }
        console.log(`Migrated ${agendas.length} speakers to agenda_speakers`);

        // 3. Drop speaker_id and location columns
        try {
            await db.query('ALTER TABLE agendas DROP FOREIGN KEY agendas_ibfk_2'); // Adjust constraint name if different
        } catch (e) {
            console.log('Foreign key agendas_ibfk_2 not found or already dropped');
        }

        try {
            await db.query('ALTER TABLE agendas DROP COLUMN speaker_id');
            console.log('Dropped speaker_id column');
        } catch (e) {
            console.log('speaker_id column already dropped');
        }

        try {
            await db.query('ALTER TABLE agendas DROP COLUMN location');
            console.log('Dropped location column');
        } catch (e) {
            console.log('location column already dropped');
        }

        await db.end();
        console.log('Migration complete');
        process.exit(0);
    } catch (error) {
        console.error('MIGRATION FAILED:', error.message);
        process.exit(1);
    }
};

migrate();
