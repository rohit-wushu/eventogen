const db = require('./config/db');

// Replaces the in-memory typing map with a tiny DB-backed table so the app
// works across multiple Node instances. Each row records that <sender_id>
// is typing to <recipient_id>; freshness is checked via updated_at instead
// of an explicit TTL (anything older than ~4s is treated as "stopped").

const migrate = async () => {
    console.log('🚀 Starting Chat Typing Migration...');

    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS chat_typing (
                sender_id INT NOT NULL,
                recipient_id INT NOT NULL,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (sender_id, recipient_id),
                INDEX idx_recipient_recent (recipient_id, updated_at)
            ) ENGINE=InnoDB
        `);
        console.log("✅ Table 'chat_typing' ready.");
    } catch (err) {
        console.error("❌ Error creating chat_typing:", err.message);
    }

    console.log('✅ Chat Typing Migration complete!');
    process.exit();
};

migrate();
