import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Form, Row, Col, Badge, Spinner, Alert } from 'react-bootstrap';
import QRCode from 'qrcode';
import { BsArrowLeft, BsEnvelopePaperFill, BsSendFill, BsArrowCounterclockwise, BsCheckCircleFill, BsExclamationTriangleFill, BsSave, BsCodeSlash, BsPhone, BsTablet, BsDisplay, BsImage, BsTrash, BsQrCode } from 'react-icons/bs';
import { useAuth } from '../context/AuthContext';
import {
    getAttendeeEmailTemplate,
    saveAttendeeEmailTemplate,
    resetAttendeeEmailTemplate,
    testAttendeeEmailTemplate,
    uploadAttendeeEmailHeader,
    getEvents,
} from '../services/api';
import { getImageUrl } from '../utils/imageUrl';

// Full-page editor for the delegate confirmation email. Two-column layout —
// editable fields on the left, live preview pinned on the right. The variable
// chips above each field click-insert {{placeholder}} into the active value.
//
// Storage and sample data mirror the backend: variables are filled at send
// time from the real attendee/event/tenant; the preview here uses sample
// values so what you see ≈ what'll go out.

const SAMPLE = {
    name: 'Sample Delegate',
    event_title: 'Annual Tech Summit 2026',
    event_date: 'Sat, 12 Sep 2026 – Sun, 13 Sep 2026',
    venue: 'Bharat Mandapam, New Delhi',
    ticket_type: 'Vip',
    status: 'confirmed',
    org_name: 'Your Organisation',
};

const fillVars = (s, overrides) => {
    const vars = overrides ? { ...SAMPLE, ...overrides } : SAMPLE;
    return String(s || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) =>
        Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : m);
};

// Format an event's start/end dates the same way the backend's
// `buildVariables` does, so the preview shows what real sends will use.
const fmtSampleDate = (start, end) => {
    if (!start) return SAMPLE.event_date;
    try {
        const fmt = (d) => new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
        if (!end || start === end) return fmt(start);
        return `${fmt(start)} – ${fmt(end)}`;
    } catch { return SAMPLE.event_date; }
};

// Sample token used to render a real-looking QR in the preview. The
// backend uses the same library + options for actual sends (errorCorrection
// 'M', 1px margin), so the visual matches what delegates will scan — only
// the encoded payload differs.
const SAMPLE_QR_TOKEN = 'sample-checkin-token-preview-1234567890';

function renderPreviewHtml(tpl, qrSrc, sampleVars) {
    const accent = tpl.brand_color || '#8b5cf6';
    const v = { ...SAMPLE, ...(sampleVars || {}) };
    const row = (show, label, value) => (show && value)
        ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:110px;">${label}</td><td style="padding:8px 0;color:#1e293b;font-size:14px;font-weight:600;">${value}</td></tr>`
        : '';
    const headerImage = tpl.header_image_url ? `
        <div style="background:#fff;padding:0;text-align:center;">
            <img src="${getImageUrl(tpl.header_image_url)}" alt="" style="display:block;width:100%;max-width:100%;height:auto;border:0;" />
        </div>` : '';
    const qrBlock = (tpl.show_qr !== false && qrSrc) ? `
        <div style="text-align:center;padding:22px 22px;margin-bottom:22px;border-radius:12px;background:#fff;border:1px dashed ${accent};">
            <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${accent};font-weight:700;margin-bottom:12px;">Show this at check-in</div>
            <img src="${qrSrc}" alt="Check-in QR (preview)" width="200" height="200" style="display:inline-block;width:200px;height:200px;border-radius:8px;" />
            <div style="margin-top:10px;color:#64748b;font-size:12px;">Real sends embed each delegate's unique QR.</div>
        </div>` : '';
    return `
        <div style="font-family:'Segoe UI',Arial,sans-serif;padding:24px;background:#f8fafc;">
            <div style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);max-width:560px;margin:0 auto;">
                ${headerImage}
                <div style="background:linear-gradient(135deg,${accent},#ec4899);padding:34px 28px;text-align:center;">
                    <div style="width:54px;height:54px;border-radius:13px;background:rgba(255,255,255,0.22);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:26px;margin-bottom:12px;">✓</div>
                    <h2 style="margin:0;color:#fff;font-size:21px;font-weight:700;letter-spacing:-0.01em;">${fillVars(tpl.hero_title, v)}</h2>
                    <p style="margin:6px 0 0;color:rgba(255,255,255,0.92);font-size:13.5px;">${fillVars(tpl.hero_subtitle, v)}</p>
                </div>
                <div style="padding:28px 30px;">
                    <p style="color:#1e293b;font-size:15px;line-height:1.55;margin:0 0 6px;">${fillVars(tpl.greeting, v)}</p>
                    <p style="color:#475569;font-size:13.5px;line-height:1.65;margin:0 0 22px;">${fillVars(tpl.intro, v)}</p>
                    <div style="background:#f8fafc;border-radius:10px;padding:18px 20px;margin-bottom:20px;border:1px solid #e2e8f0;">
                        <table style="width:100%;border-collapse:collapse;">
                            ${row(tpl.show_event, 'Event', v.event_title)}
                            ${row(tpl.show_when, 'When', v.event_date)}
                            ${row(tpl.show_venue, 'Venue', v.venue)}
                            ${row(tpl.show_ticket, 'Ticket', v.ticket_type)}
                            ${row(tpl.show_status, 'Status', v.status)}
                        </table>
                    </div>
                    ${qrBlock}
                    <p style="color:#475569;font-size:13.5px;line-height:1.6;margin:0 0 8px;">${fillVars(tpl.closing_1, v)}</p>
                    <p style="color:#475569;font-size:13.5px;line-height:1.6;margin:0;">${fillVars(tpl.closing_2, v)}</p>
                </div>
                <div style="background:#f8fafc;padding:16px 28px;text-align:center;border-top:1px solid #e2e8f0;">
                    <p style="color:#94a3b8;font-size:11.5px;margin:0;">${fillVars(tpl.footer, v)}</p>
                </div>
            </div>
        </div>
    `;
}

