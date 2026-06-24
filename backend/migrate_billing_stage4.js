/**
 * Stage 4 billing migration.
 *
 * Creates plans + subscriptions tables, seeds three default plans (Free / Pro /
 * Enterprise), links the existing tenants row's `plan` varchar to a real FK.
 *
 * Safe to re-run. Razorpay plan_ids default to NULL — fill them later in the
 * Razorpay dashboard and update via `UPDATE plans SET razorpay_plan_id = ?`.
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

    // 1. plans — the price book. Quantities are per-tenant monthly limits.
    await conn.query(`
        CREATE TABLE IF NOT EXISTS plans (
            id INT AUTO_INCREMENT PRIMARY KEY,
            code VARCHAR(40) NOT NULL UNIQUE,
            name VARCHAR(100) NOT NULL,
            price_inr INT NOT NULL DEFAULT 0,
            billing_cycle ENUM('monthly', 'yearly') NOT NULL DEFAULT 'monthly',
            razorpay_plan_id VARCHAR(100) NULL,
            max_events INT NOT NULL DEFAULT 1,
            max_speakers INT NOT NULL DEFAULT 50,
            max_attendees INT NOT NULL DEFAULT 200,
            max_users INT NOT NULL DEFAULT 3,
            features JSON NULL,
            is_public TINYINT(1) NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB;
    `);
    console.log('✓ plans table ready');

    // 2. subscriptions — 1:1 with tenants in practice but modelled as a separate
    // row so we can keep full history when a tenant upgrades/cancels.
    await conn.query(`
        CREATE TABLE IF NOT EXISTS subscriptions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            tenant_id INT NOT NULL,
            plan_id INT NOT NULL,
            razorpay_subscription_id VARCHAR(100) NULL,
            status ENUM('trial','active','past_due','cancelled','expired') NOT NULL DEFAULT 'trial',
            current_period_start TIMESTAMP NULL,
            current_period_end TIMESTAMP NULL,
            cancelled_at TIMESTAMP NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
            FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE RESTRICT,
            INDEX idx_sub_tenant (tenant_id),
            INDEX idx_sub_status (status)
        ) ENGINE=InnoDB;
    `);
    console.log('✓ subscriptions table ready');

    // 3. Seed the price book. These limits & prices are placeholders — adjust
    // via UPDATE plans SET ... after launch. Features JSON is purely cosmetic
    // and drives the Features list on the Billing page.
    const plans = [
        {
            code: 'free', name: 'Free', price_inr: 0,
            max_events: 1, max_speakers: 50, max_attendees: 200, max_users: 3,
            features: ['7-day free trial', '1 active event', 'Up to 50 speakers', 'Basic support']
        },
        {
            code: 'pro', name: 'Pro', price_inr: 2999,
            max_events: 10, max_speakers: 500, max_attendees: 2500, max_users: 20,
            features: ['10 concurrent events', 'Up to 500 speakers per event', 'Google Sheet imports', 'Priority support']
        },
        {
            code: 'enterprise', name: 'Enterprise', price_inr: 9999,
            max_events: 0, max_speakers: 0, max_attendees: 0, max_users: 0, // 0 = unlimited
            features: ['Unlimited events', 'Unlimited speakers', 'Custom branding', 'SLA + dedicated support']
        }
    ];
    for (const p of plans) {
        const [exists] = await conn.query('SELECT id FROM plans WHERE code = ?', [p.code]);
        if (exists.length === 0) {
            await conn.query(
                `INSERT INTO plans (code, name, price_inr, max_events, max_speakers, max_attendees, max_users, features)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [p.code, p.name, p.price_inr, p.max_events, p.max_speakers, p.max_attendees, p.max_users, JSON.stringify(p.features)]
            );
            console.log(`  ✓ seeded plan: ${p.code}`);
        } else {
            console.log(`  - plan already exists: ${p.code}`);
        }
    }

    // 4. For every existing tenant without a subscription row, create one on
    // the Free plan in 'trial' state. This reuses the trial_ends_at already on
    // tenants if the signup flow populated it.
    const [freePlan] = await conn.query(`SELECT id FROM plans WHERE code = 'free'`);
    const freePlanId = freePlan[0].id;
    const [tenantsWithoutSub] = await conn.query(`
        SELECT t.id, t.status, t.trial_ends_at
        FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id
        WHERE s.id IS NULL
    `);
    for (const t of tenantsWithoutSub) {
        const subStatus = t.status === 'trial' ? 'trial' : 'active';
        await conn.query(
            `INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_end)
             VALUES (?, ?, ?, ?)`,
            [t.id, freePlanId, subStatus, t.trial_ends_at || null]
        );
        console.log(`  ✓ backfilled subscription for tenant ${t.id} (status=${subStatus})`);
    }

    console.log('\n✓ Stage 4 migration complete.');
    await conn.end();
}

run().catch(err => { console.error('MIGRATION FAILED:', err); process.exit(1); });
