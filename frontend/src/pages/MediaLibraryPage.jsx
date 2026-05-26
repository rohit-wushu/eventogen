import { useState, useEffect, useMemo } from 'react';
import { Button, Form, Modal } from 'react-bootstrap';
import { getMediaLibrary, getEvents } from '../services/api';
import { getImageUrl } from '../utils/imageUrl';
import { BsImages, BsFunnel, BsDownload, BsXLg, BsFolderFill, BsArrowLeft, BsPersonBadge, BsImage, BsSearch, BsX } from 'react-icons/bs';

export default function MediaLibraryPage() {
    const [media, setMedia] = useState([]);
    const [events, setEvents] = useState([]);
    const [filterEvent, setFilterEvent] = useState('');
    const [preview, setPreview] = useState(null);
    const [loading, setLoading] = useState(true);
    const [openFolder, setOpenFolder] = useState(null); // speaker_id of open folder
    const [search, setSearch] = useState('');

    useEffect(() => {
        getEvents().then(r => setEvents(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    }, []);

    useEffect(() => {
        setLoading(true);
        getMediaLibrary(filterEvent || undefined)
            .then(r => setMedia(Array.isArray(r.data) ? r.data : []))
            .catch(err => console.error('Media library error:', err.response?.data || err.message))
            .finally(() => setLoading(false));
    }, [filterEvent]);

    // Group media by speaker NAME (same name across events = one folder)
    const speakers = useMemo(() => {
        const map = {};
        media.forEach(m => {
            const key = (m.speaker_name || '').trim().toLowerCase();
            if (!key) return;
            if (!map[key]) {
                map[key] = {
                    id: key,
                    name: m.speaker_name?.trim(),
                    designation: m.designation,
                    company: m.company,
                    events: [],
                    photo: null,
                    sns_card: null,
                    items: []
                };
            }
            if (m.type === 'photo' && !map[key].photo) map[key].photo = m;
            if (m.type === 'sns_card' && !map[key].sns_card) map[key].sns_card = m;
            if (m.event_title && !map[key].events.includes(m.event_title)) map[key].events.push(m.event_title);
            map[key].items.push(m);
        });
        return Object.values(map);
    }, [media]);

    // Search filters the speaker folders by name, company, designation, or
    // any event they appear in.
    const visibleSpeakers = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return speakers;
        return speakers.filter(s =>
            [s.name, s.company, s.designation, ...(s.events || [])]
                .some(v => (v || '').toLowerCase().includes(q))
        );
    }, [speakers, search]);

    const openSpeaker = openFolder ? speakers.find(s => s.id === openFolder) : null;

    const handleDownload = (url, name) => {
        const a = document.createElement('a');
        a.href = getImageUrl(url);
        a.download = name || 'download';
        a.target = '_blank';
        a.click();
    };

    const photoCount = media.filter(m => m.type === 'photo').length;
    const snsCount = media.filter(m => m.type === 'sns_card').length;

    return (
        <div className="animate-in">
            <div className="page-header d-flex justify-content-between align-items-center">
                <div>
                    <h4>Media Library</h4>
                    <p className="small" style={{ color: 'var(--text-muted)' }}>Speaker photos and SNS cards organized by speaker.</p>
                </div>
            </div>

            {/* Stats */}
            <div className="d-flex gap-3 mb-4 flex-wrap">
                <div className="px-4 py-3" style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent)' }}>{speakers.length}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Speakers</div>
                </div>
                <div className="px-4 py-3" style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent-pink)' }}>{photoCount}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Photos</div>
                </div>
                <div className="px-4 py-3" style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent-emerald)' }}>{snsCount}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>SNS Cards</div>
                </div>
            </div>

            {/* Filters */}
            <div className="d-flex gap-2 mb-4 align-items-center flex-wrap">
                <BsFunnel style={{ color: 'var(--text-muted)' }} />
                <Form.Select size="sm" className="form-select-dark" style={{ width: 200 }} value={filterEvent} onChange={e => { setFilterEvent(e.target.value); setOpenFolder(null); }}>
                    <option value="">All Events</option>
                    {events.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
                </Form.Select>
                {filterEvent && (
                    <Button size="sm" variant="link" className="text-muted text-decoration-none" onClick={() => { setFilterEvent(''); setOpenFolder(null); }}>Clear</Button>
                )}
                {/* Search by speaker name / company / role / event */}
                <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: 320 }}>
                    <BsSearch style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 13 }} />
                    <input
                        type="text"
                        value={search}
                        onChange={e => { setSearch(e.target.value); setOpenFolder(null); }}
                        placeholder="Search by name, company, event…"
                        style={{
                            width: '100%', padding: '7px 32px 7px 34px', borderRadius: 8,
                            border: '1px solid var(--border-subtle)', background: 'var(--bg-card)',
                            color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none'
                        }}
                    />
                    {search && (
                        <button onClick={() => setSearch('')} title="Clear search"
                            style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 4 }}>
                            <BsX size={16} />
                        </button>
                    )}
                </div>
            </div>

            {loading ? (
                <div className="text-center py-5" style={{ color: 'var(--text-muted)' }}>Loading media...</div>
            ) : speakers.length === 0 ? (
                <div className="empty-state" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
                    <div className="empty-state-icon"><BsImages /></div>
                    <p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>No Media Found</p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Upload speaker photos or generate SNS cards to see them here.</p>
                </div>
            ) : openSpeaker ? (
                /* ── Open Folder View ── */
                <div>
                    <Button variant="link" onClick={() => setOpenFolder(null)} className="mb-3 d-flex align-items-center gap-2 p-0" style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: '0.85rem' }}>
                        <BsArrowLeft /> Back to all speakers
                    </Button>

                    <div className="p-4 mb-4" style={{ background: 'var(--bg-card)', borderRadius: 14, border: '1px solid var(--border-subtle)' }}>
                        <div className="d-flex align-items-center gap-3 mb-1">
                            <div style={{ width: 48, height: 48, borderRadius: 12, overflow: 'hidden', background: 'rgba(139,92,246,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                {openSpeaker.photo ? (
                                    <img src={getImageUrl(openSpeaker.photo.url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                    <BsPersonBadge size={22} style={{ color: 'var(--accent)' }} />
                                )}
                            </div>
                            <div>
                                <div style={{ fontWeight: 700, fontSize: '1.1rem', color: 'var(--text-primary)' }}>{openSpeaker.name}</div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                    {[openSpeaker.designation, openSpeaker.company].filter(Boolean).join(' · ')}
                                    {openSpeaker.events.length > 0 && <> — <span style={{ color: 'var(--accent)' }}>{openSpeaker.events.join(', ')}</span></>}
                                </div>
                            </div>
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>{openSpeaker.items.length} file{openSpeaker.items.length !== 1 ? 's' : ''}</div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
                        {openSpeaker.items.map(m => (
                            <div key={m.id} className="media-card" style={{
                                background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                                borderRadius: 14, overflow: 'hidden', cursor: 'pointer'
                            }} onClick={() => setPreview(m)}>
                                <div style={{ aspectRatio: m.type === 'sns_card' ? '1' : '3/4', background: '#0d0d1a', overflow: 'hidden', position: 'relative' }}>
                                    <img src={getImageUrl(m.url)} alt={m.speaker_name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={e => e.target.style.display = 'none'} />
                                    <div style={{
                                        position: 'absolute', top: 8, left: 8, padding: '3px 10px',
                                        borderRadius: 6, fontSize: '0.7rem', fontWeight: 700,
                                        background: m.type === 'photo' ? 'rgba(236,72,153,0.9)' : 'rgba(16,185,129,0.9)',
                                        color: '#fff', textTransform: 'uppercase'
                                    }}>
                                        {m.type === 'photo' ? 'Photo' : 'SNS Card'}
                                    </div>
                                </div>
                                <div style={{ padding: '12px 14px' }}>
                                    <div className="d-flex justify-content-between align-items-center">
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                                            {m.type === 'photo' ? 'Speaker Photo' : 'SNS Card'}
                                        </span>
                                        <Button size="sm" variant="outline-info" style={{ fontSize: '0.7rem' }}
                                            onClick={e => { e.stopPropagation(); handleDownload(m.url, `${m.speaker_name}-${m.type}-${m.event_title || ''}.png`); }}>
                                            <BsDownload size={12} /> Download
                                        </Button>
                                    </div>
                                    {m.event_title && (
                                        <div style={{ fontSize: '0.65rem', color: 'var(--accent)', marginTop: 4, fontWeight: 600 }}>{m.event_title}</div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : visibleSpeakers.length === 0 ? (
                /* ── No search matches ── */
                <div className="empty-state" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
                    <div className="empty-state-icon"><BsSearch /></div>
                    <p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>No speakers match “{search}”</p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Try a different name, company, or event.</p>
                </div>
            ) : (
                /* ── Folder Grid View ── */
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
                    {visibleSpeakers.map(s => (
                        <div key={s.id} className="media-card" onClick={() => setOpenFolder(s.id)} style={{
                            background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                            borderRadius: 14, overflow: 'hidden', cursor: 'pointer'
                        }}>
                            {/* Folder Thumbnail — show photo or SNS card as preview */}
                            <div style={{ aspectRatio: '1', background: '#0d0d1a', overflow: 'hidden', position: 'relative' }}>
                                {s.photo ? (
                                    <img src={getImageUrl(s.photo.url)} alt={s.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={e => e.target.style.display = 'none'} />
                                ) : s.sns_card ? (
                                    <img src={getImageUrl(s.sns_card.url)} alt={s.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} onError={e => e.target.style.display = 'none'} />
                                ) : (
                                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <BsFolderFill size={40} style={{ color: 'var(--accent)', opacity: 0.3 }} />
                                    </div>
                                )}
                                {/* File count badge */}
                                <div style={{
                                    position: 'absolute', bottom: 8, right: 8, padding: '3px 8px',
                                    borderRadius: 6, fontSize: '0.65rem', fontWeight: 700,
                                    background: 'rgba(0,0,0,0.7)', color: '#fff',
                                    display: 'flex', alignItems: 'center', gap: 4
                                }}>
                                    <BsImage size={10} /> {s.items.length}
                                </div>
                                {/* SNS card mini preview overlay if both exist */}
                                {s.photo && s.sns_card && (
                                    <div style={{
                                        position: 'absolute', bottom: 8, left: 8,
                                        width: 40, height: 40, borderRadius: 6, overflow: 'hidden',
                                        border: '2px solid rgba(255,255,255,0.5)', boxShadow: '0 2px 8px rgba(0,0,0,0.4)'
                                    }}>
                                        <img src={getImageUrl(s.sns_card.url)} alt="SNS" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                    </div>
                                )}
                            </div>
                            {/* Speaker Info */}
                            <div style={{ padding: '10px 12px' }}>
                                <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {s.name}
                                </div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {[s.designation, s.company].filter(Boolean).join(' · ') || '—'}
                                </div>
                                {s.events.length > 0 && (
                                    <div style={{ fontSize: '0.65rem', color: 'var(--accent)', marginTop: 3, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {s.events.join(' · ')}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Preview Modal */}
            {preview && (
                <Modal show onHide={() => setPreview(null)} centered size="lg" contentClassName="premium-modal">
                    <Modal.Body style={{ padding: 0, position: 'relative', background: '#000' }}>
                        <Button variant="link" onClick={() => setPreview(null)}
                            style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, color: '#fff', background: 'rgba(0,0,0,0.5)', borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                            <BsXLg size={16} />
                        </Button>
                        <img src={getImageUrl(preview.url)} alt={preview.speaker_name} style={{ width: '100%', display: 'block', maxHeight: '75vh', objectFit: 'contain' }} />
                        <div style={{ padding: '16px 20px', background: 'var(--bg-secondary)' }}>
                            <div className="d-flex justify-content-between align-items-center">
                                <div>
                                    <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>{preview.speaker_name}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                        {preview.type === 'photo' ? 'Speaker Photo' : 'SNS Card'}
                                        {preview.event_title && <> — <span style={{ color: 'var(--accent)' }}>{preview.event_title}</span></>}
                                    </div>
                                </div>
                                <Button className="btn-accent d-flex align-items-center gap-2"
                                    onClick={() => handleDownload(preview.url, `${preview.speaker_name}-${preview.type}.png`)}>
                                    <BsDownload /> Download
                                </Button>
                            </div>
                        </div>
                    </Modal.Body>
                </Modal>
            )}

            <style>{`
                .media-card {
                    position: relative;
                    transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1),
                                box-shadow 0.35s ease,
                                border-color 0.25s ease;
                    will-change: transform;
                }
                /* Hairline highlight along the top edge — the Tools-launcher touch. */
                .media-card::before {
                    content: '';
                    position: absolute;
                    top: 0; left: 16px; right: 16px; height: 1px;
                    background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), transparent);
                    pointer-events: none;
                    z-index: 3;
                }
                .media-card:hover {
                    transform: translateY(-6px);
                    box-shadow: 0 24px 50px -20px rgba(139, 92, 246, 0.5);
                    border-color: rgba(139, 92, 246, 0.6) !important;
                }
                /* Thumbnail gently zooms while its card is hovered. The
                   thumbnail wrapper already clips overflow, so the image
                   scales within the frame. */
                .media-card > div:first-child img {
                    transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1);
                }
                .media-card:hover > div:first-child img {
                    transform: scale(1.07);
                }
            `}</style>
        </div>
    );
}
