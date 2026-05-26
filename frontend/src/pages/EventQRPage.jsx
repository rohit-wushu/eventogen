import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Form, Button, Alert, Spinner } from 'react-bootstrap';
import { BsArrowLeft, BsQrCode, BsDownload, BsBoxArrowUpRight, BsLink45Deg, BsImage, BsPalette, BsSliders, BsCheck2, BsSave, BsCloudCheck } from 'react-icons/bs';
import QRCodeStyling from 'qr-code-styling';
import { getEvent, getEventQrConfig, saveEventQrConfig } from '../services/api';

const PRESETS = [
    { id: 'classic',  label: 'Classic',  fg: '#111111', bg: '#ffffff', dots: 'square',         corner: 'square',        cornerDot: 'square' },
    { id: 'rounded',  label: 'Rounded',  fg: '#111827', bg: '#ffffff', dots: 'rounded',        corner: 'extra-rounded', cornerDot: 'dot'    },
    { id: 'dots',     label: 'Dots',     fg: '#0f172a', bg: '#ffffff', dots: 'dots',           corner: 'dot',           cornerDot: 'dot'    },
    { id: 'violet',   label: 'Violet',   fg: '#8b5cf6', bg: '#ffffff', dots: 'classy-rounded', corner: 'extra-rounded', cornerDot: 'dot'    },
    { id: 'ocean',    label: 'Ocean',    fg: '#0ea5e9', bg: '#ffffff', dots: 'rounded',        corner: 'extra-rounded', cornerDot: 'dot'    },
    { id: 'emerald',  label: 'Emerald',  fg: '#10b981', bg: '#ffffff', dots: 'rounded',        corner: 'extra-rounded', cornerDot: 'dot'    },
    { id: 'sunset',   label: 'Sunset',   fg: '#ec4899', bg: '#ffffff', dots: 'classy',         corner: 'extra-rounded', cornerDot: 'square' },
    { id: 'midnight', label: 'Midnight', fg: '#ffffff', bg: '#0f172a', dots: 'rounded',        corner: 'extra-rounded', cornerDot: 'dot'    },
    { id: 'punk',     label: 'Punk',     fg: '#c4b5fd', bg: '#0a0a1a', dots: 'classy-rounded', corner: 'extra-rounded', cornerDot: 'dot'    }
];

const DOT_STYLES    = ['square', 'dots', 'rounded', 'classy', 'classy-rounded', 'extra-rounded'];
const CORNER_STYLES = ['square', 'extra-rounded', 'dot'];
const CORNER_DOT    = ['square', 'dot'];
const ERROR_LEVELS  = [
    { value: 'L', label: 'L · 7% recovery' },
    { value: 'M', label: 'M · 15% recovery' },
    { value: 'Q', label: 'Q · 25% (recommended with logo)' },
    { value: 'H', label: 'H · 30% recovery' }
];

const GRADIENT_PRESETS = [
    { id: 'violet-pink', from: '#8b5cf6', to: '#ec4899' },
    { id: 'ocean',       from: '#0ea5e9', to: '#8b5cf6' },
    { id: 'emerald',     from: '#10b981', to: '#0ea5e9' },
    { id: 'sunset',      from: '#f59e0b', to: '#ec4899' },
    { id: 'mono',        from: '#111827', to: '#6b7280' }
];

