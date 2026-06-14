import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getPublicForm, submitPublicForm, uploadPublicFormFile, createFormPaymentOrder, verifyFormPayment, updateFormPaymentStatus } from '../services/api';
import { mergeThemeConfig, configToCssVars } from '../components/FormThemeCustomizer';
import { useBranding } from '../hooks/useBranding';

// Lazy-load Razorpay's checkout.js once per page (CDN script). Returns a
// Promise that resolves to window.Razorpay; subsequent calls re-use the same
// script tag so the 30 KB bundle isn't refetched.
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

const formatMoney = (amount, currency) => {
    try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 2 }).format(Number(amount) || 0);
    } catch {
        return `${currency || ''} ${amount}`;
    }
};

// Evaluates a field's `condition` ({ field_id, op, value }) against the
// current values map. Returns true if the field should be visible (no
// condition set, or rule satisfied). Mirrors the server-side check in
// formRoutes.js so client and server agree on visibility.
const isFieldVisible = (f, values) => {
    const cond = f.condition;
    if (!cond || !cond.field_id) return true;
    const v = values[cond.field_id];
    const isEmpty = v === undefined || v === null ||
        (typeof v === 'string' && v.trim() === '') ||
        (Array.isArray(v) && v.length === 0) ||
        v === false;
    switch (cond.op) {
        case 'is_filled': return !isEmpty;
        case 'is_empty':  return isEmpty;
        case 'not_equals':
            if (Array.isArray(v)) return !v.includes(cond.value);
            return String(v ?? '') !== String(cond.value ?? '');
        case 'equals':
        default:
            if (Array.isArray(v)) return v.includes(cond.value);
            if (typeof v === 'boolean') return String(v) === String(cond.value);
            return String(v ?? '') === String(cond.value ?? '');
    }
};

// Public /f/:id page — anyone with the link can fill in the form.
// Uses event branding if the form is linked to an event, otherwise falls back
// to a neutral purple gradient. Body-scroll lock is released on mount because
// the admin app sets `body { overflow: hidden }` globally.

