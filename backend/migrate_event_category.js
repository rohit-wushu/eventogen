const db = require('./config/db');

// Adds a `category` column to events for grouping by type — Expo, Summit,
// Summit & Awards, Webinar, Souvenir, Roundtable, etc. Stored as VARCHAR so
// admins can add new categories in the UI without another migration.

const migrate = async () => {
    console.log('🚀 Starting Event Category Migration...');

    try {
        await db.query("ALTER TABLE events ADD COLUMN category VARCHAR(50) NULL");
        console.log("✅ Column 'category' added to 'events' table.");
    } catch (err) {
        if (err.errno === 1060) {
            console.log("ℹ️ Column 'category' already exists in 'events' table.");
        } else {
            console.error("❌ Error adding column 'category':", err.message);
        }
    }

    console.log('✅ Event Category Migration complete!');
    process.exit();
};

migrate();
