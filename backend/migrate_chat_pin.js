const db = require('./config/db');

// Adds `is_pinned` + `pinned_at` to messages so participants in a chat
// (1-1 DM or group) can pin a message to the top of the thread and
// everyone in that chat sees it. We pin at the message level rather than
// via a junction table so the pin is conversation-global — the whole
// group / both DM parties see the same pin — which matches how Slack and
// Teams handle it.

const migrate = async () => {
    console.log('🚀 Starting Chat Pin Migration...');

    const columns = [
        ['is_pinned', 'TINYINT(1) NOT NULL DEFAULT 0'],
        ['pinned_at', 'TIMESTAMP NULL DEFAULT NULL']
    ];

    for (const [col, def] of columns) {
        try {
            await db.query(`ALTER TABLE messages ADD COLUMN ${col} ${def}`);
            console.log(`✅ Column '${col}' added to 'messages' table.`);
        } catch (err) {
            if (err.errno === 1060) {
                console.log(`ℹ️ Column '${col}' already exists.`);
            } else {
                console.error(`❌ Error adding column '${col}':`, err.message);
            }
        }
    }

    // Index speeds up "fetch pinned messages for this conversation" queries.
    try {
        await db.query('CREATE INDEX idx_messages_pinned ON messages (is_pinned, pinned_at)');
        console.log("✅ Index 'idx_messages_pinned' added.");
    } catch (err) {
        if (err.errno === 1061) {
            console.log("ℹ️ Index 'idx_messages_pinned' already exists.");
        } else {
            console.error("❌ Error creating pin index:", err.message);
        }
    }

    console.log('✅ Chat Pin Migration complete!');
    process.exit();
};

migrate();