export default function PublicFormPage() {
    const { id } = useParams();
    const brand = useBranding();
    const [form, setForm] = useState(null);
    const [values, setValues] = useState({});
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);
    const [captchaAnswer, setCaptchaAnswer] = useState('');
    // Award-nomination forms pop a confirmation sheet before we open Razorpay
    // — user reviews the path + fee + key personal details and clicks
    // "Confirm & Pay". Non-award paid forms skip straight to Razorpay.
    const [showConfirm, setShowConfirm] = useState(false);

    // Unlock body scroll while this public page is visible.
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

    useEffect(() => {
        if (!id) return;
        setLoading(true);
        getPublicForm(id)
            .then(r => {
                setForm(r.data);
                // Pre-seed values: checkboxes need arrays, everything else is '' so
                // controlled inputs don't warn about switching between controlled/uncontrolled.
                const seed = {};
                (r.data.fields || []).forEach(f => {
                    if (f.field_type === 'checkbox') seed[f.id] = [];
                    else if (f.field_type === 'consent') seed[f.id] = false;
                    else if (f.field_type === 'file') seed[f.id] = null;
                    else if (f.field_type === 'award_category') seed[f.id] = { sector_id: '', category_id: '', subcategory_id: '' };
                    else seed[f.id] = '';
                });
                setValues(seed);
            })
            .catch(err => setError(err.response?.data?.error || 'Form not found'))
            .finally(() => setLoading(false));
    }, [id]);

    useEffect(() => {
        if (!form) return;
        document.title = form.title || 'Form';
    }, [form]);

    // If the admin configured a redirect_url, jump to it ~1.5s after the
    // thank-you panel renders so the visitor actually sees the confirmation.
    useEffect(() => {
        if (!done || !form?.redirect_url) return;
        const t = setTimeout(() => { window.location.href = form.redirect_url; }, 1500);
        return () => clearTimeout(t);
    }, [done, form]);

    // Combined branding: the chosen theme preset's defaults + the saved
    // override config (theme_config). When the form is linked to an event
    // we still let the event's brand colors win over the preset's defaults
    // for primary/font, since the operator likely wants the form to feel
    // like the event.
    const themeConfig = useMemo(() => {
        const merged = mergeThemeConfig(form?.theme || 'classic', form?.theme_config || {});
        if (form?.primary_color)   merged.primary = form.primary_color;
        if (form?.secondary_color) merged.accent  = form.secondary_color;
        if (form?.font_family)     merged.fontFamily = form.font_family;
        // The legacy "Background color" field on the form continues to win
        // over the theme so an existing form's colour isn't replaced when
        // it adopts a theme.
        if (form?.background_color) merged.background = form.background_color;
        return merged;
    }, [form]);

    const themeKey = form?.theme || 'classic';

    const branding = useMemo(() => {
        const vars = configToCssVars(themeConfig);
        // Keep the legacy --pf-secondary alias used in older sections of
        // this file (chip buttons, the redirect-link colour). It maps to
        // the current --pf-accent.
        vars['--pf-secondary'] = themeConfig.accent;
        // Page background is set on the root div directly, not via a CSS
        // variable, so a CSS gradient string applies cleanly.
        return { ...vars, background: themeConfig.background };
    }, [themeConfig]);

    // For `tiered` payment mode — pick the currently-active tier based on
    // `valid_until`. Same logic as the backend's resolveCharge, mirrored here
    // so the pricing panel + Pay button label can show the current amount.
    // Returns { tier, closed } — closed=true when every tier has expired.
    const activeTier = useMemo(() => {
        if (!form || form.payment_mode !== 'tiered') return null;
        const tiers = form.payment_tiers || [];
        if (tiers.length === 0) return { tier: null, closed: true };
        const now = Date.now();
        const ordered = tiers.slice().sort((a, b) => {
            const da = a.valid_until ? new Date(a.valid_until).getTime() : Number.POSITIVE_INFINITY;
            const db = b.valid_until ? new Date(b.valid_until).getTime() : Number.POSITIVE_INFINITY;
            return da - db;
        });
        const pick = ordered.find(t => !t.valid_until || new Date(t.valid_until).getTime() >= now);
        return pick ? { tier: pick, closed: false } : { tier: null, closed: true };
    }, [form]);

    // For `award_category` payment mode: walk up the selected sector/category/
    // subcategory chain and return the deepest non-null amount, plus its label
    // path. Used to preview the fee on the Pay button and pass the selected
    // leaf id to the order endpoint.
    const awardChargeFromSelection = useMemo(() => {
        if (!form || form.payment_mode !== 'award_category') return null;
        const awardField = form.fields?.find(f => f.field_type === 'award_category');
        if (!awardField) return null;
        const v = values[awardField.id] || {};
        const leaf = v.subcategory_id || v.category_id || v.sector_id;
        if (!leaf) return { leafId: null, amount: null, label: null };
        const all = form.award_categories || [];
        const byId = new Map(all.map(c => [Number(c.id), c]));
        let cursor = Number(leaf);
        let amount = null;
        const path = [];
        for (let i = 0; i < 4 && cursor; i++) {
            const row = byId.get(cursor);
            if (!row) break;
            path.unshift(row.name);
            if (amount == null && row.amount != null) amount = Number(row.amount);
            cursor = row.parent_id ? Number(row.parent_id) : null;
        }
        return { leafId: Number(leaf), amount, label: path.join(' → ') };
    }, [form, values]);

    const setVal = (fieldId, v) => setValues(s => ({ ...s, [fieldId]: v }));

    const toggleCheckbox = (fieldId, opt) => {
        setValues(s => {
            const arr = Array.isArray(s[fieldId]) ? s[fieldId] : [];
            return {
                ...s,
                [fieldId]: arr.includes(opt) ? arr.filter(x => x !== opt) : [...arr, opt],
            };
        });
    };

    // File upload handler — uploads immediately on file select so the submit
    // payload only needs to carry the returned { url, name, size } blob.
    const uploadFile = async (fieldId, file) => {
        if (!file) { setVal(fieldId, null); return; }
        try {
            setVal(fieldId, { uploading: true, name: file.name });
            const { data } = await uploadPublicFormFile(id, file);
            setVal(fieldId, data);
        } catch (err) {
            setError(err.response?.data?.error || 'Upload failed');
            setVal(fieldId, null);
        }
    };

    // Actual Razorpay popup + verify-and-persist logic. Split out of
    // `handleSubmit` so it can be reused by the award confirmation modal's
    // "Confirm & Pay" button.
    const openRazorpayCheckout = async () => {
        try {
            setSubmitting(true);
            const Rzp = await loadRazorpay();
            const orderPayload = {
                ...(form.payment_mode === 'tiered' ? { tier_label: activeTier.tier.label } : {}),
                ...(form.payment_mode === 'award_category' ? { award_category_id: awardChargeFromSelection.leafId } : {}),
                // Send the full answer payload with the order so we persist a
                // PENDING submission — the admin sees failed/cancelled attempts too.
                data: values,
                ...(form.captcha_enabled ? { captcha_token: form.captcha?.token, captcha_answer: captchaAnswer } : {}),
            };
            const { data: order } = await createFormPaymentOrder(id, orderPayload);

            // Prefill from known email / name / phone fields to skip Razorpay's intro step.
            const emailField = form.fields.find(f => f.field_type === 'email');
            const nameField = form.fields.find(f => f.field_type === 'name');
            const phoneField = form.fields.find(f => f.field_type === 'phone');
            const prefill = {
                email: emailField ? (values[emailField.id] || '') : '',
                name:  nameField  ? (values[nameField.id]  || '') : '',
                contact: phoneField ? (values[phoneField.id] || '') : '',
            };

            const rzp = new Rzp({
                key: order.key_id,
                amount: order.amount,
                currency: order.currency,
                order_id: order.order_id,
                name: form.event_title || form.title,
                description: form.payment_description || form.title,
                prefill,
                theme: { color: form.primary_color || '#8b5cf6' },
                handler: async (resp) => {
                    try {
                        await verifyFormPayment({
                            form_id: Number(id),
                            razorpay_order_id: resp.razorpay_order_id,
                            razorpay_payment_id: resp.razorpay_payment_id,
                            razorpay_signature: resp.razorpay_signature,
                            tier_label: form.payment_mode === 'tiered' ? activeTier?.tier?.label || null : null,
                            award_category_id: form.payment_mode === 'award_category' ? awardChargeFromSelection?.leafId || null : null,
                            data: values,
                        });
                        setDone(true);
                    } catch (err) {
                        setError(err.response?.data?.error || 'Payment verification failed');
                    } finally { setSubmitting(false); }
                },
                modal: {
                    ondismiss: () => {
                        // Visitor closed the Razorpay popup without paying.
                        // Mark the pending submission so admins can see the abandon.
                        updateFormPaymentStatus(order.order_id, 'cancelled', 'User closed the checkout').catch(() => {});
                        setSubmitting(false);
                    },
                },
            });
            rzp.on('payment.failed', (resp) => {
                const reason = resp.error?.description || resp.error?.reason || 'Payment failed';
                updateFormPaymentStatus(order.order_id, 'failed', reason).catch(() => {});
                setError(reason);
                setSubmitting(false);
            });
            rzp.open();
        } catch (err) {
            setError(err.response?.data?.error || err.message || 'Unable to start payment');
            setSubmitting(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form) return;
        setError('');

        // Client-side required check — the server re-validates, this is just
        // for fast feedback so the user doesn't round-trip to see "X is required".
        // Skip validation for fields that are hidden by their condition.
        for (const f of form.fields) {
            if (!isFieldVisible(f, values)) continue;
            const v = values[f.id];
            const empty = v === null || v === undefined ||
                (typeof v === 'string' && v.trim() === '') ||
                (Array.isArray(v) && v.length === 0) ||
                (f.field_type === 'consent' && v !== true) ||
                (f.field_type === 'file' && !(v && v.url)) ||
                (f.field_type === 'award_category' && !(v && v.sector_id));
            if (f.required && empty) {
                setError(`"${f.label}" is required`);
                return;
            }
            if (f.field_type === 'file' && v && v.uploading) {
                setError('Please wait for the file upload to finish');
                return;
            }
            if (f.field_type === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v).trim())) {
                setError(`"${f.label}" must be a valid email`);
                return;
            }
        }

        // Captcha — quick client check before round-tripping to the server.
        if (form.captcha_enabled && String(captchaAnswer).trim() === '') {
            setError('Please solve the captcha to continue.');
            return;
        }

        // Payment branch — open Razorpay instead of the plain submit.
        if (form.payment_enabled) {
            if (form.payment_mode === 'tiered') {
                if (!activeTier || activeTier.closed) {
                    setError('Registration has closed — all pricing tiers have expired.');
                    return;
                }
            }
            if (form.payment_mode === 'award_category' && !awardChargeFromSelection?.leafId) {
                setError('Please pick a category before paying.');
                return;
            }
            if (form.payment_mode === 'award_category' && awardChargeFromSelection?.amount == null) {
                setError('The selected category has no nomination fee configured.');
                return;
            }
            // Award nominations get a confirmation sheet so the visitor can
            // eyeball their selections + fee before the Razorpay popup opens.
            const isAward = form.fields?.some(f => f.field_type === 'award_category');
            if (isAward) {
                setShowConfirm(true);
                return;
            }
            await openRazorpayCheckout();
            return;
        }

        try {
            setSubmitting(true);
            const extra = form.captcha_enabled
                ? { captcha_token: form.captcha?.token, captcha_answer: captchaAnswer }
                : {};
            await submitPublicForm(id, values, extra);
            setDone(true);
        } catch (err) {
            setError(err.response?.data?.error || 'Submission failed');
            // If the captcha was rejected/expired, fetch a fresh challenge so
            // the user can retry without a full page reload.
            if (form.captcha_enabled && /captcha/i.test(err.response?.data?.error || '')) {
                try {
                    const r = await getPublicForm(id);
                    setForm(prev => ({ ...prev, captcha: r.data.captcha }));
                    setCaptchaAnswer('');
                } catch { /* ignore */ }
            }
        } finally { setSubmitting(false); }
    };

    if (loading) {
        return (
            <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f8fafc', fontFamily: 'system-ui, sans-serif', color: '#475569' }}>
                Loading…
            </div>
        );
    }

    if (error && !form) {
        return (
            <div style={{ padding: 60, textAlign: 'center', fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: '#f8fafc' }}>
                <h2 style={{ color: '#1f2937', marginBottom: 8 }}>Form not available</h2>
                <p style={{ color: '#6b7280' }}>{error}</p>
            </div>
        );
    }

    if (done) {
        return (
            <div className={`pf-root pf-theme-${themeKey}`} style={branding}>
                <div className="pf-container pf-done">
                    <div className="pf-check">✓</div>
                    <h2>Thank you!</h2>
                    <p>{form.thank_you_message || 'Your response has been recorded.'}</p>
                    {form.redirect_url && (
                        <p style={{ marginTop: 18, fontSize: '0.85rem', color: '#94a3b8' }}>
                            Redirecting… <a href={form.redirect_url} style={{ color: 'var(--pf-primary)', fontWeight: 600 }}>Click here if nothing happens</a>
                        </p>
                    )}
                </div>
                <PFStyle />
            </div>
        );
    }

    // Form is explicitly closed — either past its close date or hit its
    // submission cap. Render a friendly closed page instead of the fill form.
    if (form.is_open === false) {
        const reason = form.close_reason === 'closed_by_date'
            ? 'This form has closed and is no longer accepting responses.'
            : form.close_reason === 'full'
                ? 'This form has reached its response limit.'
                : 'This form is currently closed.';
        return (
            <div className={`pf-root pf-theme-${themeKey}`} style={branding}>
                <div className="pf-container pf-done">
                    <div className="pf-check" style={{ background: '#e5e7eb', color: '#64748b', boxShadow: 'none' }}>🔒</div>
                    <h2>Form closed</h2>
                    <p>{reason}</p>
                </div>
                <PFStyle />
            </div>
        );
    }

    return (
        <div className={`pf-root pf-theme-${themeKey}`} style={branding}>
            <div className="pf-container">
                {form.header_image_url && (
                    <div className="pf-header-banner" style={{ margin: '0 -38px 16px' }}>
                        <img
                            src={form.header_image_url}
                            alt=""
                            style={{ width: '100%', height: 'auto', display: 'block', objectFit: 'cover' }}
                            onError={e => { e.currentTarget.parentElement.style.display = 'none'; }}
                        />
                    </div>
                )}
                <header className="pf-header">
                    {form.event_logo_url && <img src={form.event_logo_url} alt="" className="pf-logo" />}
                    {form.event_title && <div className="pf-event-chip">{form.event_title}</div>}
                    <h1>{form.title}</h1>
                    {form.description && <p className="pf-desc">{form.description}</p>}
                </header>

                <form onSubmit={handleSubmit} className="pf-form" noValidate>
                    {form.fields.map((f, idx) => {
                        if (!isFieldVisible(f, values)) return null;
                        return (
                            <div key={f.id} className={`pf-field pf-${f.width === 'half' ? 'half' : 'full'}`}>
                                {f.field_type !== 'consent' && (
                                    <label className="pf-label">
                                        <span className="pf-idx">{idx + 1}.</span>
                                        <span>{f.label} {f.required && <span className="pf-req">*</span>}</span>
                                    </label>
                                )}
                                {f.help_text && <div className="pf-help">{f.help_text}</div>}
                                {renderInput(f, values[f.id], setVal, toggleCheckbox, uploadFile, form.award_categories || [])}
                            </div>
                        );
                    })}

                    {form.payment_enabled && (
                        <div className="pf-payment pf-full">
                            <div className="pf-payment-head">
                                <span className="pf-payment-icon">💳</span>
                                <span>Payment required to submit</span>
                            </div>
                            {form.payment_description && (
                                <p className="pf-payment-desc">{form.payment_description}</p>
                            )}
                            {form.payment_mode === 'tiered' ? (
                                activeTier?.tier ? (
                                    <div className="pf-tier-fixed">
                                        <div>
                                            <div style={{ fontWeight: 700, color: '#0f172a' }}>{activeTier.tier.label}</div>
                                            {activeTier.tier.valid_until && (
                                                <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>
                                                    Valid until {new Date(activeTier.tier.valid_until).toLocaleString()}
                                                </div>
                                            )}
                                        </div>
                                        <span className="pf-tier-amount">{formatMoney(activeTier.tier.amount, form.payment_currency)}</span>
                                    </div>
                                ) : (
                                    <div className="pf-tier-fixed" style={{ color: '#b91c1c', borderColor: '#fecaca', background: '#fef2f2' }}>
                                        <span>Registration closed — all pricing tiers have expired.</span>
                                    </div>
                                )
                            ) : form.payment_mode === 'award_category' ? (
                                <div className="pf-tier-fixed">
                                    {awardChargeFromSelection?.amount != null ? (
                                        <>
                                            <span>{awardChargeFromSelection.label || 'Selection'}</span>
                                            <span className="pf-tier-amount">{formatMoney(awardChargeFromSelection.amount, form.payment_currency)}</span>
                                        </>
                                    ) : (
                                        <span style={{ color: '#64748b', fontStyle: 'italic' }}>Pick a category above to see the nomination fee.</span>
                                    )}
                                </div>
                            ) : (
                                <div className="pf-tier-fixed">
                                    <span>Total</span>
                                    <span className="pf-tier-amount">{formatMoney(form.payment_amount, form.payment_currency)}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {form.captcha_enabled && form.captcha?.question && (
                        <div className="pf-field pf-full">
                            <label className="pf-label">
                                <span>Spam check <span className="pf-req">*</span></span>
                            </label>
                            <div className="pf-captcha">
                                <span className="pf-captcha-q">{form.captcha.question} =</span>
                                <input
                                    type="number"
                                    inputMode="numeric"
                                    className="pf-input pf-captcha-input"
                                    value={captchaAnswer}
                                    onChange={e => setCaptchaAnswer(e.target.value)}
                                    placeholder="?"
                                    autoComplete="off"
                                />
                            </div>
                        </div>
                    )}

                    {error && <div className="pf-error pf-full">{error}</div>}

                    <button
                        type="submit"
                        className="pf-submit pf-full"
                        disabled={
                            submitting
                            || form.fields.length === 0
                            || (form.payment_enabled && form.payment_mode === 'tiered' && activeTier?.closed)
                        }
                    >
                        {submitting
                            ? (form.payment_enabled ? 'Processing…' : 'Submitting…')
                            : form.payment_enabled
                                ? (() => {
                                    if (form.payment_mode === 'fixed') return `Pay & Submit · ${formatMoney(form.payment_amount, form.payment_currency)}`;
                                    if (form.payment_mode === 'tiered' && activeTier?.tier) return `Pay & Submit · ${formatMoney(activeTier.tier.amount, form.payment_currency)}`;
                                    return 'Pay & Submit';
                                })()
                                : (form.submit_label || 'Submit')}
                    </button>
                </form>

                {!form.hide_footer && (
                    <footer className="pf-footer">Powered by {brand.site_title || 'Eventogen'}</footer>
                )}
            </div>

            {/* Award-nomination confirmation sheet. Renders the picked path,
                fee, and a compact summary of filled-in fields so the visitor
                can review before the Razorpay popup opens. */}
            {showConfirm && (
                <div className="pf-confirm-overlay" onClick={() => !submitting && setShowConfirm(false)}>
                    <div className="pf-confirm-card" onClick={e => e.stopPropagation()}>
                        <div className="pf-confirm-head">
                            <div className="pf-confirm-title">Review your nomination</div>
                            <div className="pf-confirm-sub">Confirm the details below, then proceed to secure payment.</div>
                        </div>
                        <div className="pf-confirm-body">
                            {awardChargeFromSelection?.label && (
                                <div className="pf-confirm-section">
                                    <div className="pf-confirm-label">Nomination</div>
                                    <div className="pf-confirm-path">{awardChargeFromSelection.label}</div>
                                </div>
                            )}
                            <div className="pf-confirm-section pf-confirm-fee">
                                <div className="pf-confirm-label">
                                    {form.payment_mode === 'tiered' && activeTier?.tier?.label
                                        ? `Total (${activeTier.tier.label})`
                                        : form.payment_mode === 'award_category'
                                            ? 'Nomination fee'
                                            : 'Total'}
                                </div>
                                <div className="pf-confirm-amount">
                                    {(() => {
                                        if (form.payment_mode === 'fixed') return formatMoney(form.payment_amount, form.payment_currency);
                                        if (form.payment_mode === 'tiered' && activeTier?.tier) return formatMoney(activeTier.tier.amount, form.payment_currency);
                                        if (form.payment_mode === 'award_category' && awardChargeFromSelection?.amount != null) return formatMoney(awardChargeFromSelection.amount, form.payment_currency);
                                        return '—';
                                    })()}
                                </div>
                            </div>
                            <div className="pf-confirm-section">
                                <div className="pf-confirm-label">Your details</div>
                                <div className="pf-confirm-answers">
                                    {form.fields
                                        .filter(f => f.field_type !== 'award_category' && values[f.id] != null && values[f.id] !== '')
                                        .slice(0, 8)
                                        .map(f => {
                                            const v = values[f.id];
                                            let disp;
                                            if (Array.isArray(v)) disp = v.join(', ');
                                            else if (typeof v === 'object' && v?.url) disp = v.name || 'file';
                                            else disp = String(v);
                                            return (
                                                <div key={f.id} className="pf-confirm-row">
                                                    <span className="pf-confirm-k">{f.label}</span>
                                                    <span className="pf-confirm-v">{disp}</span>
                                                </div>
                                            );
                                        })}
                                </div>
                            </div>
                        </div>
                        <div className="pf-confirm-actions">
                            <button
                                type="button"
                                className="pf-confirm-btn pf-confirm-btn-ghost"
                                onClick={() => setShowConfirm(false)}
                                disabled={submitting}
                            >Edit</button>
                            <button
                                type="button"
                                className="pf-confirm-btn pf-confirm-btn-primary"
                                disabled={submitting}
                                onClick={async () => {
                                    setShowConfirm(false);
                                    await openRazorpayCheckout();
                                }}
                            >
                                {submitting ? 'Processing…' : (() => {
                                    let amt = null;
                                    if (form.payment_mode === 'fixed') amt = form.payment_amount;
                                    else if (form.payment_mode === 'tiered' && activeTier?.tier) amt = activeTier.tier.amount;
                                    else if (form.payment_mode === 'award_category' && awardChargeFromSelection?.amount != null) amt = awardChargeFromSelection.amount;
                                    return amt != null ? `Confirm & Pay · ${formatMoney(amt, form.payment_currency)}` : 'Confirm & Pay';
                                })()}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <PFStyle />
        </div>
    );
}

function renderInput(f, value, setVal, toggleCheckbox, uploadFile, awardCategories) {
    const common = { id: `pf-f-${f.id}`, className: 'pf-input', placeholder: f.placeholder || '' };
    switch (f.field_type) {
        case 'textarea':
        case 'address':
            return <textarea {...common} rows={f.field_type === 'address' ? 3 : 4} value={value || ''} onChange={e => setVal(f.id, e.target.value)} />;
        case 'email':
            return <input {...common} type="email" value={value || ''} onChange={e => setVal(f.id, e.target.value)} />;
        case 'phone':
            return <input {...common} type="tel" value={value || ''} onChange={e => setVal(f.id, e.target.value)} />;
        case 'number':
            return <input {...common} type="number" value={value ?? ''} onChange={e => setVal(f.id, e.target.value)} />;
        case 'date':
            return <input {...common} type="date" value={value || ''} onChange={e => setVal(f.id, e.target.value)} />;
        case 'time':
            return <input {...common} type="time" value={value || ''} onChange={e => setVal(f.id, e.target.value)} />;
        case 'name':
            return <input {...common} type="text" autoComplete="name" value={value || ''} onChange={e => setVal(f.id, e.target.value)} />;
        case 'file': {
            const isUploading = value && value.uploading;
            const isUploaded = value && value.url;
            return (
                <div>
                    <label className="pf-filebox">
                        <input
                            type="file"
                            style={{ display: 'none' }}
                            onChange={e => uploadFile(f.id, e.target.files?.[0])}
                        />
                        {isUploading && <span>Uploading {value.name}…</span>}
                        {isUploaded && <span>✓ {value.name} <span style={{ color: '#64748b', fontSize: '0.8rem' }}>— click to replace</span></span>}
                        {!isUploading && !isUploaded && <span>📎 Choose a file</span>}
                    </label>
                </div>
            );
        }
        case 'dropdown':
            return (
                <select {...common} value={value || ''} onChange={e => setVal(f.id, e.target.value)}>
                    <option value="">— Select —</option>
                    {(f.options || []).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
            );
        case 'radio':
            return (
                <div className="pf-choices">
                    {(f.options || []).map(o => (
                        <label key={o} className="pf-choice">
                            <input type="radio" name={`f-${f.id}`} value={o} checked={value === o} onChange={e => setVal(f.id, e.target.value)} />
                            <span>{o}</span>
                        </label>
                    ))}
                </div>
            );
        case 'checkbox':
            return (
                <div className="pf-choices">
                    {(f.options || []).map(o => (
                        <label key={o} className="pf-choice">
                            <input type="checkbox" checked={Array.isArray(value) && value.includes(o)} onChange={() => toggleCheckbox(f.id, o)} />
                            <span>{o}</span>
                        </label>
                    ))}
                </div>
            );
        case 'consent':
            // Single-checkbox field: stored as boolean true/false. The label
            // is suppressed; the placeholder text acts as the inline label.
            return (
                <label className="pf-choice" style={{ marginTop: 4 }}>
                    <input type="checkbox" checked={!!value} onChange={e => setVal(f.id, e.target.checked)} />
                    <span>{f.placeholder || 'Yes'} {f.required && <span className="pf-req">*</span>}</span>
                </label>
            );
        case 'award_category': {
            // Three cascading selects: Sector → Category → Subcategory.
            // All three slots always render so visitors see the full flow;
            // Category/Subcategory are disabled until a parent is picked.
            // IDs kept as strings so the controlled <select> reconciles cleanly.
            const all = awardCategories || [];
            const selSectorId = value?.sector_id != null ? String(value.sector_id) : '';
            const selCatId = value?.category_id != null ? String(value.category_id) : '';
            const selSubId = value?.subcategory_id != null ? String(value.subcategory_id) : '';
            const sectors = all.filter(c => c.parent_id == null);
            const cats = selSectorId ? all.filter(c => String(c.parent_id) === selSectorId) : [];
            const subs = selCatId ? all.filter(c => String(c.parent_id) === selCatId) : [];
            if (sectors.length === 0) {
                return <div className="pf-help" style={{ fontStyle: 'italic' }}>No sectors configured for this event.</div>;
            }
            const catPlaceholder = !selSectorId
                ? '— Pick a sector first —'
                : cats.length === 0
                    ? '— No categories in this sector —'
                    : '— Category —';
            // Only render the subcategory dropdown when the picked category
            // actually has children — otherwise hide it entirely.
            const showSub = selCatId && subs.length > 0;
            return (
                <div className="pf-award-cat">
                    <select
                        className="pf-input"
                        value={selSectorId}
                        onChange={e => setVal(f.id, { sector_id: e.target.value, category_id: '', subcategory_id: '' })}
                    >
                        <option value="">— Sector —</option>
                        {sectors.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                    </select>
                    <select
                        className="pf-input"
                        value={selCatId}
                        onChange={e => setVal(f.id, { sector_id: selSectorId, category_id: e.target.value, subcategory_id: '' })}
                        disabled={!selSectorId || cats.length === 0}
                    >
                        <option value="">{catPlaceholder}</option>
                        {cats.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                    </select>
                    {showSub && (
                        <select
                            className="pf-input"
                            value={selSubId}
                            onChange={e => setVal(f.id, { sector_id: selSectorId, category_id: selCatId, subcategory_id: e.target.value })}
                        >
                            <option value="">— Subcategory —</option>
                            {subs.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                        </select>
                    )}
                </div>
            );
        }
        case 'text':
        default:
            return <input {...common} type="text" value={value || ''} onChange={e => setVal(f.id, e.target.value)} />;
    }
}

function PFStyle() {
    return (
        <style>{`
            .pf-root {
                font-family: var(--pf-font);
                font-size: var(--pf-font-size, 15px);
                min-height: 100vh;
                padding: 40px 20px 60px;
                color: var(--pf-text, #0f172a);
                -webkit-font-smoothing: antialiased;
            }
            .pf-container {
                max-width: var(--pf-card-w, 800px); margin: 0 auto;
                background: var(--pf-surface, #fff);
                color: var(--pf-text, #0f172a);
                border-radius: var(--pf-card-r, 0px);
                padding: 0 38px 40px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.08), 0 2px 6px rgba(0,0,0,0.04);
            }
            .pf-header {
                text-align: center; margin-bottom: 32px;
                padding-bottom: 24px;
                border-bottom: 1px solid color-mix(in srgb, var(--pf-text) 12%, transparent);
            }
            .pf-logo { height: 54px; object-fit: contain; margin-bottom: 16px; }
            .pf-event-chip {
                display: inline-block; margin-bottom: 12px;
                padding: 4px 12px; border-radius: 999px;
                background: color-mix(in srgb, var(--pf-primary) 10%, transparent);
                color: var(--pf-primary);
                font-size: 0.72rem; font-weight: 700;
                letter-spacing: 0.1em; text-transform: uppercase;
            }
            .pf-header h1 {
                margin: 0 0 8px; font-size: 1.8rem; font-weight: 800;
                letter-spacing: -0.02em; line-height: 1.2;
                color: var(--pf-text, #0f172a);
            }
            .pf-desc { color: var(--pf-muted, #64748b); margin: 0; line-height: 1.6; font-size: 0.95rem; }

            .pf-form {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: var(--pf-field-gap, 22px);
            }
            .pf-field { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
            .pf-full { grid-column: 1 / -1; }
            .pf-half { grid-column: span 1; }
            .pf-label { display: flex; gap: 8px; font-weight: 600; color: var(--pf-text, #0f172a); font-size: 0.95rem; }
            .pf-idx { color: var(--pf-primary); }
            .pf-req { color: #ef4444; }
            .pf-help { color: var(--pf-muted, #64748b); font-size: 0.82rem; margin-top: -2px; line-height: 1.5; }

            .pf-filebox {
                display: flex; align-items: center; justify-content: center;
                padding: 22px;
                border-radius: var(--pf-field-r, 10px);
                border: 2px dashed color-mix(in srgb, var(--pf-text) 25%, transparent);
                background: color-mix(in srgb, var(--pf-text) 4%, transparent);
                color: var(--pf-muted, #64748b); font-size: 0.9rem;
                cursor: pointer; transition: all 0.15s;
            }
            .pf-filebox:hover {
                border-color: var(--pf-primary);
                background: var(--pf-surface, #fff);
                color: var(--pf-primary);
            }

            .pf-input, .pf-form select.pf-input, .pf-form textarea.pf-input {
                width: 100%;
                border: 1px solid color-mix(in srgb, var(--pf-text) 15%, transparent);
                border-radius: var(--pf-field-r, 10px);
                padding: 12px 14px;
                background: color-mix(in srgb, var(--pf-text) 4%, transparent);
                color: var(--pf-text, #0f172a);
                font-size: 0.95rem;
                font-family: inherit;
                transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
                outline: none;
            }
            .pf-input:focus {
                border-color: var(--pf-primary);
                background: var(--pf-surface, #fff);
                box-shadow: 0 0 0 4px color-mix(in srgb, var(--pf-primary) 15%, transparent);
            }
            .pf-input::placeholder { color: var(--pf-muted, #94a3b8); }
            textarea.pf-input { resize: vertical; min-height: 96px; }

            .pf-payment {
                padding: 18px 20px; border-radius: 14px;
                background: linear-gradient(135deg, color-mix(in srgb, var(--pf-primary) 8%, #fff), color-mix(in srgb, var(--pf-secondary) 8%, #fff));
                border: 1px solid color-mix(in srgb, var(--pf-primary) 20%, transparent);
            }
            .pf-payment-head {
                display: flex; align-items: center; gap: 8px;
                font-weight: 700; color: #0f172a; font-size: 0.95rem;
                margin-bottom: 4px;
            }
            .pf-payment-icon { font-size: 1.1rem; }
            .pf-payment-desc { color: #475569; font-size: 0.85rem; margin: 0 0 14px; line-height: 1.5; }
            .pf-tier-list { display: flex; flex-direction: column; gap: 8px; }
            .pf-tier {
                display: flex; align-items: center; gap: 12px;
                padding: 12px 16px; border-radius: 10px;
                border: 1.5px solid #e5e7eb; background: #fff;
                cursor: pointer; transition: all 0.15s;
                font-size: 0.92rem;
            }
            .pf-tier:hover { border-color: var(--pf-primary); }
            .pf-tier.on {
                border-color: var(--pf-primary);
                background: color-mix(in srgb, var(--pf-primary) 5%, #fff);
                box-shadow: 0 0 0 3px color-mix(in srgb, var(--pf-primary) 15%, transparent);
            }
            .pf-tier input { accent-color: var(--pf-primary); }
            .pf-tier-label { flex: 1; font-weight: 600; color: #0f172a; }
            .pf-tier-amount { font-weight: 700; color: var(--pf-primary); font-size: 1rem; }
            .pf-tier-fixed {
                display: flex; justify-content: space-between; align-items: center;
                padding: 14px 18px; border-radius: 10px;
                background: #fff; border: 1.5px solid #e5e7eb;
                font-size: 0.95rem; color: #0f172a; font-weight: 600;
            }

            .pf-award-cat { display: flex; flex-wrap: wrap; gap: 10px; }
            .pf-award-cat > select { flex: 1 1 200px; min-width: 0; }

            .pf-choices { display: flex; flex-direction: column; gap: 8px; }
            .pf-choice {
                display: flex; align-items: center; gap: 10px;
                padding: 10px 14px; border-radius: 10px;
                border: 1px solid #e5e7eb; background: #f9fafb;
                cursor: pointer; transition: all 0.15s;
                font-size: 0.92rem;
            }
            .pf-choice:hover { border-color: var(--pf-primary); background: #fff; }
            .pf-choice input { accent-color: var(--pf-primary); }
            .pf-choice input:checked + span { font-weight: 600; color: var(--pf-primary); }

            .pf-error {
                padding: 10px 14px; border-radius: 10px;
                background: rgba(239,68,68,0.08);
                border: 1px solid rgba(239,68,68,0.2);
                color: #b91c1c; font-size: 0.88rem;
            }

            .pf-captcha {
                display: flex; align-items: center; gap: 12px;
                padding: 10px 14px; border-radius: 10px;
                background: #f8fafc; border: 1px solid #e2e8f0;
            }
            .pf-captcha-q {
                font-weight: 700; font-size: 1.1rem; color: #0f172a;
                font-variant-numeric: tabular-nums; letter-spacing: 0.05em;
            }
            .pf-captcha-input {
                width: 90px !important; flex: 0 0 auto;
                text-align: center; font-weight: 600;
            }

            .pf-submit {
                background: linear-gradient(135deg, var(--pf-primary), var(--pf-secondary));
                color: #fff; border: none;
                padding: 14px 22px; border-radius: 12px;
                font-weight: 700; font-size: 1rem;
                cursor: pointer;
                box-shadow: 0 10px 25px -10px var(--pf-primary);
                transition: transform 0.15s, box-shadow 0.15s;
                margin-top: 8px;
            }
            .pf-submit:hover:not(:disabled) { transform: translateY(-2px); }
            .pf-submit:disabled { opacity: 0.55; cursor: not-allowed; }

            .pf-footer { text-align: center; color: #94a3b8; font-size: 0.72rem; margin-top: 30px; }

            /* ── Confirmation sheet ──────────────────────────────── */
            .pf-confirm-overlay {
                position: fixed; inset: 0;
                background: rgba(15,23,42,0.55);
                backdrop-filter: blur(4px);
                z-index: 1050;
                display: flex; align-items: center; justify-content: center;
                padding: 20px;
                animation: pf-fade-in 0.15s ease-out;
            }
            @keyframes pf-fade-in { from { opacity: 0; } to { opacity: 1; } }
            .pf-confirm-card {
                background: #fff;
                max-width: 520px;
                width: 100%;
                border-radius: 18px;
                box-shadow: 0 30px 80px rgba(0,0,0,0.3);
                overflow: hidden;
                animation: pf-slide-up 0.2s ease-out;
            }
            @keyframes pf-slide-up { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            .pf-confirm-head {
                padding: 22px 26px 16px;
                border-bottom: 1px solid #eef0f3;
            }
            .pf-confirm-title { font-size: 1.15rem; font-weight: 700; color: #0f172a; }
            .pf-confirm-sub { font-size: 0.85rem; color: #64748b; margin-top: 4px; }
            .pf-confirm-body { padding: 16px 26px; max-height: 60vh; overflow-y: auto; }
            .pf-confirm-section { padding: 10px 0; }
            .pf-confirm-section + .pf-confirm-section { border-top: 1px dashed #e2e8f0; }
            .pf-confirm-label {
                font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em;
                font-weight: 700; color: #94a3b8; margin-bottom: 6px;
            }
            .pf-confirm-path {
                font-size: 1rem; font-weight: 600; color: #0f172a;
                padding: 10px 12px;
                background: color-mix(in srgb, var(--pf-primary) 8%, #fff);
                border: 1px solid color-mix(in srgb, var(--pf-primary) 20%, transparent);
                border-radius: 10px;
            }
            .pf-confirm-fee {
                display: flex; justify-content: space-between; align-items: center;
            }
            .pf-confirm-amount {
                font-size: 1.3rem; font-weight: 800;
                color: var(--pf-primary);
            }
            .pf-confirm-answers { display: flex; flex-direction: column; gap: 6px; }
            .pf-confirm-row {
                display: flex; justify-content: space-between; gap: 12px;
                font-size: 0.88rem;
            }
            .pf-confirm-k { color: #64748b; flex-shrink: 0; }
            .pf-confirm-v { color: #0f172a; font-weight: 500; text-align: right; word-break: break-word; }
            .pf-confirm-actions {
                display: flex; gap: 10px;
                padding: 14px 26px 22px;
                border-top: 1px solid #eef0f3;
                background: #f8fafc;
            }
            .pf-confirm-btn {
                flex: 1;
                padding: 12px 18px;
                border-radius: 10px;
                font-weight: 700; font-size: 0.92rem;
                border: none; cursor: pointer;
                font-family: inherit;
                transition: transform 0.15s, box-shadow 0.15s, background 0.15s;
            }
            .pf-confirm-btn:disabled { opacity: 0.55; cursor: not-allowed; }
            .pf-confirm-btn-ghost {
                background: #fff;
                color: #475569;
                border: 1.5px solid #cbd5e1;
            }
            .pf-confirm-btn-ghost:hover:not(:disabled) { border-color: var(--pf-primary); color: var(--pf-primary); }
            .pf-confirm-btn-primary {
                background: linear-gradient(135deg, var(--pf-primary), var(--pf-secondary));
                color: #fff;
                flex: 2;
                box-shadow: 0 10px 25px -10px var(--pf-primary);
            }
            .pf-confirm-btn-primary:hover:not(:disabled) { transform: translateY(-1px); }

            @media (max-width: 640px) {
                .pf-confirm-overlay { padding: 12px; align-items: flex-end; }
                .pf-confirm-card { border-radius: 16px 16px 12px 12px; }
                .pf-confirm-head { padding: 18px 20px 12px; }
                .pf-confirm-body { padding: 12px 20px; }
                .pf-confirm-actions { padding: 12px 20px 18px; flex-direction: column-reverse; }
                .pf-confirm-btn { flex: 1; }
            }

            /* Done state */
            .pf-done { text-align: center; padding: 72px 40px; }
            .pf-check {
                width: 72px; height: 72px; border-radius: 50%;
                margin: 0 auto 18px;
                background: linear-gradient(135deg, var(--pf-primary), var(--pf-secondary));
                color: #fff; font-size: 2.4rem; font-weight: 700;
                display: grid; place-items: center;
                box-shadow: 0 14px 40px -10px var(--pf-primary);
            }
            .pf-done h2 { margin: 0 0 10px; font-size: 1.8rem; font-weight: 800; letter-spacing: -0.02em; }
            .pf-done p { color: #64748b; margin: 0; line-height: 1.7; }

            @media (max-width: 640px) {
                .pf-root { padding: 20px 12px 40px; }
                .pf-container { padding: 28px 22px; border-radius: 16px; }
                .pf-header h1 { font-size: 1.5rem; }
                .pf-form { grid-template-columns: 1fr; }
                .pf-half { grid-column: 1 / -1; }
            }

            /* ── Theme variants ─────────────────────────────────────
               Most look comes from the CSS variables set on .pf-root via
               the inline branding style. The per-theme rules below add the
               handful of structural overrides that variables alone can't
               cover (border treatment, card chrome, gradient borders). */

            /* Minimal — no card border or shadow, underlined inputs. */
            .pf-theme-minimal .pf-container {
                box-shadow: none;
                background: transparent;
                border-radius: 0;
            }
            .pf-theme-minimal .pf-input,
            .pf-theme-minimal .pf-form select.pf-input,
            .pf-theme-minimal .pf-form textarea.pf-input {
                background: transparent;
                border: none;
                border-bottom: 1.5px solid color-mix(in srgb, var(--pf-text) 25%, transparent);
                border-radius: 0;
                padding: 10px 4px;
            }
            .pf-theme-minimal .pf-input:focus {
                background: transparent;
                box-shadow: none;
                border-bottom-color: var(--pf-primary);
            }
            .pf-theme-minimal .pf-header { border-bottom: 1.5px solid color-mix(in srgb, var(--pf-text) 12%, transparent); }

            /* Gradient hero — translucent card sits on the colourful page bg. */
            .pf-theme-gradient .pf-container {
                background: rgba(255,255,255,0.96);
                backdrop-filter: blur(10px);
                box-shadow: 0 30px 80px rgba(0,0,0,0.20);
            }
            .pf-theme-gradient .pf-event-chip {
                background: linear-gradient(90deg, var(--pf-primary), var(--pf-accent));
                color: #fff;
            }

            /* Dark / Neon — every surface flips to the dark surface, with
               the primary glowing on focus. */
            .pf-theme-dark .pf-container {
                box-shadow: 0 20px 60px rgba(0,0,0,0.55);
                border: 1px solid color-mix(in srgb, var(--pf-primary) 22%, transparent);
            }
            .pf-theme-dark .pf-input,
            .pf-theme-dark .pf-form select.pf-input,
            .pf-theme-dark .pf-form textarea.pf-input {
                background: color-mix(in srgb, var(--pf-text) 8%, transparent);
                border-color: color-mix(in srgb, var(--pf-text) 18%, transparent);
            }
            .pf-theme-dark .pf-input:focus {
                background: color-mix(in srgb, var(--pf-text) 5%, transparent);
                box-shadow: 0 0 0 3px color-mix(in srgb, var(--pf-primary) 30%, transparent);
            }
            .pf-theme-dark .pf-header { border-bottom-color: color-mix(in srgb, var(--pf-text) 18%, transparent); }
            .pf-theme-dark .pf-tier {
                background: color-mix(in srgb, var(--pf-text) 6%, transparent);
                border-color: color-mix(in srgb, var(--pf-text) 18%, transparent);
                color: var(--pf-text);
            }
            .pf-theme-dark .pf-tier-label, .pf-theme-dark .pf-tier-fixed { color: var(--pf-text); }

            /* Bordered — sharp corners, prominent border, lower shadow. */
            .pf-theme-bordered .pf-container {
                box-shadow: 0 6px 24px rgba(0,0,0,0.06);
                border: 2px solid var(--pf-text);
            }
            .pf-theme-bordered .pf-input,
            .pf-theme-bordered .pf-form select.pf-input,
            .pf-theme-bordered .pf-form textarea.pf-input {
                background: var(--pf-surface);
                border-color: color-mix(in srgb, var(--pf-text) 35%, transparent);
            }
        `}</style>
    );
}
