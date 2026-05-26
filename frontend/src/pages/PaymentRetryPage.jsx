import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getPaymentRetryInfo, createPaymentRetryOrder, verifyPaymentRetry, updateFormPaymentStatus } from '../services/api';

// Public retry page — opened via /pay/:token. A visitor whose original attempt
// failed or was cancelled lands here, sees the amount + current status, and
// can pay again. The token is bound to a single submission row so the admin
// sees the status flip in real time.

let rzpLoadPromise = null;
const loadRazorpay = () => {
    if (window.Razorpay) return Promise.resolve(window.Razorpay);
    if (rzpLoadPromise) return rzpLoadPromise;
    rzpLoadPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'https://checkout.razorpay.com/v1/checkout.js';
        s.async = true;
        s.onload = () => resolve(window.Razorpay);
        s.onerror = () => { rzpLoadPromise = null; reject(new Error('Failed to load Razorpay')); };
        document.body.appendChild(s);
    });
    return rzpLoadPromise;
};

const formatMoney = (amountPaise, currency) => {
    const major = (Number(amountPaise) || 0) / 100;
    try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 2 }).format(major);
    } catch {
        return `${currency || ''} ${major.toFixed(2)}`;
    }
};

const STATUS_META = {
    paid:      { label: 'Payment received',       tone: '#059669', icon: '✓', sub: 'Thank you — your payment has been confirmed.' },
    pending:   { label: 'Payment pending',        tone: '#d97706', icon: '⏱', sub: 'Complete the payment to finish your submission.' },
    failed:    { label: 'Payment failed',         tone: '#dc2626', icon: '⚠', sub: 'Your previous attempt did not go through. You can try again below.' },
    cancelled: { label: 'Payment cancelled',      tone: '#dc2626', icon: '✕', sub: 'Your previous attempt was cancelled. Resume the payment below.' },
};

