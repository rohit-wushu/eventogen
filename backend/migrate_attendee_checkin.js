const crypto = require('crypto');
const db = require('./config/db');

// On-site check-in (Phase 1).
//
// Adds three columns to `attendees` so each delegate gets a unique QR
// payload, and we can record when/who scanned them in:
//
//   checkin_token   — random URL-safe string, the QR's content. Unique per
//                     tenant so two tenants can't collide accidentally.
//   checked_in_at   — first successful scan time. NULL means not present.
//   checked_in_by   — user.id of the staff who scanned. NULL means unknown
//                     (eg backfilled rows).
//
// Backfills `checkin_token` for every existing attendee so old rows can
// also be scanned/emailed without needing to be edited first.
//
// Idempotent: errno 1060 = "Duplicate column name" is treated as "already
// applied" so the script is safe to re-run.

const genToken = () => crypto.randomBytes(16).toString('hex'); // 32 hex chars

const addColumn = async (sql, label) => {
    try {
        await db.query(sql);
        console.log(`✅ ${label}`);
    } catch (err) {
        if (err.errno === 1060) {
            console.log(`ℹ️  ${label} already exists — skipping.`);
        } else {
            throw err;
        }
    }
};

const migrate = async () => {
    console.log('🚀 Starting attendee check-in migration...');

    await addColumn(
        "ALTER TABLE attendees ADD COLUMN checkin_token VARCHAR(40) NULL",
        "Added 'checkin_token' to attendees"
    );
    await addColumn(
        "ALTER TABLE attendees ADD COLUMN checked_in_at DATETIME NULL",
        "Added 'checked_in_at' to attendees"
    );
    await addColumn(
        "ALTER TABLE attendees ADD COLUMN checked_in_by INT NULL",
        "Added 'checked_in_by' to attendees"
    );

    // Unique index on (tenant_id, checkin_token). Per-tenant so two tenants
    // can't collide. Catch the "already exists" error to stay idempotent.
    try {
        await db.query(
            "ALTER TABLE attendees ADD UNIQUE KEY uniq_attendee_checkin_token (tenant_id, checkin_token)"
        );
        console.log("✅ Added unique index on (tenant_id, checkin_token).");
    } catch (err) {
        if (err.errno === 1061 || err.errno === 1062) {
            console.log("ℹ️  Unique index already present — skipping.");
        } else {
            throw err;
        }
    }

    // Backfill tokens for any existing row that doesn't have one yet.
    const [rows] = await db.query(
        "SELECT id FROM attendees WHERE checkin_token IS NULL"
    );
    if (rows.length === 0) {
        console.log('ℹ️  No rows to backfill — every attendee already has a token.');
    } else {
        console.log(`🔧 Backfilling check-in tokens for ${rows.length} attendees…`);
        for (const r of rows) {
            // One row at a time so a rare collision (1 in 2^128) only retries
            // that single row instead of nuking the whole batch.
            let attempts = 0;
            while (attempts < 3) {
                try {
                    await db.query(
                        'UPDATE attendees SET checkin_token = ? WHERE id = ? AND checkin_token IS NULL',
                        [genToken(), r.id]
                    );
                    break;
                } catch (err) {
                    if (err.errno === 1062 && attempts < 2) {
                        attempts += 1;
                        continue; // re-roll the token
                    }
                    throw err;
                }
            }
        }
        console.log('✅ Backfill complete.');
    }

    console.log('✅ Attendee check-in migration done.');
    process.exit();
};

migrate().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
