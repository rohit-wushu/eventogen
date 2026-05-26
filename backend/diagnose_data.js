const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const diagnose = async () => {
    try {
        const db = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME
        });

        console.log('Connected to database');

        const [events] = await db.query('SELECT COUNT(*) as count FROM events');
        const [speakers] = await db.query('SELECT COUNT(*) as count FROM speakers');
        const [partners] = await db.query('SELECT COUNT(*) as count FROM partners');
        const [agendas] = await db.query('SELECT COUNT(*) as count FROM agendas');
        const [users] = await db.query('SELECT COUNT(*) as count FROM users');

        console.log('--- Data Counts ---');
        console.log('Events:', events[0].count);
        console.log('Speakers:', speakers[0].count);
        console.log('Partners:', partners[0].count);
        console.log('Agendas:', agendas[0].count);
        console.log('Users:', users[0].count);

        await db.end();
        process.exit(0);
    } catch (error) {
        console.error('DIAGNOSTICS FAILED:', error.message);
        process.exit(1);
    }
};

diagnose();
