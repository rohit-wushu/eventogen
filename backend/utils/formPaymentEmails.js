const { sendMail } = require('./mailer');

// Customer-facing emails fired around the payment lifecycle:
//   - pending:   order created, show summary + retry link ("complete your payment")
//   - paid:      receipt ("payment received")
//   - failed:    gateway reported failure + retry link
//   - cancelled: visitor closed the checkout + retry link
//
// Admin notifications are still sent separately from paymentRoutes. These
// emails go to the visitor, resolved via the first `email` field on the form.
// Errors are swallowed — email problems must never break the payment flow.

const ESC = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Walk the form's fields for the first `email` question. That's where we'll
// send the confirmation. If none, return null — caller skips the send.
const findCustomerEmail = (fields, data) => {
    if (!fields || !data) return null;
    const f = fields.find(x => x.field_type === 'email');
    if (!f) return null;
    const v = data[f.id];
    if (typeof v !== 'string') return null;
    const trimmed = v.trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
};

const formatMoney = (amountPaise, currency) => {
    const major = (Number(amountPaise) || 0) / 100;
    try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 2 }).format(major);
    } catch {
        return `${currency || ''} ${major.toFixed(2)}`;
    }
};

// Compact answers table — same rendering as the admin notification so the
// visitor sees exactly what they submitted.
const answersHtml = (fields, data, absoluteBase) => {
    return fields
        .filter(f => f.field_type !== 'file' || (data?.[f.id] && data[f.id].url))
        .map(f => {
            const v = data?.[f.id];
            let disp;
            if (v == null || v === '') disp = '<span style="color:#94a3b8">—</span>';
            else if (Array.isArray(v)) disp = ESC(v.join(', '));
            else if (typeof v === 'object' && v.url) {
                const url = v.url.startsWith('/') ? `${absoluteBase || ''}${v.url}` : v.url;
                disp = `<a href="${ESC(url)}" style="color:#8b5cf6">${ESC(v.name || 'Download')}</a>`;
            }
            else if (typeof v === 'object' && (v.sector_name || v.category_name)) {
                disp = ESC([v.sector_name, v.category_name, v.subcategory_name].filter(Boolean).join(' → '));
            }
            else disp = ESC(String(v));
            return `<tr><td style="padding:8px 12px;border-bottom:1px solid #eef0f3;color:#64748b;font-size:13px;width:42%">${ESC(f.label)}</td><td style="padding:8px 12px;border-bottom:1px solid #eef0f3;color:#0f172a;font-size:14px">${disp}</td></tr>`;
        }).join('');
};

// Variant config keyed by lifecycle state.
const VARIANTS = {
    pending: {
        subject: form => `Complete your payment · ${form.title}`,
        hero: { color: '#f59e0b', icon: '⏱', title: 'Complete your payment' },
        lead: 'Your submission is saved but payment is still pending. Click the button below to finish and secure your spot.',
        cta: 'Complete payment',
    },
    paid: {
        subject: form => `Payment receipt · ${form.title}`,
        hero: { color: '#10b981', icon: '✓', title: 'Payment received' },
        lead: 'Thank you — we\'ve received your payment and your submission is confirmed.',
        cta: null,
    },
    failed: {
        subject: form => `Payment failed · ${form.title}`,
        hero: { color: '#ef4444', icon: '⚠', title: 'Payment failed' },
        lead: 'Your payment did not go through. No charge was made. You can try again using the link below.',
        cta: 'Retry payment',
    },
    cancelled: {
        subject: form => `Payment cancelled · ${form.title}`,
        hero: { color: '#ef4444', icon: '✕', title: 'Payment cancelled' },
        lead: 'Looks like the payment window was closed before you finished. Your spot isn\'t confirmed yet — use the link below to complete payment.',
        cta: 'Resume payment',
    },
};

