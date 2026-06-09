import { useState, useEffect, useRef } from 'react';
import { Table, Button, Modal, Form, Alert } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
    getAwards, createAward, updateAward, deleteAward,
    getAwardCategories, getEvents
} from '../services/api';
import { BsPlus, BsPencil, BsTrash, BsTrophy, BsTags, BsPerson, BsBuilding, BsImage, BsGlobe } from 'react-icons/bs';
import { getImageUrl } from '../utils/imageUrl';
import AsyncButton from '../components/AsyncButton';

const emptyForm = {
    recipient_name: '',
    photo_url: '',
    category_id: '',
    event_id: '',
    company_name: '',
    company_website: '',
    company_logo_url: ''
};

export default function AwardsPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [awards, setAwards] = useState([]);
    const [categories, setCategories] = useState([]);
    const [events, setEvents] = useState([]);
    const [show, setShow] = useState(false);
    const [editing, setEditing] = useState(null);
    const [error, setError] = useState('');
    const [form, setForm] = useState(emptyForm);
    const [photo, setPhoto] = useState(null);
    const [photoPreview, setPhotoPreview] = useState('');
    const [companyLogo, setCompanyLogo] = useState(null);
    const [logoPreview, setLogoPreview] = useState('');
    const [filterEvent, setFilterEvent] = useState('');
    const photoInputRef = useRef(null);
    const logoInputRef = useRef(null);

    const canManage = ['admin', 'manager'].includes(user?.role) ||
        (user?.role === 'employee' && !!user?.assigned_event_id);

    const load = () => {
        getAwards().then(r => setAwards(Array.isArray(r.data) ? r.data : [])).catch(() => { });
        getEvents().then(r => setEvents(Array.isArray(r.data) ? r.data : [])).catch(() => { });
    };
    useEffect(() => { load(); }, []);

    useEffect(() => {
        getAwardCategories(form.event_id || undefined)
            .then(r => setCategories(Array.isArray(r.data) ? r.data : []))
            .catch(() => { });
    }, [form.event_id]);

    const openModal = (item = null) => {
        if (item) {
            setEditing(item);
            setForm({
                recipient_name: item.recipient_name || '',
                photo_url: item.photo_url || '',
                category_id: item.category_id || '',
                event_id: item.event_id || '',
                company_name: item.company_name || '',
                company_website: item.company_website || '',
                company_logo_url: item.company_logo_url || ''
            });
            setPhotoPreview(item.photo_url ? getImageUrl(item.photo_url) : '');
            setLogoPreview(item.company_logo_url ? getImageUrl(item.company_logo_url) : '');
        } else {
            setEditing(null);
            setForm(emptyForm);
            setPhotoPreview('');
            setLogoPreview('');
        }
        setPhoto(null);
        setCompanyLogo(null);
        setError('');
        setShow(true);
    };

    const handlePhotoChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setPhoto(file);
        setPhotoPreview(URL.createObjectURL(file));
    };
    const handleLogoChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setCompanyLogo(file);
        setLogoPreview(URL.createObjectURL(file));
    };

    const handleSave = async () => {
        if (!form.recipient_name) {
            return setError('Recipient name is required');
        }
        try {
            const fd = new FormData();
            Object.entries(form).forEach(([k, v]) => fd.append(k, v ?? ''));
            if (photo) fd.append('photo', photo);
            if (companyLogo) fd.append('company_logo', companyLogo);
            if (editing) {
                fd.append('id', editing.id);
                await updateAward(fd);
            } else {
                await createAward(fd);
            }
            setShow(false);
            load();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to save');
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm('Delete this award?')) {
            await deleteAward(id);
            load();
        }
    };

    const filtered = filterEvent
        ? awards.filter(a => String(a.event_id) === String(filterEvent))
        : awards;

    const UploadTile = ({ preview, icon: Icon, label, onClick, onClear }) => (
        <div
            onClick={onClick}
            style={{
                border: '1px dashed var(--border-subtle)',
                borderRadius: 12,
                background: 'rgba(255,255,255,0.02)',
                height: 110,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                position: 'relative',
                overflow: 'hidden'
            }}
        >
            {preview ? (
                <>
                    <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onClear(); }}
                        style={{
                            position: 'absolute', top: 6, right: 6,
                            border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff',
                            width: 22, height: 22, borderRadius: '50%', fontSize: 12,
                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                        }}
                    >×</button>
                </>
            ) : (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                    <Icon size={22} style={{ display: 'block', margin: '0 auto 6px' }} />
                    {label}
                </div>
            )}
        </div>
    );

    return (
        <div className="animate-in">
            <div className="page-header d-flex justify-content-between align-items-center flex-wrap gap-2">
                <div>
                    <h4 className="m-0">Awards</h4>
                    <p className='text-white small m-0 opacity-75'>Recognize recipients by category and company.</p>
                </div>
                <div className="d-flex gap-2 align-items-center">
                    <Button variant="outline-light" size="sm" className="d-flex align-items-center gap-2" onClick={() => navigate('/award-categories')}>
                        <BsTags /> Categories
                    </Button>
                    {canManage && (
                        <Button className="btn-accent d-flex align-items-center gap-2" onClick={() => openModal()}>
                            <BsPlus size={18} /> Add Award
                        </Button>
                    )}
                </div>
            </div>

            {events.length > 0 && (
                <div className="mb-3" style={{ maxWidth: 320 }}>
                    <Form.Select
                        className="form-control-dark"
                        value={filterEvent}
                        onChange={e => setFilterEvent(e.target.value)}
                    >
                        <option value="">All Events</option>
                        {events.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
                    </Form.Select>
                </div>
            )}

            {filtered.length === 0 ? (
                <div className="empty-state" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
                    <div className="empty-state-icon"><BsTrophy /></div>
                    <p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>No Awards Yet</p>
                    <p style={{ fontSize: '0.8rem' }}>Add your first award to recognize achievements.</p>
                </div>
            ) : (
                <Table responsive className="premium-table mobile-cards">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Recipient</th>
                            <th>Company</th>
                            <th>Category</th>
                            <th>Event</th>
                            {canManage && <th style={{ width: 100 }}>Actions</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map((a, i) => (
                            <tr key={a.id}>
                                <td className="mob-hide" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                                <td data-label="Recipient">
                                    <div className="d-flex align-items-center gap-2">
                                        {a.photo_url ? (
                                            <img src={getImageUrl(a.photo_url)} alt={a.recipient_name}
                                                style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
                                        ) : (
                                            <div style={{
                                                width: 36, height: 36, borderRadius: '50%',
                                                background: 'rgba(139,92,246,0.1)', color: 'var(--accent)',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                fontWeight: 700
                                            }}>
                                                {a.recipient_name?.charAt(0)}
                                            </div>
                                        )}
                                        <span style={{ fontWeight: 600 }}>{a.recipient_name}</span>
                                    </div>
                                </td>
                                <td data-label="Company">
                                    {a.company_name ? (
                                        <div className="d-flex align-items-center gap-2">
                                            {a.company_logo_url && (
                                                <img src={getImageUrl(a.company_logo_url)} alt=""
                                                    style={{ width: 24, height: 24, borderRadius: 4, objectFit: 'contain', background: '#fff' }} />
                                            )}
                                            <div>
                                                <div>{a.company_name}</div>
                                                {a.company_website && (
                                                    <a href={a.company_website} target="_blank" rel="noreferrer"
                                                        style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                                        {a.company_website.replace(/^https?:\/\//, '')}
                                                    </a>
                                                )}
                                            </div>
                                        </div>
                                    ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                </td>
                                <td data-label="Category">{a.category_name || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                                <td data-label="Event">{a.event_title || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                                {canManage && (
                                    <td className="mob-full">
                                        <button className="btn-action" onClick={() => openModal(a)}>
                                            <BsPencil size={13} />
                                        </button>
                                        <button className="btn-action danger" onClick={() => handleDelete(a.id)}>
                                            <BsTrash size={13} />
                                        </button>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}

            <Modal show={show} onHide={() => setShow(false)} centered size="lg" contentClassName="premium-modal">
                <Modal.Header closeButton closeVariant="white">
                    <Modal.Title style={{ color: 'var(--text-primary)' }}>
                        {editing ? 'Edit Award' : 'Add Award'}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {error && (
                        <Alert variant="danger" className="py-2" style={{
                            fontSize: '0.85rem', borderRadius: 10,
                            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                            color: '#f87171'
                        }}>
                            {error}
                        </Alert>
                    )}

                    {/* Section: Recipient */}
                    <div className="mb-4">
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
                            color: 'var(--accent)', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase'
                        }}>
                            <BsPerson /> Recipient
                        </div>
                        <div className="d-flex gap-3 align-items-start">
                            <div style={{ width: 110, flexShrink: 0 }}>
                                <UploadTile
                                    preview={photoPreview}
                                    icon={BsImage}
                                    label="Upload photo"
                                    onClick={() => photoInputRef.current?.click()}
                                    onClear={() => { setPhoto(null); setPhotoPreview(''); setForm({ ...form, photo_url: '' }); }}
                                />
                                <input ref={photoInputRef} type="file" accept="image/*" hidden onChange={handlePhotoChange} />
                            </div>
                            <div className="flex-grow-1">
                                <Form.Group className="mb-2">
                                    <Form.Label className="small mb-1" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Name *</Form.Label>
                                    <Form.Control
                                        className="form-control-dark"
                                        value={form.recipient_name}
                                        onChange={e => setForm({ ...form, recipient_name: e.target.value })}
                                        placeholder="Full name of awardee"
                                    />
                                </Form.Group>
                            </div>
                        </div>
                    </div>

                    {/* Section: Company */}
                    <div className="mb-4">
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
                            color: 'var(--accent)', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase'
                        }}>
                            <BsBuilding /> Company
                        </div>
                        <div className="d-flex gap-3 align-items-start">
                            <div style={{ width: 110, flexShrink: 0 }}>
                                <UploadTile
                                    preview={logoPreview}
                                    icon={BsImage}
                                    label="Company logo"
                                    onClick={() => logoInputRef.current?.click()}
                                    onClear={() => { setCompanyLogo(null); setLogoPreview(''); setForm({ ...form, company_logo_url: '' }); }}
                                />
                                <input ref={logoInputRef} type="file" accept="image/*" hidden onChange={handleLogoChange} />
                            </div>
                            <div className="flex-grow-1">
                                <Form.Group className="mb-2">
                                    <Form.Label className="small mb-1" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Company Name</Form.Label>
                                    <Form.Control
                                        className="form-control-dark"
                                        value={form.company_name}
                                        onChange={e => setForm({ ...form, company_name: e.target.value })}
                                        placeholder="e.g., Acme Corp"
                                    />
                                </Form.Group>
                                <Form.Group>
                                    <Form.Label className="small mb-1 d-flex align-items-center gap-1" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                                        <BsGlobe size={11} /> Website
                                    </Form.Label>
                                    <Form.Control
                                        className="form-control-dark"
                                        value={form.company_website}
                                        onChange={e => setForm({ ...form, company_website: e.target.value })}
                                        placeholder="https://acme.com"
                                    />
                                </Form.Group>
                            </div>
                        </div>
                    </div>

                    {/* Section: Placement */}
                    <div>
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
                            color: 'var(--accent)', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase'
                        }}>
                            <BsTrophy /> Award Placement
                        </div>
                        <div className="row g-3">
                            <div className="col-md-6">
                                <Form.Label className="small mb-1" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Event</Form.Label>
                                <Form.Select
                                    className="form-control-dark"
                                    value={form.event_id}
                                    onChange={e => setForm({ ...form, event_id: e.target.value, category_id: '' })}
                                    disabled={user?.role === 'employee'}
                                >
                                    <option value="">— No specific event —</option>
                                    {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                                </Form.Select>
                            </div>
                            <div className="col-md-6">
                                <Form.Label className="small mb-1" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Category</Form.Label>
                                <Form.Select
                                    className="form-control-dark"
                                    value={form.category_id}
                                    onChange={e => setForm({ ...form, category_id: e.target.value })}
                                    disabled={!form.event_id}
                                >
                                    <option value="">{form.event_id ? '— Select category —' : '— Pick an event first —'}</option>
                                    {categories.map(c => (
                                        <option key={c.id} value={c.id}>
                                            {c.parent_id ? `    ↳ ${c.name}` : c.name}
                                        </option>
                                    ))}
                                </Form.Select>
                            </div>
                        </div>
                    </div>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="link" onClick={() => setShow(false)} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
                        Cancel
                    </Button>
                    <AsyncButton className="btn btn-accent" onClick={handleSave} loadingText={editing ? 'Saving…' : 'Adding…'}>
                        {editing ? 'Save' : 'Add Award'}
                    </AsyncButton>
                </Modal.Footer>
            </Modal>
        </div>
    );
}
