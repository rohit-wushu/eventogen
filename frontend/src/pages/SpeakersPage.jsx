import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Table, Button, Form, Modal, Spinner, ProgressBar } from 'react-bootstrap';
import { useAuth } from '../context/AuthContext';
import { BsPlus, BsPencil, BsTrash, BsPersonBadge, BsShare, BsUpload, BsDownload, BsFunnel, BsGrid3X3Gap, BsList, BsLayoutTextWindow, BsLightningChargeFill, BsCheckCircleFill, BsXCircleFill, BsFileEarmarkSpreadsheet, BsCodeSlash, BsGripVertical, BsEye, BsEyeSlash, BsSearch, BsX, BsCalendarCheck } from 'react-icons/bs';
import { useNavigate } from 'react-router-dom';
import { getSpeakers, deleteSpeaker, getEvents, getEvent, saveSNSCard, saveAttendingCard, deleteSNSCard, deleteAttendingCard, importSpeakers, importSpeakersFromGSheet, reorderSpeakers, setSpeakerVisibility } from '../services/api';
import { getImageUrl } from '../utils/imageUrl';
import { toPng } from 'html-to-image';
import JSZip from 'jszip';
import ApiEndpointsModal from '../components/ApiEndpointsModal';
import QuotaButton from '../components/QuotaButton';
import { invalidateQuota } from '../hooks/useQuota';
// Share UI lives on its own page (/speakers/share/:id) — the buttons below
// just navigate there. Kept the import line for the small chance another
// piece of this file uses it; the share-page route is in App.jsx.

// Gallery action-bar config keyed by viewMode. Adding a third card type
// (e.g. partners) means appending one entry here, not duplicating JSX.
// `cardType` is the value passed to bulk-modal / handleDownloadAll, so
// callers stay agnostic to the panel's identity.
const CARD_PANELS = {
    gallery: {
        cardType: 'speaker',
        title: 'SNS Card Actions',
        hint: 'Design a master template then generate cards for all speakers at once',
        templateRoute: (eventId) => `/events/sns-template/${eventId}`,
        icon: BsLayoutTextWindow,
        tint: '#13d999',
        bg: 'rgba(19,217,153,0.05)',
        border: 'rgba(19,217,153,0.15)',
        masterBtn: { variant: 'outline-accent', style: {} },
        generateBtn: { className: 'btn-accent', style: {} },
    },
    attending: {
        cardType: 'attending',
        title: 'Attending Card Actions',
        hint: 'Design an "I am attending" master template then generate cards for all speakers at once',
        templateRoute: (eventId) => `/events/attending-template/${eventId}`,
        icon: BsCalendarCheck,
        tint: '#a78bfa',
        bg: 'rgba(139,92,246,0.06)',
        border: 'rgba(139,92,246,0.20)',
        masterBtn: { variant: 'outline-light', style: { borderColor: 'rgba(139,92,246,0.45)' } },
        generateBtn: { className: undefined, style: { background: '#8b5cf6', borderColor: '#8b5cf6', color: '#fff' } },
    },
};

