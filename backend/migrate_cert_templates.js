require('dotenv').config();
const db = require('./config/db');

async function migrate() {
    try {
        console.log('Creating cert_templates table...');
        await db.query(`
            CREATE TABLE IF NOT EXISTS cert_templates (
                id INT PRIMARY KEY AUTO_INCREMENT,
                tenant_id INT NOT NULL,
                event_id INT NOT NULL,
                name VARCHAR(160) NOT NULL,
                bg_image_url VARCHAR(500) NULL,
                canvas_width INT NOT NULL DEFAULT 1200,
                canvas_height INT NOT NULL DEFAULT 850,
                elements_json LONGTEXT NULL,
                created_by INT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_cert_templates_tenant_event (tenant_id, event_id),
                INDEX idx_cert_templates_event (event_id)
            )
        `);
        console.log('  + cert_templates table');
        console.log('Done.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err.message);
        process.exit(1);
    }
}

migrate();
