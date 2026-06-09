import { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, Form, Row, Col, Spinner, Alert, Badge } from 'react-bootstrap';
import { toPng } from 'html-to-image';
import {
    BsArrowLeft, BsEnvelopePaperFill, BsSave, BsCheckCircleFill,
    BsExclamationTriangleFill, BsImage, BsAward, BsPhone, BsTablet, BsDisplay,
    BsSendFill, BsXCircle, BsClockHistory,
} from 'react-icons/bs';
import {
    getEvent,
    getAttendees,
    getEventCertificateEmailTemplate,
    updateEventCertificateEmailTemplate,
    getCertificateTemplates,
    sendAttendeeCertificate,
    getCertificateSendLog,
} from '../services/api';
import { getImageUrl } from '../utils/imageUrl';

// Full-page editor for the per-event certificate email template.
// Mirrors the layout of AttendeeEmailTemplatePage but adds a live
// preview of the certificate that will be attached, so the operator
// sees the email body *and* the rendered certificate side by side.
//
// Variables: {{name}}, {{event_title}}, {{event_date}}. The same set
// is substituted on both the email body (server-side at send time)
// and the cert preview's text elements (where they map onto field keys).

const SAMPLE = {
    name: 'Rahul Sharma',
    designation: 'Founder',
    company: 'Acme Inc.',
};

const DEFAULT_SUBJECT = 'Your certificate from {{event_title}}';
const DEFAULT_BODY = 'Hi {{name}},\n\nThank you for being part of {{event_title}}. Your certificate is attached.\n\nBest regards,\nThe team';

const VARIABLES = ['name', 'event_title', 'event_date'];

const DEVICE_WIDTHS = {
    mobile:  { width: 375,  label: 'Mobile',  icon: BsPhone   },
    tablet:  { width: 600,  label: 'Tablet',  icon: BsTablet  },
    desktop: { width: null, label: 'Desktop', icon: BsDisplay },
};

const fmtEventDate = (start, end) => {
    if (!start) return '';
    const s = new Date(start);
    const e = end ? new Date(end) : null;
    if (Number.isNaN(s.getTime())) return String(start);
    const m = (d) => d.toLocaleString('en-GB', { month: 'short' });
    const full = (d) => `${d.getDate()} ${m(d)} ${d.getFullYear()}`;
    if (!e || Number.isNaN(e.getTime()) || s.toDateString() === e.toDateString()) return full(s);
    if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
        return `${s.getDate()}–${e.getDate()} ${m(s)} ${s.getFullYear()}`;
    }
    return `${s.getDate()} ${m(s)} – ${e.getDate()} ${m(e)} ${e.getFullYear()}`;
};

// Read-only render of one certificate text element. Mirrors the editor's
// auto-center behaviour: when align === 'center' && !lockX, position the
// rendered text so its measured width is centered on the canvas — same
// formula as BulkCertificatePage's onAutoCenterX callback. Without this,
// the preview uses the stored el.x (computed for whatever sample data the
// editor last rendered) and the text looks off-centered for our different
// preview values.
function StaticElement({ el, value, canvasWidth }) {
    const ref = useRef(null);
    const [x, setX] = useState(el.x);
    useLayoutEffect(() => {
        if (el.align !== 'center' || el.lockX) { setX(el.x); return; }
        if (!ref.current) return;
        const w = ref.current.offsetWidth;
        if (!w) return;
        setX(Math.max(0, Math.round((canvasWidth - w) / 2)));
    }, [value, el.x, el.align, el.lockX, el.fontSize, el.fontFamily, el.fontWeight, el.letterSpacing, el.nowrap, canvasWidth]);

    return (
        <div style={{
            position: 'absolute', top: 0, left: 0,
            transform: `translate(${x}px, ${el.y}px)`,
            fontFamily: `"${el.fontFamily}", system-ui, sans-serif`,
            fontSize: el.fontSize,
            fontWeight: el.fontWeight,
            fontStyle: el.italic ? 'italic' : 'normal',
            textDecoration: el.underline ? 'underline' : 'none',
            letterSpacing: el.letterSpacing ? `${el.letterSpacing}px` : 'normal',
            color: el.color,
            whiteSpace: el.nowrap ? 'nowrap' : 'pre-wrap',
            lineHeight: 1.2,
            pointerEvents: 'none',
        }}>
            <span ref={ref} style={{ display: 'inline-block' }}>{value}</span>
        </div>
    );
}

