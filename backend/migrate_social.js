const db = require('./config/db');

// Tables backing the multi-tenant social publishing feature.
//
//   social_accounts  — per-tenant LinkedIn / FB / IG / X connections.
//                      Tokens are stored encrypted (see utils/tokenCrypto.js);
//                      we never return them in API responses.
//
//   social_posts     — every post (draft / scheduled / posted / failed). The
//                      scheduling worker polls this table by status + time.
//
//   social_account_events — append-only audit log so admins can answer
//                      "who connected/disconnected/refreshed what and when".
//
// Multi-tenancy: every query in the new routes filters by tenant_id; the
// (tenant_id, …) indexes below keep those lookups index-only.
//
// Idempotent: re-running the migration is a no-op (uses CREATE TABLE IF
// NOT EXISTS + ALTER for forward-compatible column adds).

const migrate = async () => {
    console.log('🚀 Social tables migration starting…');

    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS social_accounts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id INT NOT NULL,
                platform ENUM('linkedin','facebook','instagram','twitter') NOT NULL,
                account_kind ENUM('personal','page','company') NOT NULL DEFAULT 'personal',
                account_external_id VARCHAR(191) NOT NULL,
                account_name VARCHAR(255) NOT NULL,
                account_handle VARCHAR(255) NULL,
                account_avatar_url TEXT NULL,
                access_token_enc TEXT NULL,
                refresh_token_enc TEXT NULL,
                token_expires_at TIMESTAMP NULL DEFAULT NULL,
                token_refresh_failures INT NOT NULL DEFAULT 0,
                scopes JSON NULL,
                account_meta JSON NULL,
                connected_by_user_id INT NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                last_used_at TIMESTAMP NULL DEFAULT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_sa_tenant_platform_active (tenant_id, platform, is_active),
                UNIQUE KEY uniq_sa_acct (tenant_id, platform, account_external_id)
            ) ENGINE=InnoDB
        `);
        console.log("✅ Table 'social_accounts' ready.");
    } catch (err) {
        console.error("❌ social_accounts:", err.message);
        process.exit(1);
    }

    // Forward-compat: add account_meta if upgrading from the original v1 schema.
    // FB Pages and IG Business Accounts need an extra JSON blob (page_id, ig_user_id, etc.)
    // alongside the standard fields. The CREATE above already includes it for fresh installs;
    // this ALTER handles existing rows. Swallow the "Duplicate column" error since both
    // paths are valid.
    try {
        await db.query(`ALTER TABLE social_accounts ADD COLUMN account_meta JSON NULL AFTER scopes`);
        console.log("✅ Added 'account_meta' column to existing social_accounts.");
    } catch (err) {
        if (err.code === 'ER_DUP_FIELDNAME') {
            console.log("ℹ️  Column 'account_meta' already present.");
        } else {
            console.warn("⚠️  account_meta ALTER:", err.message);
        }
    }

    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS social_posts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id INT NOT NULL,
                social_account_id INT NOT NULL,
                speaker_id INT NULL,
                caption TEXT NULL,
                image_url TEXT NULL,
                mentions JSON NULL,
                photo_tags JSON NULL,
                scheduled_for TIMESTAMP NULL DEFAULT NULL,
                posted_at TIMESTAMP NULL DEFAULT NULL,
                platform_post_id VARCHAR(191) NULL,
                platform_post_url TEXT NULL,
                status ENUM('draft','scheduled','posting','posted','failed','cancelled') NOT NULL DEFAULT 'draft',
                error_message TEXT NULL,
                retry_count INT NOT NULL DEFAULT 0,
                created_by_user_id INT NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_sp_tenant_status (tenant_id, status, scheduled_for),
                INDEX idx_sp_worker (status, scheduled_for)
            ) ENGINE=InnoDB
        `);
        console.log("✅ Table 'social_posts' ready.");
    } catch (err) {
        console.error("❌ social_posts:", err.message);
        process.exit(1);
    }

    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS social_account_events (
                id INT AUTO_INCREMENT PRIMARY KEY,
                tenant_id INT NOT NULL,
                social_account_id INT NULL,
                event ENUM('connected','disconnected','token_refreshed','token_expired','post_failed') NOT NULL,
                user_id INT NULL,
                platform VARCHAR(32) NOT NULL,
                account_name VARCHAR(255) NULL,
                metadata JSON NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_sae_tenant_event (tenant_id, event, created_at)
            ) ENGINE=InnoDB
        `);
        console.log("✅ Table 'social_account_events' ready.");
    } catch (err) {
        console.error("❌ social_account_events:", err.message);
        process.exit(1);
    }

    console.log('✅ Social tables migration complete!');
    process.exit();
};

migrate();
