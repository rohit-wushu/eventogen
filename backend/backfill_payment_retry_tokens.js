const crypto = require('crypto');
const db = require('./config/db');

// One-shot backfill: every submission that went through the payment flow but
// is missing a retry token gets one. Runs for pending/failed/cancelled/paid —
// paid rows get a token too so the share link still resolves (the retry page
// simply shows "already paid" in that case).

const run = async () => {
    console.log('🚀 Backfilling payment_retry_token on existing submissions...');
    try {
        const [rows] = await db.query(
            `SELECT id FROM form_submissions
             WHERE payment_status IS NOT NULL
               AND (payment_retry_token IS NULL OR payment_retry_token = '')`
        );
        console.log(`   ${rows.length} rows need a token.`);
        for (const r of rows) {
            const tok = crypto.randomBytes(24).toString('hex');
            await db.query(
                'UPDATE form_submissions SET payment_retry_token = ? WHERE id = ?',
                [tok, r.id]
            );
        }
        console.log('✅ Backfill complete.');
    } catch (err) {
        console.error('❌', err.message);
    }
    process.exit();
};

run();
