const nodemailer = require('nodemailer');
const db = require('../config/db');
const { decrypt } = require('./encryption');

// Platform-branding cache. settings.tenant_id IS NULL holds the global
// site_title + portal_logo (set by super-admin in /platform/branding).
// Cached 5 min so we don't hit the DB on every email send.
let brandCache = { data: null, expires: 0 };
const PLATFORM_FALLBACK = { site_title: 'Eventogen', portal_logo: '' };
const getPlatformBrand = async () => {
    if (brandCache.data && Date.now() < brandCache.expires) return brandCache.data;
    try {
        const [rows] = await db.query(
            `SELECT setting_key, setting_value FROM settings
             WHERE tenant_id IS NULL AND setting_key IN ('site_title','portal_logo')`
        );
        const out = { ...PLATFORM_FALLBACK };
        for (const r of rows) {
            if (r.setting_value) out[r.setting_key] = r.setting_value;
        }
        brandCache = { data: out, expires: Date.now() + 5 * 60 * 1000 };
        return out;
    } catch {
        return PLATFORM_FALLBACK;
    }
};
const invalidatePlatformBrandCache = () => { brandCache = { data: null, expires: 0 }; };
const absoluteLogoUrl = (logoPath) => {
    if (!logoPath) return '';
    if (/^https?:\/\//i.test(logoPath)) return logoPath;
    const base = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    return base ? `${base}${logoPath.startsWith('/') ? '' : '/'}${logoPath}` : '';
};

// Email transport resolution is tenant-aware:
//   1. If a tenantId is passed AND that tenant has an active row in
//      tenant_smtp_settings, use those credentials.
//   2. Otherwise fall back to the process-wide SMTP_* env vars (the old
//      single-tenant default).
//
// Transporters are cached per-tenant because nodemailer keeps a pool of
// connections open — rebuilding on every email would churn DNS + TLS.

const fallbackTransporter = (() => {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
    });
})();
// Built lazily on first use so it can pick up the (possibly cached) brand
// name. If SMTP_FROM is set in env it always wins.
const resolveFallbackFrom = async () => {
    if (process.env.SMTP_FROM) return process.env.SMTP_FROM;
    if (!process.env.SMTP_USER) return null;
    const { site_title } = await getPlatformBrand();
    return `"${site_title}" <${process.env.SMTP_USER}>`;
};

// Cache keyed by tenant_id → { transporter, from, updatedAt }. Invalidated
// when PUT /api/smtp/settings runs (see smtpRoutes).
const tenantCache = new Map();

const invalidateTenantMailerCache = (tenantId) => {
    if (tenantId == null) return;
    tenantCache.delete(Number(tenantId));
};

const buildTenantTransporter = async (tenantId) => {
    const [[row]] = await db.query(
        `SELECT host, port, secure, username, password_encrypted,
                from_name, from_email, is_active
         FROM tenant_smtp_settings
         WHERE tenant_id = ?`,
        [tenantId]
    );
    if (!row || !row.is_active || !row.host || !row.username || !row.password_encrypted) return null;
    const pass = decrypt(row.password_encrypted);
    if (!pass) return null;

    const transporter = nodemailer.createTransport({
        host: row.host,
        port: row.port || 587,
        secure: !!row.secure,
        auth: { user: row.username, pass },
    });
    const fromEmail = row.from_email || row.username;
    const from = row.from_name ? `"${row.from_name.replace(/"/g, '')}" <${fromEmail}>` : fromEmail;
    return { transporter, from };
};

// Core resolver. Returns { transporter, from, source }. Throws if neither
// tenant nor env SMTP is configured — callers catch and swallow.
const resolveTransporter = async (tenantId) => {
    if (tenantId != null) {
        const cached = tenantCache.get(Number(tenantId));
        if (cached) return { ...cached, source: 'tenant-cached' };
        try {
            const built = await buildTenantTransporter(Number(tenantId));
            if (built) {
                tenantCache.set(Number(tenantId), built);
                return { ...built, source: 'tenant' };
            }
        } catch (err) {
            console.warn(`[MAIL] tenant ${tenantId} SMTP lookup failed:`, err.message);
        }
    }
    if (fallbackTransporter) {
        const from = await resolveFallbackFrom();
        return { transporter: fallbackTransporter, from, source: 'env' };
    }
    return null;
};

const sendMail = async ({ to, subject, html, tenantId = null, attachments = undefined }) => {
    const resolved = await resolveTransporter(tenantId);
    if (!resolved) {
        console.warn('[MAIL] No SMTP configured. Email not sent to:', to);
        return { skipped: true, reason: 'SMTP not configured' };
    }

    try {
        const info = await resolved.transporter.sendMail({
            from: resolved.from,
            to,
            subject,
            html,
            ...(attachments?.length ? { attachments } : {}),
        });
        console.log(`[MAIL/${resolved.source}] ✔ Sent to ${to} (id: ${info.messageId})`);
        return info;
    } catch (err) {
        console.error(`[MAIL/${resolved.source}] ✖ Failed to send to ${to}:`, err.message);
        throw err;
    }
};

