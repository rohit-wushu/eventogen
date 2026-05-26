const db = require('./config/db');

// Adds `message_type` to messages so the chat can distinguish normal
// user messages from bot-generated report cards (triggered by @report
// inside a group). Bot messages reuse the same row shape but the body
// holds a JSON-encoded report payload that the frontend renders as a
// structured card instead of plain text.

const migrate = async () => {
    console.log('🚀 Starting Chat Report Migration...');

    try {
        await db.query(
            "ALTER TABLE messages ADD COLUMN message_type ENUM('user','bot_report') NOT NULL DEFAULT 'user'"
        );
        console.log("✅ Column 'message_type' added to 'messages' table.");
    } catch (err) {
        if (err.errno === 1060) {
            console.log("ℹ️ Column 'message_type' already exists.");
        } else {
            console.error("❌ Error adding column 'message_type':", err.message);
        }
    }

    console.log('✅ Chat Report Migration complete!');
    process.exit();
};

migrate();
