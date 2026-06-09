import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Form, Spinner, Alert, Badge } from 'react-bootstrap';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import {
    BsArrowLeft, BsCloudUpload, BsTextareaT, BsTrash, BsPlus, BsDownload,
    BsAward, BsImage, BsBraces,
    BsAlignStart, BsAlignCenter, BsAlignEnd, BsEnvelopePaperFill,
} from 'react-icons/bs';
import {
    getEvents, getAttendees,
    getCertificateTemplates, getCertificateTemplate,
    createCertificateTemplate, updateCertificateTemplate,
    deleteCertificateTemplate, uploadCertificateBackground,
} from '../services/api';
import { getImageUrl } from '../utils/imageUrl';

// ─────────────────────────────────────────────────────────────────
// Bulk Certificate Generator (admin / manager only).
//
// Three-step flow on a single page:
//   1. Pick event + recipient filter (status: any / confirmed / attended)
//   2. Design canvas — upload background, drag-position text elements
//      bound to attendee fields, configure font / size / color
//   3. Generate — render each attendee's certificate via html-to-image,
//      pack into a single PDF (one page per attendee) and ZIP
//
// Pattern mirrors the SNS Generator: a draggable card with text elements
// the admin positions visually, then we render to canvas with html-to-image
// and bake into a PDF.
// ─────────────────────────────────────────────────────────────────

const FIELD_KEYS = [
    { key: 'name',         label: 'Attendee name',  sample: 'Rahul Sharma' },
    { key: 'designation',  label: 'Designation',    sample: 'Founder' },
    { key: 'company',      label: 'Company',        sample: 'Acme Inc.' },
    { key: 'event_title',  label: 'Event title',    sample: 'NBFC 19' },
    { key: 'event_date',   label: 'Event date',     sample: '20 Oct 2026' },
    { key: 'custom',       label: 'Custom text',    sample: 'Custom text' },
];

// Grouped font catalogue. Each group is an optgroup in the dropdown so
// admins can find what they want quickly. System fonts (no `web: true`)
// load instantly; the rest are pulled from Google Fonts via the <link>
// injected by ensureWebFontsLoaded() below.
const FONT_GROUPS = [
    { label: 'Modern Serif', fonts: [
        { name: 'Playfair Display', web: true, weights: 'wght@400;500;600;700;800' },
        { name: 'Cormorant Garamond', web: true, weights: 'wght@400;500;600;700' },
        { name: 'Lora', web: true, weights: 'wght@400;500;600;700' },
        { name: 'Merriweather', web: true, weights: 'wght@400;700;900' },
        { name: 'Crimson Text', web: true, weights: 'wght@400;600;700' },
        { name: 'EB Garamond', web: true, weights: 'wght@400;500;700' },
        { name: 'PT Serif', web: true, weights: 'wght@400;700' },
    ] },
    { label: 'Classic Serif', fonts: [
        { name: 'Georgia' },
        { name: 'Times New Roman' },
        { name: 'Garamond' },
    ] },
    { label: 'Sans Serif', fonts: [
        { name: 'Inter', web: true, weights: 'wght@400;500;600;700;800' },
        { name: 'Roboto', web: true, weights: 'wght@400;500;700;900' },
        { name: 'Open Sans', web: true, weights: 'wght@400;600;700;800' },
        { name: 'Lato', web: true, weights: 'wght@400;700;900' },
        { name: 'Montserrat', web: true, weights: 'wght@400;500;600;700;800;900' },
        { name: 'Poppins', web: true, weights: 'wght@400;500;600;700;800' },
        { name: 'Raleway', web: true, weights: 'wght@400;500;600;700;800' },
        { name: 'Nunito', web: true, weights: 'wght@400;600;700;800' },
        { name: 'Source Sans 3', web: true, weights: 'wght@400;600;700;900' },
        { name: 'Helvetica' },
        { name: 'Arial' },
    ] },
    { label: 'Display', fonts: [
        { name: 'Oswald', web: true, weights: 'wght@400;500;600;700' },
        { name: 'Bebas Neue', web: true },
        { name: 'Abril Fatface', web: true },
        { name: 'Anton', web: true },
        { name: 'Cinzel', web: true, weights: 'wght@400;600;700;800' },
    ] },
    { label: 'Handwriting', fonts: [
        { name: 'Great Vibes', web: true },
        { name: 'Pacifico', web: true },
        { name: 'Dancing Script', web: true, weights: 'wght@400;500;600;700' },
        { name: 'Sacramento', web: true },
        { name: 'Allura', web: true },
        { name: 'Tangerine', web: true, weights: 'wght@400;700' },
        { name: 'Pinyon Script', web: true },
        { name: 'Brush Script MT' },
    ] },
    { label: 'Monospace', fonts: [
        { name: 'Courier New' },
        { name: 'Roboto Mono', web: true, weights: 'wght@400;500;700' },
    ] },
];
const ALL_FONT_NAMES = FONT_GROUPS.flatMap(g => g.fonts.map(f => f.name));

// Inject a Google Fonts <link> exactly once. Subsequent calls are no-ops.
// Bundles all web fonts into a single request via the families API.
const FONT_LINK_ID = 'bcp-google-fonts';
function ensureWebFontsLoaded() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(FONT_LINK_ID)) return;
    const families = FONT_GROUPS
        .flatMap(g => g.fonts)
        .filter(f => f.web)
        .map(f => `family=${encodeURIComponent(f.name)}${f.weights ? ':' + f.weights : ''}`)
        .join('&');
    const link = document.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
    document.head.appendChild(link);
}

// Default canvas — 1200×850 ≈ A4 landscape ratio. Stored on the template
// row so we can scale the editor preview at any size while the export
// always renders at full resolution.
const DEFAULT_CANVAS = { width: 1200, height: 850 };

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

// Build the actual text rendered for an attendee. The editor uses sample
// values; the bulk generator swaps in the real ones from each row.
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

// Lightweight pointer-event drag helper. Built in-house instead of using
// react-draggable because that library still calls ReactDOM.findDOMNode
// inside componentWillUnmount, which throws under React 19 and takes the
// page blank when the user navigates away from a draggable-containing
// route. The helper:
//   • takes `position` in CANVAS-pixel space and `scale` (the editor zoom)
//   • renders a translated <div>; movement is applied directly to the DOM
//     during drag for smoothness, then committed via onStop on pointerup
//   • divides screen-pixel deltas by `scale` so positions remain in
//     canvas units regardless of zoom level
// onStart and onClick both receive the original pointer/mouse event so
// callers can detect modifiers (shift for additive selection, etc.).
function DragBox({ position, scale = 1, onStart, onStop, children, style, onClick }) {
    const ref = useRef(null);
    const dragState = useRef(null);

    const handlePointerDown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* ignore */ }
        dragState.current = {
            sx: e.clientX, sy: e.clientY,
            posX: position.x, posY: position.y,
            curX: position.x, curY: position.y,
            moved: false,
        };
        onStart?.(e);
        const move = (ev) => {
            if (!dragState.current) return;
            const dx = (ev.clientX - dragState.current.sx) / scale;
            const dy = (ev.clientY - dragState.current.sy) / scale;
            if (Math.abs(dx) > 1 || Math.abs(dy) > 1) dragState.current.moved = true;
            const nx = dragState.current.posX + dx;
            const ny = dragState.current.posY + dy;
            dragState.current.curX = nx;
            dragState.current.curY = ny;
            if (ref.current) ref.current.style.transform = `translate(${nx}px, ${ny}px)`;
        };
        const up = () => {
            if (!dragState.current) return;
            const { curX, curY, moved } = dragState.current;
            dragState.current = null;
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', up);
            if (moved) onStop?.({ x: Math.round(curX), y: Math.round(curY) });
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up);
    };

    return (
        <div
            ref={ref}
            onPointerDown={handlePointerDown}
            onClick={onClick}
            style={{
                ...style,
                transform: `translate(${position.x}px, ${position.y}px)`,
                touchAction: 'none',
            }}
        >
            {children}
        </div>
    );
}

