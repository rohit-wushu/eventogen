const db = require('./config/db');

// Payment feature migration — idempotent.
//
// Adds:
//   tenant_payment_gateways  one row per (tenant, gateway). Holds encrypted keys.
//   forms.payment_*          per-form toggle + mode + tier definition
//   form_submissions.payment_*  records of the payment tied to each submission

const migrate = async () => {
    console.log('🚀 Starting Payments migration...');

    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS tenant_payment_gateways (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id INT NOT NULL,
                gateway VARCHAR(50) NOT NULL DEFAULT 'razorpay',
                key_id VARCHAR(255) NULL,
                key_secret_encrypted TEXT NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_tenant_gateway (tenant_id, gateway)
            )
        `);
        console.log('✅ tenant_payment_gateways ready.');
    } catch (err) { console.error('❌ gateways table:', err.message); }

    const alters = [
        ['forms', 'payment_enabled',     `ALTER TABLE forms ADD COLUMN payment_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER close_at`],
        ['forms', 'payment_mode',        `ALTER TABLE forms ADD COLUMN payment_mode VARCHAR(20) NULL AFTER payment_enabled`],
        ['forms', 'payment_amount',      `ALTER TABLE forms ADD COLUMN payment_amount INT NULL AFTER payment_mode`],
        ['forms', 'payment_currency',    `ALTER TABLE forms ADD COLUMN payment_currency VARCHAR(10) NULL DEFAULT 'INR' AFTER payment_amount`],
        ['forms', 'payment_tiers_json',  `ALTER TABLE forms ADD COLUMN payment_tiers_json TEXT NULL AFTER payment_currency`],
        ['forms', 'payment_description', `ALTER TABLE forms ADD COLUMN payment_description VARCHAR(500) NULL AFTER payment_tiers_json`],

        ['form_submissions', 'payment_status',     `ALTER TABLE form_submissions ADD COLUMN payment_status VARCHAR(20) NULL AFTER data_json`],
        ['form_submissions', 'payment_id',         `ALTER TABLE form_submissions ADD COLUMN payment_id VARCHAR(100) NULL AFTER payment_status`],
        ['form_submissions', 'payment_order_id',   `ALTER TABLE form_submissions ADD COLUMN payment_order_id VARCHAR(100) NULL AFTER payment_id`],
        ['form_submissions', 'payment_amount',     `ALTER TABLE form_submissions ADD COLUMN payment_amount INT NULL AFTER payment_order_id`],
        ['form_submissions', 'payment_currency',   `ALTER TABLE form_submissions ADD COLUMN payment_currency VARCHAR(10) NULL AFTER payment_amount`],
        ['form_submissions', 'payment_tier_label', `ALTER TABLE form_submissions ADD COLUMN payment_tier_label VARCHAR(255) NULL AFTER payment_currency`],
    ];

    for (const [table, col, sql] of alters) {
        try {
            await db.query(sql);
            console.log(`✅ Added '${col}' to '${table}'.`);
        } catch (err) {
            if (err.errno === 1060) console.log(`ℹ️  '${col}' on '${table}' exists.`);
            else console.error(`❌ ${table}.${col}:`, err.message);
        }
    }

    console.log('✅ Payments migration done.');
    process.exit();
};

migrate();
