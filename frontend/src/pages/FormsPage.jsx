import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Modal, Form, Alert } from 'react-bootstrap';
import { BsPlus, BsPencil, BsTrash, BsCardChecklist, BsEye, BsLink45Deg, BsCheck2, BsPeople, BsFiles } from 'react-icons/bs';
import { getForms, createForm, deleteForm, duplicateForm, getEvents } from '../services/api';

// List of all forms in the tenant. Lets admins create a new form, open the
// builder, copy the public fill URL, or view submissions.

export default function FormsPage() {
    const navigate = useNavigate();
    const [forms, setForms] = useState([]);
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [creating, setCreating] = useState(false);
    const [createForm_, setCreateForm] = useState({ title: '', description: '', event_id: '' });
    const [error, setError] = useState('');
    const [copiedId, setCopiedId] = useState(null);

    const load = () => {
        setLoading(true);
        Promise.all([
            getForms().then(r => setForms(Array.isArray(r.data) ? r.data : [])).catch(() => setForms([])),
            getEvents().then(r => setEvents(Array.isArray(r.data) ? r.data : [])).catch(() => setEvents([])),
        ]).finally(() => setLoading(false));
    };

    useEffect(() => { load(); }, []);

    const handleCreate = async () => {
        try {
            setError('');
            const title = (createForm_.title || '').trim();
            if (!title) { setError('Form title is required'); return; }
            setCreating(true);
            const { data } = await createForm({
                title,
                description: createForm_.description || null,
                event_id: createForm_.event_id || null,
            });
            setShowCreate(false);
            setCreateForm({ title: '', description: '', event_id: '' });
            navigate(`/forms/${data.id}/edit`);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to create form');
        } finally { setCreating(false); }
    };

    const handleDelete = async (id, title) => {
        if (!window.confirm(`Delete "${title}"? This removes all its questions and collected responses.`)) return;
        try { await deleteForm(id); load(); }
        catch (err) { alert(err.response?.data?.error || 'Delete failed'); }
    };

    const handleDuplicate = async (id) => {
        try {
            const { data } = await duplicateForm(id);
            // Navigate straight into the builder for the new copy.
            navigate(`/forms/${data.id}/edit`);
        } catch (err) { alert(err.response?.data?.error || 'Duplicate failed'); }
    };

    const copyPublicLink = async (id) => {
        const url = `${window.location.origin}/f/${id}`;
        try {
            await navigator.clipboard.writeText(url);
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 1800);
        } catch { alert(url); }
    };

    return (
        <div className="animate-in">
            <div className="page-header d-flex justify-content-between align-items-center">
                <div>
                    <h4>Forms</h4>
                    <p className="text-white small">Build forms for registration, feedback, RSVPs — share a public link.</p>
                </div>
                <div className="d-flex gap-2">
                    <Button className="btn-accent d-flex align-items-center gap-2" onClick={() => setShowCreate(true)}>
                        <BsPlus size={18} /> Create Form
                    </Button>
                </div>
            </div>

            {loading ? (
                <div className="text-center py-5" style={{ color: 'var(--text-muted)' }}>Loading…</div>
            ) : forms.length === 0 ? (
                <div className="empty-state" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
                    <div className="empty-state-icon"><BsCardChecklist /></div>
                    <p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>No forms yet</p>
                    <p style={{ fontSize: '0.8rem' }}>Create your first form to start collecting responses.</p>
                </div>
            ) : (
                <Table responsive className="premium-table mobile-cards">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Title</th>
                            <th>Event</th>
                            <th>Questions</th>
                            <th>Responses</th>
                            <th>Status</th>
                            <th style={{ width: 180 }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {forms.map((f, i) => (
                            <tr key={f.id}>
                                <td className="mob-hide" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                                <td data-label="Title">
                                    <div style={{ fontWeight: 600 }}>{f.title}</div>
                                    {f.description && (
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2, maxWidth: 320 }}>
                                            {f.description.length > 80 ? f.description.slice(0, 80) + '…' : f.description}
                                        </div>
                                    )}
                                </td>
                                <td data-label="Event">
                                    {f.event_title ? <span className="badge-premium status-upcoming">{f.event_title}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                </td>
                                <td data-label="Questions" style={{ color: 'var(--text-secondary)' }}>{f.field_count || 0}</td>
                                <td data-label="Responses" style={{ color: 'var(--text-secondary)' }}>{f.submission_count || 0}</td>
                                <td data-label="Status">
                                    <span className={`badge-premium status-${f.is_active ? 'ongoing' : 'canceled'}`} style={{ fontSize: '0.65rem' }}>
                                        {f.is_active ? 'Active' : 'Closed'}
                                    </span>
                                </td>
                                <td className="mob-full">
                                    <div className="d-flex gap-1">
                                        <button className="btn-action" title={copiedId === f.id ? 'Copied!' : 'Copy public link'}
                                            onClick={() => copyPublicLink(f.id)}
                                            style={{ color: copiedId === f.id ? 'var(--accent-emerald)' : '#a78bfa' }}>
                                            {copiedId === f.id ? <BsCheck2 size={13} /> : <BsLink45Deg size={13} />}
                                        </button>
                                        <button className="btn-action" title="Open fill page"
                                            onClick={() => window.open(`/f/${f.id}`, '_blank', 'noopener')}
                                            style={{ color: '#f59e0b' }}><BsEye size={13} /></button>
                                        <button className="btn-action" title="Responses"
                                            onClick={() => navigate(`/forms/${f.id}/submissions`)}
                                            style={{ color: '#60a5fa' }}><BsPeople size={13} /></button>
                                        <button className="btn-action" title="Duplicate"
                                            onClick={() => handleDuplicate(f.id)}
                                            style={{ color: '#10b981' }}><BsFiles size={13} /></button>
                                        <button className="btn-action" title="Edit / build"
                                            onClick={() => navigate(`/forms/${f.id}/edit`)}><BsPencil size={13} /></button>
                                        <button className="btn-action danger" title="Delete"
                                            onClick={() => handleDelete(f.id, f.title)}><BsTrash size={13} /></button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}

            {/* Create modal */}
            <Modal show={showCreate} onHide={() => setShowCreate(false)} centered contentClassName="premium-modal">
                <Modal.Header closeButton closeVariant="white">
                    <Modal.Title>Create Form</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {error && <Alert variant="danger" className="py-2" style={{ fontSize: '0.85rem', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>{error}</Alert>}
                    <Form.Group className="mb-3">
                        <Form.Label>Title *</Form.Label>
                        <Form.Control
                            className="form-control-dark"
                            value={createForm_.title}
                            onChange={e => setCreateForm(s => ({ ...s, title: e.target.value }))}
                            placeholder="e.g. Event Registration"
                            autoFocus
                        />
                    </Form.Group>
                    <Form.Group className="mb-3">
                        <Form.Label>Description <span className="text-muted">(optional)</span></Form.Label>
                        <Form.Control
                            as="textarea" rows={2}
                            className="form-control-dark"
                            value={createForm_.description}
                            onChange={e => setCreateForm(s => ({ ...s, description: e.target.value }))}
                            placeholder="Shown at the top of the public form"
                        />
                    </Form.Group>
                    <Form.Group className="mb-1">
                        <Form.Label>Link to Event <span className="text-muted">(optional)</span></Form.Label>
                        <Form.Select
                            className="form-select-dark"
                            value={createForm_.event_id}
                            onChange={e => setCreateForm(s => ({ ...s, event_id: e.target.value }))}
                        >
                            <option value="">— Standalone —</option>
                            {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                        </Form.Select>
                        <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                            Linking to an event makes the public form use that event's branding.
                        </Form.Text>
                    </Form.Group>
                </Modal.Body>
                <Modal.Footer style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <Button variant="link" onClick={() => setShowCreate(false)} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Cancel</Button>
                    <Button className="btn-accent" onClick={handleCreate} disabled={creating}>
                        {creating ? 'Creating…' : 'Create & Build'}
                    </Button>
                </Modal.Footer>
            </Modal>
        </div>
    );
}