// One canvas text element. Lives in its own component so we can use a ref +
// useLayoutEffect per-element to measure the actual rendered text width and
// auto-recenter the element horizontally whenever the substituted value
// changes (different recipient => different text width). Without this, a
// design that looks centered for "Jagruthi N" goes off-canvas for
// "Government R C College Of Commerce And Management".
//
// Re-centering rules:
//   • Only fires when el.align === 'center' (the default for new elements).
//   • Triggered by changes to the rendered value or canvas width, NOT by
//     changes to el.x — that way the user can drag a center-aligned element
//     off-center and the position sticks until a new recipient renders.
//   • Operator can opt out per-element by setting align to 'left' or 'right',
//     or by toggling the new `lockX` flag in the properties panel.
function CanvasElement({
    el, value, isPrimary, isSelected, generating, scale, onSelect, onDragStop, onAutoCenterX,
}) {
    const textRef = useRef(null);
    const lastValueRef = useRef(value);
    const lastWidthRef = useRef(0);

    useLayoutEffect(() => {
        if (!textRef.current) return;
        if (el.align !== 'center' || el.lockX) return;
        const w = textRef.current.offsetWidth;
        // Only re-center when the rendered value or canvas width actually
        // changed — guards against an infinite measure→setState→remeasure loop.
        if (value === lastValueRef.current && w === lastWidthRef.current) return;
        lastValueRef.current = value;
        lastWidthRef.current = w;
        const targetX = Math.round(0 - 0);  // no-op placeholder so eslint is happy
        // The parent computes the desired x based on its canvas width; we
        // just hand it the measured text width and let it decide.
        onAutoCenterX?.(el.id, w);
    }, [value, el.align, el.lockX, el.fontSize, el.fontFamily, el.fontWeight, el.letterSpacing]); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <DragBox
            position={{ x: el.x, y: el.y }}
            scale={scale}
            onStart={(e) => onSelect(el.id, e?.shiftKey)}
            onStop={(p) => onDragStop(el.id, p)}
            onClick={(e) => onSelect(el.id, e?.shiftKey)}
            style={{
                // Outer DragBox auto-sizes to its content (the inline-block
                // text span) so the drag hit-area and the visible outline
                // both match the actual text width — no more dashed boxes
                // extending past a long college name.
                position: 'absolute', top: 0, left: 0,
                cursor: 'move',
                fontFamily: `"${el.fontFamily}", system-ui, sans-serif`,
                fontSize: el.fontSize,
                fontWeight: el.fontWeight,
                fontStyle: el.italic ? 'italic' : 'normal',
                textDecoration: el.underline ? 'underline' : 'none',
                letterSpacing: el.letterSpacing ? `${el.letterSpacing}px` : 'normal',
                color: el.color,
                userSelect: 'none',
                whiteSpace: el.nowrap ? 'nowrap' : 'pre-wrap',
                lineHeight: 1.2,
                // No fixed width: the box hugs the text. textAlign is moot
                // here because the box equals the text. Centering happens via
                // the auto-recenter effect above, not via flex/textAlign.
                maxWidth: 'none',
            }}
        >
            <span
                ref={textRef}
                style={{
                    display: 'inline-block',
                    outline: !generating && isSelected
                        ? (isPrimary ? '2px dashed var(--accent)' : '2px dashed rgba(139,92,246,0.55)')
                        : 'none',
                    outlineOffset: 4,
                }}
            >
                {value}
            </span>
        </DragBox>
    );
}