function VariableChips({ variables, onInsert }) {
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
            {variables.map(v => (
                <button
                    key={v}
                    type="button"
                    onClick={() => onInsert(v)}
                    style={{
                        background: 'rgba(139,92,246,0.10)',
                        border: '1px solid rgba(139,92,246,0.30)',
                        color: 'var(--accent)',
                        borderRadius: 999,
                        padding: '2px 9px',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                    }}
                    title={`Insert {{${v}}}`}
                >{`{{${v}}}`}</button>
            ))}
        </div>
    );
}

function Field({ label, value, onChange, variables, onInsert, multiline, placeholder, hint }) {
    return (
        <div style={{ marginBottom: 18 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</label>
            {variables && <VariableChips variables={variables} onInsert={onInsert} />}
            {multiline ? (
                <Form.Control as="textarea" rows={3} className="form-control-dark" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
            ) : (
                <Form.Control className="form-control-dark" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
            )}
            {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{hint}</div>}
        </div>
    );
}

function Section({ icon: Icon, title, subtitle, children }) {
    return (
        <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 14,
            padding: '20px 22px',
            marginBottom: 18,
        }}>
            <div className="d-flex align-items-center gap-2 mb-3">
                {Icon && <Icon size={16} style={{ color: 'var(--accent)' }} />}
                <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
                    {subtitle && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>{subtitle}</div>}
                </div>
            </div>
            {children}
        </div>
    );
}

// Maps each device to the iframe's logical CSS width. Real phones/tablets
// are usually around these breakpoints; close enough that operators can
// catch wrapping or overflow issues before sending.
const DEVICE_WIDTHS = {
    mobile:  { width: 375,  label: 'Mobile',  icon: BsPhone   },
    tablet:  { width: 600,  label: 'Tablet',  icon: BsTablet  },
    desktop: { width: null, label: 'Desktop', icon: BsDisplay }, // null = fill available width
};

