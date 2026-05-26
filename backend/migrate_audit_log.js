/**
 * Audit log — durable history of who did what.
 * Separate migration so it's easy to read/drop independently from the main schema.
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });
    await conn.query(`
        CREATE TABLE IF NOT EXISTS audit_log (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            tenant_id INT NOT NULL,
            actor_user_id INT NULL,
            actor_name VARCHAR(255) NULL,
            actor_role VARCHAR(40) NULL,
            action VARCHAR(80) NOT NULL,
            resource_type VARCHAR(40) NOT NULL,
            resource_id VARCHAR(80) NULL,
            meta JSON NULL,
            ip VARCHAR(64) NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_audit_tenant_created (tenant_id, created_at),
            INDEX idx_audit_actor (actor_user_id),
            INDEX idx_audit_resource (tenant_id, resource_type, resource_id),
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        ) ENGINE=InnoDB;
    `);
    console.log('audit_log ready');
    await conn.end();
})().catch(err => { console.error(err); process.exit(1); });
