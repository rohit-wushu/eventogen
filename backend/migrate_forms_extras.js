const db = require('./config/db');

// Adds two convenience columns introduced after the initial forms release:
//
//   forms.submit_label        — custom label for the submit button
//                               (e.g. "Register", "Send", "RSVP")
//   form_fields.width         — 'full' or 'half'. Half-width fields pair
//                               up on a 2-column grid on the public page.
//
// Both are optional; existing rows default to "Submit" / "full".

const migrate = async () => {
    console.log('🚀 Starting Forms extras migration...');

    const alters = [
        ['forms', 'submit_label', `ALTER TABLE forms ADD COLUMN submit_label VARCHAR(100) NULL AFTER thank_you_message`],
        ['form_fields', 'width', `ALTER TABLE form_fields ADD COLUMN width VARCHAR(10) NOT NULL DEFAULT 'full' AFTER options_json`],
    ];

    for (const [table, col, sql] of alters) {
        try {
            await db.query(sql);
            console.log(`✅ Added '${col}' to '${table}'.`);
        } catch (err) {
            if (err.errno === 1060) {
                console.log(`ℹ️  Column '${col}' already exists on '${table}'.`);
            } else {
                console.error(`❌ Error adding '${col}' to '${table}':`, err.message);
            }
        }
    }

    console.log('✅ Forms extras migration complete!');
    process.exit();
};

migrate();
