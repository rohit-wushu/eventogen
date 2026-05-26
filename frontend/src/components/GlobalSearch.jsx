import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Modal } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import {
    BsSearch, BsPersonBadge, BsCalendarEvent, BsBriefcase, BsListTask,
    BsPeopleFill, BsArrowReturnLeft, BsXLg
} from 'react-icons/bs';
import {
    getSpeakers, getEvents, getPartners, getAgendas, getAttendees
} from '../services/api';
import { getImageUrl } from '../utils/imageUrl';

const ENTITY_META = {
    action:  { label: 'Quick Actions', icon: BsArrowReturnLeft, color: '#8b5cf6' },
    speaker: { label: 'Speakers', icon: BsPersonBadge, color: '#ec4899' },
    event:   { label: 'Events',   icon: BsCalendarEvent, color: '#8b5cf6' },
    partner: { label: 'Partners', icon: BsBriefcase, color: '#13d999' },
    agenda:  { label: 'Agendas',  icon: BsListTask, color: '#f59e0b' },
    attendee:{ label: 'Attendees',icon: BsPeopleFill, color: '#60a5fa' },
};

export default function GlobalSearch() {
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [cursor, setCursor] = useState(0);
    const [data, setData] = useState({ speakers: [], events: [], partners: [], agendas: [], attendees: [] });
    const [loaded, setLoaded] = useState(false);
    const [loading, setLoading] = useState(false);
    const inputRef = useRef(null);
    const listRef = useRef(null);

    // Global Ctrl+K / Cmd+K listener
    useEffect(() => {
        const onKey = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setOpen(o => !o);
            }
            if (e.key === 'Escape' && open) {
                setOpen(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    // Lazy-load data the first time the palette opens
    useEffect(() => {
        if (!open || loaded || loading) return;
        setLoading(true);
        Promise.allSettled([
            getSpeakers(),
            getEvents(),
            getPartners(),
            getAgendas().catch(() => ({ data: [] })),
            getAttendees(),
        ]).then(([sp, ev, pt, ag, at]) => {
            setData({
                speakers: Array.isArray(sp.value?.data) ? sp.value.data : [],
                events:   Array.isArray(ev.value?.data) ? ev.value.data : [],
                partners: Array.isArray(pt.value?.data) ? pt.value.data : [],
                agendas:  Array.isArray(ag.value?.data) ? ag.value.data : [],
                attendees:Array.isArray(at.value?.data) ? at.value.data : [],
            });
            setLoaded(true);
        }).finally(() => setLoading(false));
    }, [open, loaded, loading]);

    // Focus input when opening
    useEffect(() => {
        if (open) {
            setCursor(0);
            setTimeout(() => inputRef.current?.focus(), 10);
        } else {
            setQuery('');
        }
    }, [open]);

    // Quick actions — typed commands that navigate directly
    const QUICK_ACTIONS = [
        { keywords: ['add speaker', 'new speaker', 'create speaker'], title: 'Add Speaker', subtitle: 'Create a new speaker', path: '/speakers/add', icon: '➕' },
        { keywords: ['add event', 'new event', 'create event'], title: 'Add Event', subtitle: 'Create a new event', path: '/events', action: 'add-event', icon: '📅' },
        { keywords: ['add partner', 'new partner', 'create partner'], title: 'Add Partner', subtitle: 'Create a new partner', path: '/partners', action: 'add-partner', icon: '🤝' },
        { keywords: ['add agenda', 'new agenda', 'add session', 'create agenda'], title: 'Add Agenda Session', subtitle: 'Create a new agenda item', path: '/agendas', icon: '📋' },
        { keywords: ['add attendee', 'new attendee', 'register attendee'], title: 'Add Attendee', subtitle: 'Register a new attendee', path: '/attendees', icon: '🎫' },
        { keywords: ['add travel', 'new travel', 'travel request'], title: 'Add Travel', subtitle: 'Create a travel record', path: '/travel', icon: '✈️' },
        { keywords: ['export speaker', 'download speaker'], title: 'Export Speakers', subtitle: 'Download speakers as CSV', path: '/speakers', icon: '📥' },
        { keywords: ['export attendee', 'download attendee'], title: 'Export Attendees', subtitle: 'Download attendees as CSV', path: '/attendees', icon: '📥' },
        { keywords: ['export agenda', 'download agenda'], title: 'Export Agenda', subtitle: 'Go to agendas to export', path: '/agendas', icon: '📥' },
        { keywords: ['settings', 'admin settings', 'portal settings'], title: 'Settings', subtitle: 'Admin portal settings', path: '/settings', icon: '⚙️' },
        { keywords: ['users', 'team', 'my team', 'invite user'], title: 'Users & Team', subtitle: 'Manage users and invitations', path: '/users', icon: '👥' },
        { keywords: ['dashboard', 'home'], title: 'Dashboard', subtitle: 'Go to dashboard', path: '/dashboard', icon: '📊' },
        { keywords: ['travel', 'flights', 'hotels'], title: 'Travel Management', subtitle: 'Manage speaker travel', path: '/travel', icon: '✈️' },
        { keywords: ['media', 'photos', 'gallery', 'images', 'media library'], title: 'Media Library', subtitle: 'All speaker photos & SNS cards', path: '/media', icon: '🖼️' },
    ];

    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        const match = (v) => v && String(v).toLowerCase().includes(q);

        const img = (url) => (url ? getImageUrl(url) : null);
        const speakerRow = s => ({ type: 'speaker', id: s.id, image: img(s.photo_url), title: s.name, subtitle: [s.designation, s.company, s.email].filter(Boolean).join(' · '), path: `/speakers/view/${s.id}` });
        const eventRow   = e => ({ type: 'event',   id: e.id, image: img(e.event_logo_url || e.company_logo_url), title: e.title, subtitle: [e.venue, e.status].filter(Boolean).join(' · '), path: `/events` });
        const partnerRow = p => ({ type: 'partner', id: p.id, image: img(p.logo_url), title: p.name, subtitle: [p.category_name, p.website].filter(Boolean).join(' · '), path: `/partners/view/${p.id}` });
        const agendaRow  = a => ({ type: 'agenda',  id: a.id, image: null, title: a.title, subtitle: `Day ${a.day_number || 1}${a.start_time ? ' · ' + String(a.start_time).slice(0, 5) : ''}`, path: `/agendas` });
        const attendeeRow = a => ({ type: 'attendee', id: a.id, image: null, title: a.name, subtitle: [a.company, a.email].filter(Boolean).join(' · '), path: `/attendees` });

        // When no query, show a curated "recent" snapshot — first few of each type
        if (!q) {
            const take = (arr, mapFn, n = 4) => arr.slice(0, n).map(mapFn);
            return [
                ...take(data.speakers, speakerRow),
                ...take(data.events, eventRow),
                ...take(data.partners, partnerRow),
                ...take(data.agendas, agendaRow),
                ...take(data.attendees, attendeeRow),
            ];
        }

        // Match quick actions first
        const matchedActions = QUICK_ACTIONS.filter(a => a.keywords.some(k => k.includes(q) || q.includes(k)));
        const actionResults = matchedActions.map(a => ({ type: 'action', id: `action-${a.title}`, image: null, title: a.title, subtitle: a.subtitle, path: a.path, icon: a.icon }));

        const out = [...actionResults];
        data.speakers.forEach(s => {
            if ([s.name, s.designation, s.company, s.email, s.topic, s.panel, s.spokesperson_name, s.location].some(match)) {
                out.push(speakerRow(s));
            }
        });
        data.events.forEach(e => {
            if ([e.title, e.description, e.venue, e.status].some(match)) {
                out.push(eventRow(e));
            }
        });
        data.partners.forEach(p => {
            if ([p.name, p.website, p.category_name].some(match)) {
                out.push(partnerRow(p));
            }
        });
        data.agendas.forEach(a => {
            if ([a.title, a.description].some(match)) {
                out.push(agendaRow(a));
            }
        });
        data.attendees.forEach(a => {
            if ([a.name, a.email, a.company, a.phone, a.ticket_type].some(match)) {
                out.push(attendeeRow(a));
            }
        });
        return out.slice(0, 50);
    }, [query, data]);

    // Reset cursor when results change
    useEffect(() => { setCursor(0); }, [query]);

    // Keep active item in view
    useEffect(() => {
        if (!listRef.current) return;
        const active = listRef.current.querySelector('[data-active="true"]');
        if (active) active.scrollIntoView({ block: 'nearest' });
    }, [cursor]);

    const go = useCallback((result) => {
        if (!result) return;
        setOpen(false);
        navigate(result.path);
    }, [navigate]);

    const onInputKey = (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
        else if (e.key === 'Enter') { e.preventDefault(); go(results[cursor]); }
    };

    // Group results by type for rendering
    const grouped = useMemo(() => {
        const g = {};
        results.forEach((r, i) => {
            if (!g[r.type]) g[r.type] = [];
            g[r.type].push({ ...r, _index: i });
        });
        return g;
    }, [results]);

    const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

    return (
        <>
            {/* Topbar trigger button */}
            <button
                onClick={() => setOpen(true)}
                className="global-search-trigger"
                type="button"
                aria-label="Open global search"
            >
                <BsSearch size={13} style={{ opacity: 0.7 }} />
                <span className="gs-placeholder">Search speakers, events, partners…</span>
                <span className="gs-kbd">{isMac ? '⌘' : 'Ctrl'} K</span>
            </button>

            {/* Centred Bootstrap modal — full app-style modal chrome
                instead of the previous custom command-palette overlay. */}
            <Modal
                show={open}
                onHide={() => setOpen(false)}
                centered
                size="lg"
                contentClassName="premium-modal gs-modal"
                aria-label="Global search"
            >
                <Modal.Body style={{ padding: 0 }}>
                    <div className="gs-input-row">
                        <BsSearch size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            onKeyDown={onInputKey}
                            placeholder="Search anything — speakers, events, partners, agendas, attendees…"
                            className="gs-input"
                            autoFocus
                        />
                        <span className="gs-kbd gs-kbd-esc">Esc</span>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="gs-close-btn"
                            aria-label="Close search"
                        >
                            <BsXLg size={14} />
                        </button>
                    </div>

                    <div ref={listRef} className="gs-results">
                            {loading && !loaded && (
                                <div className="gs-empty">Loading search index…</div>
                            )}
                            {loaded && results.length === 0 && (
                                <div className="gs-empty">
                                    {query ? `No results for "${query}"` : 'No data to search yet.'}
                                </div>
                            )}
                            {Object.entries(grouped).map(([type, items]) => {
                                const meta = ENTITY_META[type];
                                const Icon = meta.icon;
                                return (
                                    <div key={type} className="gs-group">
                                        <div className="gs-group-label">{meta.label}</div>
                                        {items.map(r => {
                                            const active = r._index === cursor;
                                            return (
                                                <div
                                                    key={`${type}-${r.id}`}
                                                    data-active={active}
                                                    className={`gs-item ${active ? 'active' : ''}`}
                                                    onMouseEnter={() => setCursor(r._index)}
                                                    onClick={() => go(r)}
                                                >
                                                    {r.icon ? (
                                                        <div className="gs-item-icon" style={{ background: `${meta.color}18`, fontSize: '1.1rem' }}>
                                                            {r.icon}
                                                        </div>
                                                    ) : r.image ? (
                                                        <div className="gs-item-avatar" style={{ borderColor: `${meta.color}55` }}>
                                                            <img
                                                                src={r.image}
                                                                alt=""
                                                                onError={(e) => {
                                                                    e.currentTarget.style.display = 'none';
                                                                    const fallback = e.currentTarget.nextElementSibling;
                                                                    if (fallback) fallback.style.display = 'flex';
                                                                }}
                                                            />
                                                            <div className="gs-item-avatar-fallback" style={{ background: `${meta.color}18`, color: meta.color }}>
                                                                <Icon size={14} />
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="gs-item-icon" style={{ background: `${meta.color}18`, color: meta.color }}>
                                                            <Icon size={14} />
                                                        </div>
                                                    )}
                                                    <div className="gs-item-text">
                                                        <div className="gs-item-title">{r.title || '—'}</div>
                                                        {r.subtitle && <div className="gs-item-subtitle">{r.subtitle}</div>}
                                                    </div>
                                                    {active && <BsArrowReturnLeft size={13} style={{ color: 'var(--text-muted)' }} />}
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </div>

                    <div className="gs-footer">
                        <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
                        <span><kbd>↵</kbd> Open</span>
                        <span><kbd>Esc</kbd> Close</span>
                    </div>
                </Modal.Body>
            </Modal>

            <style>{`
                .global-search-trigger {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    background: rgba(255,255,255,0.15);
                    border: 1px solid rgba(255,255,255,0.25);
                    border-radius: 10px;
                    padding: 7px 12px;
                    color: rgba(255,255,255,0.7);
                    cursor: pointer;
                    min-width: 360px;
                    max-width: 520px;
                    width: 40%;
                    transition: background 0.15s, border-color 0.15s;
                    font-size: 0.8rem;
                }
                .global-search-trigger:hover {
                    background: rgba(255,255,255,0.22);
                    border-color: rgba(255,255,255,0.4);
                }
                .gs-placeholder { flex: 1; text-align: left; color: rgba(255,255,255,0.6); }
                .gs-kbd {
                    font-size: 0.65rem;
                    font-weight: 600;
                    padding: 2px 6px;
                    background: rgba(255,255,255,0.15);
                    border: 1px solid rgba(255,255,255,0.2);
                    border-radius: 5px;
                    color: rgba(255,255,255,0.7);
                    letter-spacing: 0.04em;
                }

                /* Bootstrap modal hosts the search palette — overrides
                   here just constrain the result list height and keep
                   the modal flush with the corners of the dialog. */
                .gs-modal { overflow: hidden; }
                .gs-modal .modal-body { display: flex; flex-direction: column; max-height: 70vh; }

                .gs-input-row {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 14px 16px;
                    border-bottom: 1px solid rgba(255,255,255,0.06);
                }
                .gs-input {
                    flex: 1;
                    background: transparent;
                    border: none;
                    outline: none;
                    color: #fff;
                    font-size: 0.95rem;
                }
                .gs-input::placeholder { color: rgba(255,255,255,0.3); }

                /* Tappable close button — primary dismiss control on mobile
                   where Esc isn't reachable. Hidden on wider screens where
                   the Esc kbd hint does the job, to keep the input row tidy. */
                .gs-close-btn {
                    display: none;
                    align-items: center;
                    justify-content: center;
                    width: 32px;
                    height: 32px;
                    border-radius: 8px;
                    border: 1px solid rgba(255,255,255,0.14);
                    background: rgba(255,255,255,0.06);
                    color: rgba(255,255,255,0.85);
                    cursor: pointer;
                    flex-shrink: 0;
                    padding: 0;
                    transition: background 0.15s, color 0.15s;
                }
                .gs-close-btn:hover {
                    background: rgba(255,255,255,0.12);
                    color: #fff;
                }
                @media (max-width: 640px) {
                    .gs-close-btn { display: inline-flex; }
                    .gs-kbd-esc { display: none; }
                }
                [data-theme="light"] .gs-close-btn {
                    border-color: #cbd5e1;
                    background: #f1f5f9;
                    color: #475569;
                }
                [data-theme="light"] .gs-close-btn:hover {
                    background: #e2e8f0;
                    color: #1e293b;
                }

                .gs-results {
                    flex: 1;
                    overflow-y: auto;
                    padding: 6px;
                }
                .gs-results::-webkit-scrollbar { width: 6px; }
                .gs-results::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }

                .gs-group { margin-bottom: 4px; }
                .gs-group-label {
                    font-size: 0.62rem;
                    font-weight: 800;
                    text-transform: uppercase;
                    letter-spacing: 0.08em;
                    color: var(--text-muted);
                    padding: 10px 12px 6px;
                }
                .gs-item {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 9px 12px;
                    border-radius: 8px;
                    cursor: pointer;
                    transition: background 0.1s;
                }
                .gs-item.active { background: rgba(139,92,246,0.16); }
                .gs-item-icon {
                    width: 30px; height: 30px;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    flex-shrink: 0;
                }
                .gs-item-avatar {
                    width: 32px; height: 32px;
                    border-radius: 8px;
                    overflow: hidden;
                    flex-shrink: 0;
                    border: 1px solid rgba(255,255,255,0.08);
                    position: relative;
                    background: rgba(255,255,255,0.04);
                }
                .gs-item-avatar img {
                    width: 100%;
                    height: 100%;
                    object-fit: contain;
                    display: block;
                    padding: 2px;
                }
                .gs-item-avatar-fallback {
                    position: absolute;
                    inset: 0;
                    display: none;
                    align-items: center;
                    justify-content: center;
                }
                .gs-item-text { flex: 1; min-width: 0; }
                .gs-item-title {
                    font-size: 0.85rem;
                    font-weight: 600;
                    color: #fff;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .gs-item-subtitle {
                    font-size: 0.72rem;
                    color: var(--text-muted);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    margin-top: 1px;
                }

                .gs-empty {
                    padding: 40px 20px;
                    text-align: center;
                    color: var(--text-muted);
                    font-size: 0.85rem;
                }

                .gs-footer {
                    display: flex;
                    gap: 16px;
                    padding: 10px 16px;
                    border-top: 1px solid rgba(255,255,255,0.06);
                    font-size: 0.7rem;
                    color: var(--text-muted);
                    background: rgba(0,0,0,0.15);
                }
                .gs-footer kbd {
                    display: inline-block;
                    padding: 1px 5px;
                    background: rgba(255,255,255,0.07);
                    border: 1px solid rgba(255,255,255,0.1);
                    border-radius: 4px;
                    font-size: 0.65rem;
                    margin-right: 3px;
                    font-family: inherit;
                }

                /* Collapse to icon-only at the same width the sidebar turns
                   into a drawer — below 1024px the topbar runs out of room
                   for [logo] [360px search] [date+tools+bell+profile] and
                   the profile icon was getting clipped off the right edge.
                   margin-left: auto pushes the collapsed icon out of the
                   topbar centre so it can't sit on top of a wide portal logo. */
                @media (max-width: 1024px) {
                    .global-search-trigger {
                        min-width: 0;
                        width: auto;
                        margin-left: auto;
                    }
                    .gs-placeholder { display: none; }
                    .gs-kbd { display: none; }
                }

                /* Light mode overrides */
                [data-theme="light"] .gs-input-row {
                    border-bottom: 1px solid #e2e8f0;
                }
                [data-theme="light"] .gs-input {
                    color: #1e293b;
                }
                [data-theme="light"] .gs-input::placeholder {
                    color: #94a3b8;
                }
                [data-theme="light"] .gs-results::-webkit-scrollbar-thumb {
                    background: #cbd5e1;
                }
                [data-theme="light"] .gs-group-label {
                    color: #64748b;
                }
                [data-theme="light"] .gs-item.active {
                    background: rgba(139,92,246,0.08);
                }
                [data-theme="light"] .gs-item:hover {
                    background: #f1f5f9;
                }
                [data-theme="light"] .gs-item-title {
                    color: #1e293b;
                }
                [data-theme="light"] .gs-item-subtitle {
                    color: #64748b;
                }
                [data-theme="light"] .gs-item-avatar {
                    border: 1px solid #e2e8f0;
                    background: #f1f5f9;
                }
                [data-theme="light"] .gs-empty {
                    color: #64748b;
                }
                [data-theme="light"] .gs-footer {
                    border-top: 1px solid #e2e8f0;
                    color: #64748b;
                    background: #f8fafc;
                }
                [data-theme="light"] .gs-footer kbd {
                    background: #e2e8f0;
                    border: 1px solid #cbd5e1;
                    color: #475569;
                }
            `}</style>
        </>
    );
}
