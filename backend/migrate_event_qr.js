const db = require('./config/db');

// Adds a `qr_config` column to events so the QR designer can persist
// the user's chosen look (preset, colours, shape styles, logo, etc.)
// and re-render it the next time they open the QR page.
//
// Uses MEDIUMTEXT so a base64-encoded logo can safely travel inside
// the config blob (MySQL TEXT caps at ~65 KB which is below most
// logos; MEDIUMTEXT gives us ~16 MB of headroom).

const migrate = async () => {
    console.log('🚀 Starting Event QR Config Migration...');

    // Step 1 — add the column if it's missing.
    try {
        await db.query('ALTER TABLE events ADD COLUMN qr_config MEDIUMTEXT NULL');
        console.log("✅ Column 'qr_config' added to 'events' table.");
    } catch (err) {
        if (err.errno === 1060) {
            console.log("ℹ️ Column 'qr_config' already exists — widening to MEDIUMTEXT in case it was created as TEXT.");
            try {
                await db.query('ALTER TABLE events MODIFY COLUMN qr_config MEDIUMTEXT NULL');
                console.log("✅ Column 'qr_config' widened to MEDIUMTEXT.");
            } catch (err2) {
                console.error("❌ Could not widen qr_config:", err2.message);
            }
        } else {
            console.error("❌ Error adding column 'qr_config':", err.message);
        }
    }

    console.log('✅ Event QR Config Migration complete!');
    process.exit();
};

migrate();
