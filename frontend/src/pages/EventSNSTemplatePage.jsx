import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Cropper from 'react-cropper';
import 'cropperjs/dist/cropper.css';
import { Button, Form, Spinner, Accordion, Tabs, Tab } from 'react-bootstrap';
import { toPng } from 'html-to-image';
import { BsDownload, BsArrowLeft, BsArrowsMove, BsLayoutTextWindow, BsShieldLock, BsMagic, BsStars, BsChatDots, BsSend, BsRobot, BsImage, BsCheckCircleFill, BsTextLeft, BsDistributeVertical, BsLightningChargeFill } from 'react-icons/bs';
import { getEvent, updateEventTemplate, updateEventAttendingTemplate, bulkApplySNSTemplate, bulkApplyAttendingTemplate, uploadImage, getSpeakers } from '../services/api';
import Draggable from 'react-draggable';
import { getImageUrl } from '../utils/imageUrl';

const selectionStyles = `
    .ps-workspace { height: 100vh; background: #3c3c3c; display: flex; flex-direction: column; color: #ddd; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; }
    .ps-header { background: #323232; height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; border-bottom: 1px solid #282828; flex-shrink: 0; }
    .ps-tabs { display: flex; gap: 24px; height: 100%; }
    .ps-tab { display: flex; align-items: center; font-size: 11px; color: #888; cursor: pointer; border-bottom: 2px solid transparent; text-transform: uppercase; letter-spacing: 0.5px; }
    .ps-tab.active { color: #fff; border-bottom-color: #0084ff; }
    .ps-close-btn { background: none; border: none; color: #888; font-size: 24px; cursor: pointer; }

    .ps-main-body { display: flex; flex: 1; overflow: hidden; background: #282828; }
    .ps-content-area { flex: 1; padding: 30px; display: flex; flex-direction: column; overflow: hidden; }
    .ps-section-label { font-size: 10px; color: #666; font-weight: 800; margin-bottom: 24px; letter-spacing: 1px; }
    .ps-scroll-container { flex: 1; overflow-y: auto; padding-right: 10px; }
    .ps-scroll-container::-webkit-scrollbar { width: 6px; }
    .ps-scroll-container::-webkit-scrollbar-thumb { background: #444; border-radius: 10px; }

    .ps-category-row { margin-bottom: 40px; }
    .ps-category-name { font-size: 13px; font-weight: 600; color: #bbb; margin-bottom: 16px; }
    .ps-presets-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 12px; }

    .ps-preset-tile { background: #3c3c3c; border: 1px solid #484848; padding: 12px; display: flex; flex-direction: column; align-items: center; cursor: pointer; border-radius: 2px; }
    .ps-preset-tile:hover { background: #444; }
    .ps-preset-tile.active { border-color: #0084ff; background: #444; box-shadow: inset 0 0 0 1px #0084ff; }

    .ps-thumb-outer { width: 100%; height: 60px; display: flex; align-items: center; justify-content: center; margin-bottom: 12px; }
    .ps-thumb-inner { width: 40px; border: 1px solid #666; background: #323232; opacity: 0.8; }
    .ps-tile-info { text-align: center; width: 100%; }
    .ps-tile-name { font-size: 10px; color: #eee; font-weight: 600; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ps-tile-dims { font-size: 9px; color: #777; }

    .ps-config-sidebar { width: 280px; background: #454545; padding: 25px; border-left: 1px solid #282828; display: flex; flex-direction: column; flex-shrink: 0; }
    .ps-sidebar-title { font-size: 10px; font-weight: 800; color: #fff; margin-bottom: 24px; }

    .ps-field label { display: block; font-size: 10px; color: #aaa; margin-bottom: 6px; }
    .ps-field input, .ps-field select { background: #323232; border: 1px solid #1a1a1a; color: #eee; height: 26px; padding: 0 8px; font-size: 11px; width: 100%; border-radius: 2px; }
    .ps-field input:focus { border-top: 1px solid #0084ff; outline: none; }

    .ps-field-row { display: flex; gap: 10px; }
    .ps-dim-swap { background: none; border: none; color: #777; cursor: pointer; padding: 0; font-size: 14px; }
    .ps-dim-swap:hover { color: #fff; }
    .ps-fake-unit { background: #3c3c3c; height: 26px; display: flex; align-items: center; justify-content: center; font-size: 9px; color: #888; border: 1px solid #222; border-radius: 2px; }

    .ps-orient-group { display: flex; gap: 4px; }
    .ps-orient-choice { width: 32px; height: 26px; border: 1px solid #1a1a1a; background: #323232; display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 2px; }
    .ps-orient-choice.active { background: #5a5a5a; border-color: #0084ff; }
    .ps-icon-rect { border: 1px solid #aaa; }
    .ps-orient-choice.active .ps-icon-rect { border-color: #fff; }
    .ps-icon-rect.vertical { width: 8px; height: 12px; }
    .ps-icon-rect.horizontal { width: 12px; height: 8px; }

    .ps-checkbox-label { font-size: 10px; color: #aaa; cursor: pointer; display: flex; align-items: center; gap: 6px; }
    .ps-color-swatch { width: 26px; height: 26px; border: 1px solid #1a1a1a; border-radius: 2px; flex-shrink: 0; }

    .ps-create-btn { background: #555; color: #fff; border: 1px solid #222; height: 32px; width: 100%; font-size: 11px; font-weight: 600; cursor: pointer; border-radius: 16px; }
    .ps-create-btn:hover { background: #666; }

    /* Page Styles */
    .premium-tabs { background: #1a1a2e; padding: 5px 5px 0; }
    .premium-tabs .nav-link { color: #a0a0c0 !important; background: transparent !important; border: none !important; font-weight: 600; font-size: 0.85rem; padding: 12px 20px; border-radius: 8px 8px 0 0 !important; }
    .premium-tabs .nav-link.active { color: #13d999 !important; background: #161625 !important; border-bottom: 2px solid #13d999 !important; }
    .premium-accordion .accordion-button { background: #13d999 !important; color: #000 !important; padding: 10px !important; font-size: 0.8rem; font-weight: bold; border-radius: 8px !important; }
    .premium-accordion .accordion-item { border: 1px solid #3d3d5c !important; margin-bottom: 10px; border-radius: 8px !important; overflow: hidden; }
    .premium-accordion .accordion-body { background: #1a1a2e; padding: 15px !important; }
    .border-dashed { border: 2px dashed #3d3d5c !important; }
    .btn-outline-accent { color: #13d999; border: 1px solid #13d999; }
    .btn-outline-accent:hover { background: #13d999; color: black; }
    .muted-label { font-size: 10px; opacity: 0.6; text-transform: uppercase; margin-bottom: 4px; }
    .btn-accent { background: #13d999; color: black; border: none; font-weight: 600; }
    .btn-accent:hover { background: #10b982; }
    .bg-accent { background: #13d999 !important; }
    .text-accent { color: #13d999 !important; }
    .form-control-dark { background: #000000; border: 1px solid #3d3d5c; color: white !important; }
    .form-control-dark:focus { background: #111111; border-color: #13d999; box-shadow: none; }
    .form-select-dark { background: #000000; border: 1px solid #3d3d5c; color: white !important; }
    .form-select-dark:focus { background: #111111; border-color: #13d999; box-shadow: none; }
    ::-webkit-scrollbar { width: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #3d3d5c; border-radius: 10px; }
`;