const valueForElement = (el, attendee, event) => {
    switch (el.key) {
        case 'name':         return attendee?.name || '';
        case 'designation':  return attendee?.designation || '';
        case 'company':      return attendee?.company || '';
        case 'event_title':  return event?.title || '';
        case 'event_date':   return fmtEventDate(event?.start_date, event?.end_date);
        case 'custom':
        default:             return el.content || '';
    }
};

// Substitute {{name}} / {{event_title}} / {{event_date}} into the body
// using sample data. Mirrors what the backend does at send time.
const fillVars = (s, event) => String(s || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => {
    if (k === 'name') return SAMPLE.name;
    if (k === 'event_title') return event?.title || 'Sample Event';
    if (k === 'event_date') return fmtEventDate(event?.start_date, event?.end_date) || '20 Oct 2026';
    return m;
});

function VariableChips({ onInsert }) {
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
            {VARIABLES.map(v => (
                <button
                    key={v}
                    type="button"
                    onClick={() => onInsert(v)}
                    style={{
                        background: 'rgba(139,92,246,0.10)',
                        border: '1px solid rgba(139,92,246,0.30)',
                        color: '#a78bfa',
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

function Section({ icon: Icon, title, subtitle, children, right }) {
    return (
        <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 14,
            padding: '20px 22px',
            marginBottom: 18,
        }}>
            <div className="d-flex align-items-center justify-content-between gap-2 mb-3">
                <div className="d-flex align-items-center gap-2">
                    {Icon && <Icon size={16} style={{ color: '#a78bfa' }} />}
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
                        {subtitle && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>{subtitle}</div>}
                    </div>
                </div>
                {right}
            </div>
            {children}
        </div>
    );
}

// Iframe email preview with device-width switcher. Auto-grows the iframe
// to fit the rendered body so there's no inner scrollbar.
function EmailPreview({ subject, body, event, device, onDeviceChange }) {
    const filledSubject = fillVars(subject || DEFAULT_SUBJECT, event);
    const filledBody = fillVars(body || DEFAULT_BODY, event).replace(/\n/g, '<br>');
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f8fafc;">
        <div style="font-family:'Segoe UI',Arial,sans-serif;background:#f8fafc;padding:24px;">
            <div style="background:#fff;max-width:560px;margin:0 auto;border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
                <div style="padding:14px 22px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#64748b;">
                    <strong style="color:#1e293b;font-size:13px;">Subject:</strong> ${filledSubject}
                </div>
                <div style="padding:32px 24px;color:#1e293b;line-height:1.55;font-size:15px;">${filledBody}</div>
                <div style="background:#f8fafc;padding:14px 22px;font-size:12px;color:#64748b;border-top:1px solid #f1f5f9;display:flex;align-items:center;gap:8px;">
                    📎 <span><em>certificate-${SAMPLE.name.toLowerCase().replace(/\s+/g, '-')}.png</em> attached</span>
                </div>
            </div>
        </div>
    </body></html>`;

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
        } catch { /* ignore */ }
    };
    useEffect(() => {
        const f = iframeRef.current;
        if (!f) return;
        const raf = requestAnimationFrame(measure);
        const t = setTimeout(measure, 80);
        return () => { cancelAnimationFrame(raf); clearTimeout(t); };
    }, [html]);

    const w = DEVICE_WIDTHS[device]?.width;

    return (
        <>
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
                                onClick={() => onDeviceChange(key)}
                                title={`${def.label}${def.width ? ` · ${def.width}px` : ''}`}
                                style={{
                                    display: 'grid', placeItems: 'center',
                                    width: 32, height: 30,
                                    borderRadius: 8,
                                    border: 'none',
                                    background: active ? '#8b5cf6' : 'transparent',
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
                        style={{ display: 'block', width: '100%', height: iframeHeight, border: 'none', background: '#f8fafc' }}
                    />
                </div>
            </div>
        </>
    );
}

// Scaled, read-only render of a cert template — bg + every text element
// positioned in canvas-pixel space, but the whole stage is shrunk to fit
// the preview pane via CSS transform: scale().
function CertificatePreview({ template, event, containerWidth }) {
    if (!template) {
        return (
            <div style={{
                padding: 40,
                textAlign: 'center',
                background: 'rgba(255,255,255,0.04)',
                border: '1px dashed var(--border-subtle)',
                borderRadius: 12,
                color: 'var(--text-muted)',
                fontSize: 13,
            }}>
                <BsAward size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
                <div>No certificate template yet for this event.</div>
                <div style={{ fontSize: 11, marginTop: 4 }}>Design one in <strong>Bulk Certificate</strong> first.</div>
            </div>
        );
    }
    const canvasW = template.canvas_width || 1200;
    const canvasH = template.canvas_height || 850;
    const scale = containerWidth > 0 ? Math.min(1, containerWidth / canvasW) : 0.5;
    const bg = template.bg_image_url ? getImageUrl(template.bg_image_url) : null;
    return (
        <div style={{
            width: '100%',
            height: canvasH * scale,
            overflow: 'hidden',
            background: '#0f172a',
            borderRadius: 12,
            border: '1px solid var(--border-subtle)',
            position: 'relative',
        }}>
            <div style={{
                width: canvasW,
                height: canvasH,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
                position: 'relative',
                background: bg ? `url(${bg}) center/cover no-repeat` : '#fff',
            }}>
                {(template.elements || []).map(el => (
                    <StaticElement key={el.id} el={el} value={valueForElement(el, SAMPLE, event)} canvasWidth={canvasW} />
                ))}
            </div>
        </div>
    );
}

export default function CertificateEmailTemplatePage() {
    const { eventId } = useParams();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [banner, setBanner] = useState(null);
    const [dirty, setDirty] = useState(false);

    const [event, setEvent] = useState(null);
    const [subject, setSubject] = useState('');
    const [body, setBody] = useState('');
    const [isCustomised, setIsCustomised] = useState(false);

    const [templates, setTemplates] = useState([]);
    const [templateId, setTemplateId] = useState(searchParams.get('template') || '');

    const [device, setDevice] = useState('desktop');

    // Attendees + send-via-email state. We load all attendees for the event
    // up front (mirrors BulkCertificatePage), then the operator picks a
    // status filter and clicks Send. The loop renders an offscreen stage
    // for each attendee and POSTs the PNG to the existing send-certificate
    // endpoint.
    const [attendees, setAttendees] = useState([]);
    const [statusFilter, setStatusFilter] = useState('all');
    const [sending, setSending] = useState(false);
    const [sendProgress, setSendProgress] = useState({ done: 0, total: 0, sent: 0, skipped: 0, failed: 0 });
    const [renderAttendee, setRenderAttendee] = useState(null);
    const cancelledRef = useRef(false);
    const offscreenRef = useRef(null);

    // Counts for the summary card. The full history (rows + chart) lives
    // on its own page; here we only need the aggregate so operators see
    // at-a-glance totals after a run without leaving this screen.
    const [logCounts, setLogCounts] = useState({ sent: 0, skipped: 0, failed: 0, total: 0 });

    const refreshLog = async () => {
        if (!eventId) return;
        try {
            const { data } = await getCertificateSendLog(eventId, { limit: 1 });
            setLogCounts(data?.counts || { sent: 0, skipped: 0, failed: 0, total: 0 });
        } catch (err) {
            console.warn('failed to load send-log counts:', err.message);
        }
    };

    // Measured width of the cert preview pane — used to scale the canvas.
    const certPaneRef = useRef(null);
    const [certPaneWidth, setCertPaneWidth] = useState(0);
    useLayoutEffect(() => {
        if (!certPaneRef.current) return;
        const el = certPaneRef.current;
        const ro = new ResizeObserver(entries => {
            for (const e of entries) setCertPaneWidth(e.contentRect.width);
        });
        ro.observe(el);
        setCertPaneWidth(el.getBoundingClientRect().width);
        return () => ro.disconnect();
    }, []);

    const subjectRef = useRef(null);
    const bodyRef = useRef(null);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const [evtRes, tplRes, listRes, attRes, logRes] = await Promise.all([
                    getEvent(eventId),
                    getEventCertificateEmailTemplate(eventId),
                    getCertificateTemplates(eventId),
                    getAttendees(eventId),
                    getCertificateSendLog(eventId, { limit: 1 }).catch(() => ({ data: null })),
                ]);
                if (cancelled) return;
                setEvent(evtRes.data || null);
                setAttendees(Array.isArray(attRes.data) ? attRes.data : []);
                if (logRes?.data) {
                    setLogCounts(logRes.data.counts || { sent: 0, skipped: 0, failed: 0, total: 0 });
                }
                const tpl = tplRes.data?.template;
                // When nothing is saved yet, seed the fields with the
                // defaults so the operator has editable copy in front of
                // them instead of just placeholder text that vanishes on
                // first click. `isCustomised` reflects what the server
                // actually has, so the badge only shows after a real save.
                setSubject(tpl?.subject || DEFAULT_SUBJECT);
                setBody(tpl?.body || DEFAULT_BODY);
                setIsCustomised(!!tpl);
                const list = Array.isArray(listRes.data) ? listRes.data : [];
                setTemplates(list);
                // If no template was passed via ?template=, pick the first
                // (most-recently-updated) one so the operator sees a preview.
                setTemplateId(prev => prev || (list[0]?.id ? String(list[0].id) : ''));
            } catch (err) {
                setBanner({ type: 'danger', text: err.response?.data?.error || 'Failed to load template' });
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [eventId]);

    const selectedTemplate = useMemo(
        () => templates.find(t => String(t.id) === String(templateId)) || null,
        [templates, templateId]
    );

    // Filter attendees by status — mirrors the dropdown on BulkCertificatePage.
    const filteredAttendees = useMemo(() => {
        if (!attendees) return [];
        if (statusFilter === 'all') return attendees;
        return attendees.filter(a => (a.status || '').toLowerCase() === statusFilter);
    }, [attendees, statusFilter]);

    // How many of the matched attendees actually have an email on file —
    // surfaced in the UI so operators know up front (instead of finding out
    // only after clicking Send and getting an error).
    const matchedWithEmail = useMemo(
        () => filteredAttendees.filter(a => !!a.email).length,
        [filteredAttendees]
    );

    const handleSend = async () => {
        setBanner(null);
        if (!selectedTemplate) {
            setBanner({ type: 'danger', text: 'No certificate template selected — design one in Bulk Certificate first.' });
            return;
        }
        if (!selectedTemplate.bg_image_url) {
            setBanner({ type: 'danger', text: 'The selected certificate template has no background image yet.' });
            return;
        }
        if (!(selectedTemplate.elements || []).length) {
            setBanner({ type: 'danger', text: 'The selected certificate template has no text elements yet.' });
            return;
        }
        if (!filteredAttendees.length) {
            setBanner({ type: 'danger', text: 'No attendees match the current filter.' });
            return;
        }
        if (dirty) {
            setBanner({ type: 'danger', text: 'Save your template changes first — unsaved subject/body would not be used by this run.' });
            return;
        }
        const withEmail = filteredAttendees.filter(a => !!a.email);
        const skippedNoEmail = filteredAttendees.length - withEmail.length;
        if (!withEmail.length) {
            setBanner({ type: 'danger', text: 'None of the matched attendees have an email on file.' });
            return;
        }
        const msg = `Email this certificate to ${withEmail.length} attendee${withEmail.length === 1 ? '' : 's'}` +
            (skippedNoEmail ? ` (skipping ${skippedNoEmail} with no email)` : '') + '?';
        if (!window.confirm(msg)) return;

        cancelledRef.current = false;
        setSending(true);
        let sent = 0, failed = 0;
        setSendProgress({ done: 0, total: withEmail.length, sent: 0, skipped: skippedNoEmail, failed: 0 });

        // Wait one frame + any pending web fonts so the offscreen stage
        // renders with the right typefaces before we start snapshotting.
        await new Promise(r => requestAnimationFrame(r));
        try { if (document.fonts?.ready) await document.fonts.ready; } catch { /* ignore */ }

        try {
            for (let i = 0; i < withEmail.length; i++) {
                if (cancelledRef.current) break;
                const a = withEmail[i];
                // Drive the offscreen stage by setting the active attendee.
                // Wait two frames so React commits and the browser paints
                // before we snapshot — otherwise we'd capture the previous
                // attendee's data.
                setRenderAttendee(a);
                await new Promise(r => requestAnimationFrame(r));
                await new Promise(r => requestAnimationFrame(r));
                await new Promise(r => setTimeout(r, 30));

                try {
                    if (!offscreenRef.current) throw new Error('Offscreen stage not ready');
                    const dataUrl = await toPng(offscreenRef.current, {
                        pixelRatio: 1,
                        width: selectedTemplate.canvas_width || 1200,
                        height: selectedTemplate.canvas_height || 850,
                        style: { transform: 'none', transformOrigin: 'top left' },
                        cacheBust: true,
                    });
                    const blob = await (await fetch(dataUrl)).blob();
                    const safeName = (a.name || `attendee-${a.id}`).replace(/[^\w-]+/g, '_').slice(0, 60);
                    await sendAttendeeCertificate(a.id, blob, `${safeName}.png`);
                    sent += 1;
                } catch (err) {
                    console.warn(`send failed for ${a.name}:`, err);
                    failed += 1;
                }
                setSendProgress({ done: i + 1, total: withEmail.length, sent, skipped: skippedNoEmail, failed });
            }
            const parts = [`${sent} sent`];
            if (skippedNoEmail) parts.push(`${skippedNoEmail} skipped (no email)`);
            if (failed) parts.push(`${failed} failed`);
            if (cancelledRef.current) parts.unshift('Cancelled —');
            setBanner({ type: failed ? 'warning' : 'success', text: parts.join(', ') + '.' });
        } catch (err) {
            console.error(err);
            setBanner({ type: 'danger', text: 'Email run failed: ' + (err.message || 'unknown error') });
        } finally {
            setSending(false);
            cancelledRef.current = false;
            setRenderAttendee(null);
            // Refresh the history panel — the backend just wrote
            // one row per attendee we touched, so the table updates
            // with the latest sent/skipped/failed without a page reload.
            refreshLog();
        }
    };

    const insertVar = (field, v) => {
        const ref = field === 'subject' ? subjectRef : bodyRef;
        const el = ref.current;
        const insert = `{{${v}}}`;
        if (!el) {
            if (field === 'subject') setSubject(s => `${s}${insert}`);
            else setBody(s => `${s}${insert}`);
            setDirty(true);
            return;
        }
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        const before = el.value.slice(0, start);
        const after = el.value.slice(end);
        const next = before + insert + after;
        if (field === 'subject') setSubject(next); else setBody(next);
        setDirty(true);
        // Reposition cursor right after the inserted variable.
        requestAnimationFrame(() => {
            el.focus();
            const pos = start + insert.length;
            el.setSelectionRange(pos, pos);
        });
    };

    const handleSave = async () => {
        if (!subject.trim() || !body.trim()) {
            setBanner({ type: 'danger', text: 'Subject and body are both required.' });
            return;
        }
        setSaving(true);
        setBanner(null);
        try {
            await updateEventCertificateEmailTemplate(eventId, { subject: subject.trim(), body: body.trim() });
            setIsCustomised(true);
            setDirty(false);
            setBanner({ type: 'success', text: 'Template saved. New certificate emails will use this version.' });
        } catch (err) {
            setBanner({ type: 'danger', text: err.response?.data?.error || 'Failed to save template' });
        } finally {
            setSaving(false);
        }
    };

    const handleResetDefaults = () => {
        if (!window.confirm('Reset subject and body to the built-in defaults?')) return;
        setSubject(DEFAULT_SUBJECT);
        setBody(DEFAULT_BODY);
        setDirty(true);
    };

    if (loading) {
        return (
            <div className="d-flex justify-content-center align-items-center" style={{ minHeight: 400 }}>
                <Spinner animation="border" style={{ color: '#8b5cf6' }} />
            </div>
        );
    }

    return (
        <div className="animate-in">
            <div className="page-header" style={{ marginBottom: 20 }}>
                <div className="d-flex align-items-center gap-3 mb-2">
                    <button
                        type="button"
                        onClick={() => navigate('/tools/bulk-certificate')}
                        title="Back to Bulk Certificate"
                        style={{
                            width: 36, height: 36, borderRadius: 10,
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-primary)',
                            display: 'grid', placeItems: 'center',
                            cursor: 'pointer',
                        }}
                    >
                        <BsArrowLeft size={16} />
                    </button>
                    <div style={{ flex: 1 }}>
                        <div className="d-flex align-items-center gap-2">
                            <h4 className="m-0" style={{ color: 'var(--text-primary)' }}>Certificate Email Template</h4>
                            {isCustomised && <Badge bg="" style={{ background: 'rgba(139,92,246,0.18)', color: '#a78bfa', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em' }}>CUSTOMISED</Badge>}
                            {dirty && <Badge bg="" style={{ background: 'rgba(245,158,11,0.18)', color: '#f59e0b', fontSize: 10, fontWeight: 700, letterSpacing: '0.05em' }}>UNSAVED</Badge>}
                        </div>
                        <p className="m-0" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                            For <strong style={{ color: 'var(--text-primary)' }}>{event?.title || `event #${eventId}`}</strong>. Used when you click <strong>Send via Email</strong> on the Bulk Certificate page. Insert <code style={{ color: '#a78bfa', fontSize: 11 }}>{`{{variables}}`}</code> for personalisation.
                        </p>
                    </div>
                    <div className="d-flex gap-2">
                        <Button
                            variant="outline-light" size="sm"
                            onClick={handleResetDefaults}
                            disabled={saving}
                            style={{ border: '1px solid var(--border-subtle)', borderRadius: 10 }}
                        >
                            Reset to default
                        </Button>
                        <Button
                            onClick={handleSave}
                            disabled={saving || !dirty}
                            style={{
                                background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
                                border: 'none', fontWeight: 600, borderRadius: 10,
                            }}
                        >
                            <BsSave className="me-1" /> {saving ? 'Saving…' : 'Save changes'}
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
                <Col lg={5}>
                    <Section icon={BsEnvelopePaperFill} title="Email content" subtitle="Subject line + body. Click a chip to insert that variable at your cursor.">
                        <div style={{ marginBottom: 18 }}>
                            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Subject</label>
                            <VariableChips onInsert={(v) => insertVar('subject', v)} />
                            <Form.Control
                                ref={subjectRef}
                                value={subject}
                                onChange={(e) => { setSubject(e.target.value); setDirty(true); }}
                                placeholder={DEFAULT_SUBJECT}
                                style={{ background: 'var(--bg-input, rgba(0,0,0,0.25))', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                            />
                        </div>
                        <div style={{ marginBottom: 8 }}>
                            <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Body</label>
                            <VariableChips onInsert={(v) => insertVar('body', v)} />
                            <Form.Control
                                as="textarea"
                                ref={bodyRef}
                                rows={11}
                                value={body}
                                onChange={(e) => { setBody(e.target.value); setDirty(true); }}
                                placeholder={DEFAULT_BODY}
                                style={{ background: 'var(--bg-input, rgba(0,0,0,0.25))', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontFamily: 'inherit', lineHeight: 1.55 }}
                            />
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                                Line breaks render as new lines in the email. HTML in the body is preserved.
                            </div>
                        </div>
                    </Section>

                    <Section icon={BsImage} title="Sample data" subtitle="Used in the live preview. Real sends fill these from each attendee.">
                        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', rowGap: 8, columnGap: 12, fontSize: 13 }}>
                            <div style={{ color: 'var(--text-muted)' }}>{'{{name}}'}</div>
                            <div style={{ color: 'var(--text-primary)' }}>{SAMPLE.name}</div>
                            <div style={{ color: 'var(--text-muted)' }}>{'{{event_title}}'}</div>
                            <div style={{ color: 'var(--text-primary)' }}>{event?.title || 'Sample Event'}</div>
                            <div style={{ color: 'var(--text-muted)' }}>{'{{event_date}}'}</div>
                            <div style={{ color: 'var(--text-primary)' }}>{fmtEventDate(event?.start_date, event?.end_date) || '20 Oct 2026'}</div>
                        </div>
                    </Section>
                </Col>

                <Col lg={7}>
                    <div style={{ position: 'sticky', top: 16 }}>
                        <Section icon={BsEnvelopePaperFill} title="Email preview" subtitle="What the delegate will see in their inbox.">
                            <EmailPreview subject={subject} body={body} event={event} device={device} onDeviceChange={setDevice} />
                        </Section>

                        <Section
                            icon={BsAward}
                            title="Certificate preview"
                            subtitle="Attached to the email above with sample data filled in."
                            right={templates.length > 1 ? (
                                <Form.Select
                                    size="sm"
                                    value={templateId}
                                    onChange={(e) => setTemplateId(e.target.value)}
                                    style={{
                                        background: 'var(--bg-input, rgba(0,0,0,0.25))',
                                        border: '1px solid var(--border-subtle)',
                                        color: 'var(--text-primary)',
                                        maxWidth: 220, fontSize: 12,
                                    }}
                                >
                                    {templates.map(t => (
                                        <option key={t.id} value={t.id}>{t.name || `Template #${t.id}`}</option>
                                    ))}
                                </Form.Select>
                            ) : null}
                        >
                            <div ref={certPaneRef}>
                                <CertificatePreview
                                    template={selectedTemplate}
                                    event={event}
                                    containerWidth={certPaneWidth}
                                />
                            </div>
                            {selectedTemplate && (
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                                    Template: <strong style={{ color: 'var(--text-primary)' }}>{selectedTemplate.name || `#${selectedTemplate.id}`}</strong> · {selectedTemplate.canvas_width}×{selectedTemplate.canvas_height}px
                                </div>
                            )}
                        </Section>

                        {/* Send via Email — moved here from BulkCertificatePage.
                            Renders each attendee's cert via the offscreen stage
                            below, then POSTs the PNG to send-certificate. */}
                        <Section icon={BsSendFill} title="Send to delegates" subtitle="Email each delegate their personalised certificate using the template above.">
                            <div className="d-flex align-items-center gap-3 flex-wrap" style={{ marginBottom: 14 }}>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Recipient filter</div>
                                <Form.Select
                                    size="sm"
                                    value={statusFilter}
                                    onChange={(e) => setStatusFilter(e.target.value)}
                                    disabled={sending}
                                    style={{
                                        background: 'var(--bg-input, rgba(0,0,0,0.25))',
                                        border: '1px solid var(--border-subtle)',
                                        color: 'var(--text-primary)',
                                        maxWidth: 200, fontSize: 12,
                                    }}
                                >
                                    <option value="all">All attendees</option>
                                    <option value="registered">Registered</option>
                                    <option value="confirmed">Confirmed</option>
                                    <option value="checked_in">Checked-in</option>
                                </Form.Select>
                                <Badge bg="" style={{ background: 'rgba(139,92,246,0.18)', color: '#a78bfa', fontSize: 11, fontWeight: 600 }}>
                                    {filteredAttendees.length} match{filteredAttendees.length === 1 ? '' : 'es'}
                                </Badge>
                                <Badge bg="" style={{
                                    background: matchedWithEmail > 0 ? 'rgba(16,185,129,0.18)' : 'rgba(239,68,68,0.18)',
                                    color: matchedWithEmail > 0 ? '#10b981' : '#ef4444',
                                    fontSize: 11, fontWeight: 600,
                                }}>
                                    {matchedWithEmail} with email
                                </Badge>
                            </div>
                            {filteredAttendees.length > 0 && matchedWithEmail === 0 && (
                                <Alert variant="warning" className="py-2 mb-3" style={{ fontSize: 12 }}>
                                    None of the {filteredAttendees.length} matched attendee{filteredAttendees.length === 1 ? '' : 's'} have an email address on file. Add emails on the <a href="/attendees" style={{ color: '#a78bfa' }}>Attendees</a> page (or via CSV import) before sending.
                                </Alert>
                            )}
                            <div className="d-flex gap-2 flex-wrap">
                                <Button
                                    onClick={handleSend}
                                    disabled={sending || !selectedTemplate || filteredAttendees.length === 0 || dirty}
                                    title={
                                        dirty ? 'Save the template first' :
                                        !selectedTemplate ? 'No certificate template found for this event' :
                                        filteredAttendees.length === 0 ? 'No attendees match the current filter' :
                                        'Email each matched attendee their certificate'
                                    }
                                    style={{
                                        background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
                                        border: 'none', fontWeight: 700, borderRadius: 10, padding: '10px 22px',
                                        boxShadow: '0 10px 28px -10px rgba(139,92,246,0.7)',
                                        opacity: (!selectedTemplate || filteredAttendees.length === 0 || dirty) ? 0.65 : 1,
                                    }}
                                >
                                    {sending ? (
                                        <><Spinner size="sm" animation="border" className="me-2" />
                                            Emailing {sendProgress.done}/{sendProgress.total}…</>
                                    ) : (
                                        <><BsSendFill size={14} className="me-2" /> Send via Email</>
                                    )}
                                </Button>
                                {sending && (
                                    <Button
                                        variant="outline-light"
                                        onClick={() => { cancelledRef.current = true; }}
                                        style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '10px 16px' }}
                                    >
                                        <BsXCircle size={14} className="me-2" /> Cancel
                                    </Button>
                                )}
                            </div>
                            {sending && sendProgress.total > 0 && (
                                <div style={{ marginTop: 12, height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                                    <div style={{
                                        width: `${(sendProgress.done / sendProgress.total) * 100}%`,
                                        height: '100%',
                                        background: 'linear-gradient(90deg, #8b5cf6, #ec4899)',
                                        transition: 'width 0.2s',
                                    }} />
                                </div>
                            )}
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.5 }}>
                                Attendees with no email on file are skipped automatically. Each send takes ~1-2 seconds — 100 attendees ≈ 2-3 min.
                            </div>
                        </Section>

                        {/* Send history — auto-refreshes after every run.
                            Stickied with the rest of the right column so the
                            operator can watch the table fill in as the loop
                            progresses (though current refresh is at run end). */}
                        {/* Compact summary card — full history (chart + filters
                            + table) lives at its own page. We keep the at-a-glance
                            totals here for context so the operator can decide if
                            they need to drill in. */}
                        <Section
                            icon={BsClockHistory}
                            title="Send history"
                            subtitle={logCounts.total > 0
                                ? `${logCounts.total} certificate${logCounts.total === 1 ? '' : 's'} emailed for this event so far.`
                                : 'No certificates have been emailed for this event yet.'}
                        >
                            <div className="d-flex gap-2 flex-wrap" style={{ marginBottom: 14 }}>
                                <Badge bg="" style={{ background: 'rgba(16,185,129,0.18)', color: '#10b981', fontSize: 11, fontWeight: 700 }}>
                                    {logCounts.sent} sent
                                </Badge>
                                <Badge bg="" style={{ background: 'rgba(245,158,11,0.18)', color: '#f59e0b', fontSize: 11, fontWeight: 700 }}>
                                    {logCounts.skipped} skipped
                                </Badge>
                                <Badge bg="" style={{ background: 'rgba(239,68,68,0.18)', color: '#ef4444', fontSize: 11, fontWeight: 700 }}>
                                    {logCounts.failed} failed
                                </Badge>
                            </div>
                            <Button
                                onClick={() => navigate(`/events/${eventId}/certificate-send-history`)}
                                style={{
                                    width: '100%',
                                    background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
                                    border: 'none', fontWeight: 600, borderRadius: 10, padding: '10px 14px',
                                }}
                            >
                                <BsClockHistory className="me-2" /> Open full history (chart + filters)
                            </Button>
                        </Section>
                    </div>
                </Col>
            </Row>

            {/* Offscreen full-resolution render target. We mount it absolutely
                positioned far off-screen instead of display:none so html-to-image
                can still measure layout. Each attendee in the send loop sets
                `renderAttendee`, we wait two frames, then snapshot. */}
            {selectedTemplate && (
                <div style={{
                    position: 'fixed',
                    left: -99999, top: 0,
                    pointerEvents: 'none',
                    width: selectedTemplate.canvas_width || 1200,
                    height: selectedTemplate.canvas_height || 850,
                }}>
                    <div
                        ref={offscreenRef}
                        style={{
                            width: selectedTemplate.canvas_width || 1200,
                            height: selectedTemplate.canvas_height || 850,
                            position: 'relative',
                            background: selectedTemplate.bg_image_url
                                ? `url(${getImageUrl(selectedTemplate.bg_image_url)}) center/cover no-repeat`
                                : '#fff',
                        }}
                    >
                        {(selectedTemplate.elements || []).map(el => (
                            <StaticElement
                                key={el.id}
                                el={el}
                                value={valueForElement(el, renderAttendee || SAMPLE, event)}
                                canvasWidth={selectedTemplate.canvas_width || 1200}
                            />
                        ))}
                    </div>
                </div>
            )}

        </div>
    );
}
