import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Cropper from 'react-cropper';
import 'cropperjs/dist/cropper.css';
import { Button, Form, Spinner, Accordion } from 'react-bootstrap';
import { toPng } from 'html-to-image';
import {
    BsDownload, BsArrowLeft, BsArrowsMove, BsTextLeft, BsDistributeVertical,
    BsShieldLock, BsLayoutTextWindow, BsWhatsapp
} from 'react-icons/bs';
import { getSpeaker, saveSNSCard, getEvent, updateEventTemplate } from '../services/api';
import Draggable from 'react-draggable';
import { getImageUrl } from '../utils/imageUrl';
import { shareSnsToWhatsApp } from '../utils/shareSns';

const selectionStyles = `
    .ps-workspace { height: 100vh; background: #3c3c3c; display: flex; flex-direction: column; color: #ddd; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; }
    .ps-header { background: #323232; height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; border-bottom: 1px solid #282828; flex-shrink: 0; }
    .ps-tabs { display: flex; gap: 24px; height: 100%; }
    .ps-tab { display: flex; align-items: center; font-size: 11px; color: #888; cursor: pointer; border-bottom: 2px solid transparent; text-transform: uppercase; letter-spacing: 0.5px; }
    .ps-tab.active { color: #fff; border-bottom-color: #0084ff; }
    .ps-close-btn { background: none; border: 1px solid rgba(255,255,255,0.18); color: #fff; font-size: 24px; cursor: pointer; display: inline-flex; align-items: center; padding: 6px 10px; border-radius: 6px; transition: background 0.15s, border-color 0.15s; }
    .ps-close-btn svg { color: #fff !important; }
    .ps-close-btn:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.35); }

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

    .ps-create-btn { background: #555; color: #fff; border: 1px solid #222; height: 32px; width: 100%; font-size: 11px; font-weight: 600; cursor: pointer; margin-top: auto; border-radius: 16px; }
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

export default function SNSGeneratorPage() {
    return (
        <>
            <style>{selectionStyles}</style>
            <SNSGeneratorInternal />
        </>
    );
}

function SNSGeneratorInternal() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const canManageEvent = isAdmin || user?.role === 'manager';
    
    const [speaker, setSpeaker] = useState(null);
    const [image, setImage] = useState(null);
    const [cropper, setCropper] = useState();
    const [croppedImage, setCroppedImage] = useState(null);
    const [background, setBackground] = useState(null);
    const [backgroundDimensions, setBackgroundDimensions] = useState({ width: 800, height: 800 });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const cardRef = useRef(null);
    const photoRef = useRef(null);
    const elementRefs = useRef({});
    const [photoSettings, setPhotoSettings] = useState({ size: 400 });
    const [canvasSize, setCanvasSize] = useState({ width: 800, height: 800 });
    const [viewportScale, setViewportScale] = useState(1);
    const containerRef = useRef(null);
    const eventLogoRef = useRef(null);
    const companyLogoRef = useRef(null);
    const [logoSettings, setLogoSettings] = useState({ eventSize: 100, companySize: 100, showEvent: true, showCompany: true });
    const [bgOverlay, setBgOverlay] = useState({ color: '#000000', opacity: 0 });
    const [bgPosition, setBgPosition] = useState('center');
    const [selectedFormat, setSelectedFormat] = useState(null);
    const [customSize, setCustomSize] = useState({ width: 1080, height: 1080, background: 'White' });
    const [event, setEvent] = useState(null);
    const [isLocked, setIsLocked] = useState(false);
    const [groupMove, setGroupMove] = useState(false);
    const [spacingPct, setSpacingPct] = useState(2);
    // After a successful save we get back a server path (e.g. /uploads/...).
    // Sharing needs an absolute URL, so we hold on to whatever Save returned
    // (preferred — it's the freshly-rendered version) and fall back to the
    // speaker's stored sns_card_url for cards saved earlier.
    const [savedSnsUrl, setSavedSnsUrl] = useState(null);

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

    // Default positions as percentages of canvas size
    const [positions, setPositions] = useState({
        photo: { x: 0.34, y: 0.125 },
        name: { x: 0.25, y: 0.5 },
        designation: { x: 0.25, y: 0.575 },
        company: { x: 0.25, y: 0.65 },
        eventLogo: { x: 0.8, y: 0.05 },
        companyLogo: { x: 0.05, y: 0.05 }
    });

    // Auto-scale canvas to fit container
    useEffect(() => {
        if (containerRef.current) {
            const containerWidth = containerRef.current.offsetWidth - 80;
            const containerHeight = containerRef.current.offsetHeight - 80;
            const scaleX = containerWidth / canvasSize.width;
            const scaleY = containerHeight / canvasSize.height;
            const scale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down
            setViewportScale(parseFloat(scale.toFixed(2)));
        }
    }, [canvasSize]);

    // Pick a readable color — returns the input if it has decent luminance, else fallback
    const readableColor = (color, fallback = '#ffffff') => {
        if (!color) return fallback;
        const hex = color.replace('#', '');
        if (hex.length !== 3 && hex.length !== 6) return fallback;
        const full = hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex;
        const r = parseInt(full.slice(0, 2), 16);
        const g = parseInt(full.slice(2, 4), 16);
        const b = parseInt(full.slice(4, 6), 16);
        // Relative luminance (sRGB); dark colors < 0.45 flipped to white
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return lum < 0.45 ? fallback : color;
    };

    // Element States
    const [elements, setElements] = useState({
        name: { text: '', color: '#ffffff', fontSize: 40, fontFamily: 'Inter', fontWeight: '800', textDecoration: 'none', letterSpacing: 0, lineHeight: 1.2, show: true },
        designation: { text: '', color: '#ffffff', fontSize: 20, fontFamily: 'Inter', fontWeight: '500', textDecoration: 'none', letterSpacing: 0, lineHeight: 1.3, show: true },
        company: { text: '', color: '#ffffff', fontSize: 18, fontFamily: 'Inter', fontWeight: '500', textDecoration: 'none', letterSpacing: 0, lineHeight: 1.3, show: true },
    });

    // Ensure ref exists for each element
    Object.keys(elements).forEach(key => {
        if (!elementRefs.current[key]) {
            elementRefs.current[key] = { current: null };
        }
    });

    useEffect(() => {
        setLoading(true);
        getSpeaker(id)
            .then(async r => {
                const s = r.data;
                if (s) {
                    setSpeaker(s);
                    if (s.sns_card_url) setSavedSnsUrl(s.sns_card_url);
                    // Fetch Event Branding
                    try {
                        const evtRes = await getEvent(s.event_id);
                        const evt = evtRes.data;
                        setEvent(evt);
                        // Admins can always override the event branding lock.
                        const locked = !!evt.is_branding_locked && user?.role !== 'admin';
                        setIsLocked(locked);

                        setElements(prev => ({
                            ...prev,
                            name: {
                                ...prev.name,
                                text: s.name || '',
                                color: locked && evt.primary_color ? readableColor(evt.primary_color) : prev.name.color,
                                fontFamily: locked && evt.font_family ? evt.font_family : prev.name.fontFamily
                            },
                            designation: {
                                ...prev.designation,
                                text: s.designation || 'Speaker',
                                color: locked && evt.secondary_color ? readableColor(evt.secondary_color) : prev.designation.color,
                                fontFamily: locked && evt.font_family ? evt.font_family : prev.designation.fontFamily
                            },
                            company: {
                                ...prev.company,
                                text: s.company || '',
                                color: locked && evt.accent_color ? readableColor(evt.accent_color) : prev.company.color,
                                fontFamily: locked && evt.font_family ? evt.font_family : prev.company.fontFamily
                            }
                        }));

                        if (locked) {
                            setLogoSettings(prev => ({
                                ...prev,
                                showEvent: !!evt.event_logo_url,
                                showCompany: !!evt.company_logo_url
                            }));
                        }

                        // Restoration Logic: Speaker Layout > Event Template
                        const speakerDesign = s.sns_card_design;
                        const eventDesign = evt.sns_card_template;
                        const designToRestore = speakerDesign || eventDesign;

                        if (designToRestore) {
                            try {
                                const design = typeof designToRestore === 'string' ? JSON.parse(designToRestore) : designToRestore;
                                if (design.elements) {
                                    setElements(prev => {
                                        const next = { ...prev };
                                        Object.keys(design.elements).forEach(k => {
                                            if (next[k]) {
                                                // PRESERVE actual speaker data for standard fields
                                                const isStandardField = ['name', 'designation', 'company'].includes(k);
                                                next[k] = { 
                                                    ...next[k], 
                                                    ...design.elements[k],
                                                    text: isStandardField ? next[k].text : design.elements[k].text 
                                                };
                                            }
                                            else next[k] = design.elements[k]; // Custom elements
                                        });
                                        return next;
                                    });
                                }
                                if (design.positions) setPositions(prev => ({ ...prev, ...design.positions }));
                                if (design.photoSettings) setPhotoSettings(prev => ({ ...prev, ...design.photoSettings }));
                                if (design.logoSettings) setLogoSettings(prev => ({ ...prev, ...design.logoSettings }));
                                if (design.canvasSize) {
                                    setCanvasSize(design.canvasSize);
                                    setSelectedFormat('restored');
                                }
                                
                                // Restore background: saved template bg first (skip stale blob URLs), then event branding fallback
                                if (design.background && !design.background.startsWith('blob:')) {
                                    setBackground(design.background);
                                } else if (evt.sns_card_bg_url) {
                                    setBackground(getImageUrl(evt.sns_card_bg_url));
                                }

                                setHasInitialDesign(true); 
                            } catch (e) { console.error("Design restore failed", e); }
                        } else if (evt.sns_card_bg_url) {
                            // Only background fallback if no layout is defined yet
                            setBackground(getImageUrl(evt.sns_card_bg_url));
                        }
                    } catch (e) { console.error("Event fetch failed", e); }

                    if (s.photo_url) {
                        setImage(s.photo_url);
                    }
                }
            })
            .catch(err => {
                console.error('Failed to fetch speaker:', err);
                setError(err.response?.data?.error || 'Failed to load speaker data.');
            })
            .finally(() => {
                setLoading(false);
            });
    }, [id]);

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
        const newElements = { ...elements };
        delete newElements[key];
        setElements(newElements);
        const newPositions = { ...positions };
        delete newPositions[key];
        setPositions(newPositions);
    };

    const handleCrop = () => {
        if (cropper && typeof cropper.getCroppedCanvas === 'function') {
            const canvas = cropper.getCroppedCanvas();
            if (canvas) {
                setCroppedImage(canvas.toDataURL());
            }
        }
    };

    const handleSaveAsEventTemplate = async () => {
        if (!canManageEvent) return;
        try {
            const designMetadata = {
                elements,
                positions,
                photoSettings,
                canvasSize,
                bgOverlay,
                bgPosition,
                // Don't persist blob: URLs — they expire with the session
                background: background && !background.startsWith('blob:') ? background : null,
                logoSettings
            };
            await updateEventTemplate(speaker.event_id, designMetadata);
            alert('Event layout template saved! This layout will now be used as the base for all speakers in this event.');
        } catch (err) {
            console.error('Template save failed', err);
            alert('Failed to save event template');
        }
    };

    const handleResetToTemplate = () => {
        if (!event?.sns_card_template) {
            alert('No event template defined. Branding defaults will be used.');
            return;
        }
        if (window.confirm('Reset this card to the Master Event Template? Your individual changes for this speaker will be lost.')) {
            try {
                const design = typeof event.sns_card_template === 'string' ? JSON.parse(event.sns_card_template) : event.sns_card_template;
                if (design.elements) setElements(prev => ({ ...prev, ...design.elements }));
                if (design.positions) setPositions(prev => ({ ...prev, ...design.positions }));
                if (design.photoSettings) setPhotoSettings(design.photoSettings);
                if (design.canvasSize) setCanvasSize(design.canvasSize);
                if (design.bgOverlay) setBgOverlay(design.bgOverlay);
                if (design.bgPosition) setBgPosition(design.bgPosition);
                if (design.logoSettings) setLogoSettings(design.logoSettings);

                // Restore background: skip stale blob URLs, fall back to event branding background
                if (design.background && !design.background.startsWith('blob:')) setBackground(design.background);
                else if (event.sns_card_bg_url) setBackground(getImageUrl(event.sns_card_bg_url));
                else setBackground(null); // Clear if no background exists anywhere

                alert('Card reset to master template.');
            } catch (e) { console.error("Reset failed", e); }
        }
    };

    // Align every visible text element to the same x column as the first
    // visible element. y positions are left untouched so the user's existing
    // vertical spacing is preserved exactly.
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
    // gap *between* lines (after each element's actual rendered height). The
    // topmost element stays put as the anchor; each subsequent element parks
    // at (previous element's bottom + gap). This way different font sizes and
    // multi-line text never overlap, and the spacing input feels intuitive
    // ("space between lines") rather than abstract row-stride.
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
        sortedByY.forEach((k, i) => {
            updates[k] = { ...positions[k], y: cursor };
            const node = elementRefs.current[k]?.current;
            const heightPct = node && node.offsetHeight > 0
                ? node.offsetHeight / canvasSize.height
                : 0.04;
            cursor += heightPct + gap;
        });

        console.log('[Apply spacing]', { sortedByY, gap, updates });
        setPositions(prev => ({ ...prev, ...updates }));
    };

    const handleDownload = async () => {
        if (cardRef.current) {
            setSaving(true);
            try {
                await document.fonts.ready;
                // Wait for all images to be loaded
                const images = cardRef.current.getElementsByTagName('img');
                await Promise.all(Array.from(images).map(img => {
                    if (img.complete) return Promise.resolve();
                    return new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });
                }));

                const dataUrl = await toPng(cardRef.current, {
                    pixelRatio: 2,
                    skipFonts: false,
                    style: {
                        transform: 'none',
                    }
                });
                const link = document.createElement('a');
                link.download = `sns-card-${speaker.name.replace(/\s+/g, '-').toLowerCase()}.png`;
                link.href = dataUrl;
                link.click();
            } catch (err) {
                console.error('Download failed', err);
            } finally {
                setSaving(false);
            }
        }
    };

    // Renders the on-screen card to PNG and uploads it. Returns the server
    // path of the uploaded image (e.g. "/uploads/...") so callers can share
    // it without waiting for a state update tick. Returns null on failure.
    const renderAndUploadCard = async () => {
        if (!cardRef.current) return null;
        await document.fonts.ready;
        const images = cardRef.current.getElementsByTagName('img');
        await Promise.all(Array.from(images).map(img => {
            if (img.complete) return Promise.resolve();
            return new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });
        }));
        const dataUrl = await toPng(cardRef.current, {
            pixelRatio: 2, skipFonts: false, style: { transform: 'none' }
        });
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const formData = new FormData();
        formData.append('sns_card', blob, `sns-card-${speaker.id}-${Date.now()}.png`);
        const designMetadata = {
            elements, positions, photoSettings, canvasSize, bgOverlay, bgPosition,
            // Don't persist blob: URLs — they expire with the session
            background: background && !background.startsWith('blob:') ? background : null,
            logoSettings
        };
        const res = await saveSNSCard(id, formData, designMetadata);
        const url = res?.data?.url || null;
        if (url) setSavedSnsUrl(url);
        return url;
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const url = await renderAndUploadCard();
            if (url) alert('SNS Card saved successfully!');
            else alert('Failed to save SNS card.');
        } catch (err) {
            console.error('Save failed', err);
            alert('Failed to save SNS card.');
        } finally {
            setSaving(false);
        }
    };

    // WhatsApp share: re-render and upload (so the latest edits go out),
    // then hand off to the share helper. On mobile that opens the OS share
    // sheet with WhatsApp listed and the PNG attached as a real file; on
    // desktop it opens wa.me with the absolute image URL in the message
    // body so WhatsApp previews it as a thumbnail.
    const handleShare = async () => {
        setSaving(true);
        try {
            const url = await renderAndUploadCard();
            if (!url) {
                alert('Could not save the card. Please try again before sharing.');
                return;
            }
            await shareSnsToWhatsApp({ snsUrl: url, speaker, eventTitle: event?.title || '' });
        } catch (err) {
            console.error('Share prep failed', err);
            alert('Failed to prepare card for sharing.');
        } finally {
            setSaving(false);
        }
    };

    const handleBgUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const url = URL.createObjectURL(file);
            setBackground(url);
        }
    };


    const handlePhotoUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const url = URL.createObjectURL(file);
            setImage(url);
            setCroppedImage(null);
        }
    };

    const updateElement = (key, field, value) => {
        setElements(prev => ({
            ...prev,
            [key]: { ...prev[key], [field]: value }
        }));
    };


    const handleFormatSelect = (preset) => {
        setCustomSize({ width: preset.width, height: preset.height, background: 'White' });
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

    const swapDimensions = () => {
        setCustomSize(prev => ({ ...prev, width: prev.height, height: prev.width }));
    };

    const updatePosition = (key, xPercent, yPercent) => {
        setPositions(prev => ({
            ...prev,
            [key]: { x: xPercent, y: yPercent }
        }));
    };

    // Group-move handler: when the user drags any visible text element while
    // group mode is on, every visible text element shifts by the same delta so
    // their relative positions stay locked.
    const handleTextDrag = (key, data) => {
        if (!groupMove) {
            updatePosition(key, data.x / canvasSize.width, data.y / canvasSize.height);
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

    if (loading) return <div className="p-5 text-center"><Spinner animation="border" variant="light" /><p className="mt-3" style={{ color: 'var(--text-primary)' }}>Loading speaker details...</p></div>;
    if (error) return <div className="p-5 text-center"><h5 className="text-danger">{error}</h5><Button variant="link" onClick={() => navigate('/speakers')}>Back to Speakers</Button></div>;
    if (!speaker) return <div className="p-5 text-center"><h5 style={{ color: 'var(--text-primary)' }}>Speaker not found</h5><Button variant="link" onClick={() => navigate('/speakers')}>Back to Speakers</Button></div>;

    if (!selectedFormat) {
        return (
            <div className="ps-workspace animate-in">
                {/* Header */}
                <div className="ps-header">
                    <div className="ps-tabs">
                        <div className="ps-tab active">Recent</div>
                        <div className="ps-tab">Saved</div>
                        <div className="ps-tab">Mobile</div>
                        <div className="ps-tab">Web</div>
                        <div className="ps-tab">Art & Illustration</div>
                    </div>
                    <button className="ps-close-btn" onClick={() => navigate('/speakers')} title="Back to Speakers" aria-label="Back to Speakers">
                        <BsArrowLeft size={20} />
                    </button>
                </div>

                <div className="ps-main-body">
                    {/* Left: Presets Grid */}
                    <div className="ps-content-area">
                        <h6 className="ps-section-label">BLANK DOCUMENT PRESETS</h6>
                        <div className="ps-scroll-container">
                            {Object.entries(formatPresets).map(([category, items]) => (
                                <div key={category} className="ps-category-row">
                                    <h6 className="ps-category-name">{category}</h6>
                                    <div className="ps-presets-grid">
                                        {items.map(preset => (
                                            <div 
                                                key={preset.id} 
                                                className={`ps-preset-tile ${customSize.width === preset.width && customSize.height === preset.height ? 'active' : ''}`}
                                                onClick={() => handleFormatSelect(preset)}
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

                    {/* Right: Photoshop Sidebar */}
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
                                <div className="ps-color-swatch" style={{ background: customSize.background.toLowerCase() }}></div>
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
                <Button variant="link" className="p-0 text-decoration-none me-3" style={{ color: 'var(--text-primary)' }} onClick={() => navigate('/speakers')} title="Back to Speakers" aria-label="Back to Speakers">
                    <BsArrowLeft size={20} />
                </Button>
                <h4 className="m-0" style={{ color: 'var(--text-primary)' }}>SNS Card Generator</h4>
            </div>

            <div className="row g-4" style={{ height: 'calc(100vh - 100px)' }}>
                {/* Tools Panel -> Tabbed Sidebar */}
                <div className="col-lg-4 h-100">
                    <div className="premium-card p-0 h-100 overflow-hidden d-flex flex-column" style={{ background: 'var(--bg-card)' }}>
                        <div>
                                <div className="p-3 overflow-auto" style={{ height: 'calc(100vh - 250px)' }}>
                                    {isLocked && (
                                        <div className="mb-3 p-2 d-flex align-items-center gap-2" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 8, color: '#13d999', fontSize: '0.75rem' }}>
                                            <BsShieldLock size={16} />
                                            <span>Branding is locked for this event. Some controls are disabled.</span>
                                        </div>
                                    )}
                                    <Accordion defaultActiveKey="0" flush className="premium-accordion">
                                        {/* Image & Background */}
                                        <Accordion.Item eventKey="0" className="bg-transparent border-0 mb-2">
                                            <Accordion.Header>Image & Background</Accordion.Header>
                                            <Accordion.Body>
                                                <div className="mb-3">
                                                    <label className="form-label small muted-label">Speaker Photo Crop</label>
                                                    <div style={{ height: 200, background: '#000', borderRadius: 8, overflow: 'hidden' }}>
                                                        <Cropper
                                                            style={{ height: '100%', width: '100%' }}
                                                            initialAspectRatio={1}
                                                            src={image || 'https://via.placeholder.com/300'}
                                                            viewMode={1}
                                                            guides={true}
                                                            minCropBoxHeight={10}
                                                            minCropBoxWidth={10}
                                                            background={false}
                                                            autoCropArea={1}
                                                            checkOrientation={false}
                                                            onInitialized={(instance) => setCropper(instance)}
                                                        />
                                                    </div>
                                                    <Button size="sm" className="mt-2 w-100 btn-secondary-glass" onClick={handleCrop}>Update Crop</Button>
                                                </div>

                                                <div className="mb-3 text-start">
                                                    <label className="form-label small muted-label">Upload New Photo</label>
                                                    <Form.Control type="file" size="sm" className="form-control-dark" onChange={handlePhotoUpload} accept="image/*" />
                                                </div>

                                                <div className="mb-3 text-start">
                                                    <label className="form-label small muted-label">Canvas Format</label>
                                                    <Button variant="outline-accent" size="sm" className="w-100" onClick={() => setSelectedFormat(null)}>Change Format</Button>
                                                </div>

                                                <div className="mb-3 text-start">
                                                    <label className="form-label small muted-label">Upload Template (BG)</label>
                                                    <Form.Control type="file" size="sm" className="form-control-dark" onChange={handleBgUpload} accept="image/*" />
                                                </div>

                                                {background && (
                                                    <div className="mb-3 text-start">
                                                        <label className="form-label small muted-label">BG Image Position</label>
                                                        <Form.Select 
                                                            size="sm" 
                                                            className="form-select-dark" 
                                                            value={bgPosition} 
                                                            onChange={(e) => setBgPosition(e.target.value)}
                                                        >
                                                            <option value="center">Center</option>
                                                            <option value="top">Top</option>
                                                            <option value="bottom">Bottom</option>
                                                            <option value="left">Left</option>
                                                            <option value="right">Right</option>
                                                        </Form.Select>
                                                    </div>
                                                )}

                                                <div className="mb-3">
                                                    <label className="form-label small text-start d-block muted-label">Photo Size</label>
                                                    <Form.Range
                                                        min={100}
                                                        max={800}
                                                        value={photoSettings.size}
                                                        onChange={(e) => setPhotoSettings(prev => ({ ...prev, size: parseInt(e.target.value) }))}
                                                    />
                                                    <div className="small text-end">{photoSettings.size}px</div>
                                                </div>

                                                {/* Overlay Controls */}
                                                <div className="mb-3 pt-3 border-top border-secondary">
                                                    <label className="form-label small d-block muted-label">Background Overlay</label>
                                                    <div className="d-flex align-items-center gap-3">
                                                        <Form.Control
                                                            type="color"
                                                            className="form-control form-control-color"
                                                            value={bgOverlay.color}
                                                            onChange={(e) => setBgOverlay(prev => ({ ...prev, color: e.target.value }))}
                                                            style={{ width: 40, border: '1px solid #3d3d5c' }}
                                                            disabled={isLocked}
                                                        />
                                                        <div className="flex-grow-1">
                                                            <Form.Range
                                                                min={0}
                                                                max={1}
                                                                step={0.1}
                                                                value={bgOverlay.opacity}
                                                                onChange={(e) => setBgOverlay(prev => ({ ...prev, opacity: parseFloat(e.target.value) }))}
                                                                disabled={isLocked}
                                                            />
                                                        </div>
                                                        <div className="small">{Math.round(bgOverlay.opacity * 100)}%</div>
                                                    </div>
                                                </div>
                                            </Accordion.Body>
                                        </Accordion.Item>

                                        {/* Dynamic Text Customization */}
                                        {Object.keys(elements).map((key, idx) => (
                                            <Accordion.Item eventKey={String(idx + 1)} key={key} className="bg-transparent border-0 mb-2">
                                                <Accordion.Header>
                                                    <div className="d-flex align-items-center justify-content-between w-100 me-3">
                                                        <span className="text-capitalize">{elements[key].isCustom ? elements[key].text.substring(0, 15) : key}</span>
                                                        {elements[key].isCustom && (
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
                                                    <Form.Group className="mb-2">
                                                        <Form.Control
                                                            as="textarea"
                                                            rows={2}
                                                            size="sm"
                                                            className="form-control-dark"
                                                            value={elements[key].text}
                                                            onChange={e => updateElement(key, 'text', e.target.value)}
                                                            placeholder="Enter text... (Enter for new line)"
                                                            style={{ resize: 'none', lineHeight: 1.4 }}
                                                            onKeyDown={e => e.key === 'Enter' && e.stopPropagation()}
                                                        />
                                                    </Form.Group>
                                                    <div className="row g-2">
                                                        <div className="col-6">
                                                            <label className="small muted-label">Color</label>
                                                            <Form.Control
                                                                type="color"
                                                                className="form-control form-control-color w-100"
                                                                value={elements[key].color}
                                                                onChange={e => updateElement(key, 'color', e.target.value)}
                                                                style={{ border: '1px solid #3d3d5c' }}
                                                                disabled={isLocked && !elements[key].isCustom}
                                                            />
                                                        </div>
                                                        <div className="col-6">
                                                            <label className="small muted-label">Size (px)</label>
                                                            <Form.Control
                                                                type="number"
                                                                size="sm"
                                                                className="form-control-dark"
                                                                value={elements[key].fontSize}
                                                                onChange={e => updateElement(key, 'fontSize', parseInt(e.target.value))}
                                                            />
                                                        </div>
                                                        <div className="col-6 mt-2">
                                                            <label className="small muted-label">Weight</label>
                                                            <Form.Select
                                                                size="sm"
                                                                className="form-select-dark"
                                                                value={elements[key].fontWeight}
                                                                onChange={e => updateElement(key, 'fontWeight', e.target.value)}
                                                            >
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
                                                            <Form.Control
                                                                type="number"
                                                                size="sm"
                                                                className="form-control-dark"
                                                                value={elements[key].letterSpacing}
                                                                onChange={e => updateElement(key, 'letterSpacing', parseFloat(e.target.value))}
                                                            />
                                                        </div>
                                                        <div className="col-6 mt-2">
                                                            <label className="small muted-label">Line Height</label>
                                                            <Form.Control
                                                                type="number"
                                                                step="0.05"
                                                                min="0.8"
                                                                max="3"
                                                                size="sm"
                                                                className="form-control-dark"
                                                                value={elements[key].lineHeight ?? 1.2}
                                                                onChange={e => updateElement(key, 'lineHeight', parseFloat(e.target.value) || 1.2)}
                                                            />
                                                        </div>
                                                        <div className="col-12 mt-2">
                                                            <label className="small muted-label">Decoration</label>
                                                            <Form.Select
                                                                size="sm"
                                                                className="form-select-dark"
                                                                value={elements[key].textDecoration}
                                                                onChange={e => updateElement(key, 'textDecoration', e.target.value)}
                                                            >
                                                                <option value="none">None</option>
                                                                <option value="underline">Underline</option>
                                                                <option value="overline">Overline</option>
                                                                <option value="capitalize">Capitalize</option>
                                                                <option value="uppercase">Uppercase</option>
                                                            </Form.Select>
                                                        </div>
                                                        <div className="col-12 mt-2">
                                                            <label className="small muted-label">Font</label>
                                                            <Form.Select
                                                                size="sm"
                                                                className="form-select-dark"
                                                                value={elements[key].fontFamily}
                                                                onChange={e => updateElement(key, 'fontFamily', e.target.value)}
                                                                disabled={isLocked && !elements[key].isCustom}
                                                            >
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
                                    </Accordion>
                                    <Button variant="outline-accent" size="sm" className="w-100 mt-3 py-2 border-dashed" onClick={addCustomElement}>
                                        + Add Custom Text
                                    </Button>
                                </div>
                        </div>

                        <div className="p-3 border-top border-secondary d-flex flex-column gap-2 bg-dark mt-auto">
                            <div className="d-flex gap-2">
                                <Button
                                    variant="outline-light"
                                    size="sm"
                                    className="flex-grow-1"
                                    onClick={arrangeTextOnSingleLine}
                                    title="Align all text to the same column as the first element"
                                >
                                    <BsTextLeft className="me-2" /> Align
                                </Button>
                                <Button
                                    variant={groupMove ? 'accent' : 'outline-light'}
                                    size="sm"
                                    className="flex-grow-1"
                                    onClick={() => setGroupMove(g => !g)}
                                    title="When ON, dragging any text element moves all of them together"
                                >
                                    <BsArrowsMove className="me-2" /> {groupMove ? 'Group: ON' : 'Group: OFF'}
                                </Button>
                            </div>
                            <div className="d-flex align-items-center gap-2">
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
                            <div className="d-flex gap-2">
                                <Button className="btn-secondary-glass flex-grow-1" onClick={handleSave} disabled={saving}>
                                    {saving ? <Spinner size="sm" /> : <>Save Card</>}
                                </Button>
                                <Button variant="outline-light" className="flex-grow-1" onClick={handleDownload}>
                                    <BsDownload className="me-2" /> Download
                                </Button>
                            </div>
                            <Button
                                className="w-100 d-flex align-items-center justify-content-center gap-2"
                                onClick={handleShare}
                                disabled={saving}
                                title={speaker?.mobile_no ? `Send card on WhatsApp to ${speaker.name}` : 'Share card on WhatsApp'}
                                style={{ background: '#25D366', border: 'none', color: '#fff', fontWeight: 700 }}
                            >
                                {saving ? <Spinner size="sm" /> : <BsWhatsapp />} Share on WhatsApp
                            </Button>
                            {canManageEvent && (
                                <div className="d-flex gap-2 w-100">
                                    <Button variant="outline-accent" size="sm" className="flex-grow-1" onClick={handleSaveAsEventTemplate}>
                                        <BsLayoutTextWindow className="me-2" /> Save to Template
                                    </Button>
                                    <Button variant="outline-secondary" size="sm" className="flex-grow-1" style={{ fontSize: '0.7rem' }} onClick={handleResetToTemplate}>
                                        Reset to Master
                                    </Button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Canvas Area */}
                <div className="col-lg-8 h-100">
                    <div ref={containerRef} className="bg-darker rounded-4 border border-secondary p-4 h-100 d-flex align-items-center justify-content-center overflow-auto">
                        <div style={{ width: canvasSize.width * viewportScale, height: canvasSize.height * viewportScale, position: 'relative' }}>
                            <div ref={cardRef} className="sns-card-canvas" style={{ width: canvasSize.width, height: canvasSize.height, position: 'absolute', top: 0, left: 0, transform: `scale(${viewportScale})`, transformOrigin: 'top left', overflow: 'hidden', background: '#1e1e2f' }}>
                                
                                {/* Background + Overlay */}
                                {background && (
                                    <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 0 }}>
                                        <img src={background} alt="BG" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: bgPosition }} />
                                        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: bgOverlay.color, opacity: bgOverlay.opacity, zIndex: 1 }}></div>
                                    </div>
                                )}

                                {/* Photo */}
                                {positions.photo && (
                                    <Draggable
                                        nodeRef={photoRef}
                                        position={{ x: positions.photo.x * canvasSize.width, y: positions.photo.y * canvasSize.height }}
                                        onDrag={(e, data) => updatePosition('photo', data.x / canvasSize.width, data.y / canvasSize.height)}
                                    >
                                        <div ref={photoRef} style={{ position: 'absolute', cursor: 'grab', zIndex: 5 }}>
                                            <div style={{ width: photoSettings.size, height: photoSettings.size, borderRadius: '8px', overflow: 'hidden' }}>
                                                <img src={croppedImage || image || 'https://via.placeholder.com/250'} alt="Speaker" style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }} />
                                            </div>
                                        </div>
                                    </Draggable>
                                )}

                                {/* All Text Elements */}
                                {Object.keys(elements).map((key) => {
                                    if (!positions[key] || !elements[key].show) return null;
                                    return (
                                        <Draggable
                                            key={key}
                                            nodeRef={elementRefs.current[key]}
                                            position={{ x: positions[key].x * canvasSize.width, y: positions[key].y * canvasSize.height }}
                                            onDrag={(e, data) => handleTextDrag(key, data)}
                                        >
                                            <div ref={elementRefs.current[key]} style={{
                                                    position: 'absolute', cursor: 'grab', zIndex: 10,
                                                    color: elements[key].color || '#ffffff',
                                                    opacity: 1,
                                                    fontSize: elements[key].fontSize,
                                                    fontFamily: elements[key].fontFamily,
                                                    fontWeight: elements[key].fontWeight,
                                                    textDecoration: elements[key].textDecoration === 'underline' || elements[key].textDecoration === 'overline' ? elements[key].textDecoration : 'none',
                                                    textTransform: elements[key].textDecoration === 'uppercase' || elements[key].textDecoration === 'capitalize' ? elements[key].textDecoration : 'none',
                                                    letterSpacing: `${elements[key].letterSpacing}px`,
                                                    lineHeight: elements[key].lineHeight ?? 1.2,
                                                    whiteSpace: 'pre-wrap',
                                                    textShadow: 'none'
                                                }}>
                                                    {elements[key].text}
                                            </div>
                                        </Draggable>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

        </div>
    );
}