export default function PaymentRetryPage() {
    const { token } = useParams();
    const [info, setInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const prevBody = document.body.style.overflow;
        const prevHtml = document.documentElement.style.overflow;
        document.body.style.overflow = 'auto';
        document.documentElement.style.overflow = 'auto';
        return () => {
            document.body.style.overflow = prevBody;
            document.documentElement.style.overflow = prevHtml;
        };
    }, []);

    const load = () => {
        setLoading(true);
        getPaymentRetryInfo(token)
            .then(r => setInfo(r.data))
            .catch(err => setError(err.response?.data?.error || 'Payment link not found'))
            .finally(() => setLoading(false));
    };
    useEffect(() => { if (token) load(); }, [token]);

    useEffect(() => {
        if (info?.form?.title) document.title = `Pay · ${info.form.title}`;
    }, [info]);

    const branding = useMemo(() => ({
        '--pf-primary': info?.form?.primary_color || '#8b5cf6',
        '--pf-secondary': info?.form?.secondary_color || '#ec4899',
        '--pf-font': info?.form?.font_family ? `${info.form.font_family}, sans-serif` : 'Inter, system-ui, sans-serif',
    }), [info]);

    const startPayment = async () => {
        setError('');
        try {
            setWorking(true);
            const Rzp = await loadRazorpay();
            const { data: order } = await createPaymentRetryOrder(token);
            const rzp = new Rzp({
                key: order.key_id,
                amount: order.amount,
                currency: order.currency,
                order_id: order.order_id,
                name: info.form.event_title || info.form.title,
                description: info.form.payment_description || info.form.title,
                theme: { color: info.form.primary_color || '#8b5cf6' },
                handler: async (resp) => {
                    try {
                        await verifyPaymentRetry(token, {
                            razorpay_order_id: resp.razorpay_order_id,
                            razorpay_payment_id: resp.razorpay_payment_id,
                            razorpay_signature: resp.razorpay_signature,
                        });
                        load();
                    } catch (err) {
                        setError(err.response?.data?.error || 'Payment verification failed');
                    } finally { setWorking(false); }
                },
                modal: {
                    ondismiss: () => {
                        updateFormPaymentStatus(order.order_id, 'cancelled', 'User closed the checkout').catch(() => {});
                        setWorking(false);
                        // Re-pull the status so the UI reflects the cancel.
                        load();
                    },
                },
            });
            rzp.on('payment.failed', (resp) => {
                const reason = resp.error?.description || resp.error?.reason || 'Payment failed';
                updateFormPaymentStatus(order.order_id, 'failed', reason).catch(() => {});
                setError(reason);
                setWorking(false);
                load();
            });
            rzp.open();
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Unable to start payment');
            setWorking(false);
        }
    };

    if (loading) {
        return (
            <div className="pr-fallback">Loading payment details…</div>
        );
    }

    if (error && !info) {
        return (
            <div className="pr-fallback">
                <h2>Link unavailable</h2>
                <p>{error}</p>
                <PRStyle />
            </div>
        );
    }

    const meta = STATUS_META[info.status] || STATUS_META.pending;
    const canPay = info.status !== 'paid';

    return (
        <div className="pr-root" style={branding}>
            <div className="pr-card">
                <header className="pr-head">
                    {info.form.event_logo_url && <img src={info.form.event_logo_url} alt="" className="pr-logo" />}
                    {info.form.event_title && <div className="pr-chip">{info.form.event_title}</div>}
                    <h1>{info.form.title}</h1>
                    {info.form.payment_description && <p className="pr-desc">{info.form.payment_description}</p>}
                </header>

                <div className="pr-status" style={{ '--pr-tone': meta.tone }}>
                    <div className="pr-status-icon">{meta.icon}</div>
                    <div>
                        <div className="pr-status-label">{meta.label}</div>
                        <div className="pr-status-sub">{meta.sub}</div>
                    </div>
                </div>

                <div className="pr-summary">
                    <div className="pr-row">
                        <span>Amount</span>
                        <span className="pr-amount">{formatMoney(info.amount, info.currency)}</span>
                    </div>
                    {info.tier_label && (
                        <div className="pr-row">
                            <span>Tier / Category</span>
                            <span>{info.tier_label}</span>
                        </div>
                    )}
                    {info.payment_id && (
                        <div className="pr-row">
                            <span>Payment ID</span>
                            <code>{info.payment_id}</code>
                        </div>
                    )}
                    {info.submitted_at && (
                        <div className="pr-row">
                            <span>Submitted</span>
                            <span>{new Date(info.submitted_at).toLocaleString()}</span>
                        </div>
                    )}
                </div>

                {error && <div className="pr-error">{error}</div>}

                {canPay ? (
                    <button className="pr-pay" disabled={working} onClick={startPayment}>
                        {working ? 'Opening Razorpay…' : `Pay ${formatMoney(info.amount, info.currency)} now`}
                    </button>
                ) : (
                    <div className="pr-done">You're all set — no further action needed.</div>
                )}

                <footer className="pr-foot">Secure payment via Razorpay</footer>
            </div>
            <PRStyle />
        </div>
    );
}

