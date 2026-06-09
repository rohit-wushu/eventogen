import { useState, useEffect, useRef, useMemo } from 'react';
import { Table, Button, Modal, Form, Alert, Row, Col, OverlayTrigger, Popover } from 'react-bootstrap';
import { useAuth } from '../context/AuthContext';
import { getPartners, createPartner, updatePartner, deletePartner, reorderPartners, getEvents, getPartnerCategories, getSpeakers, getPartnerShowcaseConfig, savePartnerShowcaseConfig } from '../services/api';
import PartnerShowcaseCustomizer from '../components/PartnerShowcaseCustomizer';
import PartnerLogoArranger from '../components/PartnerLogoArranger';
import AsyncButton from '../components/AsyncButton';
import { BsPlus, BsPencil, BsTrash, BsBriefcase, BsLink45Deg, BsEye, BsGripVertical, BsTags, BsGear, BsCheck2 } from 'react-icons/bs';
import { useNavigate } from 'react-router-dom';
import { getImageUrl } from '../utils/imageUrl';

export default function PartnersPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [partners, setPartners] = useState([]);
    const [events, setEvents] = useState([]);
    const [categories, setCategories] = useState([]);
    const [speakers, setSpeakers] = useState([]);
    const [show, setShow] = useState(false);
    const [editing, setEditing] = useState(null);
    const [error, setError] = useState('');
    const [form, setForm] = useState({
        name: '',
        website: '',
        logo_url: '',
        logo_width: '',
        logo_height: '',
        event_id: '',
        category_id: '',
        sequence: 0,
        wishlist: '',
        wishlist_speakers: []
    });
    const [logo, setLogo] = useState(null);
    const [preview, setPreview] = useState('');
    const [filterEvent, setFilterEvent] = useState('');

    // Drag-and-drop state
    const dragIdxRef = useRef(null);
    const [dragOverIdx, setDragOverIdx] = useState(null);
    const [isSaving, setIsSaving] = useState(false);
    // Active flag used to attach the global auto-scroll listener only
    // while a row is being dragged.
    const [isDragging, setIsDragging] = useState(false);

    // Infinite-scroll slice. Renders only the first `visibleCount` rows; a
    // loadMoreRef sentinel at the bottom triggers expansion via an
    // IntersectionObserver. Without this, a 100-partner event mounts 100
    // rows + 100 popovers + 100 drag handlers up-front, which jitters.
    const [visibleCount, setVisibleCount] = useState(20);
    const loadMoreRef = useRef(null);

    // Auto-scroll while dragging a row near the top or bottom of the
    // scrollable area — without this, reordering across a long partner
    // list forces the user to drop, manually scroll, drop again.
    //
    // The app layout scrolls a `.content-area` div, not the window, so
    // we target that element directly (with a fallback to window for
    // any embed/iframe context).
    useEffect(() => {
        if (!isDragging) return;

        const EDGE_PX = 90;     // distance from container edge that triggers scroll
        const MAX_SPEED = 28;   // pixels per frame at the very edge
        let pointerY = null;
        let rafId = null;

        const onDragOver = (e) => { pointerY = e.clientY; };
        const onDragEnd = () => { pointerY = null; };

        // Pick the scroll target once per drag — the app shell's
        // .content-area is the real scrolling element, not window.
        const scroller = document.querySelector('.content-area');

        const tick = () => {
            if (pointerY !== null && scroller) {
                const rect = scroller.getBoundingClientRect();
                let delta = 0;
                if (pointerY < rect.top + EDGE_PX) {
                    const dist = Math.max(0, pointerY - rect.top);
                    delta = -Math.ceil(MAX_SPEED * (1 - dist / EDGE_PX));
                } else if (pointerY > rect.bottom - EDGE_PX) {
                    const dist = Math.max(0, rect.bottom - pointerY);
                    delta = Math.ceil(MAX_SPEED * (1 - dist / EDGE_PX));
                }
                if (delta !== 0) scroller.scrollTop += delta;
            }
            rafId = requestAnimationFrame(tick);
        };

        window.addEventListener('dragover', onDragOver);
        window.addEventListener('dragend', onDragEnd);
        window.addEventListener('drop', onDragEnd);
        rafId = requestAnimationFrame(tick);

        return () => {
            cancelAnimationFrame(rafId);
            window.removeEventListener('dragover', onDragOver);
            window.removeEventListener('dragend', onDragEnd);
            window.removeEventListener('drop', onDragEnd);
        };
    }, [isDragging]);

    // Partner showcase customizer modal — picks layout template and per-event
    // overrides. Opens from the gear button in the header (only meaningful
    // when an event is selected).
    const [showShowcase, setShowShowcase] = useState(false);
    const [showcaseTemplate, setShowcaseTemplate] = useState('tiered');
    const [showcaseConfig, setShowcaseConfig] = useState({});
    const [showcaseSaveStatus, setShowcaseSaveStatus] = useState(''); // '' | 'saving' | 'saved' | 'error'
    const showcaseSaveTimer = useRef(null);
    const showcaseLinkCopiedRef = useRef(null);
    const [showcaseLinkCopied, setShowcaseLinkCopied] = useState(false);

    const canManage = ['admin', 'manager'].includes(user?.role) || (user?.role === 'employee' && !!user?.assigned_event_id);

    // Showcase: load saved template/config when the modal opens for the
    // currently-filtered event, autosave changes, copy public link helper.
    const openShowcase = async () => {
        if (!filterEvent) return;
        setShowShowcase(true);
        setShowcaseSaveStatus('');
        try {
            const r = await getPartnerShowcaseConfig(filterEvent);
            setShowcaseTemplate(r.data?.template || 'tiered');
            setShowcaseConfig(r.data?.config || {});
        } catch {
            setShowcaseTemplate('tiered');
            setShowcaseConfig({});
        }
    };
    const flushShowcase = async (tpl, cfg) => {
        if (!filterEvent) return;
        try {
            setShowcaseSaveStatus('saving');
            await savePartnerShowcaseConfig(filterEvent, { template: tpl, config: cfg });
            setShowcaseSaveStatus('saved');
            setTimeout(() => setShowcaseSaveStatus(s => s === 'saved' ? '' : s), 1200);
        } catch {
            setShowcaseSaveStatus('error');
        }
    };
    const onPickShowcaseTemplate = (key) => {
        setShowcaseTemplate(key);
        // Replace overrides with the preset's defaults so the customizer
        // rows reflect the new template's colours/spacing immediately.
        import('../components/PartnerShowcaseCustomizer').then(({ PARTNER_SHOWCASE_TEMPLATES }) => {
            const cfg = PARTNER_SHOWCASE_TEMPLATES[key]?.config || {};
            setShowcaseConfig({ ...cfg });
            clearTimeout(showcaseSaveTimer.current);
            showcaseSaveTimer.current = setTimeout(() => flushShowcase(key, cfg), 400);
        });
    };
    const onPatchShowcaseConfig = (patch) => {
        setShowcaseConfig(prev => {
            const next = { ...prev, ...patch };
            clearTimeout(showcaseSaveTimer.current);
            showcaseSaveTimer.current = setTimeout(() => flushShowcase(showcaseTemplate, next), 600);
            return next;
        });
    };
    const showcasePublicUrl = filterEvent
        ? `${window.location.origin}/partners/${filterEvent}`
        : '';

    // Persist a fresh `rows` layout from the multi-row arranger. We push
    // the rows directly into the showcase config (`config.rows`) — the
    // existing flushShowcase autosave handles the PUT.
    const handleRowsChange = (nextRows) => {
        setShowcaseConfig(prev => {
            const next = { ...prev, rows: nextRows };
            clearTimeout(showcaseSaveTimer.current);
            showcaseSaveTimer.current = setTimeout(() => flushShowcase(showcaseTemplate, next), 500);
            return next;
        });
    };
    const copyShowcaseLink = async () => {
        try {
            await navigator.clipboard.writeText(showcasePublicUrl);
            setShowcaseLinkCopied(true);
            clearTimeout(showcaseLinkCopiedRef.current);
            showcaseLinkCopiedRef.current = setTimeout(() => setShowcaseLinkCopied(false), 2000);
        } catch {/* ignore */}
    };

    const load = () => {
        getPartners().then(r => {
            setPartners(Array.isArray(r.data) ? r.data : []);
            setVisibleCount(20);
        }).catch(() => { });
        getEvents().then(r => setEvents(Array.isArray(r.data) ? r.data : [])).catch(() => { });
        getPartnerCategories().then(r => setCategories(Array.isArray(r.data) ? r.data : [])).catch(() => { });
        getSpeakers().then(r => setSpeakers(Array.isArray(r.data) ? r.data : [])).catch(() => { });
    };
    useEffect(() => { load(); }, []);

    // Reset the visible slice whenever the event filter narrows the list —
    // otherwise an earlier expanded count "sticks" and lets us render rows
    // that no longer match the filter (harmless, but wastes a re-render
    // pass and confuses the loadMoreRef bookkeeping).
    useEffect(() => { setVisibleCount(20); }, [filterEvent]);

    // IntersectionObserver-driven incremental loading. Fires when the
    // sentinel below the table scrolls into view — bumps the slice by 20.
    // We rebind on every count-change so the observer captures the latest
    // closure and disconnects cleanly when there's nothing more to load.
    useEffect(() => {
        if (!loadMoreRef.current) return;
        if (visibleCount >= partners.length) return;
        const node = loadMoreRef.current;
        const obs = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) setVisibleCount(v => v + 20);
        }, { rootMargin: '200px' });
        obs.observe(node);
        return () => obs.disconnect();
    }, [visibleCount, partners.length]);

    // Refetch the category list whenever the partner-form's event changes,
    // so the dropdown only shows categories belonging to that event (plus legacy globals).
    useEffect(() => {
        if (!show) return;
        getPartnerCategories(form.event_id || undefined)
            .then(r => setCategories(Array.isArray(r.data) ? r.data : []))
            .catch(() => { });
    }, [form.event_id, show]);

    // If the currently selected category isn't valid for the new event, clear it.
    useEffect(() => {
        if (!show || !form.category_id) return;
        if (!categories.some(c => String(c.id) === String(form.category_id))) {
            setForm(f => ({ ...f, category_id: '' }));
        }
    }, [categories, show]);

    // --- Drag-and-drop handlers (operate on filteredPartners list) ---
    const handleDragStart = (e, idx) => {
        dragIdxRef.current = idx;
        e.dataTransfer.effectAllowed = 'move';
        setIsDragging(true);
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
        setIsDragging(false);
        const dragIdx = dragIdxRef.current;
        if (dragIdx === null || dragIdx === dropIdx) return;

        // Re-order the filtered list
        const reordered = [...filteredPartners];
        const [moved] = reordered.splice(dragIdx, 1);
        reordered.splice(dropIdx, 0, moved);

        // Assign new contiguous sequences (1-based)
        const updates = reordered.map((p, i) => ({ id: p.id, sequence: i + 1 }));

        // Optimistic UI update: merge back into full partners list preserving unfiltered ones
        setPartners(prev => {
            const filteredIds = new Set(filteredPartners.map(p => p.id));
            const others = prev.filter(p => !filteredIds.has(p.id));
            const updated = reordered.map((p, i) => ({ ...p, sequence: i + 1 }));
            return [...others, ...updated].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
        });

        // Persist to backend
        setIsSaving(true);
        try {
            await reorderPartners(updates);
        } catch {
            load(); // Revert on error
        } finally {
            setIsSaving(false);
        }
        dragIdxRef.current = null;
    };

    const handleDragEnd = () => {
        dragIdxRef.current = null;
        setDragOverIdx(null);
        setIsDragging(false);
    };

    // --- Modal ---
    const openModal = (item = null) => {
        if (item) {
            setEditing(item);
            setForm({
                name: item.name,
                website: item.website || '',
                logo_url: item.logo_url || '',
                logo_width: item.logo_width || '',
                logo_height: item.logo_height || '',
                event_id: item.event_id || '',
                category_id: item.category_id || '',
                sequence: item.sequence || 0,
                wishlist: item.wishlist || '',
                wishlist_speakers: item.wishlist_speakers ? item.wishlist_speakers.map(s => s.id) : []
            });
            if (!item.wishlist_speakers) {
                import('../services/api').then(api => {
                    api.getPartner(item.id).then(r => {
                        setForm(f => ({ ...f, wishlist_speakers: r.data.wishlist_speakers.map(s => s.id) }));
                    });
                });
            }
            setPreview(item.logo_url || '');
        } else {
            setEditing(null);
            setForm({
                name: '', website: '', logo_url: '',
                logo_width: '', logo_height: '',
                event_id: user?.role === 'employee' ? user.assigned_event_id : '',
                category_id: '', sequence: 0,
                wishlist: '', wishlist_speakers: []
            });
            setPreview('');
        }
        setLogo(null);
        setError('');
        setShow(true);
    };

    const handleSave = async () => {
        if (!form.category_id) return setError('Please select a category');

        const data = new FormData();
        Object.keys(form).forEach(key => {
            if (key === 'wishlist_speakers') {
                data.append(key, JSON.stringify(form[key]));
            } else {
                data.append(key, form[key]);
            }
        });
        if (logo) data.append('logo', logo);
        if (editing) data.append('id', editing.id);

        try {
            if (editing) await updatePartner(data);
            else await createPartner(data);
            setShow(false);
            load();
        } catch (err) { setError(err.response?.data?.error || 'Failed'); }
    };

    const handleDelete = async (id) => { if (window.confirm('Delete?')) { await deletePartner(id); load(); } };

    // Always sort by the `sequence` field (then name) so the table honours
    // the ordering set in the Edit Partner modal — the API order alone can't
    // be relied on once a row's sequence is edited inline. Mirrors the
    // backend's `ORDER BY p.sequence ASC, p.name ASC`. Memoised so the
    // filter+sort doesn't rerun on every keystroke / drag re-render.
    const filteredPartners = useMemo(() => (filterEvent
        ? partners.filter(p => String(p.event_id) === String(filterEvent))
        : partners
    ).slice().sort((a, b) =>
        (a.sequence || 0) - (b.sequence || 0) ||
        (a.name || '').localeCompare(b.name || '')
    ), [partners, filterEvent]);

    // Slice for the table render. Drag handlers still receive the same
    // `i` they used to (an index into the displayed list) — and since the
    // drag-aware sort already keeps the matched ID set, partial rendering
    // doesn't break reordering.
    const displayedPartners = filteredPartners.slice(0, visibleCount);
    const hasMorePartners = visibleCount < filteredPartners.length;

    return (
        <div className="animate-in">
            <div className="page-header d-flex justify-content-between align-items-center">
                <div><h4>Partners</h4>
                    <p className='text-white small'>Manage sponsors and partners for your events. {canManage && <span style={{ color: 'var(--accent-emerald)', fontWeight: 500 }}>Drag rows to reorder.</span>}</p></div>
                <div className="d-flex gap-2 align-items-center">
                    {isSaving && <span style={{ fontSize: '0.78rem', color: 'var(--accent-emerald)', opacity: 0.8 }}>Saving order…</span>}
                    <Form.Select
                        className="form-select-dark"
                        style={{ width: 220 }}
                        value={filterEvent}
                        onChange={(e) => setFilterEvent(e.target.value)}
                    >
                        <option value="">All Events</option>
                        {events.map(ev => (
                            <option key={ev.id} value={ev.id}>{ev.title}</option>
                        ))}
                    </Form.Select>
                    {canManage && (
                        <>
                            <Button
                                variant="outline-light"
                                className="d-flex align-items-center gap-2"
                                onClick={openShowcase}
                                disabled={!filterEvent}
                                title={filterEvent ? 'Pick a public showcase template for this event' : 'Select an event first to customize its public partners page'}
                                style={{ border: '1px solid var(--border-subtle)', background: 'rgba(255,255,255,0.03)', color: '#fff' }}
                            >
                                <BsGear size={16} /> Showcase
                            </Button>
                            <Button variant="outline-light" className="d-flex align-items-center gap-2" onClick={() => navigate('/partner-categories')} style={{ border: '1px solid var(--border-subtle)', background: 'rgba(255,255,255,0.03)', color: '#fff' }}>
                                <BsTags size={16} /> Categories
                            </Button>
                            <Button className="btn-accent d-flex align-items-center gap-2" onClick={() => openModal()}><BsPlus size={18} /> Add Partner</Button>
                        </>
                    )}
                </div>
            </div>

            {filteredPartners.length === 0 ? (
                <div className="empty-state" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
                    <div className="empty-state-icon"><BsBriefcase /></div>
                    <p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>{filterEvent ? 'No Partners for this Event' : 'No Partners Yet'}</p>
                    <p style={{ fontSize: '0.8rem' }}>{filterEvent ? 'Try selecting a different event or clear the filter.' : 'Add partners and sponsors to your events.'}</p>
                </div>
            ) : (
                <Table responsive className="premium-table mobile-cards">
                    <thead>
                        <tr>
                            {canManage && <th style={{ width: 36 }}></th>}
                            <th>#</th>
                            <th>Logo</th>
                            <th>Name</th>
                            <th>Category</th>
                            <th>Speaker</th>
                            <th>Website</th>
                            <th>Event</th>
                            <th style={{ width: 140 }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {displayedPartners.map((p, i) => (
                            <tr
                                key={p.id}
                                draggable={canManage}
                                onDragStart={canManage ? (e) => handleDragStart(e, i) : undefined}
                                onDragOver={canManage ? (e) => handleDragOver(e, i) : undefined}
                                onDragLeave={canManage ? handleDragLeave : undefined}
                                onDrop={canManage ? (e) => handleDrop(e, i) : undefined}
                                onDragEnd={canManage ? handleDragEnd : undefined}
                                style={{
                                    transition: 'background 0.15s, transform 0.15s, box-shadow 0.15s',
                                    background: dragOverIdx === i
                                        ? 'rgba(16,185,129,0.08)'
                                        : undefined,
                                    boxShadow: dragOverIdx === i
                                        ? 'inset 0 2px 0 0 var(--accent-emerald)'
                                        : undefined,
                                    cursor: canManage ? 'grab' : 'default',
                                    opacity: dragIdxRef.current === i ? 0.5 : 1,
                                }}
                            >
                                {canManage && (
                                    <td className="mob-hide" style={{ color: 'var(--text-muted)', verticalAlign: 'middle', paddingRight: 0 }}>
                                        <BsGripVertical size={16} style={{ cursor: 'grab', opacity: 0.5 }} />
                                    </td>
                                )}
                                <td className="mob-hide" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                                <td data-label="Logo">
                                    {p.logo_url ? (
                                        <img
                                            src={getImageUrl(p.logo_url)}
                                            alt={p.name}
                                            loading="lazy"
                                            decoding="async"
                                            style={{
                                                width: p.logo_width ? `${p.logo_width}px` : 120,
                                                height: p.logo_height ? `${p.logo_height}px` : 120,
                                                borderRadius: 8,
                                                objectFit: 'contain',
                                                background: '#fff',
                                                padding: 4
                                            }}
                                        />
                                    ) : (
                                        <div style={{ width: 40, height: 40, borderRadius: 8, background: 'rgba(16,185,129,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-emerald)', fontWeight: 700, fontSize: '0.8rem' }}>{p.name?.charAt(0)}</div>
                                    )}
                                </td>
                                <td data-label="Name"><span style={{ fontWeight: 600 }}>{p.name}</span></td>
                                <td data-label="Category"><span className="badge-premium" style={{ background: 'rgba(59,130,246,0.1)', color: 'var(--accent-sky)' }}>{p.category_name || 'No Category'}</span></td>
                                <td data-label="Speaker">
                                    <OverlayTrigger
                                        trigger={['hover', 'focus']}
                                        placement="top"
                                        overlay={
                                            <Popover id={`popover-${p.id}`} className="premium-popover">
                                                <Popover.Header as="h3">Wishlist Speakers</Popover.Header>
                                                <Popover.Body>
                                                    {p.wishlist_speaker_names ? (
                                                        <div className="d-flex flex-column gap-3">
                                                            {p.wishlist_speaker_names.split('|||').map((name, idx) => {
                                                                const photo = p.wishlist_speaker_photos?.split('|||')[idx];
                                                                return (
                                                                    <div key={idx} className="d-flex align-items-center gap-3">
                                                                        <div style={{ width: 36, height: 36, borderRadius: 10, overflow: 'hidden', background: 'rgba(139,92,246,0.15)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(255,255,255,0.1)' }}>
                                                                            {photo ? <img src={getImageUrl(photo)} alt={name} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#a78bfa' }}>{name.charAt(0)}</span>}
                                                                        </div>
                                                                        <div className="flex-grow-1" style={{ minWidth: 0 }}>
                                                                            <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#fff' }} className="text-truncate">{name}</div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    ) : <div className="p-2 opacity-50 small">No speakers listed</div>}
                                                </Popover.Body>
                                            </Popover>
                                        }
                                    >
                                        <span className="badge-premium" style={{ background: 'rgba(236,72,153,0.1)', color: 'var(--accent-pink)', cursor: 'help' }}>
                                            {p.wishlist_speaker_count || 0} Wishlisted
                                        </span>
                                    </OverlayTrigger>
                                </td>
                                <td data-label="Website">{p.website ? <a href={p.website} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-sky)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85rem' }}><BsLink45Deg /> Link</a> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                                <td data-label="Event"><span className="badge-premium status-upcoming">{p.event_title || '—'}</span></td>
                                <td className="mob-full">
                                    <div className="d-flex gap-2">
                                        <button className="btn-action" title="View" onClick={() => navigate(`/partners/view/${p.id}`)}><BsEye size={13} /></button>
                                        {canManage && (
                                            <>
                                                <button className="btn-action" title="Edit" onClick={() => openModal(p)}><BsPencil size={13} /></button>
                                                <button className="btn-action danger" title="Delete" onClick={() => handleDelete(p.id)}><BsTrash size={13} /></button>
                                            </>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
            {/* Infinite-scroll sentinel — visible only when there's more to
                load. The observer above bumps `visibleCount` when this
                element scrolls into view. */}
            {hasMorePartners && (
                <div ref={loadMoreRef} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    Loading more partners…
                </div>
            )}

            {/* Partner Modal */}
            <Modal show={show} onHide={() => setShow(false)} centered size="lg" contentClassName="premium-modal">
                <Modal.Header closeButton closeVariant="white"><Modal.Title>{editing ? 'Edit Partner' : 'Add Partner'}</Modal.Title></Modal.Header>
                <Modal.Body>
                    {error && <Alert variant="danger" className="py-2" style={{ fontSize: '0.85rem', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>{error}</Alert>}

                    <div className="mb-4 p-3" style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
                        <div className="d-flex align-items-center gap-3">
                            <div style={{ width: 64, height: 64, borderRadius: 12, background: 'var(--bg-body)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px dashed var(--border-subtle)', overflow: 'hidden', flexShrink: 0 }}>
                                {preview ? <img src={preview} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#fff' }} /> : <BsBriefcase size={24} style={{ color: 'var(--text-muted)' }} />}
                            </div>
                            <div className="flex-grow-1">
                                <Form.Label className="m-0 mb-1" style={{ fontSize: '0.85rem', fontWeight: 600 }}>Partner Logo</Form.Label>
                                <Form.Control
                                    type="file"
                                    size="sm"
                                    accept="image/*"
                                    onChange={e => {
                                        const file = e.target.files[0];
                                        if (file) {
                                            setLogo(file);
                                            setPreview(URL.createObjectURL(file));
                                        }
                                    }}
                                />
                            </div>
                        </div>
                        <Row className="mt-3">
                            <Col xs={6}>
                                <Form.Label className="small mb-1">Logo width (px)</Form.Label>
                                <Form.Control
                                    type="number"
                                    size="sm"
                                    min="1"
                                    className="form-control-dark"
                                    placeholder="auto"
                                    value={form.logo_width}
                                    onChange={e => setForm({ ...form, logo_width: e.target.value })}
                                />
                            </Col>
                            <Col xs={6}>
                                <Form.Label className="small mb-1">Logo height (px)</Form.Label>
                                <Form.Control
                                    type="number"
                                    size="sm"
                                    min="1"
                                    className="form-control-dark"
                                    placeholder="auto"
                                    value={form.logo_height}
                                    onChange={e => setForm({ ...form, logo_height: e.target.value })}
                                />
                            </Col>
                        </Row>
                    </div>

                    <Form.Group className="mb-3"><Form.Label>Name *</Form.Label><Form.Control className="form-control-dark" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Partner name" /></Form.Group>
                    <Form.Group className="mb-3"><Form.Label>Website</Form.Label><Form.Control className="form-control-dark" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} placeholder="https://..." /></Form.Group>

                    <Row>
                        <Col md={6}>
                            <Form.Group className="mb-3"><Form.Label>Category *</Form.Label>
                                <Form.Select
                                    className="form-select-dark"
                                    value={form.category_id}
                                    onChange={e => setForm({ ...form, category_id: e.target.value })}
                                    disabled={!form.event_id}
                                >
                                    <option value="">{form.event_id ? '— Select Category —' : '— Select an Event first —'}</option>
                                    {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                                </Form.Select>
                            </Form.Group>
                        </Col>
                        <Col md={6}>
                            <Form.Group className="mb-3"><Form.Label>Sequence (Ordering)</Form.Label>
                                <Form.Control type="number" className="form-control-dark" value={form.sequence} onChange={e => setForm({ ...form, sequence: parseInt(e.target.value) || 0 })} />
                            </Form.Group>
                        </Col>
                    </Row>
                    <Form.Group className="mb-3">
                        <Form.Label>Event</Form.Label>
                        <Form.Select 
                            className="form-select-dark" 
                            value={form.event_id} 
                            onChange={e => setForm({ ...form, event_id: e.target.value })}
                            disabled={user?.role === 'employee'}
                        >
                            <option value="">— Select Event —</option>
                            {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                        </Form.Select>
                    </Form.Group>

                    <Form.Group className="mb-3">
                        <Form.Label className="d-flex justify-content-between align-items-center">
                            Target Account List / Wishlist (Speakers)
                            <span className="text-accent small">{form.wishlist_speakers.length} selected</span>
                        </Form.Label>
                        <div className="speaker-checklist p-2" style={{ 
                            background: 'rgba(255,255,255,0.03)', 
                            borderRadius: 12, 
                            border: '1px solid var(--border-subtle)',
                            maxHeight: '250px',
                            overflowY: 'auto'
                        }}>
                            {speakers.length === 0 ? (
                                <div className="p-3 text-center text-muted small">No speakers available in the database</div>
                            ) : (
                                (() => {
                                    const filtered = speakers.filter(s => !form.event_id || String(s.event_id) === String(form.event_id));
                                    if (filtered.length === 0) return <div className="p-3 text-center text-muted small">No speakers found for the selected event</div>;
                                    return filtered.map(s => (
                                        <div key={s.id} className="d-flex align-items-center gap-3 p-2 mb-2 hover-select-item" style={{ 
                                            borderRadius: 8, 
                                            cursor: 'pointer',
                                            background: form.wishlist_speakers.includes(s.id) ? 'rgba(139,92,246,0.1)' : 'transparent',
                                            transition: 'all 0.2s'
                                        }} onClick={() => {
                                            const newWishlist = form.wishlist_speakers.includes(s.id)
                                                ? form.wishlist_speakers.filter(id => id !== s.id)
                                                : [...form.wishlist_speakers, s.id];
                                            setForm({ ...form, wishlist_speakers: newWishlist });
                                        }}>
                                            <Form.Check 
                                                type="checkbox" 
                                                checked={form.wishlist_speakers.includes(s.id)}
                                                onChange={() => {}} // Handled by div click
                                                style={{ pointerEvents: 'none' }}
                                            />
                                            <div style={{ width: 32, height: 32, borderRadius: 8, overflow: 'hidden', background: 'rgba(236,72,153,0.1)', flexShrink: 0 }}>
                                                {s.photo_url ? <img src={getImageUrl(s.photo_url)} alt={s.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : s.name?.charAt(0)}
                                            </div>
                                            <div className="flex-grow-1" style={{ minWidth: 0 }}>
                                                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#fff' }} className="text-truncate">{s.name}</div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }} className="text-truncate">{s.designation} at {s.company}</div>
                                            </div>
                                        </div>
                                    ));
                                })()
                            )}
                        </div>
                    </Form.Group>

                    <Form.Group className="mb-0">
                        <Form.Label>Additional Notes</Form.Label>
                        <Form.Control 
                            as="textarea" 
                            rows={2} 
                            className="form-control-dark" 
                            value={form.wishlist} 
                            onChange={e => setForm({ ...form, wishlist: e.target.value })} 
                            placeholder="Any additional notes..." 
                        />
                    </Form.Group>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="link" onClick={() => setShow(false)} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Cancel</Button>
                    <AsyncButton className="btn btn-accent" onClick={handleSave} loadingText={editing ? 'Saving…' : 'Adding…'}>
                        {editing ? 'Save' : 'Add Partner'}
                    </AsyncButton>
                </Modal.Footer>
            </Modal>
            <style>{`
                .form-control-dark::placeholder {
                    color: rgba(255, 255, 255, 0.4) !important;
                }
                .hover-select-item:hover {
                    background: rgba(255, 255, 255, 0.05) !important;
                }
                .speaker-checklist::-webkit-scrollbar {
                    width: 4px;
                }
                .speaker-checklist::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                }
                .premium-popover {
                    background-color: #1a1b3a !important;
                    border: 1px solid rgba(255, 255, 255, 0.1) !important;
                    box-shadow: 0 15px 35px rgba(0,0,0,0.5) !important;
                    border-radius: 14px !important;
                    min-width: 220px;
                }
                .premium-popover .popover-header {
                    background-color: #1e1f4b !important;
                    color: #ffffff !important;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important;
                    font-size: 0.85rem !important;
                    font-weight: 600 !important;
                    padding: 12px 16px !important;
                }
                .premium-popover .popover-body {
                    background-color: #1a1b3a !important;
                    color: #ffffff !important;
                    padding: 12px !important;
                }
                .premium-popover .popover-arrow::after {
                    border-top-color: #1a1b3a !important;
                    border-bottom-color: #1a1b3a !important;
                }
                tr[draggable="true"]:active {
                    cursor: grabbing !important;
                }
            `}</style>

            {/* Partner Showcase Customizer modal — preset + colour + font
                + spacing controls. Autosaves on every tweak so closing
                the modal is just dismissing the panel. */}
            <Modal show={showShowcase} onHide={() => setShowShowcase(false)} centered size="lg" contentClassName="premium-modal">
                <Modal.Header closeButton closeVariant="white">
                    <Modal.Title className="d-flex align-items-center gap-2">
                        <BsGear /> Partner Showcase
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {showcasePublicUrl && (
                        <div className="ps-public-link" style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '8px 12px', marginBottom: 14,
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 10,
                        }}>
                            <BsLink45Deg style={{ color: '#13d999', flexShrink: 0 }} />
                            <code style={{ flex: 1, fontSize: 12, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {showcasePublicUrl}
                            </code>
                            <Button size="sm" variant={showcaseLinkCopied ? 'success' : 'outline-light'} onClick={copyShowcaseLink}>
                                {showcaseLinkCopied ? <><BsCheck2 /> Copied</> : 'Copy'}
                            </Button>
                            <Button
                                size="sm"
                                variant="outline-light"
                                onClick={() => window.open(showcasePublicUrl, '_blank', 'noopener')}
                                title="Open the public showcase in a new tab"
                            >
                                <BsEye /> Open
                            </Button>
                        </div>
                    )}

                    {/* Multi-row logo arranger. Operators split logos into
                        as many rows as they want; the resulting `rows`
                        array is stored in the showcase config and the
                        public page renders rows in the same order. */}
                    <div style={{
                        marginBottom: 18,
                        padding: 12,
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 12,
                    }}>
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            marginBottom: 10,
                        }}>
                            <span style={{
                                fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em',
                                color: 'var(--text-muted)', fontWeight: 700,
                            }}>Arrange logos in rows</span>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                Drag between rows · order saves automatically
                            </span>
                        </div>
                        <PartnerLogoArranger
                            partners={partners
                                .filter(p => String(p.event_id) === String(filterEvent))
                                .slice()
                                .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))}
                            rows={showcaseConfig.rows}
                            onChange={handleRowsChange}
                        />
                    </div>

                    <PartnerShowcaseCustomizer
                        template={showcaseTemplate}
                        config={showcaseConfig}
                        onPickTemplate={onPickShowcaseTemplate}
                        onPatchConfig={onPatchShowcaseConfig}
                    />
                </Modal.Body>
                <Modal.Footer>
                    <span style={{ fontSize: '0.78rem', color: showcaseSaveStatus === 'error' ? '#f87171' : 'var(--text-muted)', flex: 1 }}>
                        {showcaseSaveStatus === 'saving' ? 'Saving…'
                            : showcaseSaveStatus === 'saved' ? 'Saved'
                            : showcaseSaveStatus === 'error' ? 'Save failed — try again' : ''}
                    </span>
                    <Button className="btn-accent" size="sm" onClick={() => setShowShowcase(false)}>Done</Button>
                </Modal.Footer>
            </Modal>
        </div>
    );
}
