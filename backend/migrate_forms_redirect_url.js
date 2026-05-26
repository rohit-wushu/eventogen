const db = require('./config/db');

// Adds forms.redirect_url — if set, the public (and exported) form redirects
// the visitor to this URL a moment after successful submission instead of
// stopping at the thank-you message. Idempotent.

const migrate = async () => {
    console.log('🚀 Adding forms.redirect_url...');
    try {
        await db.query(`ALTER TABLE forms ADD COLUMN redirect_url VARCHAR(500) NULL AFTER thank_you_message`);
        console.log('✅ Added redirect_url column.');
    } catch (err) {
        if (err.errno === 1060) console.log('ℹ️  redirect_url already exists.');
        else console.error('❌ Failed:', err.message);
    }
    process.exit();
};

migrate();