// Verify a specific set of credentials (used by the settings "Test" button —
// doesn't touch the cache since these creds may not be stored yet).
const verifyRawSmtp = async ({ host, port, secure, username, password }) => {
    if (!host || !username || !password) return { ok: false, error: 'host/username/password required' };
    try {
        const t = nodemailer.createTransport({
            host,
            port: port ? Number(port) : 587,
            secure: !!secure,
            auth: { user: username, pass: password },
        });
        await t.verify();
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
};

// Legacy single-config verify (used by existing admin utilities).
const verifySmtp = async () => {
    if (!fallbackTransporter) return { ok: false, error: 'SMTP_USER / SMTP_PASS not set in .env' };
    try {
        await fallbackTransporter.verify();
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
};

// Shared brand header for every transactional email. Uses portal_logo if the
// super-admin uploaded one; otherwise renders the platform name as text.
const emailBrandHeader = (brand) => {
    const logoUrl = absoluteLogoUrl(brand.portal_logo);
    if (logoUrl) {
        return `<div style="text-align:center; margin-bottom:24px;">
            <img src="${logoUrl}" alt="${brand.site_title}" style="max-height:48px; max-width:180px;" />
        </div>`;
    }
    return `<div style="text-align:center; margin-bottom:24px;">
        <div style="font-size:18px; font-weight:800; color:#1e293b; letter-spacing:-0.01em;">${brand.site_title}</div>
    </div>`;
};

const sendPasswordResetEmail = async (email, resetUrl, userName, tenantId = null) => {
    const brand = await getPlatformBrand();
    return sendMail({
        to: email,
        tenantId,
        subject: `Reset your password — ${brand.site_title}`,
        html: `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; background: #f8fafc;">
                <div style="background: #ffffff; border-radius: 16px; padding: 40px 32px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
                    ${emailBrandHeader(brand)}
                    <div style="text-align: center; margin-bottom: 24px;">
                        <div style="width: 56px; height: 56px; border-radius: 14px; background: linear-gradient(135deg, #8b5cf6, #ec4899); display: inline-flex; align-items: center; justify-content: center; font-size: 24px; color: #fff; margin-bottom: 16px;">🔒</div>
                        <h2 style="margin: 0; color: #1e293b; font-size: 22px; font-weight: 700;">Password Reset</h2>
                    </div>
                    <p style="color: #475569; font-size: 15px; line-height: 1.6; margin-bottom: 8px;">Hi${userName ? ' ' + userName : ''},</p>
                    <p style="color: #475569; font-size: 15px; line-height: 1.6; margin-bottom: 24px;">We received a request to reset your password. Click the button below to create a new password. This link expires in <strong>1 hour</strong>.</p>
                    <div style="text-align: center; margin-bottom: 24px;">
                        <a href="${resetUrl}" style="display: inline-block; background: linear-gradient(135deg, #8b5cf6, #7c3aed); color: #ffffff; text-decoration: none; padding: 14px 36px; border-radius: 10px; font-weight: 600; font-size: 15px; box-shadow: 0 4px 12px rgba(139,92,246,0.3);">Reset Password</a>
                    </div>
                    <p style="color: #94a3b8; font-size: 13px; line-height: 1.5;">If you didn't request this, you can safely ignore this email. Your password will remain unchanged.</p>
                    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
                    <p style="color: #cbd5e1; font-size: 12px; text-align: center; margin: 0;">If the button doesn't work, copy and paste this URL:<br /><a href="${resetUrl}" style="color: #8b5cf6; word-break: break-all;">${resetUrl}</a></p>
                    <p style="color: #cbd5e1; font-size: 11px; text-align: center; margin: 12px 0 0;">Sent by ${brand.site_title}</p>
                </div>
            </div>
        `,
    });
};

const sendInviteEmail = async (email, inviteUrl, inviterName, role, eventTitle, tenantId = null) => {
    const brand = await getPlatformBrand();
    return sendMail({
        to: email,
        tenantId,
        subject: `You're invited to join ${brand.site_title}${eventTitle ? ' — ' + eventTitle : ''}`,
        html: `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; background: #f8fafc;">
                <div style="background: #ffffff; border-radius: 16px; padding: 40px 32px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
                    ${emailBrandHeader(brand)}
                    <div style="text-align: center; margin-bottom: 24px;">
                        <div style="width: 56px; height: 56px; border-radius: 14px; background: linear-gradient(135deg, #10b981, #059669); display: inline-flex; align-items: center; justify-content: center; font-size: 24px; color: #fff; margin-bottom: 16px;">✉️</div>
                        <h2 style="margin: 0; color: #1e293b; font-size: 22px; font-weight: 700;">You're Invited!</h2>
                    </div>
                    <p style="color: #475569; font-size: 15px; line-height: 1.6; margin-bottom: 8px;">Hi,</p>
                    <p style="color: #475569; font-size: 15px; line-height: 1.6; margin-bottom: 24px;"><strong>${inviterName || 'An admin'}</strong> has invited you to join <strong>${brand.site_title}</strong> as <strong style="text-transform: capitalize;">${role}</strong>${eventTitle ? ' for the event <strong>' + eventTitle + '</strong>' : ''}. Click below to set up your account.</p>
                    <div style="text-align: center; margin-bottom: 24px;">
                        <a href="${inviteUrl}" style="display: inline-block; background: linear-gradient(135deg, #10b981, #059669); color: #ffffff; text-decoration: none; padding: 14px 36px; border-radius: 10px; font-weight: 600; font-size: 15px; box-shadow: 0 4px 12px rgba(16,185,129,0.3);">Accept Invitation</a>
                    </div>
                    <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
                    <p style="color: #cbd5e1; font-size: 12px; text-align: center; margin: 0;">If the button doesn't work, copy and paste this URL:<br /><a href="${inviteUrl}" style="color: #10b981; word-break: break-all;">${inviteUrl}</a></p>
                    <p style="color: #cbd5e1; font-size: 11px; text-align: center; margin: 12px 0 0;">Sent by ${brand.site_title}</p>
                </div>
            </div>
        `,
    });
};

module.exports = {
    sendMail,
    sendPasswordResetEmail,
    sendInviteEmail,
    verifySmtp,
    verifyRawSmtp,
    invalidateTenantMailerCache,
    invalidatePlatformBrandCache,
};
