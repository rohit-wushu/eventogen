const mysql = require('mysql2');
const dotenv = require('dotenv');

dotenv.config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    // Raised from 10 to handle bursty polling traffic (chat + notifications
    // + announcements). queueLimit caps the backlog so the process fails
    // fast under sustained overload instead of growing memory unbounded.
    connectionLimit: 20,
    queueLimit: 50
});

module.exports = pool.promise();
