const db = require('./config/db');

// Widen forms.notify_email to hold multiple comma-separated recipient
// addresses (255 chars only fits ~5 emails; bumping to 1000 for headroom).
// Idempotent — re-running after success is a no-op.

const migrate = async () => {
    console.log('🚀 Widening forms.notify_email to VARCHAR(1000)...');
    try {
        await db.query(`ALTER TABLE forms MODIFY COLUMN notify_email VARCHAR(1000) NULL`);
        console.log('✅ forms.notify_email is now VARCHAR(1000).');
    } catch (err) {
        console.error('❌ Failed to widen forms.notify_email:', err.message);
    }
    process.exit();
};

migrate();
