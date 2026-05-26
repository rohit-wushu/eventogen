/**
 * Cross-tenant isolation test.
 *
 * Verifies that after Stage 2 query scoping, a user in Tenant B cannot see or
 * modify any resource belonging to Tenant A through the HTTP API.
 *
 * Prereqs:
 * - Backend server running on http://localhost:5001 (adjust PORT below if different).
 * - Stage 1 migration done: `tenants` table + `tenant_id` columns exist.
 * - Tenant 1 "Default Organization" with an admin user whose login creds we know.
 *
 * This script:
 *   1. Creates tenant 2 + admin user directly in the DB (idempotent).
 *   2. Logs in as both tenant admins via /api/auth/login.
 *   3. Creates an event, a speaker, and a partner in Tenant 1.
 *   4. From Tenant 2's session, tries to:
 *        - GET /events → should not see Tenant 1's event
 *        - GET /events/:id of Tenant 1 → 404
 *        - GET /speakers/:id of Tenant 1 → 404
 *        - PUT /events/:id of Tenant 1 → 404 (not 200)
 *        - DELETE /speakers/:id of Tenant 1 → 404
 *   5. Reports PASS/FAIL per check, exits non-zero on any leak.
 */

const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const PORT = process.env.PORT || 5001;
const BASE = `http://localhost:${PORT}/api`;

const TENANT_A_EMAIL = 'tenant-a-admin@tenancy-test.local';
const TENANT_B_EMAIL = 'tenant-b-admin@tenancy-test.local';
const PASSWORD = 'Test1234!';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail = '') {
    if (cond) {
        console.log(`  ✓ ${name}`);
        passed++;
    } else {
        console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
        failed++;
        failures.push(name + (detail ? ' — ' + detail : ''));
    }
}

async function request(method, path, token, body) {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    return { status: res.status, data };
}

async function seedTenants(conn) {
    // Ensure tenant 2 exists
    const [existing] = await conn.query('SELECT id FROM tenants WHERE slug = ?', ['tenancy-test-b']);
    let tenantBId;
    if (existing.length === 0) {
        const [r] = await conn.query(
            `INSERT INTO tenants (name, slug, plan, status) VALUES ('Tenancy Test B', 'tenancy-test-b', 'free', 'active')`
        );
        tenantBId = r.insertId;
        console.log(`seeded tenant B (id=${tenantBId})`);
    } else {
        tenantBId = existing[0].id;
    }

    // Ensure tenant A admin exists in tenant 1
    const hash = await bcrypt.hash(PASSWORD, 10);
    const [aUser] = await conn.query('SELECT id FROM users WHERE email = ?', [TENANT_A_EMAIL]);
    if (aUser.length === 0) {
        await conn.query(
            `INSERT INTO users (tenant_id, name, email, password, role) VALUES (1, 'Tenancy Test A Admin', ?, ?, 'admin')`,
            [TENANT_A_EMAIL, hash]
        );
    }
    const [bUser] = await conn.query('SELECT id FROM users WHERE email = ?', [TENANT_B_EMAIL]);
    if (bUser.length === 0) {
        await conn.query(
            `INSERT INTO users (tenant_id, name, email, password, role) VALUES (?, 'Tenancy Test B Admin', ?, ?, 'admin')`,
            [tenantBId, TENANT_B_EMAIL, hash]
        );
    }
    return tenantBId;
}