const sendCustomerPaymentEmail = async ({
    type,
    form,
    fields,
    data,
    amountPaise,
    currency,
    tierLabel,
    paymentId,
    retryUrl,
    reason,
    absoluteBase,
    tenantId,
}) => {
    try {
        const variant = VARIANTS[type];
        if (!variant) return { skipped: true, reason: 'unknown type' };

        const to = findCustomerEmail(fields, data);
        if (!to) return { skipped: true, reason: 'no email field / invalid' };

        const amount = formatMoney(amountPaise, currency);
        const paymentRows = [
            ['Form', ESC(form.title)],
            ['Amount', `<strong>${amount}</strong>`],
            tierLabel ? ['Tier / Category', ESC(tierLabel)] : null,
            paymentId ? ['Payment ID', `<code style="background:#f1f5f9;padding:2px 8px;border-radius:6px;font-size:12px">${ESC(paymentId)}</code>`] : null,
            reason ? ['Reason', ESC(reason)] : null,
        ].filter(Boolean).map(([k, v]) => `<tr><td style="padding:6px 0;color:#64748b;font-size:13px;width:42%">${k}</td><td style="padding:6px 0;color:#0f172a;font-size:14px">${v}</td></tr>`).join('');

        const ctaHtml = retryUrl && variant.cta ? `
            <div style="text-align:center;padding:18px 24px 4px">
                <a href="${ESC(retryUrl)}" style="display:inline-block;background:linear-gradient(135deg,#8b5cf6,#ec4899);color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-weight:700;font-size:15px;box-shadow:0 8px 20px -8px #8b5cf6">${variant.cta}</a>
                <div style="margin-top:10px;color:#94a3b8;font-size:12px">If the button doesn't work, paste this link:<br><a href="${ESC(retryUrl)}" style="color:#8b5cf6;word-break:break-all">${ESC(retryUrl)}</a></div>
            </div>` : '';

        const answersBlock = fields && data
            ? `<div style="padding:6px 24px 0"><div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#94a3b8;margin:18px 0 6px">Your submission</div></div>
               <table style="width:100%;border-collapse:collapse;padding:0 24px;margin:0 24px 12px;width:calc(100% - 48px)">${answersHtml(fields, data, absoluteBase)}</table>`
            : '';

        const html = `
            <div style="font-family:Inter,Segoe UI,system-ui,sans-serif;background:#f8fafc;padding:24px">
                <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;box-shadow:0 2px 10px rgba(0,0,0,0.04)">
                    <div style="background:${variant.hero.color};color:#fff;padding:26px 24px;text-align:center">
                        <div style="width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,0.2);display:inline-flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;margin-bottom:10px">${variant.hero.icon}</div>
                        <div style="font-size:20px;font-weight:700">${variant.hero.title}</div>
                        <div style="font-size:13px;opacity:0.9;margin-top:4px">${ESC(form.title)}</div>
                    </div>
                    <div style="padding:22px 24px 6px;color:#475569;font-size:14px;line-height:1.6">${variant.lead}</div>
                    <div style="padding:6px 24px 10px">
                        <table style="width:100%;border-collapse:collapse">${paymentRows}</table>
                    </div>
                    ${ctaHtml}
                    ${answersBlock}
                    <div style="padding:14px 24px;background:#f8fafc;color:#94a3b8;font-size:12px;text-align:center;margin-top:10px">
                        Sent at ${new Date().toLocaleString()}
                    </div>
                </div>
            </div>`;

        await sendMail({ to, subject: variant.subject(form), html, tenantId: tenantId ?? form?.tenant_id ?? null });
        return { ok: true, to };
    } catch (err) {
        console.error(`[form-payment email · ${type}]`, err.message);
        return { ok: false, error: err.message };
    }
};

const buildRetryUrl = (req, token) => {
    if (!token) return null;
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    return `${proto}://${host}/pay/${token}`;
};

const buildAbsoluteBase = (req) => {
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    return `${proto}://${host}`;
};

module.exports = { sendCustomerPaymentEmail, findCustomerEmail, buildRetryUrl, buildAbsoluteBase };