export default function BulkCertificatePage() {
    const navigate = useNavigate();

    // ── Step 1: source ────────────────────────────────────────────
    const [events, setEvents] = useState([]);
    const [eventId, setEventId] = useState('');
    const [statusFilter, setStatusFilter] = useState('all'); // all | confirmed | attended | invited
    const [attendees, setAttendees] = useState([]);
    const [loadingAttendees, setLoadingAttendees] = useState(false);

    // ── Step 2: design ────────────────────────────────────────────
    const [templates, setTemplates] = useState([]);
    const [templateId, setTemplateId] = useState(null);          // null = new draft
    const [templateName, setTemplateName] = useState('Untitled certificate');
    const [bgUrl, setBgUrl] = useState('');
    const [canvas, setCanvas] = useState(DEFAULT_CANVAS);
    const [elements, setElements] = useState([]);                // text boxes
    const [selectedId, setSelectedId] = useState(null);
    // Multi-selection set. `selectedId` is always the "primary" (last-clicked)
    // element and drives the single-element properties panel. `selectedIds`
    // is the broader set for group operations like "Center all on canvas".
    // Shift-click toggles membership; a plain click resets the set to one.
    const [selectedIds, setSelectedIds] = useState(() => new Set());

    // Click handler shared by DragBox and the layers list. With shift held,
    // toggles the element's membership and keeps the previously-clicked id as
    // primary if it stays in the set; without shift, selects only this one.
    const selectElement = (id, additive = false) => {
        setSelectedIds(prev => {
            if (!additive) return new Set([id]);
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
                if (id === selectedId) {
                    // Primary removed → fall back to any remaining id, or null.
                    const fallback = next.values().next().value || null;
                    setSelectedId(fallback);
                }
            } else {
                next.add(id);
                setSelectedId(id);
            }
            return next;
        });
        if (!additive) setSelectedId(id);
    };

    const clearSelection = () => {
        setSelectedId(null);
        setSelectedIds(new Set());
    };

    const selectAllElements = () => {
        if (elements.length === 0) return;
        setSelectedIds(new Set(elements.map(e => e.id)));
        setSelectedId(elements[elements.length - 1].id);
    };
    const [bgUploading, setBgUploading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editorScale, setEditorScale] = useState(0.6);          // visual zoom of canvas

    // Preview index — which attendee shows live in the editor.
    const [previewIndex, setPreviewIndex] = useState(0);

    // ── Step 3: generate ──────────────────────────────────────────
    const [generating, setGenerating] = useState(false);
    const [generateProgress, setGenerateProgress] = useState({ done: 0, total: 0 });
    // Pause / Cancel for the per-attendee loop. Stored in refs so the async
    // loop can read the current value without re-renders or stale closures.
    // `paused` state mirrors pausedRef for the UI; cancelledRef is one-shot.
    const [paused, setPaused] = useState(false);
    const pausedRef = useRef(false);
    const cancelledRef = useRef(false);
    useEffect(() => { pausedRef.current = paused; }, [paused]);

    const [error, setError] = useState('');
    const [info, setInfo] = useState('');

    const stageRef = useRef(null);
    const viewportRef = useRef(null);

    // Auto-fit zoom — recompute the editor scale so the canvas comfortably
    // fits inside the viewport's available width. Triggered when the canvas
    // dimensions change (new background uploaded / template loaded) and on
    // window resize. Caps at 1.0 so we never blow up small images.
    const fitToViewport = () => {
        if (!viewportRef.current) return;
        const PADDING = 44; // matches the viewport's inner padding (22 each side)
        const available = viewportRef.current.clientWidth - PADDING;
        if (available <= 0 || canvas.width <= 0) return;
        const next = Math.min(1, available / canvas.width);
        // Round to 5% so the slider lands on a tidy number.
        setEditorScale(Math.max(0.1, Math.round(next * 20) / 20));
    };

    useEffect(() => {
        // Defer one frame so the viewport's width is laid out before measuring.
        const t = requestAnimationFrame(fitToViewport);
        return () => cancelAnimationFrame(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canvas.width, canvas.height]);

    useEffect(() => {
        const onResize = () => fitToViewport();
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canvas.width]);

    // Load events on mount, attendees when event changes. Also kick off
    // the Google Fonts <link> so dropdown previews + final renders can use
    // the full catalogue.
    useEffect(() => {
        ensureWebFontsLoaded();
        getEvents().then(r => setEvents(r.data || [])).catch(() => setEvents([]));
    }, []);

    useEffect(() => {
        if (!eventId) { setAttendees([]); return; }
        setLoadingAttendees(true);
        getAttendees(eventId)
            .then(r => setAttendees(Array.isArray(r.data) ? r.data : []))
            .catch(() => setAttendees([]))
            .finally(() => setLoadingAttendees(false));
        getCertificateTemplates(eventId)
            .then(r => setTemplates(Array.isArray(r.data) ? r.data : []))
            .catch(() => setTemplates([]));
    }, [eventId]);

    const event = events.find(e => String(e.id) === String(eventId));

    // Apply status filter on the loaded attendees list.
    const filteredAttendees = useMemo(() => {
        if (!attendees) return [];
        if (statusFilter === 'all') return attendees;
        return attendees.filter(a => (a.status || '').toLowerCase() === statusFilter);
    }, [attendees, statusFilter]);

    // The recipient currently shown in the editor preview.
    const previewAttendee = filteredAttendees[Math.min(previewIndex, Math.max(filteredAttendees.length - 1, 0))]
        || { name: 'Sample Attendee', designation: 'Founder', company: 'Acme Inc.' };

    const selected = elements.find(el => el.id === selectedId) || null;

    // ── Element ops ──────────────────────────────────────────────
    const addElement = (key) => {
        const fieldDef = FIELD_KEYS.find(f => f.key === key);
        const id = `el_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        const isHeading = key === 'name' || key === 'event_title';
        // Heading elements get a wider box and default to single-line
        // (nowrap=true) so long names don't accidentally wrap. Users can
        // toggle wrap back on from the Properties panel if they want.
        const width = isHeading ? Math.min(900, canvas.width - 80) : 400;
        const newEl = {
            id,
            key,
            x: Math.round((canvas.width - width) / 2),
            y: canvas.height * 0.45,
            width,
            fontFamily: 'Playfair Display',
            fontSize: isHeading ? 56 : 24,
            fontWeight: isHeading ? 700 : 400,
            italic: false,
            underline: false,
            letterSpacing: 0,
            nowrap: isHeading,
            color: '#1f2937',
            align: 'center',
            content: key === 'custom' ? (fieldDef?.sample || 'Custom text') : '',
        };
        setElements(prev => [...prev, newEl]);
        setSelectedId(id);
        setSelectedIds(new Set([id]));
    };

    const updateElement = (id, patch) => {
        setElements(prev => prev.map(el => el.id === id ? { ...el, ...patch } : el));
    };

    // Patch every selected element with the same partial. Used by group
    // actions (Center on canvas, Align Left/Right, set color/size, etc.).
    const updateSelectedElements = (patchFn) => {
        setElements(prev => prev.map(el => selectedIds.has(el.id) ? { ...el, ...patchFn(el) } : el));
    };

    // Per-element new x so its box is horizontally centered on the canvas.
    const centerXFor = (el) => Math.round((canvas.width - el.width) / 2);

    // Group ops surfaced by the multi-select panel. All operate on every id
    // in selectedIds at once.
    const groupCenterOnCanvas = () => updateSelectedElements(el => ({ x: centerXFor(el) }));
    const groupAlignLeft = () => {
        const minX = Math.min(...elements.filter(e => selectedIds.has(e.id)).map(e => e.x));
        updateSelectedElements(() => ({ x: minX }));
    };
    const groupAlignRight = () => {
        const maxRight = Math.max(...elements.filter(e => selectedIds.has(e.id)).map(e => e.x + e.width));
        updateSelectedElements(el => ({ x: maxRight - el.width }));
    };
    const groupSetTextAlignCenter = () => updateSelectedElements(() => ({ align: 'center' }));

    const removeElement = (id) => {
        setElements(prev => prev.filter(el => el.id !== id));
        if (selectedId === id) clearSelection();
        setSelectedIds(prev => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev); next.delete(id); return next;
        });
    };

    // DragBox already returns canvas-space coordinates (it divides screen
    // deltas by editorScale internally) so we just persist them as-is.
    const handleDragStop = (id, { x, y }) => {
        updateElement(id, { x, y });
    };

    // ── Background upload ────────────────────────────────────────
    const handleBgUpload = async (file) => {
        if (!file) return;
        if (!file.type?.startsWith('image/')) { setError('Please choose an image file.'); return; }
        if (file.size > 20 * 1024 * 1024) { setError('Background must be under 20 MB.'); return; }
        setError('');
        setBgUploading(true);
        try {
            const { data } = await uploadCertificateBackground(file);
            if (data?.url) {
                setBgUrl(data.url);
                // Try to read the image's natural size so the canvas matches it.
                const img = new Image();
                img.onload = () => setCanvas({ width: img.naturalWidth, height: img.naturalHeight });
                img.src = getImageUrl(data.url);
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Upload failed');
        } finally {
            setBgUploading(false);
        }
    };

    // ── Template save / load / delete ────────────────────────────
    const saveTemplate = async () => {
        if (!eventId) { setError('Pick an event first.'); return; }
        if (!templateName.trim()) { setError('Give the template a name.'); return; }
        setError(''); setInfo('');
        setSaving(true);
        try {
            const payload = {
                event_id: eventId,
                name: templateName.trim(),
                bg_image_url: bgUrl || null,
                canvas_width: canvas.width,
                canvas_height: canvas.height,
                elements,
            };
            if (templateId) {
                await updateCertificateTemplate(templateId, payload);
                setInfo('Template updated');
            } else {
                const { data } = await createCertificateTemplate(payload);
                setTemplateId(data.id);
                setInfo('Template saved');
            }
            const r = await getCertificateTemplates(eventId);
            setTemplates(r.data || []);
        } catch (err) {
            setError(err.response?.data?.error || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const loadTemplate = async (id) => {
        setError(''); setInfo('');
        try {
            const { data } = await getCertificateTemplate(id);
            setTemplateId(data.id);
            setTemplateName(data.name || 'Untitled certificate');
            setBgUrl(data.bg_image_url || '');
            setCanvas({
                width: data.canvas_width || DEFAULT_CANVAS.width,
                height: data.canvas_height || DEFAULT_CANVAS.height,
            });
            setElements(Array.isArray(data.elements) ? data.elements : []);
            clearSelection();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load template');
        }
    };

    const newTemplate = () => {
        setTemplateId(null);
        setTemplateName('Untitled certificate');
        setBgUrl('');
        setCanvas(DEFAULT_CANVAS);
        setElements([]);
        clearSelection();
    };

    const removeTemplate = async (id) => {
        if (!window.confirm('Delete this template?')) return;
        try {
            await deleteCertificateTemplate(id);
            setTemplates(prev => prev.filter(t => t.id !== id));
            if (templateId === id) newTemplate();
        } catch (err) {
            setError(err.response?.data?.error || 'Delete failed');
        }
    };

    // ── Generate ────────────────────────────────────────────────
    // Renders one certificate per filtered attendee, packs all pages into
    // a single PDF (one page each), AND a ZIP of individual PNGs as a
    // bonus — admins like to mail PNGs sometimes. Order matches the
    // filtered list so it's predictable.
    // Polled by the generation loop. While `pausedRef.current` is true the
    // loop sleeps in 200ms ticks; `cancelledRef.current` aborts the loop
    // entirely (current-iteration result is discarded).
    const waitWhilePaused = async () => {
        while (pausedRef.current && !cancelledRef.current) {
            await new Promise(r => setTimeout(r, 200));
        }
    };

    const handleGenerate = async () => {
        if (!filteredAttendees.length) { setError('No attendees match the current filter.'); return; }
        if (!stageRef.current) { setError('Editor not ready.'); return; }
        setError(''); setInfo('');
        // Clear the active selection so the editor's purple "selected"
        // outline doesn't bake into the exported PNGs.
        clearSelection();
        // Reset pause/cancel flags for this run.
        cancelledRef.current = false;
        setPaused(false);
        setGenerating(true);
        setGenerateProgress({ done: 0, total: filteredAttendees.length });

        // Wait one frame so the DOM is up-to-date with whatever the user
        // last typed before they clicked Generate. Then wait for any pending
        // Google Fonts to finish loading so the rendered PNGs use the right
        // typefaces instead of falling back to sans-serif.
        await new Promise(r => requestAnimationFrame(r));
        try { if (document.fonts?.ready) await document.fonts.ready; } catch { /* ignore */ }

        // Build the PDF in landscape if the canvas is wider than tall,
        // portrait otherwise. We'll use canvas pixel dimensions directly
        // so layout matches what the editor shows 1:1.
        const isLandscape = canvas.width >= canvas.height;
        const pdf = new jsPDF({
            orientation: isLandscape ? 'landscape' : 'portrait',
            unit: 'px',
            format: [canvas.width, canvas.height],
            hotfixes: ['px_scaling'],
        });
        const zip = new JSZip();
        const folder = zip.folder('certificates');

        let processed = 0;
        try {
            for (let i = 0; i < filteredAttendees.length; i++) {
                // Honour Pause before doing any work for this attendee, then
                // re-check Cancel right after waking up so a "Pause then Cancel"
                // sequence aborts cleanly.
                await waitWhilePaused();
                if (cancelledRef.current) break;

                const a = filteredAttendees[i];
                setPreviewIndex(i);
                // Let React commit + the browser paint before we snapshot.
                await new Promise(r => requestAnimationFrame(r));
                await new Promise(r => setTimeout(r, 30));

                const dataUrl = await toPng(stageRef.current, {
                    pixelRatio: 1,
                    width: canvas.width,
                    height: canvas.height,
                    style: { transform: 'none', transformOrigin: 'top left' },
                    cacheBust: true,
                });

                if (processed > 0) pdf.addPage([canvas.width, canvas.height], isLandscape ? 'landscape' : 'portrait');
                pdf.addImage(dataUrl, 'PNG', 0, 0, canvas.width, canvas.height);

                const safeName = (a.name || `attendee-${a.id}`).replace(/[^\w-]+/g, '_').slice(0, 60);
                const png64 = dataUrl.split(',')[1];
                folder.file(`${String(i + 1).padStart(3, '0')}_${safeName}.png`, png64, { base64: true });

                processed += 1;
                setGenerateProgress({ done: processed, total: filteredAttendees.length });
            }

            if (cancelledRef.current && processed === 0) {
                // Nothing rendered before cancel — skip the empty ZIP/PDF.
                setInfo('Generation cancelled before any certificate was produced.');
                return;
            }

            // Add the combined PDF inside the ZIP as well.
            const pdfBlob = pdf.output('blob');
            zip.file('all_certificates.pdf', pdfBlob);
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const evtSlug = (event?.title || 'event').replace(/[^\w-]+/g, '_');
            const link = document.createElement('a');
            link.href = URL.createObjectURL(zipBlob);
            link.download = `certificates_${evtSlug}_${Date.now()}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);

            if (cancelledRef.current) {
                setInfo(`Cancelled — packaged ${processed} of ${filteredAttendees.length} certificates already rendered.`);
            } else {
                setInfo(`Generated ${filteredAttendees.length} certificate(s).`);
            }
        } catch (err) {
            console.error(err);
            setError('Generation failed: ' + (err.message || 'unknown error'));
        } finally {
            setGenerating(false);
            setPaused(false);
            pausedRef.current = false;
            cancelledRef.current = false;
            setGenerateProgress({ done: 0, total: 0 });
        }
    };

    // ── Render helpers ──────────────────────────────────────────
    const stageInnerStyle = {
        position: 'relative',
        width: canvas.width, height: canvas.height,
        background: bgUrl ? `url("${getImageUrl(bgUrl)}") center/cover no-repeat` : '#fff',
        flexShrink: 0,
        boxShadow: '0 12px 48px rgba(0,0,0,0.18)',
    };

    // Shared style tokens — kept inline so the page is self-contained.
    const cardStyle = {
        padding: 18,
        borderRadius: 16,
        background: 'var(--bg-card)',
        border: '1px solid var(--border-subtle)',
        boxShadow: '0 6px 20px -10px rgba(0,0,0,0.25)',
    };
    const stepBadge = {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 24, height: 24, borderRadius: '50%',
        background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
        color: '#fff', fontSize: 11, fontWeight: 800,
    };
    const stepTitle = {
        fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)',
        letterSpacing: '-0.005em',
    };
    const fieldLabel = {
        fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6,
    };

    return (
        <div style={{ padding: '24px 28px', color: 'var(--text-primary)' }}>
            {/* ── Premium hero header ───────────────────────────── */}
            <div
                className="bcp-hero d-flex align-items-center justify-content-between flex-wrap gap-3 mb-4"
                style={{
                    padding: '22px 26px',
                    borderRadius: 18,
                    background: 'linear-gradient(135deg, rgba(139,92,246,0.18) 0%, rgba(236,72,153,0.12) 60%, rgba(56,189,248,0.10) 100%)',
                    border: '1px solid rgba(139,92,246,0.25)',
                    boxShadow: '0 18px 48px -22px rgba(139,92,246,0.5)',
                    position: 'relative', overflow: 'hidden',
                }}
            >
                {/* decorative blur orb in corner */}
                <div style={{
                    position: 'absolute', right: -60, top: -60,
                    width: 220, height: 220, borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(236,72,153,0.35), transparent 70%)',
                    filter: 'blur(20px)', pointerEvents: 'none',
                }} />
                <div className="d-flex align-items-center gap-3" style={{ position: 'relative' }}>
                    <button
                        type="button"
                        onClick={() => navigate(-1)}
                        title="Back"
                        style={{
                            width: 40, height: 40, borderRadius: 12,
                            border: '1px solid rgba(255,255,255,0.15)',
                            background: 'rgba(255,255,255,0.06)',
                            color: 'var(--text-primary)',
                            display: 'grid', placeItems: 'center',
                            cursor: 'pointer', transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                    >
                        <BsArrowLeft size={18} />
                    </button>
                    <div style={{
                        width: 52, height: 52, borderRadius: 14,
                        background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
                        display: 'grid', placeItems: 'center',
                        boxShadow: '0 8px 24px -6px rgba(139,92,246,0.6)',
                    }}>
                        <BsAward size={26} style={{ color: '#fff' }} />
                    </div>
                    <div>
                        <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600 }}>
                            Tools / Generators
                        </div>
                        <h1 style={{ fontSize: 26, fontWeight: 800, margin: '2px 0 0', color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                            Bulk Certificate Generator
                        </h1>
                        <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '0.86rem' }}>
                            Design once, generate hundreds — branded certificates for every attendee.
                        </p>
                    </div>
                </div>
                <div className="d-flex gap-2 align-items-center" style={{ position: 'relative' }}>
                    <Button variant="outline-light" size="sm" onClick={newTemplate} disabled={generating}
                        style={{ borderRadius: 10, padding: '8px 14px', fontWeight: 600, fontSize: '0.82rem', borderColor: 'rgba(255,255,255,0.25)', color: 'var(--text-primary)' }}>
                        <BsPlus size={16} /> New template
                    </Button>
                    <Button onClick={saveTemplate} disabled={!eventId || saving || generating}
                        style={{
                            borderRadius: 10, padding: '8px 18px', fontWeight: 700, fontSize: '0.82rem',
                            background: 'linear-gradient(135deg, #8b5cf6, #ec4899)', border: 'none',
                            boxShadow: '0 8px 22px -8px rgba(139,92,246,0.7)',
                        }}>
                        {saving ? <><Spinner size="sm" animation="border" className="me-2" />Saving…</>
                                : (templateId ? 'Update template' : 'Save template')}
                    </Button>
                </div>
            </div>

            {error && <Alert variant="danger" onClose={() => setError('')} dismissible style={{ borderRadius: 12 }}>{error}</Alert>}
            {info && <Alert variant="success" onClose={() => setInfo('')} dismissible style={{ borderRadius: 12 }}>{info}</Alert>}

            {/* ── Step 1: Event + filter ───────────────────────── */}
            <div className="bcp-card mb-3" style={cardStyle}>
                <div className="d-flex align-items-center gap-2 mb-3">
                    <span style={stepBadge}>1</span>
                    <span style={stepTitle}>Pick event &amp; recipients</span>
                </div>
                <div className="row g-3 align-items-end">
                    <div className="col-md-5">
                        <Form.Label style={fieldLabel}>Event</Form.Label>
                        <Form.Select
                            value={eventId}
                            onChange={e => { setEventId(e.target.value); setTemplateId(null); }}
                            className="form-select-dark bcp-input"
                        >
                            <option value="">— Pick an event —</option>
                            {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                        </Form.Select>
                    </div>
                    <div className="col-md-4">
                        <Form.Label style={fieldLabel}>Status filter</Form.Label>
                        <Form.Select
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value)}
                            className="form-select-dark bcp-input"
                            disabled={!eventId}
                        >
                            <option value="all">All attendees ({attendees.length})</option>
                            <option value="confirmed">Confirmed only</option>
                            <option value="attended">Attended only</option>
                            <option value="invited">Invited only</option>
                        </Form.Select>
                    </div>
                    <div className="col-md-3">
                        <div style={{
                            padding: '14px 16px', borderRadius: 12,
                            background: 'linear-gradient(135deg, rgba(16,185,129,0.16), rgba(56,189,248,0.10))',
                            border: '1px solid rgba(16,185,129,0.3)',
                        }}>
                            <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Recipients</div>
                            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1, marginTop: 4 }}>
                                {loadingAttendees ? '…' : filteredAttendees.length}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>matched filter</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Saved templates row (visible when an event is picked) ── */}
            {eventId && (
                <div className="bcp-card mb-3" style={cardStyle}>
                    <div className="d-flex align-items-center justify-content-between mb-3">
                        <div className="d-flex align-items-center gap-2">
                            <span style={stepBadge}>2</span>
                            <span style={stepTitle}>Saved templates</span>
                            <Badge style={{ background: 'rgba(139,92,246,0.18)', color: 'var(--accent)', fontWeight: 700, padding: '5px 10px', borderRadius: 999 }}>
                                {templates.length}
                            </Badge>
                        </div>
                        <Button size="sm" variant="outline-light" onClick={newTemplate}
                            style={{ borderRadius: 10, fontSize: '0.78rem', borderColor: 'rgba(139,92,246,0.4)', color: 'var(--accent)' }}>
                            <BsPlus size={14} /> Start fresh
                        </Button>
                    </div>
                    {templates.length === 0 ? (
                        <div style={{
                            padding: '26px 18px', textAlign: 'center', borderRadius: 12,
                            background: 'rgba(255,255,255,0.02)', border: '1.5px dashed var(--border-subtle)',
                            color: 'var(--text-muted)', fontSize: '0.85rem',
                        }}>
                            No saved templates yet. Design one below and click <strong style={{ color: 'var(--text-primary)' }}>Save template</strong> at the top right.
                        </div>
                    ) : (
                        <div style={{
                            display: 'grid', gap: 12,
                            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                        }}>
                            {templates.map(t => {
                                const active = templateId === t.id;
                                return (
                                    <div
                                        key={t.id}
                                        onClick={() => loadTemplate(t.id)}
                                        style={{
                                            cursor: 'pointer', overflow: 'hidden',
                                            borderRadius: 14,
                                            border: active ? '2px solid var(--accent)' : '1px solid var(--border-subtle)',
                                            background: active
                                                ? 'linear-gradient(135deg, rgba(139,92,246,0.16), rgba(236,72,153,0.10))'
                                                : 'rgba(255,255,255,0.02)',
                                            transition: 'transform 0.15s, box-shadow 0.15s, border-color 0.15s',
                                            position: 'relative',
                                            boxShadow: active ? '0 14px 32px -16px rgba(139,92,246,0.55)' : 'none',
                                        }}
                                        onMouseEnter={e => { if (!active) e.currentTarget.style.transform = 'translateY(-2px)'; }}
                                        onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
                                    >
                                        <div style={{
                                            aspectRatio: '1.4 / 1',
                                            background: t.bg_image_url
                                                ? `url("${getImageUrl(t.bg_image_url)}") center/cover no-repeat`
                                                : 'linear-gradient(135deg, #1e293b, #334155)',
                                            position: 'relative',
                                        }}>
                                            {!t.bg_image_url && (
                                                <div style={{
                                                    position: 'absolute', inset: 0,
                                                    display: 'grid', placeItems: 'center', color: '#64748b',
                                                }}>
                                                    <BsImage size={32} style={{ opacity: 0.4 }} />
                                                </div>
                                            )}
                                            {active && (
                                                <div style={{
                                                    position: 'absolute', top: 8, right: 8,
                                                    padding: '3px 9px', borderRadius: 999,
                                                    background: 'var(--accent)', color: '#fff',
                                                    fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                                                    textTransform: 'uppercase',
                                                }}>Loaded</div>
                                            )}
                                        </div>
                                        <div className="d-flex align-items-center justify-content-between" style={{ padding: '10px 12px' }}>
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{
                                                    fontWeight: 700, fontSize: '0.86rem',
                                                    color: 'var(--text-primary)', whiteSpace: 'nowrap',
                                                    overflow: 'hidden', textOverflow: 'ellipsis',
                                                }} title={t.name}>{t.name}</div>
                                                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                                    {t.elements?.length || 0} element(s) · {new Date(t.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                                </div>
                                            </div>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); removeTemplate(t.id); }}
                                                title="Delete template"
                                                style={{
                                                    width: 28, height: 28, borderRadius: 8,
                                                    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
                                                    color: '#ef4444', cursor: 'pointer',
                                                    display: 'grid', placeItems: 'center', flexShrink: 0,
                                                }}
                                            ><BsTrash size={12} /></button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {!eventId ? (
                <div className="bcp-card text-center" style={{ ...cardStyle, padding: 60 }}>
                    <div style={{
                        width: 88, height: 88, borderRadius: 22,
                        background: 'linear-gradient(135deg, rgba(139,92,246,0.18), rgba(236,72,153,0.12))',
                        border: '1px solid rgba(139,92,246,0.25)',
                        display: 'grid', placeItems: 'center', margin: '0 auto 18px',
                    }}>
                        <BsAward size={44} style={{ color: 'var(--accent)' }} />
                    </div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                        Pick an event to start designing
                    </div>
                    <div style={{ fontSize: '0.86rem', color: 'var(--text-muted)' }}>
                        Templates and recipients are scoped per event.
                    </div>
                </div>
            ) : (
                <div className="row g-3" style={{ alignItems: 'flex-start' }}>
                    {/* ── LEFT: editor canvas (sticks while right panel scrolls) ── */}
                    <div className="col-lg-8" style={{ position: 'sticky', top: 16, alignSelf: 'flex-start' }}>
                        <div className="bcp-card" style={cardStyle}>
                            <div className="d-flex align-items-center gap-2 mb-3">
                                <span style={stepBadge}>3</span>
                                <span style={stepTitle}>Design</span>
                            </div>
                            <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
                                <Form.Control
                                    value={templateName}
                                    onChange={e => setTemplateName(e.target.value)}
                                    placeholder="Template name"
                                    className="bcp-input"
                                    style={{ maxWidth: 360, fontWeight: 700, fontSize: '0.95rem' }}
                                />
                                <div className="d-flex align-items-center gap-2" style={{
                                    fontSize: '0.78rem', color: 'var(--text-muted)',
                                    padding: '6px 8px 6px 12px', borderRadius: 999,
                                    background: 'rgba(255,255,255,0.04)',
                                    border: '1px solid var(--border-subtle)',
                                }}>
                                    <span style={{ fontWeight: 600 }}>Zoom</span>
                                    <Form.Range
                                        min={0.1} max={1} step={0.05}
                                        value={editorScale}
                                        onChange={e => setEditorScale(parseFloat(e.target.value))}
                                        style={{ width: 120 }}
                                    />
                                    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: 'var(--text-primary)', minWidth: 36, textAlign: 'right' }}>{Math.round(editorScale * 100)}%</span>
                                    <button
                                        type="button"
                                        onClick={fitToViewport}
                                        title="Fit to screen"
                                        style={{
                                            border: '1px solid var(--border-subtle)',
                                            background: 'rgba(255,255,255,0.04)',
                                            color: 'var(--text-primary)',
                                            borderRadius: 999, padding: '4px 10px',
                                            fontSize: '0.72rem', fontWeight: 700,
                                            cursor: 'pointer',
                                        }}
                                    >Fit</button>
                                </div>
                                {/* Select all + selection count, tucked next to the
                                    zoom controls. Shift-click on canvas also adds. */}
                                {elements.length > 0 && (
                                    <div className="d-flex align-items-center gap-2" style={{ fontSize: '0.78rem' }}>
                                        <button
                                            type="button"
                                            onClick={selectAllElements}
                                            title="Select every text element"
                                            style={{
                                                border: '1px solid var(--border-subtle)',
                                                background: selectedIds.size === elements.length
                                                    ? 'linear-gradient(135deg, #8b5cf6, #ec4899)'
                                                    : 'rgba(255,255,255,0.04)',
                                                color: selectedIds.size === elements.length ? '#fff' : 'var(--text-primary)',
                                                borderRadius: 999, padding: '5px 12px',
                                                fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer',
                                            }}
                                        >
                                            Select all{selectedIds.size > 0 ? ` · ${selectedIds.size}/${elements.length}` : ''}
                                        </button>
                                        {selectedIds.size > 1 && (
                                            <button
                                                type="button"
                                                onClick={clearSelection}
                                                title="Deselect everything"
                                                style={{
                                                    border: 'none', background: 'transparent',
                                                    color: 'var(--text-muted)', cursor: 'pointer',
                                                    fontSize: '0.72rem', fontWeight: 600, padding: '4px 6px',
                                                }}
                                            >Clear</button>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Always-visible toolbar above the canvas with the
                                most-asked-for align ops. "Center all" is a
                                one-click shortcut that selects every element
                                and recentres it on the canvas X axis — no
                                shift-click needed. */}
                            {elements.length > 0 && (
                                <div className="d-flex align-items-center gap-2 flex-wrap mb-2" style={{
                                    padding: '8px 10px', borderRadius: 10,
                                    background: 'rgba(139,92,246,0.06)',
                                    border: '1px solid rgba(139,92,246,0.25)',
                                }}>
                                    <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-primary)', marginRight: 4 }}>
                                        Quick align
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const ids = new Set(elements.map(e => e.id));
                                            setSelectedIds(ids);
                                            setSelectedId(elements[elements.length - 1].id);
                                            setElements(prev => prev.map(el => ({ ...el, x: Math.round((canvas.width - el.width) / 2) })));
                                        }}
                                        title="Move every text element so it's horizontally centered on the canvas"
                                        style={{
                                            border: 'none', cursor: 'pointer',
                                            background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
                                            color: '#fff', borderRadius: 999, padding: '6px 14px',
                                            fontWeight: 700, fontSize: '0.78rem',
                                            display: 'inline-flex', alignItems: 'center', gap: 6,
                                        }}
                                    >
                                        <BsAlignCenter size={13} /> Center all on canvas
                                    </button>
                                    <button
                                        type="button"
                                        onClick={selectAllElements}
                                        title="Highlight every text element so you can use the group panel"
                                        style={{
                                            border: '1px solid var(--border-subtle)', cursor: 'pointer',
                                            background: selectedIds.size === elements.length
                                                ? 'rgba(139,92,246,0.18)'
                                                : 'rgba(255,255,255,0.04)',
                                            color: 'var(--text-primary)', borderRadius: 999, padding: '6px 12px',
                                            fontWeight: 600, fontSize: '0.78rem',
                                        }}
                                    >
                                        {selectedIds.size === elements.length ? '✓ All selected' : `Select all (${elements.length})`}
                                    </button>
                                    {selectedIds.size > 0 && (
                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                            {selectedIds.size} of {elements.length} selected · <kbd style={{
                                                fontFamily: 'inherit', padding: '0 5px', borderRadius: 4,
                                                background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-subtle)',
                                            }}>Shift</kbd>-click to add more
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* Canvas viewport — checkered backdrop for that
                                Figma/Canva designer feel. Click outside the
                                stage deselects the active element. */}
                            <div
                                ref={viewportRef}
                                onClick={(e) => { if (e.target === e.currentTarget) clearSelection(); }}
                                style={{
                                    background: `
                                        repeating-conic-gradient(rgba(0,0,0,0.04) 0% 25%, transparent 0% 50%) 0 0 / 20px 20px,
                                        var(--bg-canvas, #f1f5f9)`,
                                    border: '1px solid var(--border-subtle)',
                                    borderRadius: 14, padding: 22,
                                    overflow: 'auto', maxHeight: '72vh',
                                    display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
                                    boxShadow: 'inset 0 2px 14px rgba(0,0,0,0.06)',
                                }}
                            >
                                <div style={{
                                    transform: `scale(${editorScale})`, transformOrigin: 'top left',
                                    width: canvas.width * editorScale,
                                    height: canvas.height * editorScale,
                                }}>
                                    <div
                                        ref={stageRef}
                                        style={stageInnerStyle}
                                        onClick={(e) => {
                                            // Click on empty canvas (not on a
                                            // DragBox) deselects whatever was
                                            // active so its dashed outline goes
                                            // away.
                                            if (e.target === e.currentTarget) clearSelection();
                                        }}
                                    >
                                        {!bgUrl && (
                                            <div style={{
                                                position: 'absolute', inset: 0,
                                                display: 'grid', placeItems: 'center',
                                                color: '#94a3b8', fontSize: 18, gap: 12,
                                            }}>
                                                <BsImage size={48} style={{ opacity: 0.4 }} />
                                                <span>Upload a background to start</span>
                                            </div>
                                        )}
                                        {elements.map(el => (
                                            <CanvasElement
                                                key={el.id}
                                                el={el}
                                                value={valueForElement(el, previewAttendee, event)}
                                                isPrimary={selectedId === el.id}
                                                isSelected={selectedIds.has(el.id)}
                                                generating={generating}
                                                scale={editorScale}
                                                onSelect={selectElement}
                                                onDragStop={handleDragStop}
                                                onAutoCenterX={(id, measuredW) => {
                                                    // Center the rendered text horizontally on the canvas
                                                    // — runs only when text content / typography changes,
                                                    // not when the user drags.
                                                    const newX = Math.max(0, Math.round((canvas.width - measuredW) / 2));
                                                    updateElement(id, { x: newX });
                                                }}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Live preview controls */}
                            {filteredAttendees.length > 0 && (
                                <div className="d-flex align-items-center justify-content-between mt-3 flex-wrap gap-2"
                                    style={{
                                        padding: '10px 14px', borderRadius: 12,
                                        background: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(56,189,248,0.06))',
                                        border: '1px solid var(--border-subtle)',
                                    }}>
                                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                        Previewing <strong style={{ color: 'var(--text-primary)' }}>#{previewIndex + 1} of {filteredAttendees.length}</strong>:
                                        <span style={{ color: 'var(--accent)', fontWeight: 600 }}>&nbsp;{previewAttendee.name}</span>
                                    </div>
                                    <div className="d-flex gap-1">
                                        <Button size="sm" variant="outline-light" disabled={previewIndex === 0} onClick={() => setPreviewIndex(i => Math.max(0, i - 1))}
                                            style={{ borderRadius: 8, borderColor: 'var(--border-subtle)', color: 'var(--text-primary)', fontSize: '0.78rem' }}>‹ Prev</Button>
                                        <Button size="sm" variant="outline-light" disabled={previewIndex >= filteredAttendees.length - 1} onClick={() => setPreviewIndex(i => Math.min(filteredAttendees.length - 1, i + 1))}
                                            style={{ borderRadius: 8, borderColor: 'var(--border-subtle)', color: 'var(--text-primary)', fontSize: '0.78rem' }}>Next ›</Button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Generate panel — gradient call-to-action */}
                        <div className="bcp-card mt-3" style={{
                            ...cardStyle,
                            background: 'linear-gradient(135deg, rgba(16,185,129,0.10) 0%, rgba(56,189,248,0.08) 100%)',
                            border: '1px solid rgba(16,185,129,0.3)',
                        }}>
                            <div className="d-flex align-items-center justify-content-between flex-wrap gap-3">
                                <div className="d-flex align-items-center gap-3">
                                    <div style={{
                                        width: 44, height: 44, borderRadius: 12,
                                        background: 'linear-gradient(135deg, #10b981, #38bdf8)',
                                        display: 'grid', placeItems: 'center',
                                        boxShadow: '0 8px 22px -8px rgba(16,185,129,0.6)',
                                    }}>
                                        <BsDownload size={20} style={{ color: '#fff' }} />
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '1rem' }}>
                                            Generate certificates
                                        </div>
                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                            Download a ZIP of PNGs + a combined PDF. To email each delegate their personalised certificate, open <strong>Email Template</strong>.
                                        </div>
                                    </div>
                                </div>
                                <div className="d-flex gap-2 flex-wrap">
                                    {/* Email template editor — opens its own page (with live
                                        email preview + cert preview). Hidden until an event
                                        is picked since the template is per-event. */}
                                    <Button
                                        variant="outline-light"
                                        onClick={() => {
                                            if (!eventId) { setError('Pick an event first.'); return; }
                                            const q = templateId ? `?template=${templateId}` : '';
                                            navigate(`/events/${eventId}/certificate-email-template${q}`);
                                        }}
                                        disabled={generating}
                                        title={!eventId ? 'Pick an event first' : 'Edit the email template + send certificates by email'}
                                        style={{ borderRadius: 12, padding: '10px 16px', fontWeight: 600, fontSize: '0.82rem', borderColor: 'rgba(255,255,255,0.18)', opacity: !eventId ? 0.65 : 1 }}
                                    >
                                        <BsEnvelopePaperFill size={14} className="me-2" /> Email Template
                                    </Button>
                                    <Button
                                        onClick={handleGenerate}
                                        disabled={!bgUrl || elements.length === 0 || filteredAttendees.length === 0 || generating}
                                        style={{
                                            borderRadius: 12, padding: '10px 22px', fontWeight: 700, fontSize: '0.86rem',
                                            background: paused
                                                ? 'linear-gradient(135deg, #f59e0b, #f97316)'
                                                : 'linear-gradient(135deg, #10b981, #38bdf8)',
                                            border: 'none',
                                            boxShadow: paused
                                                ? '0 10px 28px -10px rgba(245,158,11,0.7)'
                                                : '0 10px 28px -10px rgba(16,185,129,0.7)',
                                            transition: 'background 0.2s, box-shadow 0.2s',
                                        }}
                                    >
                                        {paused ? (
                                            <>⏸ Paused {generateProgress.done}/{generateProgress.total}</>
                                        ) : generating ? (
                                            <><Spinner size="sm" animation="border" className="me-2" />
                                                Rendering {generateProgress.done}/{generateProgress.total}…</>
                                        ) : (
                                            <><BsDownload size={14} className="me-2" />
                                                Generate {filteredAttendees.length} cert{filteredAttendees.length === 1 ? '' : 's'}</>
                                        )}
                                    </Button>
                                </div>
                            </div>
                            {generating && generateProgress.total > 0 && (
                                <>
                                    <div style={{ marginTop: 12, height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                                        <div style={{
                                            width: `${(generateProgress.done / generateProgress.total) * 100}%`,
                                            height: '100%',
                                            background: paused
                                                ? 'linear-gradient(90deg, #f59e0b, #f97316)'
                                                : 'linear-gradient(90deg, #10b981, #38bdf8)',
                                            transition: 'width 0.2s, background 0.2s',
                                        }} />
                                    </div>
                                    {/* Pause/Resume + Cancel — sit under the progress
                                        bar while a run is in flight. Pause halts the
                                        loop between attendees so the current capture
                                        finishes cleanly; Cancel ends the run and
                                        still packages whatever has been rendered. */}
                                    <div className="d-flex align-items-center justify-content-between gap-2 mt-2 flex-wrap">
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                            {paused
                                                ? <>⏸ Paused at <strong style={{ color: '#f59e0b' }}>{generateProgress.done}</strong>/{generateProgress.total}</>
                                                : <>Rendering <strong style={{ color: 'var(--text-primary)' }}>{generateProgress.done}</strong>/{generateProgress.total}…</>
                                            }
                                        </div>
                                        <div className="d-flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setPaused(p => !p)}
                                                title={paused ? 'Resume generation' : 'Pause after the current attendee finishes'}
                                                style={{
                                                    border: '1px solid rgba(245,158,11,0.45)',
                                                    background: paused ? 'linear-gradient(135deg, #10b981, #38bdf8)' : 'rgba(245,158,11,0.12)',
                                                    color: paused ? '#fff' : '#f59e0b',
                                                    borderRadius: 999, padding: '5px 14px',
                                                    fontWeight: 700, fontSize: '0.74rem', cursor: 'pointer',
                                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                                }}
                                            >
                                                {paused
                                                    ? <>▶ Resume</>
                                                    : <>⏸ Pause</>
                                                }
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    cancelledRef.current = true;
                                                    pausedRef.current = false;
                                                    setPaused(false);
                                                }}
                                                title="Stop generating now. Any certificates already rendered will still be packaged."
                                                style={{
                                                    border: '1px solid rgba(239,68,68,0.45)',
                                                    background: 'rgba(239,68,68,0.12)',
                                                    color: '#fca5a5',
                                                    borderRadius: 999, padding: '5px 14px',
                                                    fontWeight: 700, fontSize: '0.74rem', cursor: 'pointer',
                                                }}
                                            >
                                                ✕ Cancel
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* ── RIGHT: side panel ── */}
                    <div className="col-lg-4">
                        {/* Background uploader */}
                        <div className="bcp-card mb-3" style={cardStyle}>
                            <div className="d-flex align-items-center gap-2 mb-3">
                                <div style={{
                                    width: 28, height: 28, borderRadius: 8,
                                    background: 'rgba(139,92,246,0.14)', color: 'var(--accent)',
                                    display: 'grid', placeItems: 'center', flexShrink: 0,
                                }}><BsImage size={14} /></div>
                                <div style={stepTitle}>Background</div>
                            </div>
                            {bgUrl ? (
                                <div style={{ position: 'relative', marginBottom: 10 }}>
                                    <img
                                        src={getImageUrl(bgUrl)}
                                        alt=""
                                        style={{ width: '100%', borderRadius: 10, border: '1px solid var(--border-subtle)', display: 'block' }}
                                    />
                                </div>
                            ) : (
                                <div style={{
                                    padding: '24px 12px', borderRadius: 12, marginBottom: 10,
                                    border: '1.5px dashed var(--border-subtle)',
                                    background: 'rgba(255,255,255,0.02)',
                                    textAlign: 'center', color: 'var(--text-muted)',
                                }}>
                                    <BsImage size={28} style={{ opacity: 0.4 }} />
                                    <div style={{ fontSize: '0.78rem', marginTop: 6 }}>No background yet</div>
                                </div>
                            )}
                            <label className="w-100" style={{ marginBottom: 0 }}>
                                <input
                                    type="file"
                                    accept="image/*"
                                    style={{ display: 'none' }}
                                    onChange={e => handleBgUpload(e.target.files?.[0])}
                                />
                                <span className="bcp-upload-btn" style={{
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                    width: '100%', padding: '10px 14px', borderRadius: 10,
                                    background: bgUrl ? 'rgba(255,255,255,0.04)' : 'linear-gradient(135deg, rgba(139,92,246,0.16), rgba(236,72,153,0.10))',
                                    border: bgUrl ? '1px solid var(--border-subtle)' : '1px solid rgba(139,92,246,0.4)',
                                    color: bgUrl ? 'var(--text-primary)' : 'var(--accent)',
                                    fontWeight: 600, fontSize: '0.82rem',
                                    cursor: bgUploading ? 'wait' : 'pointer',
                                    transition: 'all 0.15s',
                                    pointerEvents: bgUploading ? 'none' : 'auto',
                                }}>
                                    {bgUploading
                                        ? <><Spinner size="sm" animation="border" />Uploading…</>
                                        : <><BsCloudUpload size={14} />{bgUrl ? 'Replace background' : 'Upload background'}</>}
                                </span>
                            </label>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 8 }}>
                                JPG/PNG, ≤20 MB · canvas auto-resizes to the image
                            </div>
                        </div>

                        {/* Add element */}
                        <div className="bcp-card mb-3" style={cardStyle}>
                            <div className="d-flex align-items-center gap-2 mb-3">
                                <div style={{
                                    width: 28, height: 28, borderRadius: 8,
                                    background: 'rgba(139,92,246,0.14)', color: 'var(--accent)',
                                    display: 'grid', placeItems: 'center', flexShrink: 0,
                                }}><BsBraces size={14} /></div>
                                <div style={stepTitle}>Add text element</div>
                            </div>
                            <div className="d-grid gap-2">
                                {FIELD_KEYS.map(f => (
                                    <button
                                        key={f.key}
                                        type="button"
                                        onClick={() => addElement(f.key)}
                                        className="bcp-add-btn"
                                        style={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            padding: '9px 12px', borderRadius: 10,
                                            background: 'rgba(255,255,255,0.02)',
                                            border: '1px solid var(--border-subtle)',
                                            color: 'var(--text-primary)',
                                            fontSize: '0.82rem', fontWeight: 600,
                                            cursor: 'pointer', transition: 'all 0.15s',
                                        }}
                                    >
                                        <span className="d-flex align-items-center gap-2">
                                            <BsTextareaT size={12} style={{ color: 'var(--accent)' }} />
                                            {f.label}
                                        </span>
                                        <code style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                                            {f.key === 'custom' ? '·' : `{${f.key}}`}
                                        </code>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Element list */}
                        <div className="bcp-card mb-3" style={cardStyle}>
                            <div className="d-flex align-items-center justify-content-between mb-3">
                                <div className="d-flex align-items-center gap-2">
                                    <div style={{
                                        width: 28, height: 28, borderRadius: 8,
                                        background: 'rgba(139,92,246,0.14)', color: 'var(--accent)',
                                        display: 'grid', placeItems: 'center', flexShrink: 0,
                                    }}><BsTextareaT size={14} /></div>
                                    <div style={stepTitle}>Elements</div>
                                </div>
                                <Badge style={{ background: 'rgba(139,92,246,0.18)', color: 'var(--accent)', fontWeight: 700, padding: '5px 10px', borderRadius: 999 }}>
                                    {elements.length}
                                </Badge>
                            </div>
                            {elements.length === 0 ? (
                                <div style={{
                                    fontSize: '0.8rem', color: 'var(--text-muted)',
                                    padding: '14px 12px', borderRadius: 10,
                                    border: '1.5px dashed var(--border-subtle)', textAlign: 'center',
                                }}>
                                    No elements yet — add one above.
                                </div>
                            ) : (
                                <div className="d-flex flex-column gap-2">
                                    {elements.map(el => {
                                        const isActive = selectedIds.has(el.id);
                                        return (
                                            <div
                                                key={el.id}
                                                onClick={(e) => selectElement(el.id, e.shiftKey)}
                                                className="d-flex align-items-center justify-content-between"
                                                style={{
                                                    padding: '9px 12px', borderRadius: 10, cursor: 'pointer',
                                                    background: isActive
                                                        ? 'linear-gradient(135deg, rgba(139,92,246,0.18), rgba(236,72,153,0.10))'
                                                        : 'rgba(255,255,255,0.02)',
                                                    border: isActive ? '1px solid var(--accent)' : '1px solid var(--border-subtle)',
                                                    fontSize: '0.82rem',
                                                    transition: 'all 0.15s',
                                                }}
                                            >
                                                <span className="d-flex align-items-center gap-2" style={{ minWidth: 0, flex: 1 }}>
                                                    <BsTextareaT size={12} style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }} />
                                                    <span style={{ fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {FIELD_KEYS.find(f => f.key === el.key)?.label || el.key}
                                                    </span>
                                                </span>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); removeElement(el.id); }}
                                                    title="Remove"
                                                    style={{
                                                        width: 26, height: 26, borderRadius: 7,
                                                        background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)',
                                                        color: '#ef4444', cursor: 'pointer',
                                                        display: 'grid', placeItems: 'center', flexShrink: 0,
                                                    }}
                                                ><BsTrash size={11} /></button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Group actions — visible when 2+ elements are
                            selected. Lets the user line them all up at once
                            (e.g. center every selected text horizontally on
                            the canvas, which is the common "center the title
                            block" workflow). The single-element properties
                            panel below still shows for the primary selection. */}
                        {selectedIds.size > 1 && (
                            <div className="bcp-card" style={{
                                ...cardStyle,
                                border: '1px solid rgba(139,92,246,0.55)',
                                background: 'linear-gradient(180deg, var(--bg-card), rgba(139,92,246,0.08))',
                            }}>
                                <div className="d-flex align-items-center gap-2 mb-3">
                                    <div style={{
                                        width: 28, height: 28, borderRadius: 8,
                                        background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
                                        color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0,
                                        fontSize: 12, fontWeight: 800,
                                    }}>{selectedIds.size}</div>
                                    <div style={stepTitle}>elements selected · group actions</div>
                                </div>
                                <div className="d-flex flex-column gap-2">
                                    <button
                                        type="button"
                                        onClick={groupCenterOnCanvas}
                                        title="Move each selected element so it's horizontally centered on the canvas"
                                        style={{
                                            padding: '10px 12px', borderRadius: 10,
                                            background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
                                            color: '#fff', border: 'none', cursor: 'pointer',
                                            fontWeight: 700, fontSize: '0.85rem',
                                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                        }}
                                    >
                                        <BsAlignCenter size={14} /> Center all on canvas
                                    </button>
                                    <div className="row g-2">
                                        <div className="col-6">
                                            <button
                                                type="button"
                                                onClick={groupAlignLeft}
                                                title="Snap every selected element's left edge to the leftmost"
                                                className="w-100"
                                                style={{
                                                    padding: '8px 0', borderRadius: 8,
                                                    background: 'rgba(255,255,255,0.04)',
                                                    border: '1px solid var(--border-subtle)',
                                                    color: 'var(--text-primary)', cursor: 'pointer',
                                                    fontWeight: 600, fontSize: '0.78rem',
                                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                                }}
                                            >
                                                <BsAlignStart size={13} /> Align left
                                            </button>
                                        </div>
                                        <div className="col-6">
                                            <button
                                                type="button"
                                                onClick={groupAlignRight}
                                                title="Snap every selected element's right edge to the rightmost"
                                                className="w-100"
                                                style={{
                                                    padding: '8px 0', borderRadius: 8,
                                                    background: 'rgba(255,255,255,0.04)',
                                                    border: '1px solid var(--border-subtle)',
                                                    color: 'var(--text-primary)', cursor: 'pointer',
                                                    fontWeight: 600, fontSize: '0.78rem',
                                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                                }}
                                            >
                                                <BsAlignEnd size={13} /> Align right
                                            </button>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={groupSetTextAlignCenter}
                                        title="Set text-align: center on every selected element"
                                        style={{
                                            padding: '8px 0', borderRadius: 8,
                                            background: 'rgba(255,255,255,0.04)',
                                            border: '1px solid var(--border-subtle)',
                                            color: 'var(--text-primary)', cursor: 'pointer',
                                            fontWeight: 600, fontSize: '0.78rem',
                                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                        }}
                                    >
                                        <BsAlignCenter size={13} /> Text align: center
                                    </button>
                                </div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.45 }}>
                                    Tip: <kbd style={{ fontFamily: 'inherit', padding: '1px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border-subtle)' }}>Shift</kbd>-click another element on the canvas (or in the layers list) to add it to the selection.
                                </div>
                            </div>
                        )}

                        {/* Element properties */}
                        {selected && (
                            <div className="bcp-card" style={{
                                ...cardStyle,
                                border: '1px solid rgba(139,92,246,0.4)',
                                background: 'linear-gradient(180deg, var(--bg-card), rgba(139,92,246,0.04))',
                            }}>
                                <div className="d-flex align-items-center gap-2 mb-3">
                                    <div style={{
                                        width: 28, height: 28, borderRadius: 8,
                                        background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
                                        color: '#fff', display: 'grid', placeItems: 'center', flexShrink: 0,
                                    }}><BsBraces size={14} /></div>
                                    <div style={stepTitle}>{FIELD_KEYS.find(f => f.key === selected.key)?.label} properties</div>
                                </div>
                                {selected.key === 'custom' && (
                                    <Form.Group className="mb-2">
                                        <Form.Label style={{ fontSize: '0.74rem' }}>Text</Form.Label>
                                        <Form.Control
                                            as="textarea" rows={2}
                                            value={selected.content}
                                            onChange={e => updateElement(selected.id, { content: e.target.value })}
                                        />
                                    </Form.Group>
                                )}
                                <Form.Group className="mb-2">
                                    <Form.Label style={{ fontSize: '0.74rem' }}>Font family</Form.Label>
                                    <Form.Select
                                        value={selected.fontFamily}
                                        onChange={e => updateElement(selected.id, { fontFamily: e.target.value })}
                                    >
                                        {FONT_GROUPS.map(group => (
                                            <optgroup key={group.label} label={group.label}>
                                                {group.fonts.map(f => (
                                                    <option key={f.name} value={f.name} style={{ fontFamily: `"${f.name}"` }}>
                                                        {f.name}
                                                    </option>
                                                ))}
                                            </optgroup>
                                        ))}
                                    </Form.Select>
                                </Form.Group>
                                <div className="row g-2">
                                    <div className="col-6">
                                        <Form.Group className="mb-2">
                                            <Form.Label style={{ fontSize: '0.74rem' }}>Size</Form.Label>
                                            <Form.Control
                                                type="number" min={8} max={300}
                                                value={selected.fontSize}
                                                onChange={e => updateElement(selected.id, { fontSize: parseInt(e.target.value, 10) || 16 })}
                                            />
                                        </Form.Group>
                                    </div>
                                    <div className="col-6">
                                        <Form.Group className="mb-2">
                                            <Form.Label style={{ fontSize: '0.74rem' }}>Width (px)</Form.Label>
                                            <Form.Control
                                                type="number" min={50} max={2000}
                                                value={selected.width}
                                                onChange={e => updateElement(selected.id, { width: parseInt(e.target.value, 10) || 200 })}
                                            />
                                        </Form.Group>
                                    </div>
                                </div>
                                <div className="row g-2">
                                    <div className="col-6">
                                        <Form.Group className="mb-2">
                                            <Form.Label style={{ fontSize: '0.74rem' }}>Color</Form.Label>
                                            <Form.Control
                                                type="color"
                                                value={selected.color}
                                                onChange={e => updateElement(selected.id, { color: e.target.value })}
                                                style={{ height: 36, padding: 4 }}
                                            />
                                        </Form.Group>
                                    </div>
                                    <div className="col-6">
                                        <Form.Group className="mb-2">
                                            <Form.Label style={{ fontSize: '0.74rem' }}>Weight</Form.Label>
                                            <Form.Select
                                                value={selected.fontWeight}
                                                onChange={e => updateElement(selected.id, { fontWeight: parseInt(e.target.value, 10) })}
                                            >
                                                <option value={300}>Light</option>
                                                <option value={400}>Regular</option>
                                                <option value={500}>Medium</option>
                                                <option value={600}>Semibold</option>
                                                <option value={700}>Bold</option>
                                                <option value={800}>Heavy</option>
                                            </Form.Select>
                                        </Form.Group>
                                    </div>
                                </div>
                                <div className="mb-2">
                                    <Form.Label style={{ fontSize: '0.74rem' }}>Alignment</Form.Label>
                                    <div className="d-flex gap-1">
                                        {[
                                            { val: 'left',   icon: BsAlignStart, label: 'Left' },
                                            { val: 'center', icon: BsAlignCenter, label: 'Center' },
                                            { val: 'right',  icon: BsAlignEnd, label: 'Right' },
                                        ].map(({ val, icon: Icon, label }) => (
                                            <button
                                                key={val}
                                                type="button"
                                                title={label}
                                                onClick={() => updateElement(selected.id, { align: val })}
                                                className="flex-grow-1"
                                                style={{
                                                    padding: '8px 0', borderRadius: 8,
                                                    background: selected.align === val
                                                        ? 'linear-gradient(135deg, #8b5cf6, #ec4899)'
                                                        : 'rgba(255,255,255,0.04)',
                                                    border: selected.align === val
                                                        ? '1px solid transparent'
                                                        : '1px solid var(--border-subtle)',
                                                    color: selected.align === val ? '#fff' : 'var(--text-primary)',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.15s',
                                                }}
                                            >
                                                <Icon size={14} />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="mb-2">
                                    <Form.Label style={{ fontSize: '0.74rem' }}>Style</Form.Label>
                                    <div className="d-flex gap-1">
                                        <button
                                            type="button"
                                            title="Italic"
                                            onClick={() => updateElement(selected.id, { italic: !selected.italic })}
                                            className="flex-grow-1"
                                            style={{
                                                padding: '8px 0', borderRadius: 8,
                                                background: selected.italic
                                                    ? 'linear-gradient(135deg, #8b5cf6, #ec4899)'
                                                    : 'rgba(255,255,255,0.04)',
                                                border: selected.italic ? '1px solid transparent' : '1px solid var(--border-subtle)',
                                                color: selected.italic ? '#fff' : 'var(--text-primary)',
                                                cursor: 'pointer',
                                                fontStyle: 'italic', fontWeight: 700, fontSize: '0.95rem',
                                                fontFamily: 'Georgia, serif',
                                                transition: 'all 0.15s',
                                            }}
                                        >I</button>
                                        <button
                                            type="button"
                                            title="Underline"
                                            onClick={() => updateElement(selected.id, { underline: !selected.underline })}
                                            className="flex-grow-1"
                                            style={{
                                                padding: '8px 0', borderRadius: 8,
                                                background: selected.underline
                                                    ? 'linear-gradient(135deg, #8b5cf6, #ec4899)'
                                                    : 'rgba(255,255,255,0.04)',
                                                border: selected.underline ? '1px solid transparent' : '1px solid var(--border-subtle)',
                                                color: selected.underline ? '#fff' : 'var(--text-primary)',
                                                cursor: 'pointer',
                                                textDecoration: 'underline', fontWeight: 700, fontSize: '0.95rem',
                                                transition: 'all 0.15s',
                                            }}
                                        >U</button>
                                    </div>
                                </div>
                                <Form.Group className="mb-2">
                                    <Form.Label style={{ fontSize: '0.74rem' }}>Letter spacing (px)</Form.Label>
                                    <Form.Control
                                        type="number" min={-5} max={50} step={0.5}
                                        value={selected.letterSpacing ?? 0}
                                        onChange={e => updateElement(selected.id, { letterSpacing: parseFloat(e.target.value) || 0 })}
                                    />
                                </Form.Group>
                                <div className="mb-2 d-flex align-items-center justify-content-between" style={{
                                    padding: '8px 12px', borderRadius: 10,
                                    background: 'rgba(255,255,255,0.04)',
                                    border: '1px solid var(--border-subtle)',
                                }}>
                                    <div>
                                        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                            Single line
                                        </div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                            Stop the text from wrapping onto a second line
                                        </div>
                                    </div>
                                    <Form.Check
                                        type="switch"
                                        id={`nowrap-${selected.id}`}
                                        checked={!!selected.nowrap}
                                        onChange={e => updateElement(selected.id, { nowrap: e.target.checked })}
                                    />
                                </div>
                                {/* When align==='center', the editor auto-recenters
                                    this element on the canvas every time the
                                    rendered text changes (different recipient =
                                    different text width). Lock X turns that off
                                    so a deliberately off-centre position sticks. */}
                                {selected.align === 'center' && (
                                    <div className="mb-2 d-flex align-items-center justify-content-between" style={{
                                        padding: '8px 12px', borderRadius: 10,
                                        background: 'rgba(255,255,255,0.04)',
                                        border: '1px solid var(--border-subtle)',
                                    }}>
                                        <div>
                                            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                                Lock X position
                                            </div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                                Don't auto-recenter when the text changes
                                            </div>
                                        </div>
                                        <Form.Check
                                            type="switch"
                                            id={`lockx-${selected.id}`}
                                            checked={!!selected.lockX}
                                            onChange={e => updateElement(selected.id, { lockX: e.target.checked })}
                                        />
                                    </div>
                                )}
                                <div className="row g-2">
                                    <div className="col-6">
                                        <Form.Group className="mb-2">
                                            <Form.Label style={{ fontSize: '0.74rem' }}>X (px)</Form.Label>
                                            <Form.Control
                                                type="number"
                                                value={selected.x}
                                                onChange={e => updateElement(selected.id, { x: parseInt(e.target.value, 10) || 0 })}
                                            />
                                        </Form.Group>
                                    </div>
                                    <div className="col-6">
                                        <Form.Group className="mb-2">
                                            <Form.Label style={{ fontSize: '0.74rem' }}>Y (px)</Form.Label>
                                            <Form.Control
                                                type="number"
                                                value={selected.y}
                                                onChange={e => updateElement(selected.id, { y: parseInt(e.target.value, 10) || 0 })}
                                            />
                                        </Form.Group>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Page-scoped polish for inputs, hover states, and the upload chip. */}
            <style>{`
                .bcp-input,
                .bcp-card .form-control,
                .bcp-card .form-select {
                    background: rgba(255,255,255,0.04) !important;
                    border: 1px solid var(--border-subtle) !important;
                    color: var(--text-primary) !important;
                    border-radius: 10px !important;
                    transition: border-color 0.15s, box-shadow 0.15s !important;
                }
                .bcp-input:focus,
                .bcp-card .form-control:focus,
                .bcp-card .form-select:focus {
                    border-color: var(--accent) !important;
                    box-shadow: 0 0 0 3px rgba(139,92,246,0.18) !important;
                }
                .bcp-add-btn:hover {
                    background: rgba(139,92,246,0.08) !important;
                    border-color: var(--accent) !important;
                    transform: translateX(2px);
                }
                .bcp-upload-btn:hover { filter: brightness(1.05); transform: translateY(-1px); }
                .bcp-card { transition: box-shadow 0.2s; }
                .bcp-card:hover { box-shadow: 0 12px 32px -16px rgba(0,0,0,0.35); }
            `}</style>

        </div>
    );
}
