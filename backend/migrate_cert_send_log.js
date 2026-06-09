const db = require('./config/db');

// Persistent log of certificate email send attempts. One row per attendee
// per click of "Send via Email" — captures sent/skipped/failed so operators
// can audit what went out, when, and to whom.
//
// We snapshot attendee_name + attendee_email at write time so the log
// remains readable even if the attendee row is later edited or deleted.
async function migrate() {
    try {
        console.log('Creating cert_send_log...');
        await db.query(`CREATE TABLE IF NOT EXISTS cert_send_log (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tenant_id INT NOT NULL,
            event_id INT,
            attendee_id INT,
            attendee_name VARCHAR(255),
            attendee_email VARCHAR(255),
            status ENUM('sent','skipped','failed') NOT NULL,
            reason VARCHAR(255),
            sent_by INT,
            sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_event_sent (event_id, sent_at),
            INDEX idx_tenant_sent (tenant_id, sent_at)
        )`);
        console.log('  ok: cert_send_log ready.');
        process.exit(0);
    } catch (err) {
        console.error('  fail:', err);
        process.exit(1);
    }
}

migrate();
