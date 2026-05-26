import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Form, Alert, Row, Col, InputGroup } from 'react-bootstrap';
import { BsArrowLeft, BsCheckCircleFill, BsExclamationCircleFill, BsXCircleFill, BsKeyboard, BsCamera, BsCameraVideoOff, BsPrinter, BsPersonBadge } from 'react-icons/bs';
import { Html5Qrcode } from 'html5-qrcode';
import { getEvent, checkinAttendee } from '../services/api';

// Common badge / lanyard sizes. Different events use different stock so
// the user picks a preset (or "custom" for an exact mm size). Stored in
// localStorage so each device remembers what's loaded in its printer.
const BADGE_PRESETS = [
    { key: 'A6',        label: 'A6 portrait (105 × 148 mm)',         w: 105,  h: 148 },
    { key: 'A7',        label: 'A7 portrait (74 × 105 mm)',          w: 74,   h: 105 },
    { key: 'CR80',      label: 'CR80 / credit card (54 × 85.6 mm)',  w: 54,   h: 85.6 },
    { key: '4x3in',     label: '4 × 3 inch (102 × 76 mm)',           w: 102,  h: 76 },
    { key: '4x6in',     label: '4 × 6 inch (102 × 152 mm)',          w: 102,  h: 152 },
    { key: 'lanyard',   label: 'Lanyard standard (100 × 70 mm)',     w: 100,  h: 70 },
    { key: 'square100', label: 'Square (100 × 100 mm)',              w: 100,  h: 100 },
    { key: 'custom',    label: 'Custom…',                            w: 105,  h: 148 },
];
const DEFAULT_BADGE = { presetKey: 'A6', w: 105, h: 148 };
const BADGE_SIZE_LS_KEY = 'checkin.badgeSize';

