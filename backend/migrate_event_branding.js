const db = require('./config/db');

const migrate = async () => {
    console.log('🚀 Starting Event Branding Migration...');

    const columns = [
        ['primary_color', 'VARCHAR(10) NULL'],
        ['secondary_color', 'VARCHAR(10) NULL'],
        ['accent_color', 'VARCHAR(10) NULL'],
        ['font_family', 'VARCHAR(50) NULL'],
        ['event_logo_url', 'VARCHAR(255) NULL'],
        ['company_logo_url', 'VARCHAR(255) NULL'],
        ['is_branding_locked', 'BOOLEAN DEFAULT FALSE']
    ];

    for (const [col, definition] of columns) {
        try {
            await db.query(`ALTER TABLE events ADD COLUMN ${col} ${definition}`);
            console.log(`✅ Column '${col}' added to 'events' table.`);
        } catch (err) {
            if (err.errno === 1060) {
                console.log(`ℹ️ Column '${col}' already exists in 'events' table.`);
            } else {
                console.error(`❌ Error adding column '${col}':`, err.message);
            }
        }
    }

    console.log('✅ Event Branding Migration complete!');
    process.exit();
};

migrate();
