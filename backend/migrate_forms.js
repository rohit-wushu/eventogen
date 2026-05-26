const db = require('./config/db');

// Adds the form-builder feature (Typeform / Zoho Forms style):
//
//   forms              — the form itself (optionally tied to an event)
//   form_fields        — the questions inside a form, ordered by `sequence`
//   form_submissions   — each response, with all answers stashed in `data_json`
//
// Answers are kept in a single JSON column on form_submissions so we never
// need a schema migration when someone adds a new field to an existing form.
// Field definitions are preserved in form_fields forever (we soft-rely on the
// label stored there to render historical submissions).

const migrate = async () => {
    console.log('🚀 Starting Forms migration...');

    const tables = [
        {
            name: 'forms',
            ddl: `CREATE TABLE IF NOT EXISTS forms (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id INT NOT NULL,
                event_id INT NULL DEFAULT NULL,
                title VARCHAR(255) NOT NULL,
                description TEXT NULL,
                thank_you_message VARCHAR(500) NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_by INT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_forms_tenant (tenant_id),
                INDEX idx_forms_event (event_id)
            )`
        },
        {
            name: 'form_fields',
            ddl: `CREATE TABLE IF NOT EXISTS form_fields (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id INT NOT NULL,
                form_id INT NOT NULL,
                field_type VARCHAR(30) NOT NULL,
                label VARCHAR(255) NOT NULL,
                placeholder VARCHAR(255) NULL,
                required TINYINT(1) NOT NULL DEFAULT 0,
                options_json TEXT NULL,
                sequence INT NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_ff_tenant (tenant_id),
                INDEX idx_ff_form (form_id)
            )`
        },
        {
            name: 'form_submissions',
            ddl: `CREATE TABLE IF NOT EXISTS form_submissions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id INT NOT NULL,
                form_id INT NOT NULL,
                data_json LONGTEXT NOT NULL,
                submitter_ip VARCHAR(45) NULL,
                submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_fs_tenant (tenant_id),
                INDEX idx_fs_form (form_id)
            )`
        }
    ];

    for (const t of tables) {
        try {
            await db.query(t.ddl);
            console.log(`✅ Table '${t.name}' ready.`);
        } catch (err) {
            console.error(`❌ Error creating '${t.name}':`, err.message);
        }
    }

    console.log('✅ Forms migration complete!');
    process.exit();
};

migrate();