export default function SpeakersPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [speakers, setSpeakers] = useState([]);
    const [visibleCount, setVisibleCount] = useState(10);
    const loadMoreRef = useRef(null);
    const dragIdxRef = useRef(null);
    const [dragOverIdx, setDragOverIdx] = useState(null);
    const [selectedIds, setSelectedIds] = useState([]);
    const [bulkMode, setBulkMode] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [events, setEvents] = useState([]);
    const [filterEvent, setFilterEvent] = useState(() => sessionStorage.getItem('speakers.filterEvent') || '');
    const [viewMode, setViewMode] = useState('table');
    const [gallerySearch, setGallerySearch] = useState('');
    const [previewCard, setPreviewCard] = useState(null); // { url, speaker }
    // Bulk generator opens for the card type the operator clicked: 'speaker'
    // for the SNS panel, 'attending' for the I-am-attending panel. null hides.
    const [bulkCardType, setBulkCardType] = useState(null);
    const showBulkModal = !!bulkCardType;
    const setShowBulkModal = (open) => setBulkCardType(open ? 'speaker' : null);
    const [showGSheetModal, setShowGSheetModal] = useState(false);
    const [gSheetUrl, setGSheetUrl] = useState('');
    const [gSheetEventId, setGSheetEventId] = useState('');
    const [gSheetImporting, setGSheetImporting] = useState(false);
    const [gSheetError, setGSheetError] = useState('');
    const [apiEvent, setApiEvent] = useState(null); // { id, title } when the JSON-endpoints modal is open

    // SNS Share → dedicated share page (/speakers/share/:id) with WhatsApp,
    // LinkedIn, X, Facebook, Telegram, Email, Download, Copy image, Copy link.
    // If no card has been generated yet, route the operator to the generator.
    const handleWhatsAppShare = (_e, s) => {
        if (!s?.sns_card_url) {
            navigate(`/speakers/sns/${s.id}`);
            return;
        }
        navigate(`/speakers/share/${s.id}`, { state: { snsUrl: s.sns_card_url, eventTitle: s.event_title || '' } });
    };

    const canManage = ['admin', 'manager'].includes(user?.role) || (user?.role === 'employee' && !!user?.assigned_event_id);
    const [downloadingAll, setDownloadingAll] = useState(false);

    const handleDownloadCard = async (speaker, cardType = 'speaker') => {
        const isAttending = cardType === 'attending';
        const sourceUrl = isAttending ? speaker.attending_card_url : speaker.sns_card_url;
        if (!sourceUrl) return;
        const url = getImageUrl(sourceUrl);
        try {
            const res = await fetch(url);
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            const prefix = isAttending ? 'attending' : 'sns';
            a.download = `${prefix}-${speaker.name.replace(/\s+/g, '-').toLowerCase()}.png`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(blobUrl); }, 1000);
        } catch (err) {
            console.error('Download failed', err);
        }
    };

    // Zip all generated cards of the given type ('speaker' → sns_card_url,
    // 'attending' → attending_card_url). The two flows are otherwise identical
    // — just different columns + zip filename.
    const handleDownloadAll = async (cardType = 'speaker') => {
        const isAttending = cardType === 'attending';
        const urlField  = isAttending ? 'attending_card_url' : 'sns_card_url';
        const filePrefix = isAttending ? 'attending' : 'sns';
        const zipName    = isAttending ? 'attending-cards.zip' : 'sns-cards.zip';
        const emptyMsg   = isAttending ? 'No I-am-attending cards generated yet.' : 'No SNS cards generated yet.';

        const withCards = speakers.filter(s => s[urlField]);
        if (!withCards.length) { alert(emptyMsg); return; }
        setDownloadingAll(true);
        try {
            const zip = new JSZip();
            await Promise.all(withCards.map(async (s) => {
                try {
                    const res = await fetch(getImageUrl(s[urlField]));
                    const blob = await res.blob();
                    zip.file(`${filePrefix}-${s.name.replace(/\s+/g, '-').toLowerCase()}.png`, blob);
                } catch (e) { console.warn(`Skip ${s.name}`, e); }
            }));
            const content = await zip.generateAsync({ type: 'blob' });
            const blobUrl = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = zipName;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(blobUrl); }, 1000);
        } catch (err) {
            console.error('Bulk download failed', err);
            alert('Bulk download failed');
        } finally {
            setDownloadingAll(false);
        }
    };

    const load = () => {
        getSpeakers(filterEvent || undefined).then(r => {
            setSpeakers(Array.isArray(r.data) ? r.data : []);
            setVisibleCount(10);
        }).catch(() => { });
    };

    const displayedSpeakers = speakers.slice(0, visibleCount);
    const hasMore = visibleCount < speakers.length;

    // Gallery-view search — filters by name, company, designation, or role.
    // Kept separate from the table view's infinite-scroll slice so the two
    // views don't interfere. When a search is active we match against the
    // full speakers list (not just the loaded slice).
    const gallerySpeakers = gallerySearch.trim()
        ? speakers.filter(s => {
            const q = gallerySearch.trim().toLowerCase();
            return [s.name, s.company, s.designation, s.role]
                .some(v => (v || '').toLowerCase().includes(q));
        })
        : displayedSpeakers;

    const handleDragStart = (e, idx) => {
        dragIdxRef.current = idx;
        e.dataTransfer.effectAllowed = 'move';
    };
    const handleDragOver = (e, idx) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverIdx(idx);
    };
    const handleDragLeave = () => setDragOverIdx(null);
    const handleDrop = async (e, dropIdx) => {
        e.preventDefault();
        setDragOverIdx(null);
        const dragIdx = dragIdxRef.current;
        dragIdxRef.current = null;
        if (dragIdx === null || dragIdx === dropIdx) return;
        const reordered = [...speakers];
        const [moved] = reordered.splice(dragIdx, 1);
        reordered.splice(dropIdx, 0, moved);
        // reassign sequence for every item
        const updates = reordered.map((s, i) => ({ id: s.id, sequence: i + 1 }));
        setSpeakers(reordered.map((s, i) => ({ ...s, sequence: i + 1, serial: i + 1 })));
        try { await reorderSpeakers(updates); } catch { load(); }
    };

    useEffect(() => {
        if (!hasMore) return;
        const el = loadMoreRef.current;
        if (!el) return;
        // Find nearest scrolling ancestor so the observer fires inside custom scroll containers
        let root = el.parentElement;
        while (root && root !== document.body) {
            const s = window.getComputedStyle(root);
            if (/(auto|scroll|overlay)/.test(s.overflowY)) break;
            root = root.parentElement;
        }
        const observer = new IntersectionObserver((entries) => {
            if (entries[0]?.isIntersecting) {
                setVisibleCount(c => Math.min(c + 10, speakers.length));
            }
        }, { root: root && root !== document.body ? root : null, rootMargin: '300px' });
        observer.observe(el);
        return () => observer.disconnect();
    }, [hasMore, speakers.length, viewMode]);

    useEffect(() => {
        getEvents().then(r => setEvents(Array.isArray(r.data) ? r.data : [])).catch(() => { });
    }, []);

    useEffect(() => { load(); }, [filterEvent]);

    useEffect(() => {
        if (filterEvent) sessionStorage.setItem('speakers.filterEvent', filterEvent);
        else sessionStorage.removeItem('speakers.filterEvent');
    }, [filterEvent]);

    const handleDelete = async (id) => {
        if (window.confirm('Delete this speaker permanently? This will remove the speaker and all related data (SNS card, travel, agenda assignments). This cannot be undone.')) {
            await deleteSpeaker(id);
            load();
            invalidateQuota();
        }
    };

    // Toggles whether the speaker is included in the public /api/public/speakers
    // JSON. The row stays in the database either way — admins still see it here.
    // Optimistic UI: flip locally first, reconcile from the server response.
    const handleToggleVisibility = async (s) => {
        const next = s.is_hidden ? 0 : 1;
        setSpeakers(prev => prev.map(x => x.id === s.id ? { ...x, is_hidden: next } : x));
        try {
            await setSpeakerVisibility(s.id, !!next);
        } catch (err) {
            // Roll back on failure and surface the error.
            setSpeakers(prev => prev.map(x => x.id === s.id ? { ...x, is_hidden: s.is_hidden } : x));
            alert(err.response?.data?.error || 'Could not update visibility');
        }
    };

    const handleDeleteCard = async (speaker, cardType = 'speaker') => {
        const isAttending = cardType === 'attending';
        const urlField = isAttending ? 'attending_card_url' : 'sns_card_url';
        const cardLabel = isAttending ? 'I-am-attending card' : 'SNS card';
        if (!speaker?.[urlField]) return;
        if (!window.confirm(`Delete the ${cardLabel} for ${speaker.name}? The speaker will remain; only the generated card will be removed.`)) return;
        try {
            const deleteFn = isAttending ? deleteAttendingCard : deleteSNSCard;
            await deleteFn(speaker.id);
            setPreviewCard(null);
            load();
        } catch (err) {
            alert(err.response?.data?.error || `Failed to delete ${cardLabel}`);
        }
    };

    const toggleSelect = (id) => {
        setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const toggleSelectAll = () => {
        if (selectedIds.length === speakers.length) {
            setSelectedIds([]);
        } else {
            setSelectedIds(speakers.map(s => s.id));
        }
    };

    const handleBulkDelete = async () => {
        if (window.confirm(`Delete ${selectedIds.length} speakers?`)) {
            try {
                const { bulkDeleteSpeakers } = await import('../services/api');
                await bulkDeleteSpeakers(selectedIds);
                setSelectedIds([]);
                setBulkMode(false);
                load();
            } catch (err) {
                alert('Failed to delete speakers');
            }
        }
    };

    const exitBulkMode = () => {
        setBulkMode(false);
        setSelectedIds([]);
    };

    const handleExport = async () => {
        setExporting(true);
        try {
            const token = localStorage.getItem('token');
            let url = '/api/speakers/export?t=' + Date.now();
            if (filterEvent) url += '&event_id=' + filterEvent;
            const response = await fetch(url, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!response.ok) throw new Error('Export failed');
            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = 'speakers_' + new Date().toISOString().split('T')[0] + '.csv';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { document.body.removeChild(a); window.URL.revokeObjectURL(blobUrl); }, 1000);
        } catch (err) { 
            alert('Export failed'); 
        } finally {
            setExporting(false);
        }
    };

    const handleImport = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        // CSV imports always need an event to land in — without one, the
        // rows would be orphaned (event_id NULL) and invisible in the UI
        // because the list is event-filtered.
        if (!filterEvent) {
            alert('Pick an event from the dropdown above before importing — speakers will be attached to that event.');
            e.target.value = '';
            return;
        }
        const formData = new FormData();
        formData.append('file', file);
        try {
            const res = await importSpeakers(formData, filterEvent);
            const { imported = 0, skipped = 0, message } = res?.data || {};
            alert(message || `${imported} speakers imported${skipped ? ` (${skipped} duplicates skipped)` : ''}`);
            load();
        } catch (err) {
            // Surface the real reason — used to just say "Import failed" no
            // matter what the backend returned (missing name, bad headers, etc.).
            const detail = err.response?.data?.error || err.message || 'Unknown error';
            alert(`Import failed: ${detail}`);
            console.warn('Speaker import failed:', err);
        }
        e.target.value = '';
    };

    const openGSheetModal = () => {
        setGSheetUrl('');
        setGSheetEventId(filterEvent || '');
        setGSheetError('');
        setShowGSheetModal(true);
    };

    const handleImportGSheet = async () => {
        setGSheetError('');
        if (!gSheetUrl.trim()) {
            setGSheetError('Please paste a Google Sheet URL.');
            return;
        }
        if (!gSheetEventId) {
            setGSheetError('Please select an event to import into.');
            return;
        }
        setGSheetImporting(true);
        try {
            const res = await importSpeakersFromGSheet(gSheetUrl.trim(), gSheetEventId);
            const d = res.data || {};
            let msg = d.message || 'Speakers imported';
            if (Array.isArray(d.failures) && d.failures.length > 0) {
                msg += '\n\nPhotos that failed to download:\n' +
                    d.failures.map(f => `• ${f.name}: ${f.reason}`).join('\n');
            }
            alert(msg);
            setShowGSheetModal(false);
            load();
        } catch (err) {
            setGSheetError(err.response?.data?.error || 'Failed to import from Google Sheet');
        } finally {
            setGSheetImporting(false);
        }
    };

    return (
        <div className="animate-in">
            <div className="page-header d-flex justify-content-between align-items-center">
                <div><h4>Speakers</h4>
                    <p className='text-white small'>Manage event speakers and presenters.</p></div>
                {canManage && (
                    <div className="d-flex gap-2">
                        {bulkMode ? (
                            <>
                                <Button
                                    variant="danger"
                                    className="d-flex align-items-center gap-2"
                                    onClick={handleBulkDelete}
                                    disabled={selectedIds.length === 0}
                                >
                                    <BsTrash size={16} /> Delete Selected ({selectedIds.length})
                                </Button>
                                <Button
                                    variant="outline-light"
                                    size="sm"
                                    style={{ border: '1px solid var(--border-subtle)', borderRadius: 10 }}
                                    onClick={exitBulkMode}
                                >
                                    Cancel
                                </Button>
                            </>
                        ) : (
                            <Button
                                variant="outline-light"
                                size="sm"
                                className="d-flex align-items-center gap-2"
                                style={{ border: '1px solid var(--border-subtle)', borderRadius: 10 }}
                                onClick={() => setBulkMode(true)}
                            >
                                <BsTrash size={16} /> Bulk Delete
                            </Button>
                        )}
                        <Button variant="outline-light" size="sm" className="d-flex align-items-center gap-2" style={{ border: '1px solid var(--border-subtle)', borderRadius: 10 }} onClick={handleExport} disabled={exporting}>
                            <BsDownload /> {exporting ? 'Exporting...' : 'Export'}
                        </Button>
                        <label className="btn btn-outline-light btn-sm d-flex align-items-center gap-2 mb-0" style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, cursor: 'pointer' }}>
                            <BsUpload /> Import <input type="file" hidden accept=".csv" onChange={handleImport} />
                        </label>
                        <Button
                            variant="outline-light"
                            size="sm"
                            className="d-flex align-items-center gap-2"
                            style={{ border: '1px solid var(--border-subtle)', borderRadius: 10 }}
                            onClick={openGSheetModal}
                            title="Import speakers from a shared Google Sheet"
                        >
                            <BsFileEarmarkSpreadsheet /> Import from Google Sheet
                        </Button>
                        <QuotaButton
                            resource="speakers"
                            className="btn-accent d-flex align-items-center gap-2"
                            onClick={() => navigate('/speakers/add')}
                        >
                            <BsPlus size={18} /> Add Speaker
                        </QuotaButton>
                    </div>
                )}
            </div>

            {/* Filters */}
            <div className="d-flex gap-2 mb-4 align-items-center flex-wrap" style={{ marginTop: -10 }}>
                <BsFunnel size={16} style={{ color: 'var(--text-primary)', opacity: 0.85 }} />
                <Form.Select size="sm" className="form-select-dark" style={{ width: 180, borderRadius: 10 }} value={filterEvent} onChange={e => setFilterEvent(e.target.value)}>
                    <option value="">All Events</option>
                    {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                </Form.Select>
                {filterEvent && (
                    <Button
                        size="sm"
                        variant="link"
                        className="text-decoration-none"
                        style={{ color: 'var(--text-primary)', fontSize: '0.8rem', padding: '2px 8px' }}
                        onClick={() => setFilterEvent('')}
                    >
                        Clear
                    </Button>
                )}
                {filterEvent && (() => {
                    const ev = events.find(e => String(e.id) === String(filterEvent));
                    return ev ? (
                        <Button
                            size="sm"
                            className="d-flex align-items-center gap-2 sp-json-btn"
                            style={{
                                borderRadius: 8, fontSize: '0.75rem',
                                background: 'rgba(14,165,233,0.12)',
                                border: '1px solid #0ea5e9',
                                color: '#0369a1',
                                fontWeight: 600,
                            }}
                            onClick={() => setApiEvent({ id: ev.id, title: ev.title })}
                            title="Get public JSON URLs for this event's speakers, partners, and agenda"
                        >
                            <BsCodeSlash size={13} /> JSON URL
                        </Button>
                    ) : null;
                })()}
                <div className="ms-auto d-flex gap-1">
                    <Button size="sm" variant={viewMode === 'table' ? 'accent' : 'outline-secondary'} style={{ borderRadius: 8, padding: '4px 10px' }} onClick={() => setViewMode('table')} title="Table View">
                        <BsList size={16} />
                    </Button>
                    <Button size="sm" variant={viewMode === 'gallery' ? 'accent' : 'outline-secondary'} style={{ borderRadius: 8, padding: '4px 10px' }} onClick={() => setViewMode('gallery')} title="SNS Gallery">
                        <BsGrid3X3Gap size={16} />
                    </Button>
                    <Button size="sm" variant={viewMode === 'attending' ? 'accent' : 'outline-secondary'} style={{ borderRadius: 8, padding: '4px 10px' }} onClick={() => setViewMode('attending')} title='"I am attending" Gallery'>
                        <BsCalendarCheck size={16} />
                    </Button>
                </div>
            </div>

            <style>{`
                .form-select-dark {
                    background-color: #111 !important;
                    color: #fff !important;
                    border: 1px solid rgba(255, 255, 255, 0.1) !important;
                }
                .form-select-dark:focus {
                    background-color: #000 !important;
                    box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.25) !important;
                    border-color: rgba(139, 92, 246, 0.5) !important;
                }
                /* JSON URL pill — keep readable contrast in both themes.
                   Default values (set inline) work for light; here we override
                   for dark so the muted slate text doesn't disappear. */
                .sp-json-btn:hover {
                    background: rgba(14,165,233,0.2) !important;
                    border-color: #0284c7 !important;
                }
                [data-theme="dark"] .sp-json-btn,
                .dark-theme .sp-json-btn {
                    background: rgba(56,189,248,0.15) !important;
                    border-color: #38bdf8 !important;
                    color: #7dd3fc !important;
                }
                [data-theme="dark"] .sp-json-btn:hover,
                .dark-theme .sp-json-btn:hover {
                    background: rgba(56,189,248,0.25) !important;
                    color: #bae6fd !important;
                }
            `}</style>

            {speakers.length === 0 ? (
                <div className="empty-state" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
                    <div className="empty-state-icon"><BsPersonBadge /></div>
                    <p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>No Speakers Yet</p>
                    <p style={{ fontSize: '0.8rem' }}>Add speakers to your events.</p>
                </div>
            ) : viewMode === 'gallery' || viewMode === 'attending' ? (
            <>
                {/* Gallery search — filters cards by name, company, designation or role */}
                <div style={{ position: 'relative', marginBottom: 16, maxWidth: 380 }}>
                    <BsSearch style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 14 }} />
                    <input
                        type="text"
                        value={gallerySearch}
                        onChange={e => setGallerySearch(e.target.value)}
                        placeholder="Search speakers by name, company, role…"
                        style={{
                            width: '100%', padding: '9px 34px 9px 36px', borderRadius: 10,
                            border: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
                            color: 'var(--text-primary)', fontSize: '0.85rem', outline: 'none'
                        }}
                    />
                    {gallerySearch && (
                        <button
                            onClick={() => setGallerySearch('')}
                            title="Clear search"
                            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 4 }}
                        >
                            <BsX size={18} />
                        </button>
                    )}
                </div>

                {/* Gallery action bar — one render driven by CARD_PANELS so a
                    third gallery (or different theming) is a config edit. */}
                {filterEvent && canManage && CARD_PANELS[viewMode] && (() => {
                    const cfg = CARD_PANELS[viewMode];
                    const Icon = cfg.icon;
                    return (
                        <div className="sns-action-bar" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '14px 18px', background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 12 }}>
                            <Icon size={16} style={{ color: cfg.tint, flexShrink: 0 }} />
                            <div className="sns-action-text" style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#fff' }}>{cfg.title}</div>
                                <div style={{ fontSize: '0.72rem', color: '#666' }}>{cfg.hint}</div>
                            </div>
                            <div className="sns-action-buttons" style={{ display: 'contents' }}>
                                <Button size="sm" variant={cfg.masterBtn.variant} style={{ borderRadius: 8, whiteSpace: 'nowrap', fontSize: '0.78rem', color: '#fff', ...cfg.masterBtn.style }}
                                    onClick={() => navigate(cfg.templateRoute(filterEvent))}>
                                    <BsLayoutTextWindow className="me-1" /> Master Template
                                </Button>
                                <Button size="sm" className={cfg.generateBtn.className} style={{ borderRadius: 8, whiteSpace: 'nowrap', fontSize: '0.78rem', ...cfg.generateBtn.style }}
                                    onClick={() => setBulkCardType(cfg.cardType)}>
                                    <BsLightningChargeFill className="me-1" /> Generate All Cards
                                </Button>
                                <Button size="sm" variant="outline-light" style={{ borderRadius: 8, whiteSpace: 'nowrap', fontSize: '0.78rem', borderColor: 'rgba(255,255,255,0.15)' }}
                                    onClick={() => handleDownloadAll(cfg.cardType)} disabled={downloadingAll}>
                                    {downloadingAll ? <Spinner size="sm" animation="border" className="me-1" /> : <BsDownload className="me-1" />}
                                    {downloadingAll ? 'Zipping...' : 'Download All'}
                                </Button>
                            </div>
                        </div>
                    );
                })()}
                {gallerySearch.trim() && gallerySpeakers.length === 0 ? (
                    <div className="empty-state" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
                        <div className="empty-state-icon"><BsSearch /></div>
                        <p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>No speakers match “{gallerySearch}”</p>
                        <p style={{ fontSize: '0.8rem' }}>Try a different name, company, or role.</p>
                    </div>
                ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 20 }}>
                    {gallerySpeakers.map(s => {
                        // Branch the card preview on view mode so the same JSX
                        // serves both gallery types. Attending view reads the
                        // attending_card_url column and links to the I-am-
                        // attending generator route.
                        const isAttendingView = viewMode === 'attending';
                        const cardUrl   = isAttendingView ? s.attending_card_url : s.sns_card_url;
                        const editRoute = isAttendingView ? `/speakers/attending/${s.id}` : `/speakers/sns/${s.id}`;
                        const altLabel  = isAttendingView ? '"I am attending" Card' : 'SNS Card';
                        return (
                        <div key={s.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                            {/* Card Preview (SNS or Attending depending on view) */}
                            <div
                                style={{ position: 'relative', aspectRatio: '1', background: '#0d0d1a', cursor: cardUrl ? 'zoom-in' : 'pointer', overflow: 'hidden' }}
                                onClick={() => cardUrl ? setPreviewCard({ url: getImageUrl(cardUrl), speaker: s }) : navigate(editRoute)}
                            >
                                {cardUrl ? (
                                    <img
                                        src={getImageUrl(cardUrl)}
                                        alt={altLabel}
                                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                                    />
                                ) : (
                                    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-muted)' }}>
                                        {isAttendingView ? <BsCalendarCheck size={28} style={{ opacity: 0.3 }} /> : <BsShare size={28} style={{ opacity: 0.3 }} />}
                                        <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>No card yet — click to create</span>
                                    </div>
                                )}
                                {/* Hover overlay — Edit + Download + Delete on a single row. */}
                                {cardUrl && (
                                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)', opacity: 0, transition: 'opacity 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexDirection: 'row', padding: '0 8px', flexWrap: 'nowrap' }}
                                        onMouseEnter={e => e.currentTarget.style.opacity = 1}
                                        onMouseLeave={e => e.currentTarget.style.opacity = 0}
                                    >
                                        <button onClick={e => { e.stopPropagation(); navigate(editRoute); }} title="Edit Card" style={{ background: isAttendingView ? 'rgba(139,92,246,0.9)' : 'rgba(19,217,153,0.9)', color: isAttendingView ? '#fff' : '#000', border: 'none', borderRadius: 8, padding: '6px 10px', fontWeight: 700, fontSize: '0.72rem', cursor: 'pointer', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                                            <BsPencil size={12} /> Edit
                                        </button>
                                        <button onClick={e => { e.stopPropagation(); handleDownloadCard(s, isAttendingView ? 'attending' : 'speaker'); }} title="Download Card" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)', borderRadius: 8, padding: '6px 10px', fontWeight: 600, fontSize: '0.72rem', cursor: 'pointer', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                                            <BsDownload size={12} /> Save
                                        </button>
                                        {canManage && (
                                            <button onClick={e => { e.stopPropagation(); handleDeleteCard(s, isAttendingView ? 'attending' : 'speaker'); }} title="Delete Card" style={{ background: 'rgba(239,68,68,0.85)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 10px', fontWeight: 600, fontSize: '0.72rem', cursor: 'pointer', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
                                                <BsTrash size={12} /> Delete
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                            {/* Speaker Info */}
                            <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <div style={{ width: 32, height: 32, borderRadius: 8, overflow: 'hidden', background: 'rgba(236,72,153,0.12)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-pink)', fontWeight: 700, fontSize: '0.85rem' }}>
                                        {s.photo_url ? <img src={s.photo_url} alt={s.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display = 'none'} /> : s.name?.charAt(0)}
                                    </div>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.salutation && `${s.salutation} `}{s.name}</div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.designation || s.company || '—'}</div>
                                    </div>
                                </div>
                                <div style={{ marginTop: 6, display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                    <button className="btn-action" title="View" onClick={() => navigate(`/speakers/view/${s.id}`)}><BsPersonBadge size={13} /></button>
                                    {/* Share is hidden in the attending gallery —
                                        attending cards are download-only. */}
                                    {s.sns_card_url && viewMode !== 'attending' && (
                                        <button
                                            className="btn-action"
                                            title="Share SNS card (WhatsApp, LinkedIn, X, …)"
                                            onClick={(e) => handleWhatsAppShare(e, s)}
                                            style={{ color: 'var(--accent)' }}
                                        >
                                            <BsShare size={13} />
                                        </button>
                                    )}
                                    {canManage && (
                                        <button className="btn-action" title="Edit Speaker" onClick={() => navigate(`/speakers/edit/${s.id}`)}><BsPencil size={13} /></button>
                                    )}
                                </div>
                            </div>
                        </div>
                        );
                    })}
                </div>
                )}
                {/* Hide the infinite-scroll loader while searching — search
                    matches against the full list, not the loaded slice. */}
                {hasMore && !gallerySearch.trim() && (
                    <div ref={loadMoreRef} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        Loading more speakers…
                    </div>
                )}
            </>
            ) : (
                <Table responsive className="premium-table mobile-cards">
                    <thead>
                        <tr>
                            {canManage && <th style={{ width: 28 }}></th>}
                            {canManage && bulkMode && (
                                <th style={{ width: 40 }}>
                                    <Form.Check
                                        type="checkbox"
                                        checked={speakers.length > 0 && selectedIds.length === speakers.length}
                                        onChange={toggleSelectAll}
                                    />
                                </th>
                            )}
                            <th>#</th>
                            <th>Name</th>
                            <th>Role</th>
                            <th>Company</th>
                            <th>Email</th>
                            <th>Event</th>
                            <th style={{ width: 140 }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {displayedSpeakers.map((s, i) => (
                            <tr key={s.id}
                                className={`${selectedIds.includes(s.id) ? 'selected-row' : ''}${dragOverIdx === i ? ' drag-over' : ''}`}
                                onDragOver={canManage ? (e) => handleDragOver(e, i) : undefined}
                                onDragLeave={canManage ? handleDragLeave : undefined}
                                onDrop={canManage ? (e) => handleDrop(e, i) : undefined}
                                style={dragOverIdx === i ? { outline: '2px dashed var(--accent)', outlineOffset: -2 } : undefined}
                            >
                                {canManage && (
                                    <td
                                        className="mob-hide"
                                        draggable
                                        onDragStart={(e) => handleDragStart(e, i)}
                                        style={{ cursor: 'grab', color: 'var(--text-muted)', textAlign: 'center', width: 28 }}
                                        title="Drag to reorder"
                                    >
                                        <BsGripVertical size={14} />
                                    </td>
                                )}
                                {canManage && bulkMode && (
                                    <td className="mob-hide">
                                        <Form.Check
                                            type="checkbox"
                                            checked={selectedIds.includes(s.id)}
                                            onChange={() => toggleSelect(s.id)}
                                        />
                                    </td>
                                )}
                                <td className="mob-hide" style={{ color: 'var(--text-muted)' }}>{s.serial ?? (i + 1)}</td>
                                <td data-label="Name">
                                    <div className="d-flex align-items-center gap-3">
                                        <div style={{ width: 40, height: 40, borderRadius: 10, overflow: 'hidden', background: 'rgba(236,72,153,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-pink)', fontWeight: 700, fontSize: '0.9rem' }}>
                                            {s.photo_url ? <img src={s.photo_url} alt={s.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => e.target.style.display = 'none'} /> : s.name?.charAt(0)}
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: 600 }}>
                                                {s.salutation && `${s.salutation} `}{s.name}
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{s.designation}</div>
                                        </div>
                                    </div>
                                </td>
                                <td data-label="Role"><span className={`badge-premium ${s.role ? 'status-ongoing' : ''}`} style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>{s.role || '—'}</span></td>
                                <td data-label="Company" style={{ color: 'var(--text-secondary)' }}>{s.company || '—'}</td>
                                <td data-label="Email" style={{ color: 'var(--accent-sky)', fontSize: '0.85rem', wordBreak: 'break-all' }}>{s.email || '—'}</td>
                                <td data-label="Event"><span className="badge-premium status-upcoming" style={{ whiteSpace: 'nowrap' }}>{s.event_title || '—'}</span></td>
                                <td className="mob-full">
                                    <div className="d-flex gap-2">
                                        <button className="btn-action" title="View" onClick={() => navigate(`/speakers/view/${s.id}`)}><BsPersonBadge size={13} /></button>
                                        {s.sns_card_url && (
                                            <button
                                                className="btn-action"
                                                title="Share SNS card (WhatsApp, LinkedIn, X, …)"
                                                onClick={(e) => handleWhatsAppShare(e, s)}
                                                style={{ color: 'var(--accent)' }}
                                            >
                                                <BsShare size={13} />
                                            </button>
                                        )}
                                        {canManage && (
                                            <>
                                                <button
                                                    className="btn-action"
                                                    title={s.is_hidden ? 'Hidden from public JSON — click to show' : 'Visible in public JSON — click to hide'}
                                                    onClick={() => handleToggleVisibility(s)}
                                                    style={s.is_hidden ? { color: '#ef4444' } : undefined}
                                                >
                                                    {s.is_hidden ? <BsEyeSlash size={13} /> : <BsEye size={13} />}
                                                </button>
                                                <button className="btn-action" title="Edit" onClick={() => navigate(`/speakers/edit/${s.id}`)}><BsPencil size={13} /></button>
                                                <button className="btn-action danger" title="Delete Speaker" onClick={() => handleDelete(s.id)}><BsTrash size={13} /></button>
                                            </>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
            {viewMode === 'table' && hasMore && (
                <div ref={loadMoreRef} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    Loading more speakers…
                </div>
            )}

            {/* SNS Card Preview Modal — rendered via portal to document.body so
                it escapes the page-level `.animate-in` wrapper, whose lingering
                transform from fadeInUp turns it into a containing block for
                position:fixed descendants and bounds the modal inside the page
                instead of the viewport. */}
            {previewCard && createPortal(
                <div
                    onClick={() => setPreviewCard(null)}
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.88)', zIndex: 9999, display: 'grid', placeItems: 'center', cursor: 'zoom-out' }}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, cursor: 'default', padding: '16px 16px 20px', maxWidth: '100vw', maxHeight: '100vh', boxSizing: 'border-box' }}
                    >
                        <img
                            src={previewCard.url}
                            alt="SNS Card Preview"
                            style={{ display: 'block', maxWidth: 'min(88vw, 560px)', maxHeight: 'calc(100vh - 90px)', width: 'auto', height: 'auto', borderRadius: 12, boxShadow: '0 24px 64px rgba(0,0,0,0.7)', flexShrink: 0 }}
                        />
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'center' }}>
                            <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.9rem' }}>{previewCard.speaker.name}</span>
                            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.78rem' }}>{previewCard.speaker.designation}</span>
                            <button onClick={() => handleDownloadCard(previewCard.speaker)}
                                style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '6px 14px', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, marginLeft: 6 }}>
                                <BsDownload size={13} /> Download
                            </button>
                            <button onClick={(e) => { handleWhatsAppShare(e, previewCard.speaker); setPreviewCard(null); }}
                                style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                                <BsShare size={13} /> Share
                            </button>
                            <button onClick={() => navigate(viewMode === 'attending' ? `/speakers/attending/${previewCard.speaker.id}` : `/speakers/sns/${previewCard.speaker.id}`)}
                                style={{ background: viewMode === 'attending' ? '#8b5cf6' : '#13d999', color: viewMode === 'attending' ? '#fff' : '#000', border: 'none', borderRadius: 8, padding: '6px 16px', fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer' }}>
                                Edit Card
                            </button>
                            {canManage && (
                                <button onClick={() => handleDeleteCard(previewCard.speaker, viewMode === 'attending' ? 'attending' : 'speaker')}
                                    style={{ background: 'rgba(239,68,68,0.85)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontWeight: 600, fontSize: '0.78rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <BsTrash size={12} /> Delete Card
                                </button>
                            )}
                            <button onClick={() => setPreviewCard(null)}
                                style={{ background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '6px 14px', fontSize: '0.78rem', cursor: 'pointer' }}>
                                Close
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Bulk Card Generator Modal — handles both 'speaker' (SNS) and
                'attending' modes; the active mode is held in bulkCardType. */}
            <BulkSNSModal
                show={showBulkModal}
                onHide={() => setBulkCardType(null)}
                speakers={speakers}
                filterEvent={filterEvent}
                cardType={bulkCardType || 'speaker'}
                onComplete={() => load()}
            />

            {/* Import from Google Sheet Modal */}
            <Modal show={showGSheetModal} onHide={() => !gSheetImporting && setShowGSheetModal(false)} centered contentClassName="premium-modal">
                <Modal.Header closeButton={!gSheetImporting} closeVariant="white">
                    <Modal.Title style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <BsFileEarmarkSpreadsheet style={{ color: '#13d999' }} /> Import Speakers from Google Sheet
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <div className="mb-3 p-3" style={{ background: 'rgba(19,217,153,0.05)', border: '1px solid rgba(19,217,153,0.15)', borderRadius: 10, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        <strong style={{ color: '#13d999' }}>Before you start:</strong>
                        <ol className="mb-0 mt-2 ps-3">
                            <li>Open your Google Sheet, click <strong>Share</strong>, and set access to <strong>"Anyone with the link — Viewer"</strong>.</li>
                            <li>The first row must be column headers. Supported columns: <em>Salutation, Name, Bio, Designation, Company, Location, Email, Office No, Role, Topic, Panel, Mobile No, Category, Spokesperson Name, LinkedIn URL, Photo URL</em>.</li>
                            <li><strong>Name</strong> is required for each row. Rows with no name are skipped.</li>
                            <li><strong>Photo URL</strong> is optional. You can paste:
                                <ul className="mb-0 mt-1">
                                    <li>a direct image link (<em>https://example.com/photo.jpg</em>), or</li>
                                    <li>a Google Drive sharing link (<em>drive.google.com/file/d/.../view</em>) — the photo file itself must also be shared as <strong>"Anyone with the link — Viewer"</strong>.</li>
                                </ul>
                                Photos are downloaded and stored on the server during import. Rows with broken or private photo links still import — just without a photo.
                            </li>
                        </ol>
                    </div>

                    <Form.Group className="mb-3">
                        <Form.Label>Google Sheet URL <span className="text-danger">*</span></Form.Label>
                        <Form.Control
                            className="form-control-dark"
                            placeholder="https://docs.google.com/spreadsheets/d/..."
                            value={gSheetUrl}
                            onChange={e => setGSheetUrl(e.target.value)}
                            disabled={gSheetImporting}
                        />
                    </Form.Group>

                    <Form.Group className="mb-3">
                        <Form.Label>Import into Event <span className="text-danger">*</span></Form.Label>
                        <Form.Select
                            className="form-select-dark"
                            value={gSheetEventId}
                            onChange={e => setGSheetEventId(e.target.value)}
                            disabled={gSheetImporting || (user?.role === 'employee' && !!user?.assigned_event_id)}
                        >
                            <option value="">Select an event</option>
                            {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                        </Form.Select>
                    </Form.Group>

                    {gSheetError && (
                        <div className="p-2 mb-0" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, color: '#f87171', fontSize: '0.8rem' }}>
                            {gSheetError}
                        </div>
                    )}
                </Modal.Body>
                <Modal.Footer style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <Button variant="link" onClick={() => setShowGSheetModal(false)} disabled={gSheetImporting} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
                        Cancel
                    </Button>
                    <Button className="btn-accent d-flex align-items-center gap-2" onClick={handleImportGSheet} disabled={gSheetImporting}>
                        {gSheetImporting ? <><Spinner size="sm" animation="border" /> Importing…</> : <><BsFileEarmarkSpreadsheet size={14} /> Import Speakers</>}
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* Public JSON API Endpoints Modal */}
            <ApiEndpointsModal apiEvent={apiEvent} onHide={() => setApiEvent(null)} />
        </div>
    );
}

function BulkSNSModal({ show, onHide, speakers, filterEvent, onComplete, cardType = 'speaker' }) {
    // Pivot all card-type-specific behavior off one boolean. Keeps the diff
    // localized (template column, save call, zip-source field, seed text).
    const isAttending = cardType === 'attending';
    const labels = isAttending
        ? { title: 'Bulk "I am Attending" Card Generator', zipName: 'attending-cards.zip', filePrefix: 'attending', emptyTitle: 'No attending master template found', emptyHint: 'Design a master template for "I am attending" first before generating cards in bulk.', designRoute: `/events/attending-template/${filterEvent}` }
        : { title: 'Bulk SNS Card Generator',           zipName: 'sns-cards.zip',         filePrefix: 'sns',        emptyTitle: 'No master template found',           emptyHint: 'Design a master template for this event first before generating cards in bulk.',          designRoute: `/events/sns-template/${filterEvent}` };

    const navigate = useNavigate();
    const [event, setEvent] = useState(null);
    const [template, setTemplate] = useState(null);
    const [generating, setGenerating] = useState(false);
    const [renderIndex, setRenderIndex] = useState(-1);
    const [results, setResults] = useState([]);
    const [downloadingZip, setDownloadingZip] = useState(false);
    const [selectedIds, setSelectedIds] = useState([]);
    const cardRef = useRef(null);
    const isProcessingRef = useRef(false);

    const selectedSpeakers = speakers.filter(s => selectedIds.includes(s.id));

    const toggleSelect = (id) => {
        if (generating) return;
        setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
    };

    const toggleSelectAll = () => {
        if (generating) return;
        if (selectedIds.length === speakers.length) setSelectedIds([]);
        else setSelectedIds(speakers.map(s => s.id));
    };

    const handleDownloadAllGenerated = async (doneResults) => {
        setDownloadingZip(true);
        try {
            // Re-fetch speakers to get fresh card-url values for the active card type.
            const { data: freshSpeakers } = await getSpeakers(filterEvent || undefined);
            const urlField = isAttending ? 'attending_card_url' : 'sns_card_url';
            const zip = new JSZip();
            await Promise.all(doneResults.map(async (r) => {
                const fresh = freshSpeakers.find(s => s.id === r.id);
                if (!fresh?.[urlField]) return;
                try {
                    const res = await fetch(getImageUrl(fresh[urlField]));
                    const blob = await res.blob();
                    zip.file(`${labels.filePrefix}-${fresh.name.replace(/\s+/g, '-').toLowerCase()}.png`, blob);
                } catch (e) { console.warn(`Skip ${fresh.name}`, e); }
            }));
            const content = await zip.generateAsync({ type: 'blob' });
            const blobUrl = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = labels.zipName;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(blobUrl); }, 1000);
        } catch (err) {
            console.error('Download failed', err);
        } finally {
            setDownloadingZip(false);
        }
    };

    useEffect(() => {
        if (!show || !filterEvent) return;
        setResults([]);
        setRenderIndex(-1);
        setGenerating(false);
        isProcessingRef.current = false;
        setSelectedIds(speakers.map(s => s.id));
        getEvent(filterEvent).then(r => {
            const evt = r.data;
            setEvent(evt);
            const rawTemplate = isAttending ? evt.attending_card_template : evt.sns_card_template;
            if (rawTemplate) {
                try {
                    const tmpl = typeof rawTemplate === 'string'
                        ? JSON.parse(rawTemplate)
                        : rawTemplate;
                    setTemplate(tmpl);
                } catch (e) { console.error('Template parse failed', e); }
            } else {
                setTemplate(null);
            }
        });
        setResults(speakers.map(s => ({ id: s.id, name: s.name, photo_url: s.photo_url, designation: s.designation, company: s.company, status: 'pending' })));
    }, [show, filterEvent]);

    const startGeneration = () => {
        if (!template || generating || selectedIds.length === 0) return;
        setGenerating(true);
        isProcessingRef.current = false;
        setResults(prev => prev.map(r => selectedIds.includes(r.id) ? { ...r, status: 'pending' } : { ...r, status: 'skipped' }));
        setRenderIndex(0);
    };

    useEffect(() => {
        if (renderIndex < 0 || renderIndex >= selectedSpeakers.length || !generating) return;
        if (isProcessingRef.current) return;
        isProcessingRef.current = true;

        const captureAndUpload = async () => {
            const speaker = selectedSpeakers[renderIndex];
            try {
                if (cardRef.current) {
                    const imgs = Array.from(cardRef.current.getElementsByTagName('img'));
                    await Promise.all(imgs.map(img =>
                        img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })
                    ));
                }
                await new Promise(r => setTimeout(r, 400));
                const dataUrl = await toPng(cardRef.current, { pixelRatio: 2, style: { transform: 'none' } });
                const blob = await (await fetch(dataUrl)).blob();
                const formData = new FormData();
                formData.append('sns_card', blob, `${labels.filePrefix}-bulk-${speaker.id}-${Date.now()}.png`);
                const meta = { ...template, background: template.background && !template.background.startsWith('blob:') ? template.background : null };
                const saveFn = isAttending ? saveAttendingCard : saveSNSCard;
                await saveFn(speaker.id, formData, meta);
                setResults(prev => prev.map(r => r.id === speaker.id ? { ...r, status: 'done' } : r));
            } catch (err) {
                console.error(`Bulk SNS failed for ${speaker.name}:`, err);
                setResults(prev => prev.map(r => r.id === speaker.id ? { ...r, status: 'failed' } : r));
            }
            isProcessingRef.current = false;
            const next = renderIndex + 1;
            if (next < selectedSpeakers.length) {
                setRenderIndex(next);
            } else {
                setGenerating(false);
                setRenderIndex(-1);
                onComplete?.();
            }
        };

        captureAndUpload();
    }, [renderIndex]);

    const currentSpeaker = renderIndex >= 0 && renderIndex < selectedSpeakers.length ? selectedSpeakers[renderIndex] : null;
    const selectedResults = results.filter(r => selectedIds.includes(r.id));
    const doneCount = selectedResults.filter(r => r.status === 'done').length;
    const failedCount = selectedResults.filter(r => r.status === 'failed').length;
    const isComplete = !generating && selectedResults.length > 0 && doneCount + failedCount === selectedResults.length;
    const allSelected = selectedIds.length === speakers.length && speakers.length > 0;

    const canvasSize = template?.canvasSize || { width: 1080, height: 1080 };
    const bgUrl = template?.background && !template.background.startsWith('blob:')
        ? template.background
        : event?.sns_card_bg_url ? getImageUrl(event.sns_card_bg_url) : null;
    const bgOverlay = template?.bgOverlay || { color: '#000000', opacity: 0.3 };
    const bgPosition = template?.bgPosition || 'center';
    const positions = template?.positions || {};
    const elements = template?.elements || {};
    const photoSettings = template?.photoSettings || { size: 400 };
    const logoSettings = template?.logoSettings || { showEvent: true, showCompany: true, eventSize: 100, companySize: 100 };

    return (
        <>
            <Modal show={show} onHide={!generating ? onHide : undefined} centered size="md" contentClassName="premium-modal">
                <Modal.Header closeButton={!generating} closeVariant="white">
                    <Modal.Title style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <BsLightningChargeFill style={{ color: isAttending ? '#a78bfa' : '#13d999' }} /> {labels.title}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {!template ? (
                        <div className="text-center py-5">
                            <BsLayoutTextWindow size={40} style={{ color: '#444', marginBottom: 16 }} />
                            <p className="text-white mb-1">{labels.emptyTitle}</p>
                            <p className="text-muted small mb-4">{labels.emptyHint}</p>
                            <Button className="btn-accent" size="sm" onClick={() => { onHide(); navigate(labels.designRoute); }}>
                                <BsLayoutTextWindow className="me-2" /> Design Master Template
                            </Button>
                        </div>
                    ) : (
                        <>
                            {/* Progress bar */}
                            <div className="mb-3 p-3" style={{ background: 'rgba(19,217,153,0.05)', border: '1px solid rgba(19,217,153,0.12)', borderRadius: 10 }}>
                                <div className="d-flex justify-content-between align-items-center mb-2">
                                    <span className="small text-white fw-semibold">{selectedIds.length} of {speakers.length} selected</span>
                                    <span className="small" style={{ color: '#13d999' }}>
                                        {isComplete ? `Done — ${doneCount} generated${failedCount > 0 ? `, ${failedCount} failed` : ''}` : generating ? `${doneCount + failedCount} / ${selectedIds.length}` : 'Ready'}
                                    </span>
                                </div>
                                <ProgressBar now={selectedIds.length ? ((doneCount + failedCount) / selectedIds.length) * 100 : 0}
                                    style={{ height: 5, background: 'rgba(255,255,255,0.08)', borderRadius: 4 }}
                                    variant="success" />
                            </div>

                            {/* Select All header */}
                            <div className="d-flex align-items-center gap-2 px-1 py-2 mb-1" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                <Form.Check
                                    type="checkbox"
                                    checked={allSelected}
                                    onChange={toggleSelectAll}
                                    disabled={generating}
                                    id="bulk-sns-select-all"
                                />
                                <label htmlFor="bulk-sns-select-all" className="small text-white fw-semibold mb-0" style={{ cursor: generating ? 'not-allowed' : 'pointer' }}>
                                    {allSelected ? 'Deselect all' : 'Select all'}
                                </label>
                            </div>

                            {/* Speaker list */}
                            <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
                                {results.map(r => {
                                    const isSelected = selectedIds.includes(r.id);
                                    const isCurrent = currentSpeaker?.id === r.id && generating;
                                    return (
                                        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 4px', borderBottom: '1px solid rgba(255,255,255,0.05)', opacity: isSelected ? 1 : 0.4 }}>
                                            <Form.Check
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => toggleSelect(r.id)}
                                                disabled={generating}
                                            />
                                            <div style={{ width: 18, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                {isSelected && r.status === 'done' && <BsCheckCircleFill size={14} style={{ color: '#13d999' }} />}
                                                {isSelected && r.status === 'failed' && <BsXCircleFill size={14} style={{ color: '#ef4444' }} />}
                                                {isSelected && r.status === 'pending' && isCurrent && <Spinner animation="border" style={{ width: 14, height: 14, borderWidth: 2, color: '#13d999' }} />}
                                                {isSelected && r.status === 'pending' && !isCurrent && <div style={{ width: 14, height: 14, borderRadius: '50%', border: '1.5px solid #333' }} />}
                                            </div>
                                            <span className="small text-white flex-grow-1">{r.name}</span>
                                            <span style={{ fontSize: '0.68rem', color: !isSelected ? '#555' : r.status === 'done' ? '#13d999' : r.status === 'failed' ? '#ef4444' : isCurrent ? '#aaa' : '#444' }}>
                                                {!isSelected ? 'Skipped' : r.status === 'done' ? 'Generated' : r.status === 'failed' ? 'Failed' : isCurrent ? 'Rendering...' : 'Pending'}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </>
                    )}
                </Modal.Body>
                {template && (
                    <Modal.Footer style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <Button variant="link" onClick={onHide} disabled={generating} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
                            {generating ? 'Please wait...' : 'Close'}
                        </Button>
                        {isComplete && doneCount > 0 && (
                            <Button variant="outline-light" size="sm" style={{ borderColor: 'rgba(255,255,255,0.15)', fontSize: '0.82rem' }}
                                onClick={() => handleDownloadAllGenerated(results.filter(r => r.status === 'done'))}
                                disabled={downloadingZip}>
                                {downloadingZip ? <Spinner size="sm" animation="border" className="me-1" /> : <BsDownload className="me-1" />}
                                {downloadingZip ? 'Zipping...' : `Download All (${doneCount})`}
                            </Button>
                        )}
                        {generating ? (
                            <Button className="btn-accent" disabled>
                                <Spinner size="sm" animation="border" className="me-2" />
                                Generating ({doneCount + failedCount}/{selectedIds.length})
                            </Button>
                        ) : (
                            <Button className="btn-accent" onClick={startGeneration} disabled={selectedIds.length === 0}>
                                <BsLightningChargeFill className="me-2" />
                                {isComplete ? `Regenerate (${selectedIds.length})` : `Generate ${selectedIds.length} Card${selectedIds.length === 1 ? '' : 's'}`}
                            </Button>
                        )}
                    </Modal.Footer>
                )}
            </Modal>

            {/* Hidden offscreen card renderer */}
            {currentSpeaker && template && (
                <div style={{ position: 'fixed', left: -99999, top: 0, pointerEvents: 'none', zIndex: -1, overflow: 'hidden' }}>
                    <div ref={cardRef} style={{ width: canvasSize.width, height: canvasSize.height, position: 'relative', overflow: 'hidden', background: '#1e1e2f' }}>
                        {bgUrl && (
                            <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
                                <img src={bgUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: bgPosition, display: 'block' }} />
                                <div style={{ position: 'absolute', inset: 0, backgroundColor: bgOverlay.color, opacity: bgOverlay.opacity }} />
                            </div>
                        )}
                        {positions.photo && (
                            <div style={{ position: 'absolute', left: positions.photo.x * canvasSize.width, top: positions.photo.y * canvasSize.height, width: photoSettings.size, height: photoSettings.size, borderRadius: 8, overflow: 'hidden', zIndex: 5 }}>
                                {currentSpeaker.photo_url && <img src={getImageUrl(currentSpeaker.photo_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                            </div>
                        )}
                        {['name', 'designation', 'company'].map(key => {
                            const el = elements[key];
                            const pos = positions[key];
                            if (!el || !pos || el.show === false) return null;
                            // Slot semantics flip with cardType: in attending mode the
                            // big slot reads "I am attending", the mid slot reads the
                            // event title, and the small slot reads who's posting.
                            let text;
                            // Both modes now render the same way: the three standard
                            // slots hold real speaker data. Operators who want
                            // "I am attending" / event title text on the card add
                            // them as custom text elements in the master template.
                            text = key === 'name' ? currentSpeaker.name
                                 : key === 'designation' ? currentSpeaker.designation
                                 : currentSpeaker.company;
                            return (
                                <div key={key} style={{ position: 'absolute', left: pos.x * canvasSize.width, top: pos.y * canvasSize.height, color: el.color, fontSize: el.fontSize, fontFamily: el.fontFamily, fontWeight: el.fontWeight, letterSpacing: `${el.letterSpacing || 0}px`, textDecoration: ['underline','overline'].includes(el.textDecoration) ? el.textDecoration : 'none', textTransform: ['uppercase','capitalize'].includes(el.textDecoration) ? el.textDecoration : 'none', whiteSpace: 'pre-wrap', zIndex: 20 }}>
                                    {text || ''}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </>
    );
}
