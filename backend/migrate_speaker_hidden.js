const db = require('./config/db');

// Adds `is_hidden` to speakers so admins can keep a speaker in the
// database (history, scheduling, internal use) without exposing them
// on the public marketing JSON. The public /api/public/speakers and
// nested speakers inside /api/public/agendas filter on this column;
// admin views still show all rows.

const migrate = async () => {
    console.log('🚀 Starting Speaker Hidden Migration...');

    try {
        await db.query(
            "ALTER TABLE speakers ADD COLUMN is_hidden TINYINT(1) NOT NULL DEFAULT 0"
        );
        console.log("✅ Column 'is_hidden' added to 'speakers' table.");
    } catch (err) {
        if (err.errno === 1060) {
            console.log("ℹ️ Column 'is_hidden' already exists.");
        } else {
            console.error("❌ Error adding column 'is_hidden':", err.message);
        }
    }

    console.log('✅ Speaker Hidden Migration complete!');
    process.exit();
};

migrate();
