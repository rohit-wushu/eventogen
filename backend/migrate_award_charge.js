const db = require('./config/db');

// Adds award_categories.amount — per-category nomination fee used when a form
// has an award_category field and payment_mode='award_category'. Stored as
// DECIMAL so we can hold fractional currency values (paise-level) in the
// presentation unit. Nullable: null means "no fee at this level, fall back to
// parent". Idempotent.
//
// The hierarchy now supports up to 3 levels (Sector → Category → Subcategory).
// We don't need a DB change for that — the existing self-referencing
// parent_id already allows arbitrary depth; only the application-level check
// in awardCategoryRoutes.js needs relaxing.

const migrate = async () => {
    console.log('🚀 Adding award_categories.amount...');
    try {
        await db.query(`ALTER TABLE award_categories ADD COLUMN amount DECIMAL(10,2) NULL AFTER parent_id`);
        console.log('✅ Added amount column.');
    } catch (err) {
        if (err.errno === 1060) console.log('ℹ️  amount already exists.');
        else console.error('❌ Failed:', err.message);
    }
    process.exit();
};

migrate();