async function run() {
    const conn = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    console.log('\n━━━ Seeding test tenants ━━━');
    const tenantBId = await seedTenants(conn);

    console.log('\n━━━ Logging in as both admins ━━━');
    const aLogin = await request('POST', '/auth/login', null, { email: TENANT_A_EMAIL, password: PASSWORD });
    const bLogin = await request('POST', '/auth/login', null, { email: TENANT_B_EMAIL, password: PASSWORD });
    check('Tenant A admin login', aLogin.status === 200 && aLogin.data?.token);
    check('Tenant B admin login', bLogin.status === 200 && bLogin.data?.token);
    if (!aLogin.data?.token || !bLogin.data?.token) {
        console.log('\n✗ Cannot continue without both logins. Is the server running?');
        process.exit(1);
    }
    const tokenA = aLogin.data.token;
    const tokenB = bLogin.data.token;

    console.log('\n━━━ Creating resources in Tenant A ━━━');
    const createEvent = await request('POST', '/events', tokenA, {
        title: '[TENANCY TEST A] Event',
        description: 'should never be visible to tenant B',
        start_date: '2026-06-01',
        end_date: '2026-06-02',
        venue: 'Test Venue',
        status: 'upcoming'
    });
    // /events uses multipart in production; for this test we POST JSON and accept either 201 or fall back to direct DB insert.
    let tenantAEventId = createEvent.data?.id;
    if (!tenantAEventId) {
        const [r] = await conn.query(
            `INSERT INTO events (tenant_id, title, description, start_date, end_date, venue, status, created_by) VALUES (1, '[TENANCY TEST A] Event', 'should never be visible to tenant B', '2026-06-01', '2026-06-02', 'Test Venue', 'upcoming', (SELECT id FROM users WHERE email = ? LIMIT 1))`,
            [TENANT_A_EMAIL]
        );
        tenantAEventId = r.insertId;
        console.log(`(fell back to direct DB insert — event id=${tenantAEventId})`);
    }
    const [spkInsert] = await conn.query(
        `INSERT INTO speakers (tenant_id, name, email, event_id) VALUES (1, '[TENANCY TEST A] Speaker', 'spk-a@tenancy-test.local', ?)`,
        [tenantAEventId]
    );
    const tenantASpeakerId = spkInsert.insertId;
    const [partnerInsert] = await conn.query(
        `INSERT INTO partners (tenant_id, name, event_id) VALUES (1, '[TENANCY TEST A] Partner', ?)`,
        [tenantAEventId]
    );
    const tenantAPartnerId = partnerInsert.insertId;
    console.log(`  event=${tenantAEventId}, speaker=${tenantASpeakerId}, partner=${tenantAPartnerId}`);

    console.log('\n━━━ Checking Tenant B cannot see Tenant A data ━━━');

    // list events
    const bEvents = await request('GET', '/events', tokenB);
    const leakedEvent = Array.isArray(bEvents.data) && bEvents.data.some(e => e.id === tenantAEventId);
    check('GET /events does not leak Tenant A event', !leakedEvent,
        leakedEvent ? `LEAK: Tenant A event ${tenantAEventId} visible in B's list` : '');

    // detail by id
    const bEventDetail = await request('GET', `/events/${tenantAEventId}`, tokenB);
    check('GET /events/:id of Tenant A returns 404 for Tenant B',
        bEventDetail.status === 404 || bEventDetail.status === 403,
        `got ${bEventDetail.status}`);

    // update by id
    const bEventUpdate = await request('PUT', `/events/${tenantAEventId}`, tokenB, { title: 'hijacked' });
    check('PUT /events/:id of Tenant A returns 404/403 for Tenant B',
        bEventUpdate.status === 404 || bEventUpdate.status === 403,
        `got ${bEventUpdate.status}`);

    // speakers list
    const bSpeakers = await request('GET', '/speakers', tokenB);
    const leakedSpeaker = Array.isArray(bSpeakers.data) && bSpeakers.data.some(s => s.id === tenantASpeakerId);
    check('GET /speakers does not leak Tenant A speaker', !leakedSpeaker);

    // speaker by id
    const bSpeakerDetail = await request('GET', `/speakers/${tenantASpeakerId}`, tokenB);
    check('GET /speakers/:id of Tenant A returns 404 for Tenant B',
        bSpeakerDetail.status === 404 || bSpeakerDetail.status === 403,
        `got ${bSpeakerDetail.status}`);

    // delete speaker by id
    const bSpeakerDelete = await request('DELETE', `/speakers/${tenantASpeakerId}`, tokenB);
    check('DELETE /speakers/:id of Tenant A returns 404/403 for Tenant B',
        bSpeakerDelete.status === 404 || bSpeakerDelete.status === 403,
        `got ${bSpeakerDelete.status}`);

    // partners
    const bPartners = await request('GET', '/partners', tokenB);
    const leakedPartner = Array.isArray(bPartners.data) && bPartners.data.some(p => p.id === tenantAPartnerId);
    check('GET /partners does not leak Tenant A partner', !leakedPartner);

    console.log(`\n━━━ Result: ${passed} passed, ${failed} failed ━━━`);
    if (failed > 0) {
        console.log('\nFailures:');
        failures.forEach(f => console.log(`  ✗ ${f}`));
    }

    // cleanup — delete test-created A resources
    await conn.query('DELETE FROM speakers WHERE id = ?', [tenantASpeakerId]).catch(() => {});
    await conn.query('DELETE FROM partners WHERE id = ?', [tenantAPartnerId]).catch(() => {});
    await conn.query('DELETE FROM events WHERE id = ?', [tenantAEventId]).catch(() => {});

    await conn.end();
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => { console.error(err); process.exit(1); });
