import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Form, Row, Col, Badge, Spinner, Alert } from 'react-bootstrap';
import { BsArrowLeft, BsEnvelopePaperFill, BsSendFill, BsArrowCounterclockwise, BsCheckCircleFill, BsExclamationTriangleFill, BsSave, BsCodeSlash, BsPhone, BsTablet, BsDisplay } from 'react-icons/bs';
import { useAuth } from '../context/AuthContext';
import {
    getAttendeeEmailTemplate,
    saveAttendeeEmailTemplate,
    resetAttendeeEmailTemplate,
    testAttendeeEmailTemplate,
} from '../services/api';

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

const fillVars = (s) => String(s || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) =>
    Object.prototype.hasOwnProperty.call(SAMPLE, k) ? SAMPLE[k] : m);

function renderPreviewHtml(tpl) {
    const accent = tpl.brand_color || '#8b5cf6';
    const row = (show, label, value) => (show && value)
        ? `<tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:110px;">${label}</td><td style="padding:8px 0;color:#1e293b;font-size:14px;font-weight:600;">${value}</td></tr>`
        : '';
    return `
        <div style="font-family:'Segoe UI',Arial,sans-serif;padding:24px;background:#f8fafc;">
            <div style="background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);max-width:560px;margin:0 auto;">
                <div style="background:linear-gradient(135deg,${accent},#ec4899);padding:34px 28px;text-align:center;">
                    <div style="width:54px;height:54px;border-radius:13px;background:rgba(255,255,255,0.22);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:26px;margin-bottom:12px;">✓</div>
                    <h2 style="margin:0;color:#fff;font-size:21px;font-weight:700;letter-spacing:-0.01em;">${fillVars(tpl.hero_title)}</h2>
                    <p style="margin:6px 0 0;color:rgba(255,255,255,0.92);font-size:13.5px;">${fillVars(tpl.hero_subtitle)}</p>
                </div>
                <div style="padding:28px 30px;">
                    <p style="color:#1e293b;font-size:15px;line-height:1.55;margin:0 0 6px;">${fillVars(tpl.greeting)}</p>
                    <p style="color:#475569;font-size:13.5px;line-height:1.65;margin:0 0 22px;">${fillVars(tpl.intro)}</p>
                    <div style="background:#f8fafc;border-radius:10px;padding:18px 20px;margin-bottom:20px;border:1px solid #e2e8f0;">
                        <table style="width:100%;border-collapse:collapse;">
                            ${row(tpl.show_event, 'Event', SAMPLE.event_title)}
                            ${row(tpl.show_when, 'When', SAMPLE.event_date)}
                            ${row(tpl.show_venue, 'Venue', SAMPLE.venue)}
                            ${row(tpl.show_ticket, 'Ticket', SAMPLE.ticket_type)}
                            ${row(tpl.show_status, 'Status', SAMPLE.status)}
                        </table>
                    </div>
                    <p style="color:#475569;font-size:13.5px;line-height:1.6;margin:0 0 8px;">${fillVars(tpl.closing_1)}</p>
                    <p style="color:#475569;font-size:13.5px;line-height:1.6;margin:0;">${fillVars(tpl.closing_2)}</p>
                </div>
                <div style="background:#f8fafc;padding:16px 28px;text-align:center;border-top:1px solid #e2e8f0;">
                    <p style="color:#94a3b8;font-size:11.5px;margin:0;">${fillVars(tpl.footer)}</p>
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
function DevicePreview({ tpl, device, onChange }) {
    const w = DEVICE_WIDTHS[device]?.width;
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f8fafc;">${renderPreviewHtml(tpl)}</body></html>`;
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

    useEffect(() => {
        getAttendeeEmailTemplate()
            .then(r => {
                setTpl(r.data?.template || null);
                setVariables(r.data?.variables || []);
                setDefaults(r.data?.defaults || null);
                setIsCustomised(!!r.data?.is_customised);
                setTestTo(user?.email || '');
            })
            .catch(err => setBanner({ type: 'danger', text: err.response?.data?.error || 'Failed to load template' }))
            .finally(() => setLoading(false));
    }, [user?.email]);

    const setField = (k, v) => { setTpl(prev => ({ ...prev, [k]: v })); setDirty(true); };
    const insertVar = (k, v) => setField(k, `${tpl?.[k] || ''}{{${v}}}`);

    const handleSave = async () => {
        setSaving(true); setBanner(null);
        try {
            const r = await saveAttendeeEmailTemplate(tpl);
            setIsCustomised(!!r.data?.is_customised);
            setDirty(false);
            setBanner({ type: 'success', text: 'Template saved. New sends will use this version.' });
        } catch (err) {
            setBanner({ type: 'danger', text: err.response?.data?.error || 'Failed to save template' });
        } finally { setSaving(false); }
    };

    const handleReset = async () => {
        if (!window.confirm('Reset to the default template? Your custom changes will be lost.')) return;
        setResetting(true); setBanner(null);
        try {
            const r = await resetAttendeeEmailTemplate();
            setTpl(r.data?.template || defaults);
            setIsCustomised(false);
            setDirty(false);
            setBanner({ type: 'success', text: 'Template reset to default.' });
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
            const r = await testAttendeeEmailTemplate(tpl, testTo);
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
                    <div style={{ flex: 1 }}>
                        <div className="d-flex align-items-center gap-2">
                            <h4 className="m-0" style={{ color: 'var(--text-primary)' }}>Delegate Confirmation Email</h4>
                            {isCustomised && <Badge bg="" style={{ background: 'rgba(139,92,246,0.18)', color: 'var(--accent)', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em' }}>CUSTOMISED</Badge>}
                            {dirty && <Badge bg="" style={{ background: 'rgba(245,158,11,0.18)', color: '#f59e0b', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em' }}>UNSAVED</Badge>}
                        </div>
                        <p className="m-0" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                            This template is sent to delegates after registration. Use <code style={{ color: 'var(--accent)', fontSize: 11 }}>{`{{variables}}`}</code> for personalisation.
                        </p>
                    </div>
                    <div className="d-flex gap-2">
                        <Button
                            variant="outline-light" size="sm"
                            onClick={handleReset}
                            disabled={!isCustomised || resetting || saving}
                            style={{ border: '1px solid var(--border-subtle)', borderRadius: 10 }}
                        >
                            <BsArrowCounterclockwise className="me-1" /> {resetting ? 'Resetting…' : 'Reset to default'}
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
                            <DevicePreview tpl={tpl} device={device} onChange={setDevice} />
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
                    </div>
                </Col>
            </Row>
        </div>
    );
}
