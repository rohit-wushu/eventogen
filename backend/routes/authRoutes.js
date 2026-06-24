const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { protect } = require('../middleware/authMiddleware');
const { usageAndLimit } = require('../middleware/limits');
const { sendPasswordResetEmail, sendInviteEmail, verifySmtp } = require('../utils/mailer');
const { notifyUser } = require('../utils/notify');
const { OAuth2Client } = require('google-auth-library');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Check Email Existence
router.post('/check-email', async (req, res) => {
    const { email } = req.body;
    try {
        const [users] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        res.json({ exists: users.length > 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Signup — creates a brand-new tenant + its first admin user in one transaction.
// Starts a 14-day trial. Used by the public /signup page.
router.post('/signup', async (req, res) => {
    const { name, email, password, org_name } = req.body || {};
    if (!name || !email || !password || !org_name) {
        return res.status(400).json({ error: 'name, email, password, and org_name are required' });
    }
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
    const baseSlug = slugify(org_name) || 'org';

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        const [existing] = await conn.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) {
            await conn.rollback();
            return res.status(400).json({ error: 'An account with this email already exists' });
        }

        // Slug collision handling — append short random suffix if taken.
        let slug = baseSlug;
        for (let i = 0; i < 5; i++) {
            const [taken] = await conn.query('SELECT id FROM tenants WHERE slug = ?', [slug]);
            if (taken.length === 0) break;
            slug = `${baseSlug}-${crypto.randomBytes(3).toString('hex')}`;
        }

        // Trial length is configurable per-plan in the super-admin Plans page.
        // Read from `plans.trial_days` for the Free plan; fall back to 7 if
        // the column doesn't exist (e.g. migrate_plan_trial_days hasn't run).
        let trialDays = 7;
        try {
            const [[row]] = await conn.query(
                `SELECT trial_days FROM plans WHERE code = 'free' LIMIT 1`
            );
            if (row && Number(row.trial_days) > 0) trialDays = Number(row.trial_days);
        } catch { /* plans.trial_days missing — keep default */ }
        const trialEnds = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);
        const [tenantResult] = await conn.query(
            `INSERT INTO tenants (name, slug, plan, status, trial_ends_at) VALUES (?, ?, 'free', 'trial', ?)`,
            [org_name.trim(), slug, trialEnds]
        );
        const tenantId = tenantResult.insertId;

        const hash = await bcrypt.hash(password, 10);
        const [userResult] = await conn.query(
            `INSERT INTO users (tenant_id, name, email, password, role) VALUES (?, ?, ?, ?, 'admin')`,
            [tenantId, name.trim(), email.toLowerCase().trim(), hash]
        );
        const userId = userResult.insertId;

        await conn.query('UPDATE tenants SET owner_user_id = ? WHERE id = ?', [userId, tenantId]);

        // Seed the price book on first signup if the billing migration hasn't
        // been run yet. Idempotent — only inserts plans that don't already exist.
        const seedPlans = [
            { code: 'free', name: 'Free', price_inr: 0,
              max_events: 1, max_speakers: 50, max_attendees: 200, max_users: 3, max_storage_mb: 100,
              features: ['7-day free trial', '1 active event', 'Up to 50 speakers', 'Basic support'] },
            { code: 'pro', name: 'Pro', price_inr: 2999,
              max_events: 10, max_speakers: 500, max_attendees: 2500, max_users: 20, max_storage_mb: 5120,
              features: ['10 concurrent events', 'Up to 500 speakers per event', 'Google Sheet imports', 'Priority support'] },
            { code: 'enterprise', name: 'Enterprise', price_inr: 9999,
              max_events: 0, max_speakers: 0, max_attendees: 0, max_users: 0, max_storage_mb: 0,
              features: ['Unlimited events', 'Unlimited speakers', 'Custom branding', 'SLA + dedicated support'] }
        ];
        // Detect whether the max_storage_mb column has been added yet — the
        // storage-limits migration may not have run on older deployments. If it
        // hasn't, fall back to the legacy schema so signup still works.
        const [colCheck] = await conn.query(
            `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plans' AND COLUMN_NAME = 'max_storage_mb'`
        );
        const storageColExists = colCheck.length > 0;

        for (const p of seedPlans) {
            const [exists] = await conn.query('SELECT id FROM plans WHERE code = ?', [p.code]);
            if (exists.length === 0) {
                if (storageColExists) {
                    await conn.query(
                        `INSERT INTO plans (code, name, price_inr, max_events, max_speakers, max_attendees, max_users, max_storage_mb, features)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [p.code, p.name, p.price_inr, p.max_events, p.max_speakers, p.max_attendees, p.max_users, p.max_storage_mb, JSON.stringify(p.features)]
                    );
                } else {
                    await conn.query(
                        `INSERT INTO plans (code, name, price_inr, max_events, max_speakers, max_attendees, max_users, features)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        [p.code, p.name, p.price_inr, p.max_events, p.max_speakers, p.max_attendees, p.max_users, JSON.stringify(p.features)]
                    );
                }
            }
        }

        // Without a subscriptions row the limits middleware has nothing to check
        // against and billing endpoints 404 — seed one in 'trial' on the Free plan.
        const [[{ id: freePlanId }]] = await conn.query(`SELECT id FROM plans WHERE code = 'free' LIMIT 1`);
        await conn.query(
            `INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_end)
             VALUES (?, ?, 'trial', ?)`,
            [tenantId, freePlanId, trialEnds]
        );

        await conn.commit();

        const token = jwt.sign({ id: userId, name, role: 'admin', email }, process.env.JWT_SECRET, { expiresIn: '30d' });
        res.status(201).json({
            token,
            user: { id: userId, name, email, role: 'admin', assigned_event_id: null },
            tenant: { id: tenantId, name: org_name, slug, status: 'trial', trial_ends_at: trialEnds }
        });
    } catch (err) {
        try { await conn.rollback(); } catch {}
        console.error('Signup failed:', err);
        res.status(500).json({ error: err.message });
    } finally {
        conn.release();
    }
});

// Register — legacy. Defaults new users into tenant 1. Kept for internal admin-created users.
router.post('/register', async (req, res) => {
    const { name, email, password, role } = req.body;
    try {
        const [exists] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (exists.length > 0) return res.status(400).json({ error: 'User already exists' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        await db.query('INSERT INTO users (tenant_id, name, email, password, role) VALUES (?, ?, ?, ?, ?)',
            [1, name, email, hashedPassword, role || 'employee']);

        res.status(201).json({ message: 'User registered' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Current User Profile (Fresh from DB)
router.get('/me', protect, async (req, res) => {
    try {
        const [users] = await db.query(
            `SELECT u.id, u.name, u.email, u.role, u.assigned_event_id, u.assigned_task,
                    u.profile_photo_url, u.is_super_admin, u.permissions,
                    t.bulk_certificate_enabled
             FROM users u
             LEFT JOIN tenants t ON t.id = u.tenant_id
             WHERE u.id = ?`,
            [req.user.id]
        );
        if (users.length === 0) return res.status(404).json({ error: 'User not found' });

        const user = users[0];
        user.is_super_admin = !!user.is_super_admin;
        // Default-on so super admins (no tenant) and any pre-migration row
        // doesn't accidentally read as disabled. Tenant flag wins when set.
        user.bulk_certificate_enabled = user.bulk_certificate_enabled === null
            ? true
            : !!user.bulk_certificate_enabled;
        // Normalise permissions: column comes back as parsed array, JSON string,
        // or NULL. NULL = full access (legacy/unset). Frontend hides sections
        // not in the array; admins/managers ignore the field.
        if (typeof user.permissions === 'string') {
            try { user.permissions = JSON.parse(user.permissions); }
            catch { user.permissions = null; }
        }
        // Sign a fresh token with the latest assignment data
        const token = jwt.sign(
            { id: user.id, name: user.name, role: user.role, email: user.email, assigned_event_id: user.assigned_event_id },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({ user, token });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin/Manager Invites User
router.post('/invite', protect, async (req, res) => {
    if (!['admin', 'manager'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Only admins and managers can invite' });
    }

    const { email, role, event_id, assigned_task } = req.body;

    if (!email || !email.trim()) {
        return res.status(400).json({ error: 'Email is required' });
    }

    // Managers can only invite employees
    if (req.user.role === 'manager' && role !== 'employee') {
        return res.status(403).json({ error: 'Managers can only invite employees' });
    }

    // Enforce plan user limit up-front — don't send invite emails we can't honor.
    const userUsage = await usageAndLimit(req.tenantId, 'users');
    if (userUsage && !userUsage.unlimited && userUsage.used >= userUsage.limit) {
        return res.status(402).json({
            error: 'plan_limit_reached',
            message: `Your ${userUsage.plan_name} plan allows up to ${userUsage.limit} team members. Upgrade to invite more.`,
            plan: userUsage.plan_name
        });
    }

    try {
        // Generate token
        const token = crypto.randomBytes(32).toString('hex');

        // Delete any existing invitation for this email within this tenant.
        await db.query('DELETE FROM invitations WHERE email = ? AND tenant_id = ?', [email, req.tenantId]);

        // Create new invitation scoped to the inviter's tenant.
        await db.query('INSERT INTO invitations (tenant_id, email, role, token, created_by, event_id, assigned_task) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [req.tenantId, email, role, token, req.user.id, event_id || null, assigned_task || null]
        );

        const inviteLink = `/accept-invite/${token}`;

        // Send invite email
        const frontendUrl = process.env.FRONTEND_URL || req.headers.origin || 'http://localhost:5173';
        const inviteUrl = `${frontendUrl}/accept-invite/${token}`;
        let eventTitle = null;
        if (event_id) {
            const [evts] = await db.query('SELECT title FROM events WHERE id = ? AND tenant_id = ?', [event_id, req.tenantId]);
            if (evts.length > 0) eventTitle = evts[0].title;
        }
        let emailStatus = { sent: false, error: null };
        try {
            const result = await sendInviteEmail(email, inviteUrl, req.user.name, role, eventTitle, req.tenantId);
            emailStatus.sent = !result?.skipped;
            if (result?.skipped) emailStatus.error = result.reason || 'SMTP not configured';
        } catch (err) {
            console.error('Invite email failed:', err.message);
            emailStatus.error = err.message;
        }

        // Fire-and-forget: notify user if they already exist
        const [existingUsers] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUsers.length > 0) {
            notifyUser(existingUsers[0].id, 'invite_received', 'New Invitation', `${req.user.name} invited you as ${role}`, '/accept-invite').catch(() => {});
        }

        res.status(201).json({ message: 'Invitation created', inviteLink, token, emailStatus });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Validate Invitation Token
router.get('/validate-invite/:token', async (req, res) => {
    try {
        const [invitations] = await db.query(
            `SELECT i.email, i.role, i.event_id, i.assigned_task, e.title as event_title 
             FROM invitations i 
             LEFT JOIN events e ON i.event_id = e.id
             WHERE i.token = ?`,
            [req.params.token]
        );
        if (invitations.length === 0) return res.status(404).json({ error: 'Invalid or expired invitation' });

        res.json({
            email: invitations[0].email,
            role: invitations[0].role,
            event_id: invitations[0].event_id,
            event_title: invitations[0].event_title,
            assigned_task: invitations[0].assigned_task
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Accept Invitation (new user registration via invite link)
router.post('/accept-invite', async (req, res) => {
    const { token, name, password } = req.body;
    try {
        const [invitations] = await db.query(
            'SELECT id, email, tenant_id, role, event_id, assigned_task, created_by FROM invitations WHERE token = ?',
            [token]
        );
        if (invitations.length === 0) return res.status(400).json({ error: 'Invalid or expired invitation' });

        const invite = invitations[0];

        // Check if user already exists (they should use accept-invite-existing instead)
        const [existingUser] = await db.query('SELECT id FROM users WHERE email = ?', [invite.email]);
        if (existingUser.length > 0) {
            return res.status(400).json({ error: 'already_registered', message: 'This email is already registered. Please login and accept from your dashboard.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create user in the inviting tenant.
        const [result] = await db.query(
            'INSERT INTO users (tenant_id, name, email, password, role, assigned_event_id, assigned_task) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [invite.tenant_id, name, invite.email, hashedPassword, invite.role, invite.event_id || null, invite.assigned_task || null]
        );

        // Delete invitation
        await db.query('DELETE FROM invitations WHERE id = ?', [invite.id]);

        // Fire-and-forget: notify the inviter
        notifyUser(invite.created_by, 'invite_accepted', 'Invitation Accepted', `${name} accepted your invitation`, '/users').catch(() => {});

        // Login the user immediately
        const authToken = jwt.sign(
            { id: result.insertId, name, role: invite.role, assigned_event_id: invite.event_id || null },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.status(201).json({
            message: 'Registration successful',
            token: authToken,
            user: { id: result.insertId, name, email: invite.email, role: invite.role, assigned_event_id: invite.event_id || null }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Accept Invitation for existing registered users (called after login).
// Cross-tenant invites are blocked here: we only accept invitations from the
// tenant the user already belongs to. Moving a user between tenants is a
// separate (future) flow.
router.post('/accept-invite-existing', protect, async (req, res) => {
    try {
        const [invitations] = await db.query(
            'SELECT id, role, event_id, assigned_task, created_by FROM invitations WHERE email = ? AND tenant_id = ?',
            [req.user.email, req.tenantId]
        );
        if (invitations.length === 0) return res.status(404).json({ error: 'No pending invitation found' });

        const invite = invitations[0];

        // Update user's role and assigned event/task
        await db.query(
            'UPDATE users SET role = ?, assigned_event_id = ?, assigned_task = ? WHERE id = ?',
            [invite.role, invite.event_id || null, invite.assigned_task || null, req.user.id]
        );

        // Delete invitation
        await db.query('DELETE FROM invitations WHERE id = ?', [invite.id]);

        // Fire-and-forget: notify the inviter
        notifyUser(invite.created_by, 'invite_accepted', 'Invitation Accepted', `${req.user.name} accepted your invitation`, '/users').catch(() => {});

        // Issue new token with updated role
        const [updatedUser] = await db.query(
            'SELECT id, name, email, role, assigned_event_id FROM users WHERE id = ?',
            [req.user.id]
        );
        const u = updatedUser[0];
        const authToken = jwt.sign(
            { id: u.id, name: u.name, role: u.role, assigned_event_id: u.assigned_event_id },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            message: 'Invitation accepted',
            token: authToken,
            user: { id: u.id, name: u.name, email: u.email, role: u.role, assigned_event_id: u.assigned_event_id }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Decline Invitation — only declines invites within the user's tenant.
router.post('/decline-invite', protect, async (req, res) => {
    try {
        await db.query('DELETE FROM invitations WHERE email = ? AND tenant_id = ?', [req.user.email, req.tenantId]);
        res.json({ message: 'Invitation declined' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Admin/Manager Delete Invitation
router.delete('/invitation', protect, async (req, res) => {
    const email = req.query.email;
    const inviteId = req.query.id;
    if (!email && !inviteId) return res.status(400).json({ error: 'Email or invitation ID is required' });
    if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
    try {
        const field = inviteId ? 'id' : 'email';
        const value = inviteId || email;
        if (req.user.role === 'manager') {
            const [check] = await db.query(`SELECT created_by FROM invitations WHERE ${field} = ? AND tenant_id = ?`, [value, req.tenantId]);
            if (check.length > 0 && check[0].created_by !== req.user.id) {
                return res.status(403).json({ error: 'You can only delete invitations you created' });
            }
        }
        const [result] = await db.query(`DELETE FROM invitations WHERE ${field} = ? AND tenant_id = ?`, [value, req.tenantId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Invitation not found' });
        res.json({ message: 'Invitation revoked' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Keep old route for backwards compatibility
router.delete('/invitation/:email', protect, async (req, res) => {
    const email = decodeURIComponent(req.params.email);
    if (!['admin', 'manager'].includes(req.user.role)) return res.status(403).json({ error: 'Access denied' });
    try {
        if (req.user.role === 'manager') {
            const [check] = await db.query('SELECT created_by FROM invitations WHERE email = ? AND tenant_id = ?', [email, req.tenantId]);
            if (check.length > 0 && check[0].created_by !== req.user.id) {
                return res.status(403).json({ error: 'You can only delete invitations you created' });
            }
        }
        const [result] = await db.query('DELETE FROM invitations WHERE email = ? AND tenant_id = ?', [email, req.tenantId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Invitation not found' });
        res.json({ message: 'Invitation revoked' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const [users] = await db.query(
            `SELECT id, name, email, password, role, assigned_event_id, tenant_id,
                    is_super_admin, permissions
             FROM users WHERE email = ?`,
            [email]
        );
        if (users.length === 0) return res.status(400).json({ error: 'Invalid credentials' });

        const user = users[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });

        // Pull tenant feature flags so the SPA can hide gated UI on first paint
        // (rather than waiting for /auth/me to complete and redirect).
        let bulkCertEnabled = true;
        if (user.tenant_id) {
            const [[trow]] = await db.query('SELECT bulk_certificate_enabled FROM tenants WHERE id = ?', [user.tenant_id]);
            if (trow && trow.bulk_certificate_enabled === 0) bulkCertEnabled = false;
        }

        // Check for pending invitation
        const [invitations] = await db.query(
            `SELECT i.*, e.title as event_title 
             FROM invitations i 
             LEFT JOIN events e ON i.event_id = e.id
             WHERE i.email = ?`,
            [email]
        );

        const pendingInvite = invitations.length > 0 ? {
            role: invitations[0].role,
            event_id: invitations[0].event_id,
            event_title: invitations[0].event_title,
            assigned_task: invitations[0].assigned_task,
            token: invitations[0].token
        } : null;

        const token = jwt.sign(
            { id: user.id, name: user.name, role: user.role, email: user.email, assigned_event_id: user.assigned_event_id },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            token,
            user: {
                id: user.id, name: user.name, email: user.email, role: user.role,
                assigned_event_id: user.assigned_event_id,
                is_super_admin: !!user.is_super_admin,
                bulk_certificate_enabled: bulkCertEnabled,
                permissions: typeof user.permissions === 'string'
                    ? (() => { try { return JSON.parse(user.permissions); } catch { return null; } })()
                    : (user.permissions ?? null),
            },
            pendingInvite
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Login with Google (pre-invited users only)
router.post('/google', async (req, res) => {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Missing Google credential' });
    if (!process.env.GOOGLE_CLIENT_ID) return res.status(500).json({ error: 'Google login not configured on server' });

    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID
        });
        const payload = ticket.getPayload();
        const email = (payload.email || '').toLowerCase();
        if (!payload.email_verified) return res.status(400).json({ error: 'Google account email not verified' });

        const [users] = await db.query(
            `SELECT id, name, email, role, assigned_event_id, tenant_id,
                    is_super_admin, permissions
             FROM users WHERE LOWER(email) = ?`,
            [email]
        );
        if (users.length === 0) {
            return res.status(403).json({ error: 'No account found for this Google email. Ask an admin to invite you first.' });
        }
        const user = users[0];

        // Pending invite (same as password login)
        const [invitations] = await db.query(
            `SELECT i.*, e.title as event_title FROM invitations i LEFT JOIN events e ON i.event_id = e.id WHERE i.email = ?`,
            [user.email]
        );
        const pendingInvite = invitations.length > 0 ? {
            role: invitations[0].role,
            event_id: invitations[0].event_id,
            event_title: invitations[0].event_title,
            assigned_task: invitations[0].assigned_task,
            token: invitations[0].token
        } : null;

        const token = jwt.sign(
            { id: user.id, name: user.name, role: user.role, email: user.email, assigned_event_id: user.assigned_event_id },
            process.env.JWT_SECRET,
            { expiresIn: '30d' }
        );

        res.json({
            token,
            user: { id: user.id, name: user.name, email: user.email, role: user.role, assigned_event_id: user.assigned_event_id, is_super_admin: !!user.is_super_admin },
            pendingInvite
        });
    } catch (err) {
        console.error('Google login error:', err.message);
        res.status(400).json({ error: 'Invalid Google token' });
    }
});

// Admin: test SMTP configuration
router.get('/test-smtp', protect, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const result = await verifySmtp();
    res.json(result);
});

// Change own password
router.put('/change-password', protect, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password are required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

    try {
        const [users] = await db.query('SELECT password FROM users WHERE id = ?', [req.user.id]);
        if (users.length === 0) return res.status(404).json({ error: 'User not found' });

        const isMatch = await bcrypt.compare(currentPassword, users[0].password);
        if (!isMatch) return res.status(400).json({ error: 'Current password is incorrect' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);
        await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.user.id]);

        res.json({ message: 'Password changed successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Forgot Password - send reset email
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    try {
        const [users] = await db.query('SELECT id, name, email, tenant_id FROM users WHERE email = ?', [email]);
        // Always return success to prevent email enumeration
        if (users.length === 0) {
            return res.json({ message: 'If an account with that email exists, a reset link has been sent.' });
        }

        const user = users[0];
        const resetToken = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        await db.query('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
            [resetToken, expires, user.id]);

        const frontendUrl = process.env.FRONTEND_URL || req.headers.origin || 'http://localhost:5173';
        const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;

        await sendPasswordResetEmail(user.email, resetUrl, user.name, user.tenant_id);

        res.json({ message: 'If an account with that email exists, a reset link has been sent.' });
    } catch (err) {
        console.error('Forgot password error:', err);
        res.status(500).json({ error: 'Failed to process request. Please try again.' });
    }
});

// Reset Password - verify token and set new password
router.post('/reset-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    try {
        const [users] = await db.query(
            'SELECT id, name FROM users WHERE reset_token = ? AND reset_token_expires > NOW()',
            [token]
        );

        if (users.length === 0) {
            return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
        }

        const user = users[0];
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        await db.query(
            'UPDATE users SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?',
            [hashedPassword, user.id]
        );

        res.json({ message: 'Password reset successfully! You can now sign in.' });
    } catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ error: 'Failed to reset password. Please try again.' });
    }
});

module.exports = router;
