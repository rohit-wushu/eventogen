import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Modal, Form, Alert, Tabs, Tab, Row, Col } from 'react-bootstrap';
import { useAuth } from '../context/AuthContext';
import { getEvents, createEvent, updateEvent, deleteEvent } from '../services/api';
import AsyncButton from '../components/AsyncButton';
import QuotaButton from '../components/QuotaButton';
import { invalidateQuota } from '../hooks/useQuota';
import { BsPlus, BsPencil, BsTrash, BsCalendarEvent, BsPalette, BsShieldLock, BsLayoutTextWindow, BsImage, BsCodeSlash, BsFunnel, BsQrCode } from 'react-icons/bs';

import { getImageUrl } from '../utils/imageUrl';

export default function EventsPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [events, setEvents] = useState([]);
    const [show, setShow] = useState(false);
    const [editing, setEditing] = useState(null);
    const [error, setError] = useState('');
    const [filterYear, setFilterYear] = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [form, setForm] = useState({
        title: '', description: '', start_date: '', end_date: '', venue: '', status: 'upcoming', category: '',
        primary_color: '#8b5cf6', secondary_color: '#ec4899', accent_color: '#10b981',
        font_family: 'Inter', is_branding_locked: false,
        event_logo: null, company_logo: null, sns_card_bg: null,
        event_logo_url: '', company_logo_url: '', sns_card_bg_url: ''
    });

    // Fixed category vocabulary. Stored as a VARCHAR in the DB so we can add
    // new ones here later without touching the schema.
    const EVENT_CATEGORIES = [
        'Expo',
        'Summit',
        'Summit & Awards',
        'Conference',
        'Webinar',
        'Roundtable',
        'Workshop',
        'Seminar',
        'Souvenir'
    ];

    const formatDate = (dateStr) => {
        if (!dateStr) return '—';
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}-${month}-${year}`;
    };

    const isAdmin = user?.role === 'admin';
    const canManageBranding = ['admin', 'manager'].includes(user?.role);
    const canManage = ['admin', 'manager'].includes(user?.role);

    const load = () => {
        setError('');
        getEvents()
            .then(r => setEvents(Array.isArray(r.data) ? r.data : []))
            .catch(err => {
                console.error('Events Load Error:', err);
                setError(err.response?.data?.error || 'Failed to load events. Please try logging in again.');
            });
    };
    useEffect(() => { load(); }, [user?.assigned_event_id]);

    const openModal = (event = null) => {
        if (event) {
            setEditing(event);
            setForm({
                title: event.title,
                description: event.description || '',
                start_date: event.start_date,
                end_date: event.end_date,
                venue: event.venue || '',
                status: event.status,
                category: event.category || '',
                primary_color: event.primary_color || '#8b5cf6',
                secondary_color: event.secondary_color || '#ec4899',
                accent_color: event.accent_color || '#10b981',
                font_family: event.font_family || 'Inter',
                is_branding_locked: !!event.is_branding_locked,
                event_logo: null,
                company_logo: null,
                sns_card_bg: null,
                event_logo_url: event.event_logo_url || '',
                company_logo_url: event.company_logo_url || '',
                sns_card_bg_url: event.sns_card_bg_url || ''
            });
        } else {
            setEditing(null);
            setForm({
                title: '', description: '', start_date: '', end_date: '', venue: '', status: 'upcoming', category: '',
                primary_color: '#8b5cf6', secondary_color: '#ec4899', accent_color: '#10b981',
                font_family: 'Inter', is_branding_locked: false,
                event_logo: null, company_logo: null, sns_card_bg: null,
                event_logo_url: '', company_logo_url: '', sns_card_bg_url: ''
            });
        }
        setError('');
        setShow(true);
    };

    const handleSave = async () => {
        const data = new FormData();
        Object.keys(form).forEach(key => {
            if (['event_logo', 'company_logo', 'sns_card_bg'].includes(key)) {
                if (form[key]) data.append(key, form[key]);
            } else if (['event_logo_url', 'company_logo_url', 'sns_card_bg_url'].includes(key)) {
                // Skip preview URLs
            } else {
                data.append(key, form[key]);
            }
        });
        if (editing) data.append('id', editing.id);

        try {
            if (editing) await updateEvent(data);
            else await createEvent(data);
            setShow(false);
            load();
            if (!editing) invalidateQuota();
        } catch (err) { setError(err.response?.data?.error || 'Failed'); }
    };

    const handleDelete = async (id) => {
        if (window.confirm('Delete this event?')) { await deleteEvent(id); load(); invalidateQuota(); }
    };

    return (
        <div className="animate-in">
            <div className="page-header d-flex justify-content-between align-items-center">
                <div>
                    <h4>Events</h4>
                    <p className='text-white small'>Manage all your events in one place.</p>
                </div>
                {canManage && (
                    <QuotaButton resource="events" className="btn-accent d-flex align-items-center gap-2" onClick={() => openModal()}>
                        <BsPlus size={18} /> Create Event
                    </QuotaButton>
                )}
            </div>

            {error && <Alert variant="danger" className="mb-4 py-2" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', borderRadius: 'var(--radius-lg)' }}>{error}</Alert>}

            {/* Filters */}
            {events.length > 0 && (() => {
                const years = [...new Set(events.map(e => e.start_date ? new Date(e.start_date).getFullYear() : null).filter(Boolean))].sort((a, b) => b - a);
                return (
                    <div className="d-flex gap-2 mb-3 align-items-center flex-wrap">
                        <BsFunnel style={{ color: 'var(--text-muted)' }} />
                        <Form.Select size="sm" className="form-select-dark" style={{ width: 130 }} value={filterYear} onChange={e => setFilterYear(e.target.value)}>
                            <option value="">All Years</option>
                            {years.map(y => <option key={y} value={y}>{y}</option>)}
                        </Form.Select>
                        <Form.Select size="sm" className="form-select-dark" style={{ width: 150 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                            <option value="">All Status</option>
                            <option value="upcoming">Upcoming</option>
                            <option value="ongoing">Ongoing</option>
                            <option value="completed">Completed</option>
                            <option value="cancelled">Cancelled</option>
                        </Form.Select>
                        {(filterYear || filterStatus) && (
                            <Button size="sm" variant="link" className="text-muted text-decoration-none" onClick={() => { setFilterYear(''); setFilterStatus(''); }}>Clear</Button>
                        )}
                    </div>
                );
            })()}

            {(() => {
                const filtered = events.filter(e => {
                    if (filterYear && e.start_date) {
                        const y = new Date(e.start_date).getFullYear();
                        if (String(y) !== filterYear) return false;
                    }
                    if (filterStatus && e.status !== filterStatus) return false;
                    return true;
                });

                if (filtered.length === 0 && events.length > 0) return (
                    <div className="text-center py-5" style={{ color: 'var(--text-muted)' }}>No events match the selected filters.</div>
                );

            return filtered.length === 0 ? (
                <div className="empty-state" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
                    <div className="empty-state-icon"><BsCalendarEvent /></div>
                    <p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>No Events Yet</p>
                    <p style={{ fontSize: '0.8rem' }}>Create your first event to get started.</p>
                </div>
            ) : (
                <Table responsive className="premium-table mobile-cards">
                    <thead>
                        <tr><th>#</th><th>Branding</th><th>Title</th><th>Venue</th><th>Start</th><th>End</th><th>Status</th><th>Created By</th>{canManage && <th style={{ width: 100 }}>Actions</th>}</tr>
                    </thead>
                    <tbody>
                        {filtered.map((e, i) => (
                            <tr key={e.id}>
                                <td className="mob-hide" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                                <td data-label="Branding">
                                    <div className="d-flex align-items-center gap-2">
                                        <div style={{ width: 24, height: 24, borderRadius: 4, background: e.primary_color || 'transparent', border: '1px solid rgba(255,255,255,0.1)' }} title="Primary Color"></div>
                                        {e.is_branding_locked ? <BsShieldLock className="text-accent" title="Branding Locked" /> : <BsPalette className="text-muted" title="Branding Open" />}
                                    </div>
                                </td>
                                <td data-label="Title" style={{ fontWeight: 600 }}>
                                    <div>{e.title}</div>
                                    {e.category && (
                                        <span className="event-category-chip">{e.category}</span>
                                    )}
                                </td>
                                <td data-label="Venue" style={{ color: 'var(--text-secondary)' }}>{e.venue || '—'}</td>
                                <td data-label="Start" style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{formatDate(e.start_date)}</td>
                                <td data-label="End" style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{formatDate(e.end_date)}</td>
                                <td data-label="Status"><span className={`badge-premium status-${e.status}`}>{e.status}</span></td>
                                <td data-label="Created By" style={{ color: 'var(--text-secondary)' }}>{e.creator_name}</td>
                                {canManage && (
                                    <td className="mob-full">
                                        <div className="d-flex gap-1">
                                            <button className="btn-action" onClick={() => navigate(`/events/sns-template/${e.id}`)} title="Design Master SNS Template" style={{ color: 'var(--accent-emerald)' }}><BsLayoutTextWindow size={13} /></button>
                                            <button className="btn-action" onClick={() => navigate(`/events/${e.id}/web`)} title="Web Integration, SEO & Analytics" style={{ color: '#60a5fa' }}><BsCodeSlash size={13} /></button>
                                            <button className="btn-action" onClick={() => navigate(`/events/${e.id}/qr`)} title="Generate QR code" style={{ color: '#c084fc' }}><BsQrCode size={13} /></button>
                                            <button className="btn-action" onClick={() => openModal(e)} title="Edit Event & Branding"><BsPencil size={13} /></button>
                                            {(isAdmin || (user?.role === 'manager' && e.created_by === user?.id)) && (
                                                <button className="btn-action danger" onClick={() => handleDelete(e.id)} title="Delete Event"><BsTrash size={13} /></button>
                                            )}
                                        </div>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </Table>
            );
            })()}

            <Modal show={show} onHide={() => setShow(false)} centered size="lg" contentClassName="premium-modal">
                <Modal.Header closeButton closeVariant="white"><Modal.Title>{editing ? 'Edit Event' : 'Create Event'}</Modal.Title></Modal.Header>
                <Modal.Body className="p-0">
                    <Tabs defaultActiveKey="general" className="premium-tabs border-0 mt-2 px-3">
                        <Tab eventKey="general" title="General Info" className="p-3">
                            {error && <Alert variant="danger" className="py-2" style={{ fontSize: '0.85rem', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>{error}</Alert>}
                            <Form.Group className="mb-3"><Form.Label>Title</Form.Label><Form.Control className="form-control-dark" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Enter event title" /></Form.Group>
                            <Form.Group className="mb-3"><Form.Label>Description</Form.Label><Form.Control as="textarea" rows={2} className="form-control-dark" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Brief description" /></Form.Group>
                            <Form.Group className="mb-3"><Form.Label>Venue</Form.Label><Form.Control className="form-control-dark" value={form.venue} onChange={e => setForm({ ...form, venue: e.target.value })} placeholder="Event venue" /></Form.Group>
                            <div className="d-flex gap-3">
                                <Form.Group className="mb-3 flex-fill">
                                    <Form.Label>Start Date</Form.Label>
                                    <Form.Control 
                                        type="date" 
                                        className="form-control-dark" 
                                        value={form.start_date ? form.start_date.split('T')[0] : ''} 
                                        onChange={e => setForm({ ...form, start_date: e.target.value })} 
                                        disabled={user?.role === 'employee'}
                                    />
                                </Form.Group>
                                <Form.Group className="mb-3 flex-fill">
                                    <Form.Label>End Date</Form.Label>
                                    <Form.Control 
                                        type="date" 
                                        className="form-control-dark" 
                                        value={form.end_date ? form.end_date.split('T')[0] : ''} 
                                        onChange={e => setForm({ ...form, end_date: e.target.value })} 
                                        disabled={user?.role === 'employee'}
                                    />
                                </Form.Group>
                            </div>
                            <div className="d-flex gap-3">
                                <Form.Group className="mb-0 flex-fill">
                                    <Form.Label>Status</Form.Label>
                                    <Form.Select
                                        className="form-select-dark"
                                        value={form.status}
                                        onChange={e => setForm({ ...form, status: e.target.value })}
                                        disabled={user?.role === 'employee'}
                                    >
                                        <option value="upcoming">Upcoming</option>
                                        <option value="ongoing">Ongoing</option>
                                        <option value="completed">Completed</option>
                                        <option value="cancelled">Cancelled</option>
                                    </Form.Select>
                                </Form.Group>
                                <Form.Group className="mb-0 flex-fill">
                                    <Form.Label>Category</Form.Label>
                                    <Form.Select
                                        className="form-select-dark"
                                        value={form.category}
                                        onChange={e => setForm({ ...form, category: e.target.value })}
                                        disabled={user?.role === 'employee'}
                                    >
                                        <option value="">— Select category —</option>
                                        {EVENT_CATEGORIES.map(c => (
                                            <option key={c} value={c}>{c}</option>
                                        ))}
                                    </Form.Select>
                                </Form.Group>
                            </div>
                        </Tab>
                        <Tab eventKey="branding" title="Branding & Styles">
                            <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

                                {/* Branding Lock */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderRadius: 12, background: form.is_branding_locked ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${form.is_branding_locked ? 'rgba(16,185,129,0.25)' : 'rgba(255,255,255,0.07)'}`, transition: 'all 0.2s' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <div style={{ width: 36, height: 36, borderRadius: 10, background: form.is_branding_locked ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <BsShieldLock size={16} style={{ color: form.is_branding_locked ? '#13d999' : '#888' }} />
                                        </div>
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: '0.88rem', color: form.is_branding_locked ? '#13d999' : '#ccc' }}>Branding Lock</div>
                                            <div style={{ fontSize: '0.72rem', color: '#666', marginTop: 1 }}>Locks colors, fonts & logos for all generators</div>
                                        </div>
                                    </div>
                                    <Form.Check type="switch" id="branding-lock-switch" checked={form.is_branding_locked} onChange={e => setForm({ ...form, is_branding_locked: e.target.checked })} disabled={!canManageBranding} style={{ transform: 'scale(1.2)' }} />
                                </div>

                                {/* Color Palette + Font */}
                                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                                    {/* Color preview bar */}
                                    <div style={{ height: 10, display: 'flex' }}>
                                        <div style={{ flex: 1, background: form.primary_color }} />
                                        <div style={{ flex: 1, background: form.secondary_color }} />
                                        <div style={{ flex: 1, background: form.accent_color }} />
                                    </div>
                                    <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#666', letterSpacing: 1, textTransform: 'uppercase' }}>Color Palette</div>
                                        <div className="event-color-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                                            {[
                                                { label: 'Primary', key: 'primary_color' },
                                                { label: 'Secondary', key: 'secondary_color' },
                                                { label: 'Accent', key: 'accent_color' },
                                            ].map(({ label, key }) => (
                                                <div key={key}>
                                                    <div style={{ fontSize: '0.68rem', color: '#777', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                                                        <div style={{ position: 'relative', width: 36, height: 36, borderRadius: 8, overflow: 'hidden', border: '2px solid rgba(255,255,255,0.1)', flexShrink: 0 }}>
                                                            <div style={{ width: '100%', height: '100%', background: form[key] }} />
                                                            <input type="color" value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                                                        </div>
                                                        <input type="text" value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: '#ddd', fontSize: '0.72rem', fontFamily: 'monospace', padding: '4px 8px', width: '100%', outline: 'none' }} />
                                                    </label>
                                                </div>
                                            ))}
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.68rem', color: '#777', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>Font Family</div>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                                {[
                                                    { value: 'Inter', label: 'Inter', sub: 'Modern Sans' },
                                                    { value: 'Montserrat', label: 'Montserrat', sub: 'Geometric' },
                                                    { value: 'Poppins', label: 'Poppins', sub: 'Soft Sans' },
                                                    { value: 'Roboto', label: 'Roboto', sub: 'Clean' },
                                                    { value: 'Playfair Display', label: 'Playfair', sub: 'Serif Elegant' },
                                                    { value: 'Lora', label: 'Lora', sub: 'Serif' },
                                                ].map(f => (
                                                    <div key={f.value} onClick={() => setForm({ ...form, font_family: f.value })}
                                                        style={{ padding: '8px 12px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${form.font_family === f.value ? 'rgba(16,185,129,0.5)' : 'rgba(255,255,255,0.07)'}`, background: form.font_family === f.value ? 'rgba(16,185,129,0.1)' : 'rgba(0,0,0,0.2)', transition: 'all 0.15s', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                        <span style={{ fontFamily: f.value, fontSize: '0.82rem', color: form.font_family === f.value ? '#13d999' : '#ccc', fontWeight: 600 }}>{f.label}</span>
                                                        <span style={{ fontSize: '0.62rem', color: '#555' }}>{f.sub}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Logos */}
                                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.07)', padding: '16px 18px' }}>
                                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#666', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 14 }}>Logos</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                                        {[
                                            { label: 'Event Logo', fileKey: 'event_logo', urlKey: 'event_logo_url' },
                                            { label: 'Company Logo', fileKey: 'company_logo', urlKey: 'company_logo_url' },
                                        ].map(({ label, fileKey, urlKey }) => {
                                            const src = form[fileKey] ? URL.createObjectURL(form[fileKey]) : (form[urlKey] ? getImageUrl(form[urlKey]) : null);
                                            return (
                                                <label key={fileKey} style={{ cursor: 'pointer', display: 'block' }}>
                                                    <div style={{ fontSize: '0.72rem', color: '#888', marginBottom: 8 }}>{label}</div>
                                                    <div style={{ height: 90, borderRadius: 10, border: `2px dashed ${src ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.1)'}`, background: 'rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', transition: 'border-color 0.2s', position: 'relative' }}>
                                                        {src ? (
                                                            <img src={src} alt={label} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain', padding: 8 }} />
                                                        ) : (
                                                            <div style={{ textAlign: 'center', color: '#444' }}>
                                                                <BsImage size={20} style={{ marginBottom: 4 }} />
                                                                <div style={{ fontSize: '0.65rem' }}>Click to upload</div>
                                                            </div>
                                                        )}
                                                    </div>
                                                    <input type="file" hidden accept="image/*" onChange={e => setForm({ ...form, [fileKey]: e.target.files[0] })} />
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* SNS Card Background */}
                                <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 14, border: '1px solid rgba(255,255,255,0.07)', padding: '16px 18px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                        <div>
                                            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#666', letterSpacing: 1, textTransform: 'uppercase' }}>Default SNS Card Background</div>
                                            <div style={{ fontSize: '0.68rem', color: '#555', marginTop: 2 }}>Used as the base for all speaker cards in this event</div>
                                        </div>
                                        <label style={{ cursor: 'pointer', background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.25)', color: '#13d999', borderRadius: 8, padding: '5px 12px', fontSize: '0.72rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                            {(form.sns_card_bg || form.sns_card_bg_url) ? 'Change' : 'Upload'}
                                            <input type="file" hidden accept="image/*" onChange={e => setForm({ ...form, sns_card_bg: e.target.files[0] })} />
                                        </label>
                                    </div>
                                    <div style={{ height: 140, borderRadius: 10, border: '2px dashed rgba(255,255,255,0.08)', background: '#0a0a14', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        {(form.sns_card_bg || form.sns_card_bg_url) ? (
                                            <img src={form.sns_card_bg ? URL.createObjectURL(form.sns_card_bg) : getImageUrl(form.sns_card_bg_url)} alt="SNS BG" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        ) : (
                                            <div style={{ textAlign: 'center', color: '#333' }}>
                                                <BsImage size={28} style={{ marginBottom: 6 }} />
                                                <div style={{ fontSize: '0.72rem' }}>No background set</div>
                                            </div>
                                        )}
                                    </div>
                                </div>

                            </div>
                        </Tab>
                    </Tabs>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="link" onClick={() => setShow(false)} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Cancel</Button>
                    <AsyncButton className="btn btn-accent" onClick={handleSave} loadingText={editing ? 'Saving…' : 'Creating…'}>
                        {editing ? 'Save Changes' : 'Create Event'}
                    </AsyncButton>
                </Modal.Footer>
            </Modal>

        </div>
    );
}