export default function EventQRPage() {
    const { id } = useParams();
    const navigate = useNavigate();

    const [event, setEvent]     = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');

    const [content,    setContent]    = useState('');
    const [size,       setSize]       = useState(1024);
    const [margin,     setMargin]     = useState(10);
    const [fg,         setFg]         = useState('#111827');
    const [bg,         setBg]         = useState('#ffffff');
    const [dots,       setDots]       = useState('rounded');
    const [corner,     setCorner]     = useState('extra-rounded');
    const [cornerDot,  setCornerDot]  = useState('dot');
    const [errorLevel, setErrorLevel] = useState('Q');
    const [useGradient, setUseGradient] = useState(false);
    const [gradientTo,  setGradientTo]  = useState('#ec4899');
    const [logoDataUrl, setLogoDataUrl] = useState(null);
    const [logoSize,    setLogoSize]    = useState(0.25);
    const [caption,     setCaption]     = useState('');
    const [presetId,    setPresetId]    = useState('rounded');
    const [copied,      setCopied]      = useState(false);

    // Persistence state. `savedAt` flashes a "Saved" confirmation after a
    // successful PUT so the user gets feedback without a toast library.
    const [saving,      setSaving]      = useState(false);
    const [savedAt,     setSavedAt]     = useState(null);
    const [saveError,   setSaveError]   = useState('');
    const [hasSaved,    setHasSaved]    = useState(false); // true once a config exists on the server

    const qrRef = useRef(null);
    const qrInstance = useRef(null);

    // Load event + any previously-saved QR design. If a saved config exists
    // we hydrate every field from it and skip the defaults — so opening the
    // page again after saving shows exactly what you exported last time.
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const [evRes, cfgRes] = await Promise.all([
                    getEvent(id),
                    getEventQrConfig(id).catch(() => ({ data: { qr_config: null } }))
                ]);
                if (!alive) return;
                const ev = evRes.data;
                setEvent(ev);

                const saved = cfgRes.data?.qr_config;
                if (saved && typeof saved === 'object') {
                    setHasSaved(true);
                    setContent(saved.content ?? `${window.location.origin}/events/${ev.id}`);
                    setCaption(saved.caption ?? ev.title ?? '');
                    if (saved.size       != null) setSize(saved.size);
                    if (saved.margin     != null) setMargin(saved.margin);
                    if (saved.fg)               setFg(saved.fg);
                    if (saved.bg)               setBg(saved.bg);
                    if (saved.dots)             setDots(saved.dots);
                    if (saved.corner)           setCorner(saved.corner);
                    if (saved.cornerDot)        setCornerDot(saved.cornerDot);
                    if (saved.errorLevel)       setErrorLevel(saved.errorLevel);
                    if (saved.useGradient != null) setUseGradient(saved.useGradient);
                    if (saved.gradientTo)       setGradientTo(saved.gradientTo);
                    if (saved.logoDataUrl)      setLogoDataUrl(saved.logoDataUrl);
                    if (saved.logoSize   != null) setLogoSize(saved.logoSize);
                    if (saved.presetId)         setPresetId(saved.presetId);
                } else {
                    setContent(`${window.location.origin}/events/${ev.id}`);
                    setCaption(ev.title || '');
                }
            } catch (err) {
                if (!alive) return;
                setLoadError(err.response?.data?.message || 'Unable to load event.');
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, [id]);

    // Build or update the QR whenever any setting changes. qr-code-styling is
    // imperative so we keep a single instance in a ref and call update().
    useEffect(() => {
        if (loading) return;
        const preview = 340;
        const options = {
            width:  preview,
            height: preview,
            type: 'svg',
            data: content || ' ',
            margin,
            qrOptions: { errorCorrectionLevel: errorLevel },
            dotsOptions: useGradient
                ? { type: dots, gradient: { type: 'linear', rotation: Math.PI / 4, colorStops: [{ offset: 0, color: fg }, { offset: 1, color: gradientTo }] } }
                : { type: dots, color: fg },
            backgroundOptions: { color: bg },
            cornersSquareOptions: { type: corner, color: useGradient ? gradientTo : fg },
            cornersDotOptions:    { type: cornerDot, color: fg },
            imageOptions: { crossOrigin: 'anonymous', margin: 4, imageSize: logoSize, hideBackgroundDots: true }
        };
        if (logoDataUrl) options.image = logoDataUrl;

        if (!qrInstance.current) {
            qrInstance.current = new QRCodeStyling(options);
            if (qrRef.current) {
                qrRef.current.innerHTML = '';
                qrInstance.current.append(qrRef.current);
            }
        } else {
            qrInstance.current.update(options);
        }
    }, [loading, content, margin, fg, bg, dots, corner, cornerDot, errorLevel, useGradient, gradientTo, logoDataUrl, logoSize]);

    const applyPreset = (p) => {
        setPresetId(p.id);
        setFg(p.fg); setBg(p.bg);
        setDots(p.dots); setCorner(p.corner); setCornerDot(p.cornerDot);
        setUseGradient(false);
    };

    const applyGradientPreset = (g) => {
        setFg(g.from); setGradientTo(g.to); setUseGradient(true);
    };

    const handleLogoFile = (file) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => setLogoDataUrl(reader.result);
        reader.readAsDataURL(file);
    };

    const download = (ext) => {
        if (!qrInstance.current) return;
        qrInstance.current.update({ width: size, height: size });
        qrInstance.current.download({
            name: `qr-${(event?.title || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
            extension: ext
        });
        setTimeout(() => qrInstance.current?.update({ width: 340, height: 340 }), 400);
    };

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(content);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        } catch { /* noop */ }
    };

    const handleSave = async () => {
        setSaving(true);
        setSaveError('');
        try {
            const payload = {
                content, caption,
                size, margin,
                fg, bg, dots, corner, cornerDot,
                errorLevel,
                useGradient, gradientTo,
                logoDataUrl, logoSize,
                presetId
            };
            await saveEventQrConfig(id, payload);
            setHasSaved(true);
            setSavedAt(Date.now());
            setTimeout(() => setSavedAt(null), 2400);
        } catch (err) {
            // Surface whatever the server actually said so the user can tell a
            // missing-column / missing-route problem apart from a permissions issue.
            const data   = err.response?.data;
            const status = err.response?.status;
            const reason = data?.error || data?.message;
            let msg;
            if (!err.response) {
                msg = 'Could not reach the server. Check that the backend is running.';
            } else if (status === 404) {
                msg = 'Save endpoint missing. Restart the backend after adding the new routes.';
            } else if (reason && /qr_config/i.test(reason)) {
                msg = `Database not ready: ${reason}. Run "node migrate_event_qr.js" in the backend folder.`;
            } else {
                msg = reason || `Save failed (HTTP ${status || 'unknown'}). Try again.`;
            }
            setSaveError(msg);
            // Also log the raw error for devtools debugging.
            console.error('Save QR failed:', err.response || err);
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '60vh' }}>
                <Spinner animation="border" variant="light" />
            </div>
        );
    }

    if (loadError) {
        return (
            <div style={{ padding: 24 }}>
                <Alert variant="danger">{loadError}</Alert>
                <Button variant="outline-light" onClick={() => navigate('/events')}>
                    <BsArrowLeft className="me-2" /> Back to events
                </Button>
            </div>
        );
    }

    return (
        <div className="event-qr-page">
            {/* ── Page header ─────────────────────────────────────────── */}
            <div className="qr-hero">
                <div className="qr-hero-main">
                    <button className="qr-back" onClick={() => navigate('/events')}>
                        <BsArrowLeft size={14} /> <span>Back to events</span>
                    </button>
                    <div className="qr-hero-row">
                        <div className="qr-hero-icon">
                            <BsQrCode size={28} color="white" />
                        </div>
                        <div className="qr-hero-text">
                            <div className="qr-hero-eyebrow">
                                Event QR code
                                {hasSaved && (
                                    <span className="qr-saved-chip" title="A design is saved to this event">
                                        <BsCloudCheck size={11} /> Saved
                                    </span>
                                )}
                            </div>
                            <h2 className="qr-hero-title">{event?.title || 'Untitled event'}</h2>
                            <div className="qr-hero-sub">
                                Design a scannable code that routes attendees to the event page or any URL you choose.
                            </div>
                        </div>
                    </div>
                </div>

                <div className="qr-hero-actions">
                    <Button
                        className="btn-accent"
                        onClick={handleSave}
                        disabled={saving}
                        title="Save this design to the event"
                    >
                        {saving
                            ? <><Spinner size="sm" animation="border" className="me-2" /> Saving…</>
                            : savedAt
                                ? <><BsCheck2 className="me-2" /> Saved</>
                                : <><BsSave className="me-2" /> Save</>}
                    </Button>
                    <Button variant="outline-light" onClick={() => download('png')}>
                        <BsDownload className="me-1" /> PNG
                    </Button>
                    <Button variant="outline-light" onClick={() => download('svg')}>
                        <BsDownload className="me-1" /> SVG
                    </Button>
                    <Button variant="outline-light" onClick={() => download('jpeg')}>
                        <BsDownload className="me-1" /> JPG
                    </Button>
                    <Button variant="outline-light" onClick={copyLink}>
                        {copied ? <><BsCheck2 className="me-1" /> Copied</> : <><BsLink45Deg className="me-1" /> Copy link</>}
                    </Button>
                    {content && (
                        <Button
                            variant="outline-light"
                            href={content}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <BsBoxArrowUpRight className="me-1" /> Test
                        </Button>
                    )}
                </div>
            </div>

            {saveError && (
                <Alert variant="danger" className="mb-3" onClose={() => setSaveError('')} dismissible>
                    {saveError}
                </Alert>
            )}

            {/* ── Two-column layout ───────────────────────────────────── */}
            <div className="qr-grid">
                {/* Preview column (sticky) */}
                <aside className="qr-preview-col">
                    <div className="qr-preview-card">
                        <div className="qr-preview-frame">
                            <div className="qr-preview-mount" style={{ background: bg }}>
                                <div className="qr-preview-canvas" ref={qrRef} />
                                {caption && (
                                    <div className="qr-caption" style={{ color: bg === '#ffffff' || bg === '#fff' ? '#111' : '#fff' }}>
                                        {caption}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="qr-preview-meta">
                            <div className="qr-meta-row">
                                <span className="qr-meta-key">Export</span>
                                <span className="qr-meta-val">{size} × {size} px</span>
                            </div>
                            <div className="qr-meta-row">
                                <span className="qr-meta-key">Format</span>
                                <span className="qr-meta-val">PNG · SVG · JPG</span>
                            </div>
                            <div className="qr-meta-row">
                                <span className="qr-meta-key">Recovery</span>
                                <span className="qr-meta-val">Level {errorLevel}</span>
                            </div>
                        </div>

                        <div className="qr-preview-hint">
                            Scan with any phone camera to preview. Download or copy the link from the header above.
                        </div>
                    </div>
                </aside>

                {/* Controls column */}
                <section className="qr-controls-col">
                    {/* Quick styles */}
                    <Panel icon={<BsPalette />} title="Quick styles" subtitle="Tap a preset to jump-start, then tweak below.">
                        <div className="qr-preset-grid">
                            {PRESETS.map(p => (
                                <button
                                    key={p.id}
                                    type="button"
                                    className={`qr-preset ${presetId === p.id ? 'is-active' : ''}`}
                                    onClick={() => applyPreset(p)}
                                >
                                    <div className="qr-preset-thumb" style={{ background: p.bg }}>
                                        <PresetGlyph fg={p.fg} dots={p.dots} />
                                    </div>
                                    <div className="qr-preset-label">{p.label}</div>
                                </button>
                            ))}
                        </div>
                    </Panel>

                    {/* Content */}
                    <Panel icon={<BsLink45Deg />} title="Content" subtitle="What phones will open when they scan this code.">
                        <Form.Control
                            value={content}
                            onChange={(e) => setContent(e.target.value)}
                            placeholder="https://… or any text"
                            className="qr-input"
                        />
                        <Form.Label className="qr-sublabel mt-3">Caption (printed under the QR)</Form.Label>
                        <Form.Control
                            value={caption}
                            onChange={(e) => setCaption(e.target.value)}
                            placeholder="Event name"
                            className="qr-input"
                        />
                    </Panel>

                    {/* Colors */}
                    <Panel icon={<BsPalette />} title="Colors">
                        <div className="qr-color-row">
                            <ColorField label="Foreground" value={fg} onChange={setFg} />
                            <ColorField label="Background" value={bg} onChange={setBg} />
                        </div>

                        <div className="qr-gradient-header">
                            <Form.Check
                                type="switch"
                                id="qr-gradient-switch"
                                label="Gradient foreground"
                                checked={useGradient}
                                onChange={(e) => setUseGradient(e.target.checked)}
                            />
                            <span className="qr-sublabel">Smooth two-colour blend across the dots.</span>
                        </div>

                        {useGradient && (
                            <>
                                <div className="qr-gradient-presets">
                                    {GRADIENT_PRESETS.map(g => (
                                        <button
                                            key={g.id}
                                            type="button"
                                            className="qr-gradient-swatch"
                                            onClick={() => applyGradientPreset(g)}
                                            style={{ background: `linear-gradient(135deg, ${g.from}, ${g.to})` }}
                                            title={g.id}
                                        />
                                    ))}
                                </div>
                                <div className="qr-color-row mt-2">
                                    <ColorField label="Gradient end" value={gradientTo} onChange={setGradientTo} />
                                </div>
                            </>
                        )}
                    </Panel>

                    {/* Shapes */}
                    <Panel icon={<BsSliders />} title="Shape styles">
                        <div className="qr-triple">
                            <SelectField label="Dots" value={dots} options={DOT_STYLES} onChange={setDots} />
                            <SelectField label="Corners" value={corner} options={CORNER_STYLES} onChange={setCorner} />
                            <SelectField label="Corner dots" value={cornerDot} options={CORNER_DOT} onChange={setCornerDot} />
                        </div>
                    </Panel>

                    {/* Logo */}
                    <Panel icon={<BsImage />} title="Center logo (optional)">
                        <div className="d-flex gap-2 align-items-center flex-wrap">
                            <Form.Control
                                type="file"
                                accept="image/*"
                                onChange={(e) => handleLogoFile(e.target.files?.[0])}
                                className="qr-input"
                                style={{ maxWidth: 320 }}
                            />
                            {logoDataUrl && (
                                <Button variant="outline-light" size="sm" onClick={() => setLogoDataUrl(null)}>
                                    Remove logo
                                </Button>
                            )}
                        </div>
                        {logoDataUrl && (
                            <div className="mt-3">
                                <div className="qr-sublabel">Logo size · {Math.round(logoSize * 100)}%</div>
                                <Form.Range
                                    min={0.1} max={0.4} step={0.02}
                                    value={logoSize}
                                    onChange={(e) => setLogoSize(parseFloat(e.target.value))}
                                />
                                <div className="qr-hint">
                                    Logos cover part of the code — keep error recovery at <strong>Q</strong> or <strong>H</strong> so phones still read it.
                                </div>
                            </div>
                        )}
                    </Panel>

                    {/* Technical */}
                    <Panel icon={<BsSliders />} title="Technical" subtitle="Output size, quiet-zone margin and error recovery.">
                        <div className="qr-double">
                            <div>
                                <div className="qr-sublabel">Export size · {size} px</div>
                                <Form.Range
                                    min={256} max={2048} step={64}
                                    value={size}
                                    onChange={(e) => setSize(parseInt(e.target.value, 10))}
                                />
                            </div>
                            <div>
                                <div className="qr-sublabel">Margin · {margin} px</div>
                                <Form.Range
                                    min={0} max={40}
                                    value={margin}
                                    onChange={(e) => setMargin(parseInt(e.target.value, 10))}
                                />
                            </div>
                        </div>
                        <div className="mt-3">
                            <SelectField
                                label="Error recovery"
                                value={errorLevel}
                                options={ERROR_LEVELS.map(l => l.value)}
                                labelOptions={ERROR_LEVELS.reduce((acc, l) => ({ ...acc, [l.value]: l.label }), {})}
                                onChange={setErrorLevel}
                            />
                        </div>
                    </Panel>
                </section>
            </div>
        </div>
    );
}

// ── Small view helpers ──────────────────────────────────────────────
function Panel({ icon, title, subtitle, children }) {
    return (
        <div className="qr-panel">
            <div className="qr-panel-header">
                <div className="qr-panel-icon">{icon}</div>
                <div>
                    <div className="qr-panel-title">{title}</div>
                    {subtitle && <div className="qr-panel-sub">{subtitle}</div>}
                </div>
            </div>
            <div className="qr-panel-body">{children}</div>
        </div>
    );
}

function ColorField({ label, value, onChange }) {
    return (
        <div className="qr-color-field">
            <Form.Label className="qr-sublabel">{label}</Form.Label>
            <div className="qr-color-input">
                <Form.Control
                    type="color"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                />
                <Form.Control
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="qr-input qr-mono"
                />
            </div>
        </div>
    );
}

function SelectField({ label, value, options, labelOptions, onChange }) {
    return (
        <Form.Group>
            <Form.Label className="qr-sublabel">{label}</Form.Label>
            <Form.Select value={value} onChange={(e) => onChange(e.target.value)} className="qr-input">
                {options.map(o => (
                    <option key={o} value={o}>{labelOptions?.[o] || o}</option>
                ))}
            </Form.Select>
        </Form.Group>
    );
}

// Tiny decorative glyph used inside preset thumbnails. Not a real QR —
// just a visual hint at the dot / corner style of the preset so the user
// sees the vibe before they click.
function PresetGlyph({ fg, dots }) {
    const rounded = dots === 'rounded' || dots === 'classy-rounded' || dots === 'extra-rounded' || dots === 'classy';
    const isDots  = dots === 'dots' || dots === 'dot';
    const r = isDots ? 5 : rounded ? 2 : 0;
    const cells = [
        [0,0],[1,0],[2,0],[4,0],[5,0],
        [0,1],[2,1],[4,1],
        [0,2],[1,2],[2,2],[3,2],[5,2],
        [1,3],[3,3],[4,3],[5,3],
        [0,4],[2,4],[3,4],[5,4]
    ];
    return (
        <svg viewBox="0 0 6 5" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
            {cells.map(([x, y]) => (
                <rect key={`${x}-${y}`} x={x + 0.1} y={y + 0.1} width={0.8} height={0.8} rx={r / 10} fill={fg} />
            ))}
        </svg>
    );
}
