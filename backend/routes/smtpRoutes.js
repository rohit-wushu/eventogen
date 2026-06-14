const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { protect } = require('../middleware/authMiddleware');
const { encrypt, decrypt, maskSecret } = require('../utils/encryption');
const { verifyRawSmtp, sendMail, invalidateTenantMailerCache } = require('../utils/mailer');

// Tenant-scoped SMTP configuration. Mirrors the tenant_payment_gateways UX:
// admins read/update/test their own org's mail-sending credentials. Every
// outgoing email in the app is now resolved per-tenant by mailer.js.

const requireAdmin = (req, res, next) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
};

router.get('/settings', protect, requireAdmin, async (req, res) => {
    try {
        const [[row]] = await db.query(
            `SELECT host, port, secure, username, password_encrypted,
                    from_name, from_email, is_active, updated_at
             FROM tenant_smtp_settings WHERE tenant_id = ?`,
            [req.tenantId]
        );
        if (!row) return res.json({
            host: '', port: 587, secure: false, username: '',
            password_masked: '', from_name: '', from_email: '',
            is_active: false, configured: false,
        });
        const pass = decrypt(row.password_encrypted);
        res.json({
            host: row.host || '',
            port: row.port || 587,
            secure: !!row.secure,
            username: row.username || '',
            password_masked: maskSecret(pass),
            from_name: row.from_name || '',
            from_email: row.from_email || '',
            is_active: !!row.is_active,
            configured: !!(row.host && row.username && pass),
            updated_at: row.updated_at,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/settings', protect, requireAdmin, async (req, res) => {
    const {
        host, port, secure, username, password,
        from_name, from_email, is_active,
    } = req.body || {};

    const cleanHost = (host || '').trim();
    const cleanUser = (username || '').trim();
    const cleanPass = password != null ? String(password).trim() : '';
    const cleanFromEmail = (from_email || '').trim();

    if (cleanFromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanFromEmail)) {
        return res.status(400).json({ error: 'From email is not valid' });
    }
    const portNum = port ? parseInt(port, 10) : 587;
    if (!(portNum > 0 && portNum < 65536)) {
        return res.status(400).json({ error: 'Port must be between 1 and 65535' });
    }

    try {
        const [[existing]] = await db.query(
            'SELECT id, password_encrypted FROM tenant_smtp_settings WHERE tenant_id = ?',
            [req.tenantId]
        );
        // Keep the existing password when admin leaves the field blank — the UI
        // shows a masked preview so empty input is the "don't touch" gesture.
        const passToStore = cleanPass
            ? encrypt(cleanPass)
            : (existing ? existing.password_encrypted : null);

        if (existing) {
            await db.query(
                `UPDATE tenant_smtp_settings
                 SET host = ?, port = ?, secure = ?, username = ?, password_encrypted = ?,
                     from_name = ?, from_email = ?, is_active = ?
                 WHERE id = ?`,
                [
                    cleanHost || null, portNum, secure ? 1 : 0, cleanUser || null, passToStore,
                    (from_name || '').trim() || null, cleanFromEmail || null, is_active ? 1 : 0,
                    existing.id,
                ]
            );
        } else {
            await db.query(
                `INSERT INTO tenant_smtp_settings (
                    tenant_id, host, port, secure, username, password_encrypted,
                    from_name, from_email, is_active
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    req.tenantId, cleanHost || null, portNum, secure ? 1 : 0,
                    cleanUser || null, passToStore,
                    (from_name || '').trim() || null, cleanFromEmail || null, is_active ? 1 : 0,
                ]
            );
        }
        // Drop the cached transporter so the next send picks up the new creds.
        invalidateTenantMailerCache(req.tenantId);
        res.json({ message: 'SMTP settings saved' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Probe stored credentials (or freshly submitted ones) and optionally send a
// test email to the logged-in admin. `send_test` flag controls whether we
// actually dispatch a test message — useful for a "send me a test" button.
router.post('/settings/test', protect, requireAdmin, async (req, res) => {
    const { send_test } = req.body || {};
    try {
        const [[row]] = await db.query(
            `SELECT host, port, secure, username, password_encrypted,
                    from_name, from_email, is_active
             FROM tenant_smtp_settings WHERE tenant_id = ?`,
            [req.tenantId]
        );
        if (!row) return res.status(400).json({ error: 'No SMTP settings saved yet' });
        if (!row.is_active) return res.status(400).json({ error: 'SMTP is disabled for this organization' });
        const pass = decrypt(row.password_encrypted);
        if (!row.host || !row.username || !pass) {
            return res.status(400).json({ error: 'Host, username, and password are required' });
        }

        const verify = await verifyRawSmtp({
            host: row.host, port: row.port, secure: !!row.secure,
            username: row.username, password: pass,
        });
        if (!verify.ok) return res.status(400).json({ error: verify.error });

        if (send_test) {
            const adminEmail = req.user?.email;
            if (!adminEmail) return res.json({ ok: true, verified: true, sent: false });
            try {
                await sendMail({
                    tenantId: req.tenantId,
                    to: adminEmail,
                    subject: 'SMTP test · it works',
                    html: `<div style="font-family:Inter,system-ui,sans-serif;background:#f8fafc;padding:24px">
                        <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:26px 28px;border:1px solid #e5e7eb">
                            <div style="font-size:20px;font-weight:700;color:#0f172a;margin-bottom:6px">✅ SMTP is working</div>
                            <p style="color:#475569;font-size:14px;line-height:1.6;margin:0">Your organization's mail server is correctly configured and reachable. All form notifications, payment receipts, and invitations will be sent from this account.</p>
                            <p style="color:#94a3b8;font-size:12px;margin-top:18px">Sent at ${new Date().toLocaleString()}</p>
                        </div>
                    </div>`,
                });
                return res.json({ ok: true, verified: true, sent: true, to: adminEmail });
            } catch (mailErr) {
                return res.status(400).json({ error: `Verified but send failed: ${mailErr.message}` });
            }
        }
        res.json({ ok: true, verified: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
