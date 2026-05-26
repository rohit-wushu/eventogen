/**
 * Invoices table — persists each successful payment so the Billing page can
 * render a receipt history and we have a paper trail for reconciliation.
 *
 * Safe to re-run.
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });
    console.log('Connected\n');

    await conn.query(`
        CREATE TABLE IF NOT EXISTS invoices (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tenant_id INT NOT NULL,
            subscription_id INT NULL,
            plan_id INT NOT NULL,
            plan_code VARCHAR(40) NOT NULL,
            plan_name VARCHAR(100) NOT NULL,
            amount_inr INT NOT NULL,
            currency VARCHAR(8) NOT NULL DEFAULT 'INR',
            status ENUM('paid','failed','refunded','stub') NOT NULL DEFAULT 'paid',
            razorpay_order_id VARCHAR(100) NULL,
            razorpay_payment_id VARCHAR(100) NULL,
            billing_name VARCHAR(150) NULL,
            billing_email VARCHAR(150) NULL,
            invoice_number VARCHAR(40) NOT NULL UNIQUE,
            period_start TIMESTAMP NULL,
            period_end TIMESTAMP NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
            FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE RESTRICT,
            INDEX idx_inv_tenant (tenant_id, created_at),
            INDEX idx_inv_payment (razorpay_payment_id)
        ) ENGINE=InnoDB;
    `);
    console.log('✓ invoices table ready');

    await conn.end();
    console.log('\n✓ Invoice migration complete.');
}

run().catch(err => { console.error('MIGRATION FAILED:', err); process.exit(1); });
