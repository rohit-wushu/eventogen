const db = require('./config/db');

// Adds a random, unguessable token to every submission so we can surface a
// public "retry this payment" link the admin can send to a visitor whose
// payment failed or was cancelled. Older rows stay NULL — the retry UX only
// applies to attempts created after this migration runs.

const migrate = async () => {
    console.log('🚀 Adding payment_retry_token to form_submissions...');
    try {
        await db.query(
            `ALTER TABLE form_submissions
             ADD COLUMN payment_retry_token VARCHAR(64) NULL AFTER payment_tier_label,
             ADD UNIQUE KEY uq_fs_retry_token (payment_retry_token)`
        );
        console.log('✅ payment_retry_token added.');
    } catch (err) {
        if (err.errno === 1060 || err.errno === 1061) console.log('ℹ️  payment_retry_token already present.');
        else console.error('❌', err.message);
    }
    process.exit();
};

migrate();