// cardType: 'speaker' (default) edits events.sns_card_template;
// 'attending' edits events.attending_card_template — same designer UI,
// just bound to a different column so the two layouts stay independent.
export default function EventSNSTemplatePage({ cardType = 'speaker' }) {
    return (
        <>
            <style>{selectionStyles}</style>
            <TemplateDesignerInternal cardType={cardType} />
        </>
    );
}

function TemplateDesignerInternal({ cardType = 'speaker' }) {
    const { id } = useParams();
    const { user } = useAuth();
    const navigate = useNavigate();
    const isAttending = cardType === 'attending';
    
    const [event, setEvent] = useState(null);
    const [placeholderSpeaker] = useState({
        name: 'Speaker Full Name',
        designation: 'Designation / Role',
        company: 'Company Name',
        photo_url: null
    });

    const [image, setImage] = useState(null);
    const [cropper, setCropper] = useState();
    const [croppedImage, setCroppedImage] = useState(null);
    const [background, setBackground] = useState(null);
    const [backgroundDimensions, setBackgroundDimensions] = useState({ width: 1080, height: 1080 });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const cardRef = useRef(null);
    const containerRef = useRef(null);
    const elementRefs = useRef({});

    // hardcoded drag elements
    const dragRefs = {
        photo: useRef(null),
        eventLogo: useRef(null),
        companyLogo: useRef(null),
    };
    const [photoSettings, setPhotoSettings] = useState({ size: 400 });
    const [canvasSize, setCanvasSize] = useState({ width: 1080, height: 1080 });
    const [viewportScale, setViewportScale] = useState(1);
    const [logoSettings, setLogoSettings] = useState({ eventSize: 100, companySize: 100, showEvent: false, showCompany: false });
    const [bgOverlay, setBgOverlay] = useState({ color: '#000000', opacity: 0 });
    const [bgPosition, setBgPosition] = useState('center');
    const [selectedFormat, setSelectedFormat] = useState(null);
    const [customSize, setCustomSize] = useState({ width: 1080, height: 1080, background: 'White' });
    const [isLocked, setIsLocked] = useState(false);
    const [groupMove, setGroupMove] = useState(false);
    const [spacingPct, setSpacingPct] = useState(2);

    const formatPresets = {
        'Instagram': [
            { id: 'insta_square', name: 'Instagram', width: 1080, height: 1080, ratio: '1:1' },
            { id: 'insta_story', name: 'Insta Story', width: 1080, height: 1920, ratio: '9:16' },
            { id: 'insta_portrait', name: 'Insta Portrait', width: 1080, height: 1350, ratio: '4:5' }
        ],
        'Facebook': [
            { id: 'fb_cover', name: 'FB Page Cover', width: 1640, height: 664, ratio: '2.47:1' },
            { id: 'fb_event', name: 'FB Event Image', width: 1920, height: 1080, ratio: '16:9' },
            { id: 'fb_group', name: 'FB Group Header', width: 1640, height: 856, ratio: '1.91:1' }
        ],
        'YouTube': [
            { id: 'yt_thumb', name: 'Youtube Thumbnail', width: 1280, height: 720, ratio: '16:9' },
            { id: 'yt_profile', name: 'Youtube Profile', width: 800, height: 800, ratio: '1:1' },
            { id: 'yt_cover', name: 'Youtube Cover', width: 2560, height: 1440, ratio: '16:9' }
        ],
        'Twitter': [
            { id: 'tw_profile', name: 'Twitter Profile', width: 400, height: 400, ratio: '1:1' },
            { id: 'tw_header', name: 'Twitter Header', width: 1500, height: 500, ratio: '3:1' }
        ]
    };

    const [positions, setPositions] = useState({
        photo: { x: 0.34, y: 0.125 },
        name: { x: 0.25, y: 0.5 },
        designation: { x: 0.25, y: 0.575 },
        company: { x: 0.25, y: 0.65 },
        eventLogo: { x: 0.8, y: 0.05 },
        companyLogo: { x: 0.05, y: 0.05 }
    });

    const [elements, setElements] = useState({
        name: { text: 'Speaker Full Name', color: '#ffffff', fontSize: 40, fontFamily: 'Inter', fontWeight: '800', textDecoration: 'none', letterSpacing: 0, lineHeight: 1.2, show: true },
        designation: { text: 'Designation / Role', color: '#ffffff', fontSize: 20, fontFamily: 'Inter', fontWeight: '500', textDecoration: 'none', letterSpacing: 0, lineHeight: 1.3, show: true },
        company: { text: 'Company Name', color: '#ffffff', fontSize: 18, fontFamily: 'Inter', fontWeight: '500', textDecoration: 'none', letterSpacing: 0, lineHeight: 1.3, show: true },
    });

    // Add a free-text element ("Subtitle", "I am attending", etc.) at the
    // canvas center. `isCustom: true` flags it for the controls UI (text
    // editor + Remove button) and for the per-speaker generator's restore
    // logic so custom text is preserved verbatim instead of being
    // overwritten with speaker data.
    const addCustomElement = () => {
        const id = `custom_${Date.now()}`;
        setElements(prev => ({
            ...prev,
            [id]: { text: 'New Text', color: '#ffffff', fontSize: 24, fontFamily: 'Inter', fontWeight: '600', textDecoration: 'none', letterSpacing: 0, lineHeight: 1.3, show: true, isCustom: true }
        }));
        setPositions(prev => ({
            ...prev,
            [id]: { x: 0.5, y: 0.5 }
        }));
    };

    const removeElement = (key) => {
        setElements(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
        setPositions(prev => {
            const next = { ...prev };
            delete next[key];
            return next;
        });
    };

    // Convenience setter — matches SNSGenerator's signature so the per-
    // element controls can share their JSX without a styling refactor.
    const updateElement = (key, field, value) => {
        setElements(prev => ({
            ...prev,
            [key]: { ...prev[key], [field]: value }
        }));
    };

    // Ensure ref exists for each element
    Object.keys(elements).forEach(key => {
        if (!elementRefs.current[key]) {
            elementRefs.current[key] = { current: null };
        }
    });

    useEffect(() => {
        if (containerRef.current) {
            const containerWidth = containerRef.current.offsetWidth - 80;
            const containerHeight = containerRef.current.offsetHeight - 80;
            const scaleX = containerWidth / canvasSize.width;
            const scaleY = containerHeight / canvasSize.height;
            const scale = Math.min(scaleX, scaleY, 1);
            setViewportScale(parseFloat(scale.toFixed(2)));
        }
    }, [canvasSize, selectedFormat]);

    useEffect(() => {
        setLoading(true);
        getEvent(id)
            .then(r => {
                const evt = r.data;
                setEvent(evt);
                // Admins can always override the event branding lock.
                setIsLocked(!!evt.is_branding_locked && user?.role !== 'admin');

                // Apply event font family as default (but keep text color white — branding colors may be dark)
                if (evt.font_family) {
                    setElements(prev => ({
                        ...prev,
                        name: { ...prev.name, fontFamily: evt.font_family },
                        designation: { ...prev.designation, fontFamily: evt.font_family },
                        company: { ...prev.company, fontFamily: evt.font_family }
                    }));
                }

                // Fallback Background
                if (evt.sns_card_bg_url) {
                    setBackground(getImageUrl(evt.sns_card_bg_url));
                }

                // Seed the placeholder photo with this event's first speaker so
                // the editor renders a realistic preview out of the box — no
                // need for the operator to upload a stand-in image. Falls back
                // to the empty placeholder if the event has no speakers yet,
                // or the API call fails.
                getSpeakers(id)
                    .then(sr => {
                        const list = Array.isArray(sr.data) ? sr.data : [];
                        const first = list.find(s => s.photo_url) || list[0];
                        if (first?.photo_url) setImage(getImageUrl(first.photo_url));
                    })
                    .catch(() => { /* leave placeholder empty */ });

                // Restore Template if exists, otherwise use default 1080x1080 format.
                // Each card type reads from its own column so layouts stay independent.
                const savedTemplate = isAttending ? evt.attending_card_template : evt.sns_card_template;
                if (savedTemplate) {
                    try {
                        const design = typeof savedTemplate === 'string' ? JSON.parse(savedTemplate) : savedTemplate;
                        if (design.elements) {
                            setElements(prev => {
                                const next = { ...prev };
                                Object.keys(design.elements).forEach(k => {
                                    if (next[k]) next[k] = { ...next[k], ...design.elements[k] };
                                    else next[k] = design.elements[k];
                                });
                                return next;
                            });
                        }
                        if (design.positions) setPositions(prev => ({ ...prev, ...design.positions }));
                        if (design.photoSettings) setPhotoSettings(design.photoSettings);
                        if (design.canvasSize) {
                            setCanvasSize(design.canvasSize);
                        }
                        if (design.bgOverlay) setBgOverlay(design.bgOverlay);
                        if (design.bgPosition) setBgPosition(design.bgPosition);
                        // Enhanced Fallback: If template has no background, use event branding background
                        if (design.background) setBackground(design.background);
                        else if (evt.sns_card_bg_url) setBackground(getImageUrl(evt.sns_card_bg_url));

                        // Always open with both logo toggles off — sizes and any
                        // other saved fields restore as normal, but visibility
                        // resets each session so the operator opts in explicitly.
                        if (design.logoSettings) setLogoSettings({ ...design.logoSettings, showEvent: false, showCompany: false });
                        setSelectedFormat('restored');
                    } catch (e) { console.error("Template restore failed", e); }
                }
            })
            .catch(err => setError(err.message))
            .finally(() => setLoading(false));
    }, [id]);

    // Shared builder so Save and Save+Apply send the exact same payload.
    const buildTemplatePayload = () => ({
        elements,
        positions,
        photoSettings,
        canvasSize,
        bgOverlay,
        bgPosition,
        // Don't persist blob: URLs — they expire with the session; SNSGenerator falls back to sns_card_bg_url
        background: background && !background.startsWith('blob:') ? background : null,
        logoSettings
    });

    const handleSaveTemplate = async () => {
        if (bgUploading) {
            alert('Background is still uploading. Please wait a moment then click Save again.');
            return;
        }
        // Catch the blob: URL case explicitly — if it's still blob: at save
        // time the upload failed silently (network blip, file too big, etc).
        if (background && background.startsWith('blob:')) {
            const ok = window.confirm('The background image did not finish uploading. Save the template without a background? Click Cancel to retry the upload first.');
            if (!ok) return;
        }
        setSaving(true);
        try {
            const saveFn = isAttending ? updateEventAttendingTemplate : updateEventTemplate;
            await saveFn(id, buildTemplatePayload());
            alert(isAttending
                ? 'I-am-attending master template saved! This layout will now seed every attending card in this event.'
                : 'Master Layout Template saved successfully! This will now be the default for all speaker cards in this event.');
            navigate('/speakers');
        } catch (err) {
            alert('Failed to save template: ' + err.message);
        } finally {
            setSaving(false);
        }
    };

    // Save the template and immediately push it onto every existing speaker's
    // per-card design column. Without this, a freshly saved template only
    // applies to *new* generations — existing speakers keep their old layout
    // until each one is re-opened in the generator.
    const [applying, setApplying] = useState(false);
    const handleSaveAndApply = async () => {
        if (bgUploading) {
            alert('Background is still uploading. Please wait a moment then try again.');
            return;
        }
        if (background && background.startsWith('blob:')) {
            const ok = window.confirm('The background image did not finish uploading. Apply the template without a background? Click Cancel to retry the upload first.');
            if (!ok) return;
        }
        const kind = isAttending ? 'attending' : 'speaker-announcement';
        if (!window.confirm(`Save this master template and push it onto every existing speaker's ${kind} card in this event? Any per-card customisations they made will be overwritten.`)) return;
        setApplying(true);
        try {
            const saveFn  = isAttending ? updateEventAttendingTemplate : updateEventTemplate;
            const applyFn = isAttending ? bulkApplyAttendingTemplate    : bulkApplySNSTemplate;
            await saveFn(id, buildTemplatePayload());
            const { data } = await applyFn(id);
            alert(`Template applied to ${data?.affected ?? 0} of ${data?.total ?? 0} speakers in this event.`);
            navigate('/speakers');
        } catch (err) {
            alert('Failed to apply template: ' + (err?.response?.data?.error || err.message));
        } finally {
            setApplying(false);
        }
    };

    // Group-move: when on, dragging any visible text element shifts every
    // other visible text element by the same delta so the relative layout is
    // preserved. When off, only the element being dragged moves.
    const handleTextDrag = (key, data) => {
        if (!groupMove) {
            setPositions(prev => ({ ...prev, [key]: { x: data.x / canvasSize.width, y: data.y / canvasSize.height } }));
            return;
        }
        const dxPct = data.deltaX / canvasSize.width;
        const dyPct = data.deltaY / canvasSize.height;
        setPositions(prev => {
            const next = { ...prev };
            Object.keys(elements).forEach(k => {
                if (elements[k]?.show && next[k]) {
                    next[k] = { ...next[k], x: next[k].x + dxPct, y: next[k].y + dyPct };
                }
            });
            return next;
        });
    };

    // Align every visible text element to the same x column as the first
    // visible element. y positions are left untouched.
    const arrangeTextOnSingleLine = () => {
        const visibleKeys = Object.keys(elements).filter(k =>
            elements[k]?.show && elements[k]?.text && positions[k]
        );
        if (visibleKeys.length === 0) return;

        const sharedX = positions[visibleKeys[0]]?.x ?? 0.25;

        setPositions(prev => {
            const next = { ...prev };
            visibleKeys.forEach(k => {
                next[k] = { ...prev[k], x: sharedX };
            });
            return next;
        });
    };

    // Stack visible text elements vertically with the spacing value as the
    // gap *between* lines (after each element's actual rendered height).
    const evenlySpaceTextElements = () => {
        const visibleKeys = Object.keys(elements).filter(k =>
            elements[k]?.show && positions[k]
        );
        if (visibleKeys.length < 2) {
            console.warn('[Apply spacing] need at least 2 visible text elements');
            return;
        }

        const parsed = Number(spacingPct);
        const gap = (Number.isFinite(parsed) && parsed >= 0 ? parsed : 7) / 100;

        const sortedByY = [...visibleKeys].sort(
            (a, b) => (positions[a]?.y ?? 0) - (positions[b]?.y ?? 0)
        );

        let cursor = positions[sortedByY[0]].y;
        const updates = {};
        sortedByY.forEach(k => {
            updates[k] = { ...positions[k], y: cursor };
            const node = (elementRefs.current[k]?.current) || (dragRefs[k]?.current);
            const heightPct = node && node.offsetHeight > 0
                ? node.offsetHeight / canvasSize.height
                : 0.04;
            cursor += heightPct + gap;
        });

        console.log('[Apply spacing]', { sortedByY, gap, updates });
        setPositions(prev => ({ ...prev, ...updates }));
    };

    const swapDimensions = () => {
        setCustomSize(prev => ({ ...prev, width: prev.height, height: prev.width }));
    };

    const handleCreate = () => {
        const { width, height } = customSize;
        setCanvasSize({ width, height });
        setBackgroundDimensions({ width, height });
        
        // Initial scaling
        const scaleFactor = Math.min(width, height) / 800;
        setPhotoSettings(prev => ({ ...prev, size: Math.round(400 * scaleFactor) }));
        setElements(prev => ({
            name: { ...prev.name, fontSize: Math.round(40 * scaleFactor) },
            designation: { ...prev.designation, fontSize: Math.round(20 * scaleFactor) },
            company: { ...prev.company, fontSize: Math.round(18 * scaleFactor) }
        }));
        
        setSelectedFormat('custom');
    };

    const handleCrop = () => {
        if (cropper && typeof cropper.getCroppedCanvas === 'function') {
            setCroppedImage(cropper.getCroppedCanvas().toDataURL());
        }
    };

    // Background images must be uploaded to the server so the saved
    // template payload can persist a real URL. The save handler strips
    // `blob:` URLs (they're session-scoped and meaningless after reload),
    // so we upload immediately on file pick and store the returned
    // `/uploads/...` URL instead.
    const [bgUploading, setBgUploading] = useState(false);
    const handleBgUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        // Show the local preview straight away so the editor feels snappy;
        // we'll replace it with the persisted URL once the upload returns.
        setBackground(URL.createObjectURL(file));
        setBgUploading(true);
        try {
            const { data } = await uploadImage(file);
            if (data?.url) setBackground(data.url);
        } catch (err) {
            alert('Background upload failed: ' + (err.response?.data?.error || err.message));
        } finally {
            setBgUploading(false);
        }
    };

    const handlePhotoUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            setImage(URL.createObjectURL(file));
            setCroppedImage(null);
        }
    };

    if (loading) return <div className="p-5 text-center"><Spinner animation="border" variant="light" /></div>;
    if (error) return <div className="p-5 text-center text-danger">{error}</div>;

    if (!selectedFormat) {
        return (
            <div className="ps-workspace animate-in">
                <div className="ps-header">
                    <div className="ps-tabs">
                        <div className="ps-tab active">{isAttending ? 'I-am-Attending Master Template' : 'Master Template Setup'}</div>
                    </div>
                    <button className="ps-close-btn" onClick={() => navigate('/events')}>&times;</button>
                </div>
                <div className="ps-main-body">
                    <div className="ps-content-area">
                        <h6 className="ps-section-label">CHOOSE BASE FORMAT FOR MASTER TEMPLATE</h6>
                        <div className="ps-scroll-container">
                            {Object.entries(formatPresets).map(([category, items]) => (
                                <div key={category} className="ps-category-row">
                                    <h6 className="ps-category-name">{category}</h6>
                                    <div className="ps-presets-grid">
                                        {items.map(preset => (
                                            <div 
                                                key={preset.id} 
                                                className={`ps-preset-tile ${customSize.width === preset.width && customSize.height === preset.height ? 'active' : ''}`}
                                                onClick={() => setCustomSize({ ...customSize, width: preset.width, height: preset.height, background: 'White' })}
                                            >
                                                <div className="ps-thumb-outer">
                                                    <div className="ps-thumb-inner" style={{ aspectRatio: preset.width / preset.height }}></div>
                                                </div>
                                                <div className="ps-tile-info">
                                                    <span className="ps-tile-name">{preset.name}</span>
                                                    <span className="ps-tile-dims">{preset.width} x {preset.height} px</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="ps-config-sidebar">
                        <h6 className="ps-sidebar-title">PRESET DETAILS</h6>
                        
                        <div className="ps-field-row mb-3">
                            <div className="ps-field flex-grow-1">
                                <label>Width</label>
                                <input 
                                    type="number" 
                                    value={customSize.width} 
                                    onChange={e => setCustomSize({...customSize, width: parseInt(e.target.value)})}
                                />
                            </div>
                            <div className="ps-field flex-grow-1">
                                <div className="d-flex align-items-center justify-content-between">
                                    <label>Height</label>
                                    <button className="ps-dim-swap" onClick={swapDimensions}>⇆</button>
                                </div>
                                <input 
                                    type="number" 
                                    value={customSize.height} 
                                    onChange={e => setCustomSize({...customSize, height: parseInt(e.target.value)})}
                                />
                            </div>
                            <div className="ps-field" style={{ width: '70px' }}>
                                <label>&nbsp;</label>
                                <div className="ps-fake-unit">Pixels</div>
                            </div>
                        </div>

                        <div className="ps-field-row mb-3">
                            <div className="ps-field flex-grow-1">
                                <label>Orientation</label>
                                <div className="ps-orient-group">
                                    <div className={`ps-orient-choice ${customSize.width < customSize.height ? 'active' : ''}`} onClick={() => customSize.width > customSize.height && swapDimensions()}>
                                        <div className="ps-icon-rect portrait"></div>
                                    </div>
                                    <div className={`ps-orient-choice ${customSize.width > customSize.height ? 'active' : ''}`} onClick={() => customSize.width < customSize.height && swapDimensions()}>
                                        <div className="ps-icon-rect landscape"></div>
                                    </div>
                                </div>
                            </div>
                            <div className="ps-field d-flex align-items-end pb-1" style={{ width: '130px' }}>
                                <label className="ps-checkbox-label">
                                    <input type="checkbox" /> Artboards
                                </label>
                            </div>
                        </div>

                        <div className="ps-field-row mb-3">
                            <div className="ps-field flex-grow-1">
                                <label>Resolution</label>
                                <input type="number" defaultValue="72" />
                            </div>
                            <div className="ps-field" style={{ width: '120px' }}>
                                <label>&nbsp;</label>
                                <select>
                                    <option>Pixels / Inch</option>
                                </select>
                            </div>
                        </div>

                        <div className="ps-field mb-3">
                            <label>Color Mode</label>
                            <div className="d-flex gap-2">
                                <select className="flex-grow-1">
                                    <option>RGB Color</option>
                                </select>
                                <select style={{ width: '80px' }}>
                                    <option>8 bit</option>
                                </select>
                            </div>
                        </div>

                        <div className="ps-field mb-3">
                            <label>Background Contents</label>
                            <div className="d-flex gap-2">
                                <select className="flex-grow-1" value={customSize.background} onChange={e => setCustomSize({...customSize, background: e.target.value})}>
                                    <option>White</option>
                                    <option>Black</option>
                                    <option>Transparent</option>
                                </select>
                                <div className="ps-color-swatch" style={{ background: (customSize.background || 'White').toLowerCase() }}></div>
                            </div>
                        </div>

                        <div className="ps-field mb-4">
                            <label>Color Profile</label>
                            <select>
                                <option>sRGB IEC61966-2.1</option>
                            </select>
                        </div>

                        <button className="ps-create-btn" onClick={handleCreate}>Create</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="container-fluid py-4 animate-in" style={{ height: '100vh', overflow: 'hidden' }}>
            <div className="d-flex align-items-center mb-3">
                <Button variant="link" className="p-0 text-decoration-none text-muted me-3" onClick={() => navigate('/speakers')}>
                    <BsArrowLeft size={20} />
                </Button>
                <h4 className="m-0" style={{ color: 'var(--text-primary)' }}>Master SNS Designer <span className="badge bg-accent ms-2" style={{ fontSize: '0.6rem', color: 'black' }}>EVENT TEMPLATE</span></h4>
            </div>

            <div className="row g-4" style={{ height: 'calc(100vh - 100px)' }}>
                {/* Left Sidebar */}
                <div className="col-lg-4 h-100">
                    <div className="premium-card p-0 h-100 overflow-hidden d-flex flex-column" style={{ background: 'var(--bg-card)' }}>
                        <div className="p-3 overflow-auto flex-grow-1">
                            <Accordion defaultActiveKey="0" flush className="premium-accordion">
                                {/* Image & Background */}
                                <Accordion.Item eventKey="0" className="bg-transparent border-0 mb-2">
                                    <Accordion.Header>Image & Background</Accordion.Header>
                                    <Accordion.Body>
                                        <div className="mb-3">
                                            <label className="form-label small muted-label">Placeholder Photo Crop</label>
                                            <div style={{ height: 200, background: '#000', borderRadius: 8, overflow: 'hidden' }}>
                                                {image
                                                    ? <Cropper style={{ height: '100%', width: '100%' }} initialAspectRatio={1} src={image} viewMode={1} guides={true} background={false} autoCropArea={1} onInitialized={setCropper} />
                                                    : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: '0.75rem' }}>Upload a photo below to preview</div>
                                                }
                                            </div>
                                            <Button size="sm" className="mt-2 w-100 btn-secondary-glass" onClick={handleCrop}>Update Crop</Button>
                                        </div>

                                        <div className="mb-3">
                                            <label className="form-label small muted-label">Upload Placeholder Photo</label>
                                            <Form.Control type="file" size="sm" className="form-control-dark" onChange={handlePhotoUpload} accept="image/*" />
                                        </div>

                                        <div className="mb-3">
                                            <label className="form-label small muted-label">Canvas Format</label>
                                            <Button variant="outline-accent" size="sm" className="w-100" onClick={() => setSelectedFormat(null)}>Change Format</Button>
                                        </div>

                                        <div className="mb-3">
                                            <label className="form-label small muted-label">Upload Template Background</label>
                                            <Form.Control type="file" size="sm" className="form-control-dark" onChange={handleBgUpload} accept="image/*" />
                                            {event?.sns_card_bg_url && (
                                                <Button size="sm" variant="link" className="p-0 mt-1 small text-accent text-decoration-none" onClick={() => setBackground(getImageUrl(event.sns_card_bg_url))}>
                                                    Use Event Branding Background
                                                </Button>
                                            )}
                                        </div>

                                        {background && (
                                            <div className="mb-3">
                                                <label className="form-label small muted-label">BG Image Position</label>
                                                <Form.Select size="sm" className="form-select-dark" value={bgPosition} onChange={e => setBgPosition(e.target.value)}>
                                                    <option value="center">Center</option>
                                                    <option value="top">Top</option>
                                                    <option value="bottom">Bottom</option>
                                                    <option value="left">Left</option>
                                                    <option value="right">Right</option>
                                                </Form.Select>
                                            </div>
                                        )}

                                        <div className="mb-3">
                                            <label className="form-label small d-block muted-label">Photo Size</label>
                                            <Form.Range min={100} max={800} value={photoSettings.size} onChange={e => setPhotoSettings(prev => ({ ...prev, size: parseInt(e.target.value) }))} />
                                            <div className="small text-end">{photoSettings.size}px</div>
                                        </div>

                                        <div className="mb-3 pt-3 border-top border-secondary">
                                            <label className="form-label small d-block muted-label">Background Overlay</label>
                                            <div className="d-flex align-items-center gap-3">
                                                <Form.Control type="color" className="form-control form-control-color" value={bgOverlay.color} onChange={e => setBgOverlay(prev => ({ ...prev, color: e.target.value }))} style={{ width: 40, border: '1px solid #3d3d5c' }} />
                                                <div className="flex-grow-1">
                                                    <Form.Range min={0} max={1} step={0.1} value={bgOverlay.opacity} onChange={e => setBgOverlay(prev => ({ ...prev, opacity: parseFloat(e.target.value) }))} />
                                                </div>
                                                <div className="small">{Math.round(bgOverlay.opacity * 100)}%</div>
                                            </div>
                                        </div>
                                    </Accordion.Body>
                                </Accordion.Item>

                                {/* Text Elements */}
                                {Object.entries(elements).map(([key, el], idx) => (
                                    <Accordion.Item eventKey={String(idx + 1)} key={key} className="bg-transparent border-0 mb-2">
                                        <Accordion.Header>
                                            <div className="d-flex align-items-center justify-content-between w-100 me-3">
                                                <span className="text-capitalize">{el.isCustom ? (el.text || 'Custom').substring(0, 18) : key}</span>
                                                {el.isCustom && (
                                                    <Button
                                                        variant="link"
                                                        size="sm"
                                                        className="p-0 text-danger text-decoration-none small"
                                                        onClick={(e) => { e.stopPropagation(); removeElement(key); }}
                                                    >Remove</Button>
                                                )}
                                            </div>
                                        </Accordion.Header>
                                        <Accordion.Body>
                                            <div className="d-flex justify-content-between align-items-center mb-2">
                                                <span className="small">Show element</span>
                                                <Form.Check type="switch" checked={el.show} onChange={e => updateElement(key, 'show', e.target.checked)} />
                                            </div>
                                            {el.isCustom && (
                                                <Form.Group className="mb-2">
                                                    <label className="small muted-label">Text</label>
                                                    <Form.Control
                                                        as="textarea"
                                                        rows={2}
                                                        size="sm"
                                                        className="form-control-dark"
                                                        value={el.text}
                                                        onChange={e => updateElement(key, 'text', e.target.value)}
                                                        placeholder="Enter text... (Enter for new line)"
                                                        style={{ resize: 'none', lineHeight: 1.4 }}
                                                        onKeyDown={e => e.key === 'Enter' && e.stopPropagation()}
                                                    />
                                                </Form.Group>
                                            )}
                                            <div className="row g-2">
                                                <div className="col-6">
                                                    <label className="small muted-label">Color</label>
                                                    <Form.Control type="color" className="form-control form-control-color w-100" value={el.color} onChange={e => updateElement(key, 'color', e.target.value)} style={{ border: '1px solid #3d3d5c' }} />
                                                </div>
                                                <div className="col-6">
                                                    <label className="small muted-label">Size (px)</label>
                                                    <Form.Control type="number" size="sm" className="form-control-dark" value={el.fontSize} onChange={e => updateElement(key, 'fontSize', parseInt(e.target.value))} />
                                                </div>
                                                <div className="col-6 mt-2">
                                                    <label className="small muted-label">Weight</label>
                                                    <Form.Select size="sm" className="form-select-dark" value={el.fontWeight} onChange={e => updateElement(key, 'fontWeight', e.target.value)}>
                                                        <option value="300">Light</option>
                                                        <option value="400">Normal</option>
                                                        <option value="500">Medium</option>
                                                        <option value="600">SemiBold</option>
                                                        <option value="700">Bold</option>
                                                        <option value="800">ExtraBold</option>
                                                    </Form.Select>
                                                </div>
                                                <div className="col-6 mt-2">
                                                    <label className="small muted-label">Spacing</label>
                                                    <Form.Control type="number" size="sm" className="form-control-dark" value={el.letterSpacing || 0} onChange={e => updateElement(key, 'letterSpacing', parseFloat(e.target.value))} />
                                                </div>
                                                <div className="col-12 mt-2">
                                                    <label className="small muted-label">Font</label>
                                                    <Form.Select size="sm" className="form-select-dark" value={el.fontFamily} onChange={e => updateElement(key, 'fontFamily', e.target.value)}>
                                                        <option value="Inter">Inter</option>
                                                        <option value="Montserrat">Montserrat</option>
                                                        <option value="Poppins">Poppins</option>
                                                        <option value="Roboto">Roboto</option>
                                                        <option value="Playfair Display">Playfair (Serif)</option>
                                                        <option value="Lora">Lora (Serif)</option>
                                                    </Form.Select>
                                                </div>
                                            </div>
                                        </Accordion.Body>
                                    </Accordion.Item>
                                ))}

                                {/* Add Custom Text — same dashed-outline CTA style as the per-
                                    speaker generator so the affordance is familiar. */}
                                <Button variant="outline-accent" size="sm" className="w-100 mt-2 py-2 border-dashed" onClick={addCustomElement}>
                                    + Add Custom Text
                                </Button>

                                {/* Logos */}
                                <Accordion.Item eventKey="4" className="bg-transparent border-0 mb-2">
                                    <Accordion.Header>Logos</Accordion.Header>
                                    <Accordion.Body>
                                        <Form.Check label="Show Event Logo" checked={logoSettings.showEvent} onChange={e => setLogoSettings({ ...logoSettings, showEvent: e.target.checked })} className="small mb-2" />
                                        <Form.Range min="20" max="300" value={logoSettings.eventSize} onChange={e => setLogoSettings({ ...logoSettings, eventSize: parseInt(e.target.value) })} />
                                        <Form.Check label="Show Company Logo" checked={logoSettings.showCompany} onChange={e => setLogoSettings({ ...logoSettings, showCompany: e.target.checked })} className="small mt-3 mb-2" />
                                        <Form.Range min="20" max="300" value={logoSettings.companySize} onChange={e => setLogoSettings({ ...logoSettings, companySize: parseInt(e.target.value) })} />
                                    </Accordion.Body>
                                </Accordion.Item>

                                {/* Alignment, custom spacing, and group-move toggle for all visible text. */}
                                <Accordion.Item eventKey="5" className="bg-transparent border-0 mb-2">
                                    <Accordion.Header>Alignment</Accordion.Header>
                                    <Accordion.Body>
                                        <Button variant="outline-light" size="sm" className="w-100 mb-2" onClick={arrangeTextOnSingleLine} title="Align all text to the same column as the first element">
                                            <BsTextLeft className="me-2" /> Align text to one column
                                        </Button>
                                        <div className="d-flex align-items-center gap-2 mb-2">
                                            <BsDistributeVertical />
                                            <span className="small">Space</span>
                                            <Form.Control
                                                type="number"
                                                size="sm"
                                                min="0"
                                                max="50"
                                                step="0.5"
                                                style={{ width: 70 }}
                                                value={spacingPct}
                                                onChange={e => setSpacingPct(e.target.value)}
                                                title="Vertical gap between text elements as a % of canvas height"
                                            />
                                            <span className="small">%</span>
                                            <Button
                                                variant="outline-light"
                                                size="sm"
                                                className="flex-grow-1"
                                                onClick={evenlySpaceTextElements}
                                                title="Stack all text vertically with this spacing"
                                            >
                                                Apply
                                            </Button>
                                        </div>
                                        <Button
                                            variant={groupMove ? 'accent' : 'outline-light'}
                                            size="sm"
                                            className="w-100"
                                            onClick={() => setGroupMove(g => !g)}
                                            title="When ON, dragging any text element moves all of them together"
                                        >
                                            <BsArrowsMove className="me-2" /> Move all together: {groupMove ? 'ON' : 'OFF'}
                                        </Button>
                                    </Accordion.Body>
                                </Accordion.Item>
                            </Accordion>
                        </div>

                        {/* Bottom Action Bar */}
                        <div className="p-3 border-top border-secondary d-flex flex-column gap-2 bg-dark mt-auto">
                            <Button className="btn-accent w-100 py-2" onClick={handleSaveTemplate} disabled={saving || applying}>
                                {saving ? <Spinner size="sm" animation="border" className="me-2" /> : <BsLayoutTextWindow className="me-2" />}
                                {saving ? 'Saving...' : 'Save Master Layout'}
                            </Button>
                            {/* Saves AND retroactively rewrites every existing
                                speaker's card design so this template takes
                                effect for them too — not just newly generated
                                cards. */}
                            <Button variant="outline-light" className="w-100 py-2" onClick={handleSaveAndApply} disabled={saving || applying} title="Save and push this layout onto every existing speaker in this event">
                                {applying ? <Spinner size="sm" animation="border" className="me-2" /> : <BsLightningChargeFill className="me-2" />}
                                {applying ? 'Applying to all speakers…' : 'Save & Apply to All Speakers'}
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Canvas Area */}
                <div className="col-lg-8 h-100">
                    <div ref={containerRef} className="bg-darker rounded-4 border border-secondary p-4 h-100 d-flex align-items-center justify-content-center overflow-auto">
                        <div style={{ width: canvasSize.width * viewportScale, height: canvasSize.height * viewportScale, position: 'relative' }}>
                            <div ref={cardRef} className="sns-card-canvas" style={{ width: canvasSize.width, height: canvasSize.height, position: 'absolute', top: 0, left: 0, transform: `scale(${viewportScale})`, transformOrigin: 'top left', overflow: 'hidden', background: '#1a1a2e' }}>
                                {/* Background */}
                                {background && <img src={background} style={{ width: '100%', height: '100%', objectFit: bgPosition === 'fill' ? 'fill' : 'cover', position: 'absolute', top: 0, left: 0 }} alt="" />}

                                {/* Overlay */}
                                <div style={{ position: 'absolute', inset: 0, backgroundColor: bgOverlay.color, opacity: bgOverlay.opacity }} />

                                {/* Logos */}
                                {logoSettings.showEvent && event?.event_logo_url && positions.eventLogo && (
                                    <Draggable nodeRef={dragRefs.eventLogo} bounds="parent" position={{ x: (positions.eventLogo?.x ?? 0.8) * canvasSize.width, y: (positions.eventLogo?.y ?? 0.05) * canvasSize.height }} onStop={(e, d) => setPositions({ ...positions, eventLogo: { x: d.x / canvasSize.width, y: d.y / canvasSize.height } })}>
                                        <div ref={dragRefs.eventLogo} style={{ position: 'absolute', width: logoSettings.eventSize, cursor: 'move', zIndex: 10 }}>
                                            <img src={getImageUrl(event.event_logo_url)} style={{ width: '100%' }} alt="Event Logo" />
                                        </div>
                                    </Draggable>
                                )}
                                {logoSettings.showCompany && event?.company_logo_url && positions.companyLogo && (
                                    <Draggable nodeRef={dragRefs.companyLogo} bounds="parent" position={{ x: (positions.companyLogo?.x ?? 0.05) * canvasSize.width, y: (positions.companyLogo?.y ?? 0.05) * canvasSize.height }} onStop={(e, d) => setPositions({ ...positions, companyLogo: { x: d.x / canvasSize.width, y: d.y / canvasSize.height } })}>
                                        <div ref={dragRefs.companyLogo} style={{ position: 'absolute', width: logoSettings.companySize, cursor: 'move', zIndex: 10 }}>
                                            <img src={getImageUrl(event.company_logo_url)} style={{ width: '100%' }} alt="Company Logo" />
                                        </div>
                                    </Draggable>
                                )}

                                {/* Speaker Photo — actual crop when uploaded, subtle dashed box when empty.
                                    Falls back to the raw uploaded image if the user hasn't clicked Update Crop yet,
                                    so the photo appears in the preview immediately on upload. */}
                                <Draggable nodeRef={dragRefs.photo} bounds="parent" position={{ x: (positions.photo?.x ?? 0.34) * canvasSize.width, y: (positions.photo?.y ?? 0.125) * canvasSize.height }} onStop={(e, d) => setPositions({ ...positions, photo: { x: d.x / canvasSize.width, y: d.y / canvasSize.height } })}>
                                    <div ref={dragRefs.photo} style={{ position: 'absolute', width: photoSettings.size, cursor: 'move' }}>
                                        {(croppedImage || image) ? (
                                            <img src={croppedImage || image} style={{ width: '100%', height: 'auto', display: 'block' }} alt="" />
                                        ) : (
                                            <div style={{
                                                width: '100%', aspectRatio: '4 / 5',
                                                border: '2px dashed rgba(148,163,184,0.45)',
                                                borderRadius: 12, background: 'rgba(148,163,184,0.08)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                color: 'rgba(148,163,184,0.7)', fontSize: 14, fontWeight: 500
                                            }}>
                                                Placeholder photo
                                            </div>
                                        )}
                                    </div>
                                </Draggable>

                                {/* Text Elements */}
                                {Object.entries(elements).map(([key, el]) => el.show && positions[key] && (
                                    <Draggable key={key} nodeRef={elementRefs.current[key] || dragRefs[key]} bounds="parent" position={{ x: (positions[key]?.x ?? 0.25) * canvasSize.width, y: (positions[key]?.y ?? 0.5) * canvasSize.height }} onDrag={(e, d) => handleTextDrag(key, d)}>
                                        <div ref={elementRefs.current[key] || dragRefs[key]} style={{ position: 'absolute', color: el.color, fontSize: el.fontSize, fontFamily: el.fontFamily, fontWeight: el.fontWeight, letterSpacing: `${el.letterSpacing || 0}px`, cursor: 'move', zIndex: 20, whiteSpace: 'pre-wrap' }}>
                                            {el.text}
                                        </div>
                                    </Draggable>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