// Live email preview with a viewport switcher pinned above. Rendering into
// an iframe (instead of inline HTML) keeps the email's <style> isolated
// from the app's CSS and lets us shrink the viewport to phone widths
// without the page CSS interfering with the layout.
function DevicePreview({ tpl, device, onChange, qrSrc, sampleVars }) {
    const w = DEVICE_WIDTHS[device]?.width;
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f8fafc;">${renderPreviewHtml(tpl, qrSrc, sampleVars)}</body></html>`;
    // iframe content is dynamic; we want the frame to grow to fit the email
    // exactly so there's no inner scrollbar and no dead space below short
    // templates. ResizeObserver on the iframe's body catches late layout
    // (web font loads, images decoding) which a single onLoad would miss.
    const iframeRef = useRef(null);
    const [iframeHeight, setIframeHeight] = useState(420);
    const measure = () => {
        const f = iframeRef.current;
        if (!f) return;
        try {
            const doc = f.contentDocument || f.contentWindow?.document;
            if (!doc?.body) return;
            const h = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
            if (h) setIframeHeight(prev => (Math.abs(prev - h) > 2 ? h : prev));
        } catch { /* same-origin srcDoc; ignored */ }
    };
    // Re-measure whenever srcDoc changes. Defer once with rAF + setTimeout
    // so layout has settled before we read scrollHeight.
    useEffect(() => {
        const f = iframeRef.current;
        if (!f) return;
        let raf;
        const tick = () => { raf = requestAnimationFrame(measure); };
        tick();
        const t = setTimeout(measure, 80);
        // Observe body resizes (fonts/images) for the lifetime of this srcDoc.
        let observer;
        const attach = () => {
            try {
                const doc = f.contentDocument;
                if (!doc?.body) return;
                observer = new ResizeObserver(measure);
                observer.observe(doc.body);
            } catch {}
        };
        f.addEventListener('load', attach);
        // contentDocument is usually ready synchronously for srcDoc — try now too.
        attach();
        return () => {
            cancelAnimationFrame(raf);
            clearTimeout(t);
            f.removeEventListener('load', attach);
            try { observer?.disconnect(); } catch {}
        };
    }, [html]);
    return (
        <>
            {/* Device switcher */}
            <div className="d-flex align-items-center justify-content-between gap-2 mb-3">
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                    {w ? `${w}px viewport` : 'Full width'}
                </div>
                <div style={{
                    display: 'inline-flex',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 10, padding: 3, gap: 2,
                }}>
                    {Object.entries(DEVICE_WIDTHS).map(([key, def]) => {
                        const Icon = def.icon;
                        const active = device === key;
                        return (
                            <button
                                key={key}
                                type="button"
                                onClick={() => onChange(key)}
                                title={`${def.label}${def.width ? ` · ${def.width}px` : ''}`}
                                style={{
                                    display: 'grid', placeItems: 'center',
                                    width: 32, height: 30,
                                    borderRadius: 8,
                                    border: 'none',
                                    background: active ? 'var(--accent)' : 'transparent',
                                    color: active ? '#fff' : 'var(--text-secondary)',
                                    cursor: 'pointer',
                                    transition: 'background 0.15s, color 0.15s',
                                }}
                            >
                                <Icon size={15} />
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Stage — dark backdrop centres the device frame so phone/tablet
                widths don't look adrift in a wide column. */}
            <div style={{
                background: 'rgba(0,0,0,0.18)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 14,
                padding: w ? '16px' : '0',
                display: 'flex', justifyContent: 'center',
            }}>
                <div style={{
                    width: w ? `${w}px` : '100%',
                    maxWidth: '100%',
                    background: '#f8fafc',
                    borderRadius: w ? 16 : 12,
                    overflow: 'hidden',
                    boxShadow: w ? '0 18px 40px rgba(0,0,0,0.35)' : 'none',
                    transition: 'width 0.25s ease',
                }}>
                    <iframe
                        ref={iframeRef}
                        title="Email preview"
                        srcDoc={html}
                        onLoad={measure}
                        style={{
                            display: 'block',
                            width: '100%', height: iframeHeight,
                            border: 'none',
                            background: '#f8fafc',
                        }}
                    />
                </div>
            </div>
        </>
    );
}

export default function AttendeeEmailTemplatePage() {
    const navigate = useNavigate();
    const { user } = useAuth();

    const [loading, setLoading] = useState(true);
    const [tpl, setTpl] = useState(null);
    const [variables, setVariables] = useState([]);
    const [defaults, setDefaults] = useState(null);
    const [isCustomised, setIsCustomised] = useState(false);
    // `inheritsFromTenant` is true when we're editing an event scope but
    // the event has no override yet — the editor is seeded with the
    // tenant default, so the banner explains where the copy came from.
    const [inheritsFromTenant, setInheritsFromTenant] = useState(false);

    const [saving, setSaving] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testTo, setTestTo] = useState('');
    const [banner, setBanner] = useState(null); // { type, text }
    const [dirty, setDirty] = useState(false);
    // Preview viewport — lets the editor verify the email looks right on
    // each form factor without resizing the browser. Width drives the
    // wrapper, the rendered HTML reflows to match.
    const [device, setDevice] = useState('desktop');

    // Scope: '' (tenant default) or an event id. Switching scope reloads
    // the template — whatever's saved for that scope, falling back to
    // the tenant default when the event has no override.
    const [scope, setScope] = useState('');
    const [events, setEvents] = useState([]);
    const currentEvent = useMemo(
        () => events.find(e => String(e.id) === String(scope)) || null,
        [events, scope]
    );

    // One-shot fetch of events for the picker. We don't refetch on scope
    // changes — events don't appear / vanish mid-edit.
    useEffect(() => {
        getEvents().then(r => setEvents(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    }, []);

    // Reload the template whenever scope changes. Unsaved edits are
    // dropped — we prompt the user first so they don't silently lose
    // work. `loading` only flips for the very first load to avoid
    // flashing the spinner when switching events.
    const loadTemplate = (nextScope) => {
        const eventId = nextScope || undefined;
        setLoading(prev => prev);  // keep current loading state; spinner is only for first paint
        setBanner(null);
        getAttendeeEmailTemplate(eventId)
            .then(r => {
                setTpl(r.data?.template || null);
                setVariables(r.data?.variables || []);
                setDefaults(r.data?.defaults || null);
                setIsCustomised(!!r.data?.is_customised);
                setInheritsFromTenant(!!r.data?.inherits_from_tenant);
                setTestTo(user?.email || '');
                setDirty(false);
            })
            .catch(err => setBanner({ type: 'danger', text: err.response?.data?.error || 'Failed to load template' }))
            .finally(() => setLoading(false));
    };
    useEffect(() => { loadTemplate(scope); }, [scope, user?.email]);  // eslint-disable-line react-hooks/exhaustive-deps

    const handleScopeChange = (next) => {
        if (dirty && !window.confirm('You have unsaved changes — switching will discard them. Continue?')) return;
        setScope(next);
    };

    // Sample variable overrides for the preview iframe — when an event
    // is selected, swap in its real title / venue / dates so the operator
    // sees what real sends will look like instead of canned placeholder
    // values.
    const sampleVars = useMemo(() => {
        if (!currentEvent) return null;
        return {
            event_title: currentEvent.title || SAMPLE.event_title,
            venue:       currentEvent.venue || SAMPLE.venue,
            event_date:  fmtSampleDate(currentEvent.start_date, currentEvent.end_date),
        };
    }, [currentEvent]);

    const setField = (k, v) => { setTpl(prev => ({ ...prev, [k]: v })); setDirty(true); };
    const insertVar = (k, v) => setField(k, `${tpl?.[k] || ''}{{${v}}}`);

    // Real QR generated client-side using the same library + options the
    // backend uses for outgoing sends. Computed once on mount — the
    // sample token never changes so we don't need to regenerate.
    const [qrDataUrl, setQrDataUrl] = useState('');
    useEffect(() => {
        let cancelled = false;
        QRCode.toDataURL(SAMPLE_QR_TOKEN, {
            width: 400, margin: 1, errorCorrectionLevel: 'M',
            color: { dark: '#0f172a', light: '#ffffff' },
        }).then(url => { if (!cancelled) setQrDataUrl(url); }).catch(() => {});
        return () => { cancelled = true; };
    }, []);

    // Banner image upload — we POST the raw file, then drop the returned
    // URL straight into `header_image_url` so the preview iframe picks it
    // up immediately. The template still has to be Saved for the change
    // to persist; until then the page shows the unsaved badge.
    const [headerUploading, setHeaderUploading] = useState(false);
    const handleHeaderUpload = async (file) => {
        if (!file) return;
        if (file.size > 4 * 1024 * 1024) {
            setBanner({ type: 'danger', text: 'Image must be under 4MB.' });
            return;
        }
        setHeaderUploading(true);
        setBanner(null);
        try {
            const r = await uploadAttendeeEmailHeader(file);
            const url = r.data?.url;
            if (!url) throw new Error('Upload returned no URL');
            setField('header_image_url', url);
        } catch (err) {
            setBanner({ type: 'danger', text: err.response?.data?.error || err.message || 'Header upload failed' });
        } finally {
            setHeaderUploading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true); setBanner(null);
        try {
            const r = await saveAttendeeEmailTemplate(tpl, scope || undefined);
            setIsCustomised(!!r.data?.is_customised);
            setInheritsFromTenant(false);
            setDirty(false);
            setBanner({
                type: 'success',
                text: scope
                    ? `Saved. New sends for "${currentEvent?.title || 'this event'}" will use this version.`
                    : 'Saved. New sends will use this version (tenant default).',
            });
        } catch (err) {
            setBanner({ type: 'danger', text: err.response?.data?.error || 'Failed to save template' });
        } finally { setSaving(false); }
    };

    const handleReset = async () => {
        const msg = scope
            ? `Remove the override for "${currentEvent?.title || 'this event'}"? Sends will fall back to the tenant default template.`
            : 'Reset to the default template? Your custom changes will be lost.';
        if (!window.confirm(msg)) return;
        setResetting(true); setBanner(null);
        try {
            const r = await resetAttendeeEmailTemplate(scope || undefined);
            setTpl(r.data?.template || defaults);
            setIsCustomised(false);
            setDirty(false);
            // Re-load so we pick up the right seed (event reset → tenant default).
            loadTemplate(scope);
            setBanner({ type: 'success', text: scope ? 'Event override removed.' : 'Template reset to default.' });
        } catch (err) {
            setBanner({ type: 'danger', text: err.response?.data?.error || 'Failed to reset' });
        } finally { setResetting(false); }
    };

    const handleTest = async () => {
        if (!testTo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testTo)) {
            setBanner({ type: 'danger', text: 'Enter a valid email to receive the test.' });
            return;
        }
        setTesting(true); setBanner(null);
        try {
            const r = await testAttendeeEmailTemplate(tpl, testTo, scope || undefined);
            if (r.data?.skipped) {
                setBanner({ type: 'danger', text: r.data.skipped === 'SMTP not configured'
                    ? 'No SMTP configured — set up email under Settings → SMTP first.'
                    : `Email skipped: ${r.data.skipped}` });
            } else if (r.data?.sent) {
                setBanner({ type: 'success', text: `Test email sent to ${testTo}.` });
            }
        } catch (err) {
            setBanner({ type: 'danger', text: err.response?.data?.error || 'Failed to send test' });
        } finally { setTesting(false); }
    };

    if (loading) {
        return (
            <div className="d-flex justify-content-center align-items-center" style={{ minHeight: 400 }}>
                <Spinner animation="border" style={{ color: 'var(--accent)' }} />
            </div>
        );
    }

    if (!tpl) {
        return (
            <div className="animate-in p-4">
                <Alert variant="danger">Couldn't load the template. Please refresh.</Alert>
            </div>
        );
    }

    return (
        <div className="animate-in">
            {/* Header — back link, title, action buttons */}
            <div className="page-header" style={{ marginBottom: 20 }}>
                <div className="d-flex align-items-center gap-3 mb-2">
                    <button
                        type="button"
                        onClick={() => navigate('/attendees')}
                        title="Back to Attendees"
                        style={{
                            width: 36, height: 36, borderRadius: 10,
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-primary)',
                            display: 'grid', placeItems: 'center',
                            cursor: 'pointer',
                            transition: 'background 0.15s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                    >
                        <BsArrowLeft size={16} />
                    </button>
                    <div style={{ flex: 1, minWidth: 240 }}>
                        <div className="d-flex align-items-center gap-2 flex-wrap">
                            <h4 className="m-0" style={{ color: 'var(--text-primary)' }}>Delegate Confirmation Email</h4>
                            <Badge bg="" style={{
                                background: scope ? 'rgba(236,72,153,0.18)' : 'rgba(99,102,241,0.18)',
                                color: scope ? '#f472b6' : '#818cf8',
                                fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
                            }}>
                                {scope ? 'EVENT SCOPE' : 'TENANT DEFAULT'}
                            </Badge>
                            {isCustomised && <Badge bg="" style={{ background: 'rgba(139,92,246,0.18)', color: 'var(--accent)', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em' }}>CUSTOMISED</Badge>}
                            {dirty && <Badge bg="" style={{ background: 'rgba(245,158,11,0.18)', color: '#f59e0b', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em' }}>UNSAVED</Badge>}
                        </div>
                        <p className="m-0" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                            {scope
                                ? <>Edits here only affect <strong style={{ color: 'var(--text-primary)' }}>{currentEvent?.title || `event #${scope}`}</strong>. Use <code style={{ color: 'var(--accent)', fontSize: 11 }}>{`{{variables}}`}</code> for personalisation.</>
                                : <>This template is sent to delegates for every event that doesn't have its own override. Use <code style={{ color: 'var(--accent)', fontSize: 11 }}>{`{{variables}}`}</code> for personalisation.</>}
                        </p>
                        {scope && inheritsFromTenant && (
                            <div style={{ marginTop: 6, fontSize: 12, color: '#a78bfa', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <BsExclamationTriangleFill size={12} /> No override yet — fields are pre-filled from the tenant default. Edit and Save to create one.
                            </div>
                        )}
                    </div>
                    <div className="d-flex gap-2 flex-wrap align-items-center">
                        {/* Scope picker — "Tenant default (all events)" + every
                            event the operator can see. Switching prompts to
                            discard unsaved changes. */}
                        <Form.Select
                            size="sm"
                            value={scope}
                            onChange={(e) => handleScopeChange(e.target.value)}
                            disabled={saving || resetting}
                            style={{
                                background: 'rgba(0,0,0,0.25)',
                                border: '1px solid var(--border-subtle)',
                                color: 'var(--text-primary)',
                                minWidth: 220, maxWidth: 260, fontSize: 12,
                            }}
                            title="Pick which template scope to edit"
                        >
                            <option value="">Tenant default (all events)</option>
                            <optgroup label="Per-event override">
                                {events.map(ev => (
                                    <option key={ev.id} value={ev.id}>{ev.title}</option>
                                ))}
                            </optgroup>
                        </Form.Select>
                        <Button
                            variant="outline-light" size="sm"
                            onClick={handleReset}
                            disabled={!isCustomised || resetting || saving}
                            style={{ border: '1px solid var(--border-subtle)', borderRadius: 10 }}
                            title={scope ? 'Remove the event override (falls back to tenant default)' : 'Reset to the built-in defaults'}
                        >
                            <BsArrowCounterclockwise className="me-1" /> {resetting ? 'Resetting…' : (scope ? 'Remove override' : 'Reset to default')}
                        </Button>
                        <Button
                            className="btn-accent d-flex align-items-center gap-2"
                            onClick={handleSave}
                            disabled={saving || !dirty}
                        >
                            <BsSave /> {saving ? 'Saving…' : 'Save changes'}
                        </Button>
                    </div>
                </div>

                {banner && (
                    <Alert
                        variant={banner.type}
                        dismissible
                        onClose={() => setBanner(null)}
                        className="d-flex align-items-center gap-2 mb-0 py-2"
                        style={{ fontSize: 13 }}
                    >
                        {banner.type === 'success' ? <BsCheckCircleFill /> : <BsExclamationTriangleFill />}
                        <span>{banner.text}</span>
                    </Alert>
                )}
            </div>

            <Row className="g-4">
                {/* Left: editor — narrower so the preview on the right has
                    room to breathe (especially on desktop / tablet). */}
                <Col lg={5}>
                    <Section icon={BsEnvelopePaperFill} title="Subject & header" subtitle="What appears in the inbox preview and the gradient banner.">
                        <Field
                            label="Subject line" value={tpl.subject}
                            onChange={(v) => setField('subject', v)}
                            variables={variables}
                            onInsert={(v) => insertVar('subject', v)}
                            placeholder={defaults?.subject}
                        />
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 14, alignItems: 'end' }}>
                            <Field
                                label="Hero title" value={tpl.hero_title}
                                onChange={(v) => setField('hero_title', v)}
                                placeholder={defaults?.hero_title}
                            />
                            <div style={{ marginBottom: 18 }}>
                                <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Brand colour</label>
                                <div className="d-flex gap-2 align-items-center">
                                    <Form.Control
                                        type="color"
                                        value={tpl.brand_color || '#8b5cf6'}
                                        onChange={(e) => setField('brand_color', e.target.value)}
                                        style={{ width: 46, height: 38, padding: 2, cursor: 'pointer' }}
                                    />
                                    {tpl.brand_color && (
                                        <button
                                            type="button"
                                            onClick={() => setField('brand_color', '')}
                                            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11, padding: 0, cursor: 'pointer', textDecoration: 'underline' }}
                                            title="Clear so the event's primary colour is used"
                                        >clear</button>
                                    )}
                                </div>
                            </div>
                        </div>
                        <Field
                            label="Hero subtitle" value={tpl.hero_subtitle}
                            onChange={(v) => setField('hero_subtitle', v)}
                            variables={variables}
                            onInsert={(v) => insertVar('hero_subtitle', v)}
                            placeholder={defaults?.hero_subtitle}
                        />
                    </Section>

                    <Section icon={BsCodeSlash} title="Body copy" subtitle="The greeting, intro and closing paragraphs.">
                        <Field
                            label="Greeting" value={tpl.greeting}
                            onChange={(v) => setField('greeting', v)}
                            variables={variables}
                            onInsert={(v) => insertVar('greeting', v)}
                            placeholder={defaults?.greeting}
                        />
                        <Field
                            label="Intro paragraph" value={tpl.intro}
                            onChange={(v) => setField('intro', v)}
                            variables={variables}
                            onInsert={(v) => insertVar('intro', v)}
                            multiline
                            placeholder={defaults?.intro}
                        />
                        <Field
                            label="Closing line 1" value={tpl.closing_1}
                            onChange={(v) => setField('closing_1', v)}
                            variables={variables}
                            onInsert={(v) => insertVar('closing_1', v)}
                            multiline
                            placeholder={defaults?.closing_1}
                        />
                        <Field
                            label="Closing line 2" value={tpl.closing_2}
                            onChange={(v) => setField('closing_2', v)}
                            variables={variables}
                            onInsert={(v) => insertVar('closing_2', v)}
                            placeholder={defaults?.closing_2}
                        />
                        <Field
                            label="Footer (small print)" value={tpl.footer}
                            onChange={(v) => setField('footer', v)}
                            variables={variables}
                            onInsert={(v) => insertVar('footer', v)}
                            multiline
                            placeholder={defaults?.footer}
                        />
                    </Section>

                    <Section icon={BsImage} title="Header banner" subtitle="Optional image rendered at the top of the email (above the gradient hero). PNG / JPG, max 4MB. Recommended width ≥ 1120px for retina screens.">
                        {tpl.header_image_url ? (
                            <div>
                                <div style={{
                                    background: '#fff',
                                    borderRadius: 10,
                                    overflow: 'hidden',
                                    border: '1px solid var(--border-subtle)',
                                    marginBottom: 10,
                                }}>
                                    <img
                                        src={getImageUrl(tpl.header_image_url)}
                                        alt="Email header"
                                        style={{ display: 'block', width: '100%', height: 'auto', maxHeight: 220, objectFit: 'cover' }}
                                    />
                                </div>
                                <div className="d-flex gap-2">
                                    <label className="btn btn-outline-light btn-sm mb-0" style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, cursor: 'pointer' }}>
                                        Replace…
                                        <input type="file" hidden accept="image/*"
                                            onChange={(e) => handleHeaderUpload(e.target.files?.[0])}
                                            disabled={headerUploading} />
                                    </label>
                                    <Button
                                        variant="outline-light" size="sm"
                                        onClick={() => setField('header_image_url', '')}
                                        disabled={headerUploading}
                                        style={{ border: '1px solid rgba(239,68,68,0.45)', color: '#ef4444', borderRadius: 8 }}
                                    >
                                        <BsTrash className="me-1" /> Remove
                                    </Button>
                                    {headerUploading && <Spinner size="sm" animation="border" style={{ color: 'var(--accent)' }} />}
                                </div>
                            </div>
                        ) : (
                            <label
                                className="d-flex flex-column align-items-center justify-content-center"
                                style={{
                                    padding: '28px 16px',
                                    border: '2px dashed var(--border-subtle)',
                                    borderRadius: 12,
                                    color: 'var(--text-muted)',
                                    cursor: headerUploading ? 'wait' : 'pointer',
                                    background: 'rgba(255,255,255,0.02)',
                                    textAlign: 'center',
                                }}
                            >
                                {headerUploading ? (
                                    <>
                                        <Spinner size="sm" animation="border" style={{ color: 'var(--accent)' }} />
                                        <div style={{ fontSize: 12, marginTop: 8 }}>Uploading…</div>
                                    </>
                                ) : (
                                    <>
                                        <BsImage size={26} style={{ opacity: 0.5 }} />
                                        <div style={{ fontSize: 13, marginTop: 8, color: 'var(--text-secondary)' }}>Click to upload a header banner</div>
                                        <div style={{ fontSize: 11, marginTop: 4 }}>PNG / JPG, max 4MB</div>
                                    </>
                                )}
                                <input type="file" hidden accept="image/*"
                                    onChange={(e) => handleHeaderUpload(e.target.files?.[0])}
                                    disabled={headerUploading} />
                            </label>
                        )}
                    </Section>

                    <Section icon={BsQrCode} title="Check-in QR" subtitle="Embeds each delegate's unique QR code in the email. Useful for on-site events with QR-based check-in.">
                        <Form.Check
                            type="switch"
                            id="show_qr-switch"
                            label={tpl.show_qr === false ? 'Hidden — QR will not appear in the email.' : 'Visible — the QR block renders before the closing paragraph.'}
                            checked={tpl.show_qr !== false}
                            onChange={(e) => setField('show_qr', e.target.checked)}
                            style={{ color: 'var(--text-primary)', fontSize: 13 }}
                        />
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                            Real sends embed each attendee's unique <code style={{ color: 'var(--accent)' }}>checkin_token</code> as a PNG via <code style={{ color: 'var(--accent)' }}>cid:</code> attachment. The live preview uses a static placeholder.
                        </div>
                    </Section>

                    <Section title="Detail rows" subtitle="Toggle which information shows in the details card.">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
                            {[
                                { k: 'show_event', l: 'Event' },
                                { k: 'show_when', l: 'When' },
                                { k: 'show_venue', l: 'Venue' },
                                { k: 'show_ticket', l: 'Ticket' },
                                { k: 'show_status', l: 'Status' },
                            ].map(({ k, l }) => (
                                <Form.Check
                                    key={k} type="switch" label={l}
                                    checked={!!tpl[k]}
                                    onChange={(e) => setField(k, e.target.checked)}
                                    style={{ color: 'var(--text-primary)', fontSize: 13 }}
                                />
                            ))}
                        </div>
                    </Section>
                </Col>

                {/* Right: sticky preview + test send — gets the wider column
                    so the desktop viewport renders at a believable size. */}
                <Col lg={7}>
                    <div style={{ position: 'sticky', top: 16 }}>
                        <Section icon={BsEnvelopePaperFill} title="Live preview" subtitle="Sample data shown — real sends fill in delegate details.">
                            <DevicePreview tpl={tpl} device={device} onChange={setDevice} qrSrc={qrDataUrl} sampleVars={sampleVars} />
                        </Section>

                        <Section icon={BsSendFill} title="Send test email" subtitle="Verify formatting and SMTP delivery before going live.">
                            <div className="d-flex gap-2">
                                <Form.Control
                                    className="form-control-dark"
                                    value={testTo}
                                    onChange={(e) => setTestTo(e.target.value)}
                                    placeholder="your@email.com"
                                    type="email"
                                />
                                <Button
                                    variant="outline-light" size="sm"
                                    disabled={testing}
                                    onClick={handleTest}
                                    style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, whiteSpace: 'nowrap' }}
                                >
                                    <BsSendFill className="me-1" /> {testing ? 'Sending…' : 'Send test'}
                                </Button>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.45 }}>
                                The subject is prefixed with <code style={{ color: 'var(--accent)', fontSize: 11 }}>[TEST]</code> so it's easy to spot in your inbox.
                            </div>
                        </Section>

                        {/* Quick path to actually use the template — jumps
                            to the Attendees page with this event preselected
                            (when scoped) so the operator can immediately
                            send bulk or individual confirmations. */}
                        <Section icon={BsSendFill} title="Send to delegates" subtitle="Once you're happy with the template, send it from the Attendees page.">
                            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 14 }}>
                                <strong style={{ color: 'var(--text-primary)' }}>One delegate</strong> — click the <BsEnvelopePaperFill style={{ color: 'var(--accent)' }} /> envelope on any row to preview, then send.<br />
                                <strong style={{ color: 'var(--text-primary)' }}>Bulk</strong> — apply the filter you want (event, status, ticket type, search) and click <strong>Send Confirmations</strong> in the page header. Skips delegates without an email automatically.
                            </div>
                            <Button
                                onClick={() => navigate(scope ? `/attendees?event=${scope}` : '/attendees')}
                                style={{
                                    width: '100%',
                                    background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
                                    border: 'none', fontWeight: 600, borderRadius: 10, padding: '10px 14px',
                                }}
                            >
                                <BsSendFill className="me-2" /> Open Attendees{scope ? ` (${currentEvent?.title || 'this event'})` : ''}
                            </Button>
                        </Section>
                    </div>
                </Col>
            </Row>
        </div>
    );
}