function PRStyle() {
    return (
        <style>{`
            .pr-root {
                font-family: var(--pf-font, Inter, system-ui, sans-serif);
                min-height: 100vh;
                background: linear-gradient(135deg, color-mix(in srgb, var(--pf-primary, #8b5cf6) 10%, #f8fafc), color-mix(in srgb, var(--pf-secondary, #ec4899) 10%, #f8fafc));
                padding: 40px 20px 60px;
                color: #0f172a;
                -webkit-font-smoothing: antialiased;
            }
            .pr-fallback {
                min-height: 100vh;
                display: grid; place-items: center;
                background: #f8fafc;
                font-family: system-ui, sans-serif;
                color: #475569;
                text-align: center;
                padding: 40px;
            }
            .pr-fallback h2 { color: #0f172a; margin-bottom: 6px; }
            .pr-card {
                max-width: 520px; margin: 0 auto;
                background: #fff; border-radius: 20px;
                padding: 36px 32px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04);
            }
            .pr-head { text-align: center; margin-bottom: 22px; padding-bottom: 20px; border-bottom: 1px solid #eef0f3; }
            .pr-logo { height: 48px; object-fit: contain; margin-bottom: 12px; }
            .pr-chip {
                display: inline-block; margin-bottom: 10px;
                padding: 4px 12px; border-radius: 999px;
                background: color-mix(in srgb, var(--pf-primary) 10%, transparent);
                color: var(--pf-primary);
                font-size: 0.72rem; font-weight: 700;
                letter-spacing: 0.1em; text-transform: uppercase;
            }
            .pr-head h1 { margin: 0 0 6px; font-size: 1.6rem; font-weight: 800; letter-spacing: -0.02em; line-height: 1.25; }
            .pr-desc { color: #64748b; margin: 0; line-height: 1.55; font-size: 0.92rem; }

            .pr-status {
                display: flex; gap: 14px; align-items: flex-start;
                padding: 16px 18px; border-radius: 14px;
                background: color-mix(in srgb, var(--pr-tone) 10%, #fff);
                border: 1px solid color-mix(in srgb, var(--pr-tone) 25%, transparent);
                margin-bottom: 18px;
            }
            .pr-status-icon {
                width: 36px; height: 36px; border-radius: 50%;
                background: var(--pr-tone); color: #fff;
                display: grid; place-items: center;
                font-size: 1.1rem; font-weight: 800;
                flex-shrink: 0;
            }
            .pr-status-label { font-weight: 700; color: #0f172a; }
            .pr-status-sub { color: #475569; font-size: 0.88rem; margin-top: 2px; line-height: 1.5; }

            .pr-summary {
                background: #f9fafb; border: 1px solid #e5e7eb;
                border-radius: 12px; padding: 12px 16px;
                margin-bottom: 18px;
            }
            .pr-row {
                display: flex; justify-content: space-between; gap: 16px;
                padding: 8px 0; font-size: 0.9rem;
                border-bottom: 1px dashed #e2e8f0;
            }
            .pr-row:last-child { border-bottom: none; }
            .pr-row > span:first-child { color: #64748b; }
            .pr-row > span:last-child, .pr-row code { color: #0f172a; font-weight: 500; text-align: right; word-break: break-word; }
            .pr-amount { font-weight: 800 !important; color: var(--pf-primary) !important; font-size: 1.05rem; }
            .pr-row code { background: #f1f5f9; padding: 2px 8px; border-radius: 6px; font-size: 0.82rem; }

            .pr-error {
                padding: 10px 14px; border-radius: 10px;
                background: rgba(239,68,68,0.08);
                border: 1px solid rgba(239,68,68,0.22);
                color: #b91c1c; font-size: 0.88rem;
                margin-bottom: 14px;
            }

            .pr-pay {
                width: 100%;
                background: linear-gradient(135deg, var(--pf-primary), var(--pf-secondary));
                color: #fff; border: none;
                padding: 14px 22px; border-radius: 12px;
                font-weight: 700; font-size: 1rem;
                cursor: pointer;
                box-shadow: 0 10px 25px -10px var(--pf-primary);
                transition: transform 0.15s, box-shadow 0.15s;
            }
            .pr-pay:hover:not(:disabled) { transform: translateY(-2px); }
            .pr-pay:disabled { opacity: 0.55; cursor: not-allowed; }
            .pr-done {
                text-align: center;
                padding: 14px;
                background: #ecfdf5;
                color: #065f46;
                border-radius: 12px;
                font-weight: 600;
                font-size: 0.92rem;
            }
            .pr-foot { text-align: center; color: #94a3b8; font-size: 0.72rem; margin-top: 22px; }

            @media (max-width: 640px) {
                .pr-root { padding: 20px 12px 40px; }
                .pr-card { padding: 26px 22px; border-radius: 16px; }
                .pr-head h1 { font-size: 1.35rem; }
            }
        `}</style>
    );
}
