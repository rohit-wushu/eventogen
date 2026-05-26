const db = require('./config/db');

// Per-tenant SMTP config. Same pattern as tenant_payment_gateways — one row
// per tenant, password stored AES-GCM encrypted. `is_active` lets an admin
// temporarily disable sends without wiping credentials.

const migrate = async () => {
    console.log('🚀 Creating tenant_smtp_settings...');
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS tenant_smtp_settings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id INT NOT NULL,
                host VARCHAR(255) NULL,
                port INT NULL,
                secure TINYINT(1) NOT NULL DEFAULT 0,
                username VARCHAR(255) NULL,
                password_encrypted TEXT NULL,
                from_name VARCHAR(255) NULL,
                from_email VARCHAR(255) NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uq_tenant_smtp (tenant_id)
            )
        `);
        console.log('✅ tenant_smtp_settings ready.');
    } catch (err) { console.error('❌', err.message); }
    process.exit();
};

migrate();