// On-site QR scanner.
//
// Route: /events/:id/checkin — meant to be opened on a phone or tablet at the
// registration desk. Staff is already authenticated (the route is wrapped in
// ProtectedRoute), so we just need camera permission.
//
// One scan = one POST to /api/attendees/checkin, with three possible
// outcomes shown as a big colour-coded result card:
//   success — first scan, attendee just marked present
//   already — was already checked in (shows who/when)
//   invalid — unknown / wrong-event / no-permission QR
//
// After a result lands we pause scanning for ~2.5s so the same QR doesn't
// fire repeatedly while it's still in the viewport, then re-arm.
export default function CheckInScannerPage() {
    const { id: eventId } = useParams();
    const navigate = useNavigate();

    const [event, setEvent] = useState(null);
    const [scannerError, setScannerError] = useState('');
    const [result, setResult] = useState(null); // { status, attendee?, checked_in_at?, checked_in_by_name?, reason? }
    const [manualOpen, setManualOpen] = useState(false);
    const [manualToken, setManualToken] = useState('');

    // Persistent "last checked in" panel — survives the result-card
    // auto-dismiss so the staffer has time to print the badge for that
    // delegate before the next scan replaces it.
    const [lastCheckin, setLastCheckin] = useState(null);

    // Badge / lanyard dimensions. Drives both the on-screen preview and
    // the @page size used when printing. Persisted per-device.
    const [badgeSize, setBadgeSize] = useState(() => {
        try {
            const raw = localStorage.getItem(BADGE_SIZE_LS_KEY);
            if (raw) {
                const p = JSON.parse(raw);
                if (p && typeof p.w === 'number' && typeof p.h === 'number' && p.w > 0 && p.h > 0) return p;
            }
        } catch { /* ignore */ }
        return DEFAULT_BADGE;
    });
    useEffect(() => {
        try { localStorage.setItem(BADGE_SIZE_LS_KEY, JSON.stringify(badgeSize)); } catch { /* ignore */ }
    }, [badgeSize]);

    const onBadgePresetChange = (key) => {
        const preset = BADGE_PRESETS.find(p => p.key === key) || BADGE_PRESETS[0];
        if (key === 'custom') {
            setBadgeSize(s => ({ presetKey: 'custom', w: s.w, h: s.h }));
        } else {
            setBadgeSize({ presetKey: preset.key, w: preset.w, h: preset.h });
        }
    };

    // Scale the preview so it fits the right column at a consistent on-screen
    // size regardless of the badge's actual mm dimensions. 3.78 = approx
    // px-per-mm at 96 dpi. Capped at 0.85 so small badges (CR80) don't blow
    // up bigger than the print copy.
    const previewScale = Math.min(0.85, 220 / (badgeSize.w * 3.78));

    // We keep the Html5Qrcode instance + a "processing" flag in refs. Refs
    // (not state) because the decode callback closes over the value at the
    // time scanning started — state would be stale.
    const scannerRef = useRef(null);
    const processingRef = useRef(false);
    const containerId = 'checkin-scanner-reader';

    useEffect(() => {
        getEvent(eventId).then(r => setEvent(r.data)).catch(() => {});
    }, [eventId]);

    // Boot the camera scanner.
    //
    // React StrictMode in dev runs every effect twice (mount → cleanup →
    // mount again) which trips up html5-qrcode if we don't await stop()
    // properly before letting the next mount start. We track local
    // `cancelled`/`started` flags so an unmount that fires mid-start stops
    // the camera once start finally resolves.
    //
    // Camera selection: we enumerate available cameras and pick the back
    // camera on phones (label contains "back"/"environment") or fall back
    // to the first one — using `facingMode: 'environment'` directly fails
    // silently on laptops that don't have a rear camera.
    useEffect(() => {
        let cancelled = false;
        let started = false;
        const scanner = new Html5Qrcode(containerId, { verbose: false });
        scannerRef.current = scanner;

        (async () => {
            try {
                const cameras = await Html5Qrcode.getCameras();
                if (cancelled) return;
                if (!cameras || cameras.length === 0) {
                    setScannerError('No camera detected. Make sure your browser has permission and no other app is using the camera.');
                    return;
                }
                // Prefer back camera if present (phones/tablets); fall back
                // to the first available on laptops.
                const back = cameras.find(c => /back|environment|rear/i.test(c.label || ''));
                const cameraId = (back || cameras[0]).id;

                await scanner.start(
                    cameraId,
                    { fps: 10, qrbox: { width: 260, height: 260 } },
                    (decodedText) => onScan(decodedText),
                    () => { /* per-frame "no QR here" — noisy; intentionally ignored */ }
                );
                started = true;
                if (cancelled) {
                    // We were unmounted mid-start (StrictMode dev cycle).
                    await scanner.stop().catch(() => {});
                    try { scanner.clear(); } catch { /* ignore */ }
                }
            } catch (err) {
                if (cancelled) return;
                const msg = err?.message || String(err) || 'Could not access camera.';
                setScannerError(/permission|notallowed/i.test(msg)
                    ? 'Camera permission was denied. Click the camera icon in the address bar to allow it, then reload.'
                    : msg);
            }
        })();

        return () => {
            cancelled = true;
            if (started) {
                scanner.stop().catch(() => {}).finally(() => {
                    try { scanner.clear(); } catch { /* ignore */ }
                });
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const onScan = async (token) => {
        if (processingRef.current) return;
        processingRef.current = true;
        try {
            const r = await checkinAttendee(token, eventId);
            setResult(r.data);
            // Stick the attendee on the persistent panel for success and
            // already-checked-in scans (both have the attendee payload).
            // Invalid scans don't have a real attendee, so leave the panel
            // showing whoever was last legitimately scanned.
            if ((r.data.status === 'success' || r.data.status === 'already') && r.data.attendee) {
                setLastCheckin({
                    ...r.data.attendee,
                    checked_in_at: r.data.checked_in_at,
                    status: r.data.status,
                });
            }
        } catch (err) {
            setResult({ status: 'invalid', reason: err?.response?.data?.reason || err.message || 'Scan failed' });
        } finally {
            // Re-arm after a brief pause so the same code in view doesn't
            // trigger again, and the operator has time to read the card.
            setTimeout(() => {
                processingRef.current = false;
                setResult(null);
            }, 2500);
        }
    };

    const onManualSubmit = (e) => {
        e.preventDefault();
        const t = manualToken.trim();
        if (!t) return;
        setManualToken('');
        onScan(t);
    };

    const RESULT_STYLES = {
        success: { color: '#10b981', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.45)', Icon: BsCheckCircleFill, title: 'Checked in' },
        already: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.45)', Icon: BsExclamationCircleFill, title: 'Already checked in' },
        invalid: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.45)', Icon: BsXCircleFill, title: 'Not valid' },
    };

    return (
        <div className="animate-in checkin-scanner-page" style={{ maxWidth: 1180, margin: '0 auto' }}>
            <Button variant="link" className="p-0 mb-2 text-decoration-none" onClick={() => navigate('/attendees')} style={{ color: 'var(--text-muted)' }}>
                <BsArrowLeft /> Back to attendees
            </Button>

            <div className="page-header">
                <h4 className="d-flex align-items-center gap-2" style={{ lineHeight: 1.2 }}>
                    {/* The h4 uses -webkit-text-fill-color:transparent for its
                        gradient effect; inline SVG inherits that and renders
                        invisible. Wrap the icon in a span that resets fill so
                        it shows again. */}
                    <span style={{ WebkitTextFillColor: 'var(--text-primary)', color: 'var(--text-primary)', display: 'inline-flex', alignItems: 'center', fontSize: '1em', lineHeight: 1 }}>
                        <BsCamera size="1em" />
                    </span>
                    <span>On-site check-in</span>
                </h4>
                <p className="text-white small" style={{ opacity: 0.7 }}>
                    {event?.title || 'Loading event…'}
                    <span style={{ color: 'var(--text-muted)' }}> · point the camera at a delegate's QR</span>
                </p>
            </div>

            {scannerError && (
                <Alert variant="danger" className="py-2 d-flex align-items-center gap-2" style={{ fontSize: '0.88rem', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#fca5a5' }}>
                    <BsCameraVideoOff /> {scannerError}
                </Alert>
            )}

            {/* Two-column main row — scanner viewport on the left, the last-
                checked-in card with print action on the right. Stacks on mobile
                via Bootstrap's md breakpoint. */}
            <Row className="g-3">
                <Col md={7}>
                    {/* Scanner viewport. Html5Qrcode injects its <video> into this div.
                        Wrapped so we can layer a result card on top without disturbing
                        the library's internal DOM. */}
                    <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', background: '#000', border: '1px solid var(--border-subtle)', aspectRatio: '1 / 1' }}>
                        <div id={containerId} style={{ width: '100%', height: '100%' }} />

                        {result && (() => {
                            const s = RESULT_STYLES[result.status] || RESULT_STYLES.invalid;
                            const { Icon } = s;
                            return (
                                <div style={{
                                    position: 'absolute', inset: 0,
                                    background: 'rgba(8, 11, 25, 0.86)',
                                    backdropFilter: 'blur(10px)',
                                    WebkitBackdropFilter: 'blur(10px)',
                                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                    padding: 20, textAlign: 'center',
                                    animation: 'fadeInUp 0.18s ease',
                                }}>
                                    <div style={{
                                        width: 84, height: 84, borderRadius: '50%',
                                        background: s.bg, border: `2px solid ${s.border}`,
                                        display: 'grid', placeItems: 'center',
                                        marginBottom: 16,
                                        boxShadow: `0 12px 36px -10px ${s.color}88`,
                                    }}>
                                        <Icon size={42} style={{ color: s.color }} />
                                    </div>
                                    <div style={{ color: '#fff', fontWeight: 800, fontSize: '1.4rem', letterSpacing: '-0.01em', marginBottom: 4 }}>
                                        {s.title}
                                    </div>
                                    {result.attendee?.name && (
                                        <div style={{ color: '#fff', fontSize: '1.05rem', fontWeight: 600 }}>
                                            {result.attendee.name}
                                        </div>
                                    )}
                                    {(result.attendee?.designation || result.attendee?.company) && (
                                        <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', marginTop: 2 }}>
                                            {[result.attendee.designation, result.attendee.company].filter(Boolean).join(' · ')}
                                        </div>
                                    )}
                                    {result.attendee?.ticket_type && (
                                        <div style={{
                                            marginTop: 12, display: 'inline-block',
                                            padding: '4px 12px', borderRadius: 999,
                                            background: s.bg, color: s.color,
                                            fontSize: '0.7rem', fontWeight: 700,
                                            textTransform: 'uppercase', letterSpacing: '0.1em',
                                        }}>
                                            {result.attendee.ticket_type}
                                        </div>
                                    )}
                                    {result.status === 'already' && result.checked_in_by_name && (
                                        <div style={{ marginTop: 14, color: 'rgba(255,255,255,0.6)', fontSize: '0.78rem' }}>
                                            by {result.checked_in_by_name}
                                        </div>
                                    )}
                                    {result.status === 'invalid' && result.reason && (
                                        <div style={{ marginTop: 14, color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', maxWidth: 340 }}>
                                            {result.reason}
                                        </div>
                                    )}
                                </div>
                            );
                        })()}
                    </div>
                </Col>

                <Col md={5}>
                    {/* Right column: header → print button → badge preview.
                        Print sits up top because that's the primary action;
                        the preview underneath confirms what will print. */}
                    {lastCheckin ? (
                        <div style={{
                            background: 'rgba(255,255,255,0.02)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 16,
                            padding: '18px 18px 20px',
                            height: '100%',
                            display: 'flex', flexDirection: 'column', gap: 14,
                        }}>
                            <div style={{
                                fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase',
                                color: '#10b981', fontWeight: 800,
                            }}>
                                Last checked in
                            </div>

                            <Button
                                className="d-flex align-items-center justify-content-center gap-2"
                                style={{
                                    background: 'linear-gradient(135deg, #10b981, #059669)',
                                    border: 'none', fontWeight: 700, color: '#fff',
                                    padding: '12px 18px', borderRadius: 12, fontSize: '0.95rem',
                                    boxShadow: '0 10px 22px -10px rgba(16,185,129,0.6)',
                                }}
                                onClick={() => window.print()}
                            >
                                <BsPrinter size={16} /> Print badge
                            </Button>

                            <div>
                                <div style={{
                                    fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
                                    color: 'var(--text-muted)', fontWeight: 700, marginBottom: 6,
                                }}>
                                    Badge size
                                </div>
                                <Form.Select
                                    size="sm"
                                    value={badgeSize.presetKey}
                                    onChange={(e) => onBadgePresetChange(e.target.value)}
                                >
                                    {BADGE_PRESETS.map(p => (
                                        <option key={p.key} value={p.key}>{p.label}</option>
                                    ))}
                                </Form.Select>
                                {badgeSize.presetKey === 'custom' && (
                                    <InputGroup size="sm" className="mt-2">
                                        <Form.Control
                                            type="number" min="20" max="500" step="1"
                                            value={badgeSize.w}
                                            onChange={(e) => setBadgeSize(s => ({ ...s, presetKey: 'custom', w: Math.max(20, Math.min(500, Number(e.target.value) || 0)) }))}
                                            aria-label="Width in mm"
                                        />
                                        <InputGroup.Text>×</InputGroup.Text>
                                        <Form.Control
                                            type="number" min="20" max="500" step="1"
                                            value={badgeSize.h}
                                            onChange={(e) => setBadgeSize(s => ({ ...s, presetKey: 'custom', h: Math.max(20, Math.min(500, Number(e.target.value) || 0)) }))}
                                            aria-label="Height in mm"
                                        />
                                        <InputGroup.Text>mm</InputGroup.Text>
                                    </InputGroup>
                                )}
                            </div>

                            <div style={{
                                fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
                                color: 'var(--text-muted)', fontWeight: 700, marginTop: 2,
                            }}>
                                Preview · {badgeSize.w} × {badgeSize.h} mm
                            </div>

                            {/* Badge preview directly under the Print button —
                                what you see here is what comes out of the printer. */}
                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                                <div className="checkin-badge-preview">
                                    <BadgeContent attendee={lastCheckin} eventFallback={event?.title} />
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div style={{
                            background: 'rgba(255,255,255,0.02)',
                            border: '1px dashed var(--border-subtle)',
                            borderRadius: 16,
                            padding: '22px 22px',
                            height: '100%', minHeight: 280,
                            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                            textAlign: 'center', color: 'var(--text-muted)',
                        }}>
                            <BsPersonBadge size={42} style={{ opacity: 0.4, marginBottom: 10 }} />
                            <div style={{ fontWeight: 700, color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: 4 }}>
                                Ready to scan
                            </div>
                            <div style={{ fontSize: '0.8rem', maxWidth: 240, lineHeight: 1.5 }}>
                                Once you scan a delegate's QR, their badge will appear here for printing.
                            </div>
                        </div>
                    )}
                </Col>
            </Row>

            {/* Manual fallback — for when the camera fails or staff want to
                type/paste the token. Keeps the same code path as a real scan
                so the result card logic doesn't need a second branch. */}
            <div className="mt-3">
                <Button
                    variant="link"
                    className="p-0 text-decoration-none d-flex align-items-center gap-2"
                    onClick={() => setManualOpen(v => !v)}
                    style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}
                >
                    <BsKeyboard /> {manualOpen ? 'Hide manual entry' : 'Enter token manually'}
                </Button>
                {manualOpen && (
                    <Form onSubmit={onManualSubmit} className="d-flex gap-2 mt-2">
                        <Form.Control
                            type="text"
                            className="form-control-dark"
                            placeholder="Paste check-in token"
                            value={manualToken}
                            onChange={e => setManualToken(e.target.value)}
                            autoFocus
                        />
                        <Button type="submit" className="btn-accent" disabled={!manualToken.trim()}>
                            Check in
                        </Button>
                    </Form>
                )}
            </div>

            {/* Print-only badge. Off-screen on the regular page; @media print
                rules below flip the visibility so the printer gets only this
                card, sized for A6 portrait (standard lanyard / ID badge). */}
            {lastCheckin && (
                <div className="checkin-badge-print" aria-hidden="true">
                    <BadgeContent attendee={lastCheckin} eventFallback={event?.title} />
                </div>
            )}

            <style>{`
                /* Make the library's <video> fill the reader frame edge-to-edge.
                   We deliberately don't hide other library-injected elements —
                   that risked hiding the video itself in some layouts. */
                #${containerId} { width: 100% !important; height: 100% !important; }
                #${containerId} video {
                    width: 100% !important;
                    height: 100% !important;
                    object-fit: cover !important;
                    display: block !important;
                }

                /* ── Badge card (shared structure) ──
                   Sized in mm so the off-screen print copy matches real-world
                   paper. Dimensions come from the user-selected badge size;
                   the on-screen preview scales the whole card down via CSS
                   transform. */
                .checkin-badge-card {
                    width: ${badgeSize.w}mm;
                    height: ${badgeSize.h}mm;
                    background: #ffffff;
                    color: #0f172a;
                    font-family: 'Inter', system-ui, sans-serif;
                    display: flex;
                    flex-direction: column;
                    box-sizing: border-box;
                    border-radius: 4mm;
                    overflow: hidden;
                    box-shadow: 0 8mm 24mm -8mm rgba(15,23,42,0.35);
                }
                .checkin-badge-header {
                    background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%);
                    color: #fff;
                    padding: 12mm 10mm 10mm;
                    position: relative;
                }
                .checkin-badge-eyebrow {
                    font-size: 8pt;
                    letter-spacing: 0.18em;
                    text-transform: uppercase;
                    font-weight: 700;
                    opacity: 0.9;
                    margin-bottom: 3mm;
                }
                .checkin-badge-event {
                    font-size: 16pt;
                    font-weight: 800;
                    letter-spacing: -0.01em;
                    line-height: 1.15;
                }
                .checkin-badge-ticket {
                    position: absolute;
                    top: 8mm;
                    right: 8mm;
                    background: rgba(255,255,255,0.25);
                    border: 1px solid rgba(255,255,255,0.5);
                    padding: 1.5mm 4mm;
                    border-radius: 999px;
                    font-size: 7pt;
                    font-weight: 700;
                    letter-spacing: 0.14em;
                    text-transform: uppercase;
                }
                .checkin-badge-body {
                    flex: 1;
                    padding: 14mm 10mm 14mm;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    text-align: center;
                    justify-content: center;
                }
                .checkin-badge-name {
                    font-size: 26pt;
                    font-weight: 800;
                    letter-spacing: -0.015em;
                    line-height: 1.1;
                    margin-bottom: 6mm;
                    word-break: break-word;
                    color: #0f172a;
                }
                .checkin-badge-designation {
                    font-size: 13pt;
                    font-weight: 600;
                    color: #334155;
                    line-height: 1.35;
                    margin-bottom: 3mm;
                }
                .checkin-badge-company {
                    font-size: 12pt;
                    color: #64748b;
                    line-height: 1.35;
                }

                /* ── On-screen preview ──
                   The badge card retains its mm dimensions internally; we
                   scale the whole thing down via CSS transform so it fits
                   inside the right column. The wrapper width/height match
                   the scaled output so it doesn't leave dead space. */
                .checkin-badge-preview {
                    width: calc(${badgeSize.w}mm * ${previewScale});
                    height: calc(${badgeSize.h}mm * ${previewScale});
                    overflow: visible;
                    position: relative;
                }
                .checkin-badge-preview .checkin-badge-card {
                    transform: scale(${previewScale});
                    transform-origin: top left;
                }

                /* ── Off-screen print copy ──
                   Pushed far off-canvas so it doesn't show on screen but is
                   still in the DOM for the print engine to render. */
                .checkin-badge-print {
                    position: absolute;
                    left: -10000px;
                    top: 0;
                }

                @media print {
                    /* Strip default browser margins on html/body — Chrome's
                       "Default" margin setting otherwise pads the whole page. */
                    html, body { margin: 0 !important; padding: 0 !important; }
                    /* Kill any transforms on ancestors — a non-none transform
                       establishes a containing block for absolute descendants,
                       which would anchor the print copy to the page wrapper
                       (below the topbar) instead of the page edge. */
                    body, body * { transform: none !important; animation: none !important; }
                    /* Hide everything by default… */
                    body * { visibility: hidden !important; }
                    /* …then re-show only the print-badge subtree. */
                    .checkin-badge-print,
                    .checkin-badge-print * { visibility: visible !important; }
                    /* position: fixed pins to the printed page, sidestepping
                       any ancestor containing-block surprises. */
                    .checkin-badge-print {
                        position: fixed !important;
                        left: 0 !important;
                        top: 0 !important;
                        width: 100% !important;
                        margin: 0 !important;
                        padding: 0 !important;
                    }
                    /* Print only the name / designation / company block —
                       hide the gradient header (event title + ticket type)
                       and let the body fill the page on its own. */
                    .checkin-badge-print .checkin-badge-header,
                    .checkin-badge-print .checkin-badge-header * { display: none !important; }
                    .checkin-badge-print .checkin-badge-card {
                        box-shadow: none !important;
                        border-radius: 0 !important;
                        margin: 0 !important;
                    }
                    /* Tighter padding for the print copy — the original 14mm
                       top/bottom was designed to clear the gradient header;
                       without the header, content can sit closer to the edge. */
                    .checkin-badge-print .checkin-badge-body {
                        flex: 1 1 auto !important;
                        justify-content: center !important;
                        padding: 4mm 8mm !important;
                    }
                    /* Page sized to the selected badge dimensions, zero margin. */
                    @page { size: ${badgeSize.w}mm ${badgeSize.h}mm; margin: 0; }
                    body { background: #ffffff !important; }
                }
            `}</style>
        </div>
    );
}

// Shared inner structure for the badge — used both as the on-screen preview
// (scaled down via CSS) and the off-screen print copy. Body intentionally
// kept minimal: name + designation + company. The header carries the event
// + ticket type so the body stays clean and large for visibility at a glance.
function BadgeContent({ attendee, eventFallback }) {
    return (
        <div className="checkin-badge-card">
            <div className="checkin-badge-header">
                <div className="checkin-badge-eyebrow">Event Pass</div>
                <div className="checkin-badge-event">{attendee.event_title || eventFallback || 'Event'}</div>
                {attendee.ticket_type && (
                    <div className="checkin-badge-ticket">{attendee.ticket_type}</div>
                )}
            </div>
            <div className="checkin-badge-body">
                <div className="checkin-badge-name">{attendee.name}</div>
                {attendee.designation && (
                    <div className="checkin-badge-designation">{attendee.designation}</div>
                )}
                {attendee.company && (
                    <div className="checkin-badge-company">{attendee.company}</div>
                )}
            </div>
        </div>
    );
}
