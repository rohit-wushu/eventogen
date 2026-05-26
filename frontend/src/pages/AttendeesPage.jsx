import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Table, Button, Modal, Form, Alert, Row, Col, Badge, Spinner } from 'react-bootstrap';
import { useAuth } from '../context/AuthContext';
import { BsPlus, BsPencil, BsTrash, BsPeopleFill, BsFunnel, BsPersonCheck, BsPersonX, BsPersonBadge, BsTelephone, BsEnvelope, BsBuilding, BsUpload, BsDownload, BsEnvelopePaperFill, BsCheckCircleFill, BsExclamationTriangleFill, BsSendFill, BsPhone, BsTablet, BsDisplay, BsPerson, BsBriefcase, BsCalendarEvent, BsTicketPerforated, BsBookmarkStar, BsJournalText, BsCameraVideo, BsQrCode, BsBarChartFill, BsChevronUp } from 'react-icons/bs';
import { Bar, Doughnut } from 'react-chartjs-2';
import QRCode from 'qrcode';
import { toPng } from 'html-to-image';
import { getAttendees, createAttendee, updateAttendee, deleteAttendee, getEvents, exportAttendees, importAttendees, sendAttendeeConfirmation, previewAttendeeConfirmation, getAttendeeReports } from '../services/api';

const STATUS_COLORS = {
    registered: { bg: 'rgba(59,130,246,0.12)', color: '#60a5fa', border: 'rgba(59,130,246,0.25)' },
    confirmed: { bg: 'rgba(34,197,94,0.12)', color: '#4ade80', border: 'rgba(34,197,94,0.25)' },
    checked_in: { bg: 'rgba(168,85,247,0.12)', color: '#c084fc', border: 'rgba(168,85,247,0.25)' },
    cancelled: { bg: 'rgba(239,68,68,0.12)', color: '#f87171', border: 'rgba(239,68,68,0.25)' },
};

const TICKET_COLORS = {
    general: { bg: 'rgba(148,163,184,0.12)', color: '#94a3b8', border: 'rgba(148,163,184,0.25)' },
    vip: { bg: 'rgba(234,179,8,0.12)', color: '#facc15', border: 'rgba(234,179,8,0.25)' },
    speaker: { bg: 'rgba(236,72,153,0.12)', color: '#f472b6', border: 'rgba(236,72,153,0.25)' },
    sponsor: { bg: 'rgba(14,165,233,0.12)', color: '#38bdf8', border: 'rgba(14,165,233,0.25)' },
    premium: { bg: 'rgba(139,92,246,0.12)', color: '#a78bfa', border: 'rgba(139,92,246,0.25)' },
    gov: { bg: 'rgba(99,102,241,0.12)', color: '#818cf8', border: 'rgba(99,102,241,0.25)' },
    'non-gov': { bg: 'rgba(107,114,128,0.12)', color: '#9ca3af', border: 'rgba(107,114,128,0.25)' },
};

// Compact "checked in at" formatter. Shows relative time for recent scans
// ("2m ago", "1h ago") and a full date/time for anything older so a row
// scanned three days ago is still unambiguous at a glance.
const fmtCheckinTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diffSec < 60) return 'Just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export default function AttendeesPage() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [attendees, setAttendees] = useState([]);
    const [events, setEvents] = useState([]);
    const [show, setShow] = useState(false);
    const [editing, setEditing] = useState(null);
    const [error, setError] = useState('');
    const [filterEvent, setFilterEvent] = useState('');
    const [filterStatus, setFilterStatus] = useState('');
    const [filterTicket, setFilterTicket] = useState('');
    const [form, setForm] = useState({
        name: '', email: '', phone: '', company: '', designation: '',
        ticket_type: 'general', status: 'registered', event_id: '', notes: ''
    });
    const [exporting, setExporting] = useState(false);
    // Modal shown right after a new attendee with an email is created — asks
    // whether to fire the confirmation email now. Holds the freshly-created
    // attendee details so we can send without re-fetching.
    const [confirmPrompt, setConfirmPrompt] = useState(null);
    const [sendingId, setSendingId] = useState(null);
    const [toast, setToast] = useState(null); // { type: 'success'|'danger', text }
    // Preview modal state — opens when the user clicks the row's envelope
    // icon. We fetch the rendered email server-side using the saved template
    // + the actual attendee's data, so what shows here is exactly what'll
    // arrive in their inbox. `loadingId` flags the row that's fetching.
    const [preview, setPreview] = useState(null); // { id, html, subject, to, attendee_name, event_title }
    const [loadingPreviewId, setLoadingPreviewId] = useState(null);

    // QR preview modal — opened from the per-row QR button. We render the QR
    // client-side from the attendee's `checkin_token` so it stays cheap (no
    // round-trip to the server) and works offline once the page is loaded.
    const [qrAttendee, setQrAttendee] = useState(null);
    const [qrDataUrl, setQrDataUrl] = useState('');
    const ticketRef = useRef(null);
    const [downloadingTicket, setDownloadingTicket] = useState(false);

    // Inline Reports panel — toggled by the Reports toolbar button. Data is
    // fetched lazily (only after first open) and re-fetched whenever the
    // attendees list reloads, so check-ins reflect within the next refresh.
    const [showReports, setShowReports] = useState(false);
    const [reportsData, setReportsData] = useState(null);
    const [reportsLoading, setReportsLoading] = useState(false);

    useEffect(() => {
        if (!qrAttendee?.checkin_token) { setQrDataUrl(''); return; }
        let cancelled = false;
        QRCode.toDataURL(qrAttendee.checkin_token, {
            width: 360, margin: 1, errorCorrectionLevel: 'M',
            color: { dark: '#0f172a', light: '#ffffff' },
        }).then(url => { if (!cancelled) setQrDataUrl(url); }).catch(() => {});
        return () => { cancelled = true; };
    }, [qrAttendee]);

    const canManage = ['admin', 'manager'].includes(user?.role) || (user?.role === 'employee' && !!user?.assigned_event_id);

    const load = () => {
        getAttendees(filterEvent || undefined, filterTicket || undefined, filterStatus || undefined)
            .then(r => setAttendees(Array.isArray(r.data) ? r.data : []))
            .catch(() => { });
    };

    useEffect(() => {
        getEvents().then(r => setEvents(Array.isArray(r.data) ? r.data : [])).catch(() => { });
    }, []);

    useEffect(() => { load(); }, [filterEvent, filterTicket, filterStatus]);

    // Lazy-load reports the first time the panel opens, refresh whenever the
    // attendees list reloads (so check-ins propagate to the charts), and
    // re-scope the moment the user picks a different event in the filter.
    useEffect(() => {
        if (!showReports) return;
        let cancelled = false;
        setReportsLoading(true);
        getAttendeeReports(filterEvent || undefined)
            .then(r => { if (!cancelled) setReportsData(r.data); })
            .catch(() => { if (!cancelled) setReportsData(null); })
            .finally(() => { if (!cancelled) setReportsLoading(false); });
        return () => { cancelled = true; };
    }, [showReports, attendees, filterEvent]);

    const openModal = (item = null) => {
        if (item) {
            setEditing(item);
            setForm({
                name: item.name, email: item.email || '', phone: item.phone || '',
                company: item.company || '', designation: item.designation || '',
                ticket_type: item.ticket_type || 'general', status: item.status || 'registered',
                event_id: item.event_id || '', notes: item.notes || ''
            });
        } else {
            setEditing(null);
            setForm({ 
                name: '', email: '', phone: '', company: '', designation: '', 
                ticket_type: 'general', status: 'registered', 
                event_id: user?.role === 'employee' ? user.assigned_event_id : '', 
                notes: '' 
            });
        }
        setError('');
        setShow(true);
    };

    const handleSave = async () => {
        try {
            setError('');
            const name = (form.name || '').trim();
            const email = (form.email || '').trim();
            if (!name) { setError('Attendee name is required'); return; }
            if (!form.event_id) { setError('Please select an event'); return; }
            if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                setError('Please enter a valid email address'); return;
            }
            const payload = { ...form, name, email };
            if (editing) {
                await updateAttendee({ ...payload, id: editing.id });
                setShow(false);
                load();
            } else {
                const res = await createAttendee(payload);
                const newId = res?.data?.id;
                setShow(false);
                load();
                // Only prompt to send confirmation when we actually have an
                // email + an id back from the server. Skipping silently when
                // either is missing keeps the no-email path frictionless.
                if (newId && email) {
                    const evt = events.find(e => String(e.id) === String(form.event_id));
                    setConfirmPrompt({ id: newId, name, email, eventTitle: evt?.title || '' });
                }
            }
        } catch (err) { setError(err.response?.data?.error || 'Failed'); }
    };

    // Click the envelope icon (or "Send confirmation" in the post-add prompt)
    // to fetch the rendered email and open the preview modal. The actual
    // send happens from the modal's CTA, so the operator gets to verify
    // first.
    const handleOpenPreview = async (meta) => {
        setLoadingPreviewId(meta.id);
        try {
            const r = await previewAttendeeConfirmation(meta.id);
            setPreview({ id: meta.id, ...(r.data || {}) });
            // Tear down the post-add prompt if it was the trigger.
            setConfirmPrompt(null);
        } catch (err) {
            setToast({ type: 'danger', text: err.response?.data?.error || 'Failed to load preview' });
        } finally {
            setLoadingPreviewId(null);
        }
    };

    // Fire the confirmation email — used from the preview modal's Send button.
    // `meta` is { id, email, name } so we can show it in the toast without
    // re-reading the row from state.
    const handleSendConfirmation = async (meta, { silent } = {}) => {
        setSendingId(meta.id);
        try {
            const r = await sendAttendeeConfirmation(meta.id);
            if (r.data?.skipped) {
                setToast({ type: 'danger', text: r.data.skipped === 'SMTP not configured'
                    ? 'No SMTP configured — set up email under Settings → SMTP first.'
                    : `Email skipped: ${r.data.skipped}` });
            } else if (r.data?.sent) {
                if (!silent) setToast({ type: 'success', text: `Confirmation email sent to ${meta.email}.` });
            }
        } catch (err) {
            setToast({ type: 'danger', text: err.response?.data?.error || 'Failed to send confirmation email' });
        } finally {
            setSendingId(null);
            setConfirmPrompt(null);
            setPreview(null);
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm('Delete this attendee?')) { await deleteAttendee(id); load(); }
    };

    const handleExport = async () => {
        setExporting(true);
        try {
            const token = localStorage.getItem('token');
            let url = '/api/attendees/export?t=' + Date.now();
            if (filterEvent) url += '&event_id=' + filterEvent;
            const response = await fetch(url, {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (!response.ok) throw new Error('Export failed');
            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = 'attendees_' + new Date().toISOString().split('T')[0] + '.csv';
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
        const formData = new FormData();
        formData.append('file', file);
        try {
            await importAttendees(formData, filterEvent || undefined);
            alert('Attendees imported successfully');
            load();
        } catch (err) { alert(err.response?.data?.error || 'Import failed'); }
        e.target.value = '';
    };

    // Filtered attendees
    let filtered = attendees;

    // Stats
    const stats = {
        total: attendees.length,
        confirmed: attendees.filter(a => a.status === 'confirmed').length,
        checked_in: attendees.filter(a => a.status === 'checked_in').length,
        cancelled: attendees.filter(a => a.status === 'cancelled').length,
    };

    // Clicking a stat card filters the table to that status. Click again
    // (when already active) to clear back to "all". `statusKey === null`
    // means the Total card — it just clears the filter.
    const StatCard = ({ label, value, icon: Icon, color, statusKey = null }) => {
        const active = statusKey !== null && filterStatus === statusKey;
        const clickable = true;
        const onClick = () => {
            if (statusKey === null) setFilterStatus('');
            else setFilterStatus(active ? '' : statusKey);
        };
        return (
        <Col xs={6} md={3}>
            <div
                onClick={onClick}
                role="button" tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
                style={{
                    background: active ? `${color}1a` : 'var(--bg-card)',
                    borderRadius: 'var(--radius-lg)',
                    border: active ? `1px solid ${color}` : '1px solid var(--border-subtle)',
                    padding: '16px 20px',
                    display: 'flex', alignItems: 'center', gap: 14,
                    cursor: clickable ? 'pointer' : 'default',
                    transition: 'border-color 0.18s ease, background 0.18s ease, transform 0.18s ease',
                }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.borderColor = `${color}66`; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
            >
                <div style={{
                    width: 42, height: 42, borderRadius: 12,
                    background: `${color}15`, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', color: color, fontSize: 18
                }}>
                    <Icon />
                </div>
                <div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                </div>
            </div>
        </Col>
        );
    };

    return (
        <div className="animate-in">
            <div className="page-header d-flex justify-content-between align-items-center">
                <div><h4>Attendees</h4><p>Manage event delegates and participants.</p></div>
                <div className="d-flex gap-2">
                    <Button variant="outline-light" size="sm" className="d-flex align-items-center gap-2" style={{ border: '1px solid var(--border-subtle)', borderRadius: 10 }} onClick={handleExport} disabled={exporting}>
                        <BsDownload /> {exporting ? 'Exporting...' : 'Export'}
                    </Button>
                    <label className="btn btn-outline-light btn-sm d-flex align-items-center gap-2 mb-0" style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, cursor: 'pointer' }}>
                        <BsUpload /> Import <input type="file" hidden accept=".csv" onChange={handleImport} />
                    </label>
                    {(user?.role === 'admin' || user?.role === 'manager') && (
                        <Button
                            variant="outline-light" size="sm"
                            className="d-flex align-items-center gap-2"
                            style={{ border: '1px solid var(--border-subtle)', borderRadius: 10 }}
                            onClick={() => navigate('/attendees/email-template')}
                            title="Edit the confirmation email template sent to delegates"
                        >
                            <BsEnvelopePaperFill /> Email Template
                        </Button>
                    )}
                    <Button
                        variant="outline-light" size="sm"
                        className="d-flex align-items-center gap-2"
                        style={{
                            border: '1px solid rgba(139,92,246,0.45)',
                            color: '#a78bfa', borderRadius: 10,
                            background: showReports ? 'rgba(139,92,246,0.12)' : 'transparent',
                        }}
                        onClick={() => setShowReports(s => !s)}
                        title="Toggle attendance report"
                    >
                        <BsBarChartFill /> Reports {showReports && <BsChevronUp size={12} />}
                    </Button>
                    {/* On-site scanner — only meaningful when filtered to one
                        event, since check-in is event-scoped. Hidden otherwise
                        so staff can't open it without a target event. */}
                    {filterEvent && canManage && (
                        <Button
                            variant="outline-light" size="sm"
                            className="d-flex align-items-center gap-2"
                            style={{ border: '1px solid rgba(16,185,129,0.45)', color: '#10b981', borderRadius: 10 }}
                            onClick={() => navigate(`/events/${filterEvent}/checkin`)}
                            title="Open the QR scanner for this event"
                        >
                            <BsCameraVideo /> Scanner
                        </Button>
                    )}
                    {canManage && <Button className="btn-accent d-flex align-items-center gap-2" onClick={() => openModal()}><BsPlus size={18} /> Add Attendee</Button>}
                </div>
            </div>

            {/* Stat Cards */}
            <Row className="g-3 mb-4">
                <StatCard label="Total" value={stats.total} icon={BsPeopleFill} color="#8b5cf6" />
                <StatCard label="Confirmed" value={stats.confirmed} icon={BsPersonCheck} color="#4ade80" statusKey="confirmed" />
                <StatCard label="Checked In" value={stats.checked_in} icon={BsPersonBadge} color="#c084fc" statusKey="checked_in" />
                <StatCard label="Cancelled" value={stats.cancelled} icon={BsPersonX} color="#f87171" statusKey="cancelled" />
            </Row>

            {/* Inline reports panel — toggled by the Reports button. Sits
                between the stat cards and the filters so the dashboard view
                is right where the user expects, without leaving the page. */}
            {showReports && (
                <ReportsPanel data={reportsData} loading={reportsLoading} />
            )}

            {/* Filters */}
            <div className="d-flex gap-2 mb-3 align-items-center flex-wrap">
                <BsFunnel size={16} style={{ color: 'var(--text-primary)', opacity: 0.85 }} />
                <Form.Select size="sm" className="form-select-dark" style={{ width: 160 }} value={filterEvent} onChange={e => setFilterEvent(e.target.value)}>
                    <option value="">All Events</option>
                    {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                </Form.Select>
                <Form.Select size="sm" className="form-select-dark" style={{ width: 150 }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
                    <option value="">All Status</option>
                    <option value="registered">Registered</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="checked_in">Checked In</option>
                    <option value="cancelled">Cancelled</option>
                </Form.Select>
                <Form.Select size="sm" className="form-select-dark" style={{ width: 150 }} value={filterTicket} onChange={e => setFilterTicket(e.target.value)}>
                    <option value="">All Tickets</option>
                    <option value="general">General</option>
                    <option value="vip">VIP</option>
                    <option value="speaker">Speaker</option>
                    <option value="sponsor">Sponsor</option>
                    <option value="premium">Premium</option>
                    <option value="gov">Gov</option>
                    <option value="non-gov">Non-Gov</option>
                </Form.Select>
                {(filterEvent || filterStatus || filterTicket) && (
                    <Button size="sm" variant="link" className="text-muted text-decoration-none" onClick={() => { setFilterEvent(''); setFilterStatus(''); setFilterTicket(''); }}>
                        Clear
                    </Button>
                )}
            </div>

            {filtered.length === 0 ? (
                <div className="empty-state" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
                    <div className="empty-state-icon"><BsPeopleFill /></div>
                    <p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>No Attendees Found</p>
                    <p style={{ fontSize: '0.8rem' }}>Add attendees or adjust your filters.</p>
                </div>
            ) : (
                <Table responsive className="premium-table mobile-cards">
                    <thead>
                        <tr>
                            <th>#</th><th>Name</th><th>Contact</th><th>Company</th>
                            <th>Ticket</th><th>Status</th><th>Event</th>
                            {canManage && <th style={{ width: 100 }}>Actions</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map((a, i) => (
                            <tr key={a.id}>
                                <td className="mob-hide" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                                <td data-label="Name">
                                    <div>
                                        <div style={{ fontWeight: 600 }}>{a.name}</div>
                                        {a.designation && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{a.designation}</div>}
                                    </div>
                                </td>
                                <td data-label="Contact">
                                    <div style={{ fontSize: '0.8rem' }}>
                                        {a.email && <div className="d-flex align-items-center gap-1" style={{ color: 'var(--accent-sky)' }}><BsEnvelope size={11} /> {a.email}</div>}
                                        {a.phone && <div className="d-flex align-items-center gap-1 mt-1" style={{ color: 'var(--text-muted)' }}><BsTelephone size={11} /> {a.phone}</div>}
                                    </div>
                                </td>
                                <td data-label="Company" style={{ color: 'var(--text-secondary)' }}>{a.company || '—'}</td>
                                <td data-label="Ticket">
                                    <span style={{
                                        display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: '0.7rem',
                                        fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em',
                                        background: TICKET_COLORS[a.ticket_type]?.bg, color: TICKET_COLORS[a.ticket_type]?.color,
                                        border: `1px solid ${TICKET_COLORS[a.ticket_type]?.border}`
                                    }}>{a.ticket_type}</span>
                                </td>
                                <td data-label="Status">
                                    <span style={{
                                        display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: '0.7rem',
                                        fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em',
                                        background: STATUS_COLORS[a.status]?.bg, color: STATUS_COLORS[a.status]?.color,
                                        border: `1px solid ${STATUS_COLORS[a.status]?.border}`
                                    }}>{a.status?.replace('_', ' ')}</span>
                                    {/* Check-in audit — shown under the badge whenever a row has
                                        been scanned. "by …" + relative time so staff can see
                                        when/who at a glance without opening a detail modal. */}
                                    {a.checked_in_at && (
                                        <div style={{ marginTop: 6, fontSize: '0.7rem', lineHeight: 1.4, color: 'var(--text-muted)' }}>
                                            <div style={{ color: '#c084fc', fontWeight: 600 }}>
                                                {fmtCheckinTime(a.checked_in_at)}
                                            </div>
                                            {a.checked_in_by_name && (
                                                <div>by {a.checked_in_by_name}</div>
                                            )}
                                        </div>
                                    )}
                                </td>
                                <td data-label="Event"><span className="badge-premium status-upcoming">{a.event_title || '—'}</span></td>
                                {canManage && (
                                    <td className="mob-full">
                                        <button className="btn-action" onClick={() => openModal(a)} title="Edit"><BsPencil size={13} /></button>
                                        {/* Show the delegate's check-in QR. Always clickable — if the
                                            row has no token (migration not yet run, or backend wasn't
                                            restarted after it), the modal shows a clear diagnostic
                                            instead of silently doing nothing. */}
                                        <button
                                            className="btn-action"
                                            onClick={() => setQrAttendee(a)}
                                            title="Show check-in QR"
                                            style={{ color: '#10b981' }}
                                        >
                                            <BsQrCode size={13} />
                                        </button>
                                        {a.email && (
                                            <button
                                                className="btn-action"
                                                disabled={loadingPreviewId === a.id || sendingId === a.id}
                                                onClick={() => handleOpenPreview({ id: a.id, email: a.email, name: a.name })}
                                                title={`Preview confirmation email for ${a.email}`}
                                                style={{ color: 'var(--accent)' }}
                                            >
                                                {loadingPreviewId === a.id ? '…' : <BsEnvelopePaperFill size={13} />}
                                            </button>
                                        )}
                                        {user?.role === 'admin' && <button className="btn-action danger" onClick={() => handleDelete(a.id)} title="Delete"><BsTrash size={13} /></button>}
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}

            {/* Modal */}
            <Modal show={show} onHide={() => setShow(false)} centered contentClassName="premium-modal" size="lg">
                <Modal.Header closeButton closeVariant="white"><Modal.Title style={{ color: 'var(--text-primary)' }}>{editing ? 'Edit Attendee' : 'Add Attendee'}</Modal.Title></Modal.Header>
                <Modal.Body>
                    {error && <Alert variant="danger" className="py-2" style={{ fontSize: '0.85rem', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>{error}</Alert>}

                    <Row>
                        <Col md={6}>
                            <Form.Group className="mb-3"><Form.Label>Name *</Form.Label>
                                <div className="att-field">
                                    <BsPerson className="att-field-icon" />
                                    <Form.Control className="form-control-dark" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Full name" required />
                                </div>
                            </Form.Group>
                        </Col>
                        <Col md={6}>
                            <Form.Group className="mb-3"><Form.Label>Email</Form.Label>
                                <div className="att-field">
                                    <BsEnvelope className="att-field-icon" />
                                    <Form.Control type="email" className="form-control-dark" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" />
                                </div>
                            </Form.Group>
                        </Col>
                    </Row>

                    <Row>
                        <Col md={6}>
                            <Form.Group className="mb-3"><Form.Label>Phone</Form.Label>
                                <div className="att-field">
                                    <BsTelephone className="att-field-icon" />
                                    <Form.Control className="form-control-dark" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+91 98765 43210" />
                                </div>
                            </Form.Group>
                        </Col>
                        <Col md={6}>
                            <Form.Group className="mb-3"><Form.Label>Company</Form.Label>
                                <div className="att-field">
                                    <BsBuilding className="att-field-icon" />
                                    <Form.Control className="form-control-dark" value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} placeholder="Organization" />
                                </div>
                            </Form.Group>
                        </Col>
                    </Row>

                    <Row>
                        <Col md={6}>
                            <Form.Group className="mb-3"><Form.Label>Designation</Form.Label>
                                <div className="att-field">
                                    <BsBriefcase className="att-field-icon" />
                                    <Form.Control className="form-control-dark" value={form.designation} onChange={e => setForm({ ...form, designation: e.target.value })} placeholder="Job title" />
                                </div>
                            </Form.Group>
                        </Col>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Event</Form.Label>
                                <div className="att-field">
                                    <BsCalendarEvent className="att-field-icon" />
                                    <Form.Select
                                        className="form-select-dark"
                                        value={form.event_id}
                                        onChange={e => setForm({ ...form, event_id: e.target.value })}
                                        disabled={user?.role === 'employee'}
                                    >
                                        <option value="">Select Event</option>
                                        {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                                    </Form.Select>
                                </div>
                            </Form.Group>
                        </Col>
                    </Row>

                    <Row>
                        <Col md={6}>
                            <Form.Group className="mb-3"><Form.Label>Ticket Type</Form.Label>
                                <div className="att-field">
                                    <BsTicketPerforated className="att-field-icon" />
                                    <Form.Select className="form-select-dark" value={form.ticket_type} onChange={e => setForm({ ...form, ticket_type: e.target.value })}>
                                        <option value="general">General</option>
                                        <option value="vip">VIP</option>
                                        <option value="speaker">Speaker</option>
                                        <option value="sponsor">Sponsor</option>
                                        <option value="premium">Premium</option>
                                        <option value="gov">Gov</option>
                                        <option value="non-gov">Non-Gov</option>
                                    </Form.Select>
                                </div>
                            </Form.Group>
                        </Col>
                        <Col md={6}>
                            <Form.Group className="mb-3"><Form.Label>Status</Form.Label>
                                <div className="att-field">
                                    <BsBookmarkStar className="att-field-icon" />
                                    <Form.Select className="form-select-dark" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                                        <option value="registered">Registered</option>
                                        <option value="confirmed">Confirmed</option>
                                        <option value="checked_in">Checked In</option>
                                        <option value="cancelled">Cancelled</option>
                                    </Form.Select>
                                </div>
                            </Form.Group>
                        </Col>
                    </Row>

                    <Form.Group className="mb-0"><Form.Label>Notes</Form.Label>
                        <div className="att-field att-field--textarea">
                            <BsJournalText className="att-field-icon" />
                            <Form.Control as="textarea" rows={2} className="form-control-dark" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Any additional notes..." />
                        </div>
                    </Form.Group>

                    <style>{`
                        /* Icon-prefixed inputs — the icon sits absolutely on
                           the left so .form-control-dark / .form-select-dark
                           keep their existing dark styling untouched. The icon
                           lifts to accent on focus for a subtle highlight. */
                        .att-field { position: relative; }
                        .att-field > .att-field-icon {
                            position: absolute;
                            left: 12px;
                            top: 50%;
                            transform: translateY(-50%);
                            color: var(--text-muted);
                            pointer-events: none;
                            z-index: 2;
                            font-size: 15px;
                            transition: color 0.18s ease;
                        }
                        .att-field:focus-within > .att-field-icon { color: var(--accent); }
                        .att-field > .form-control,
                        .att-field > .form-select { padding-left: 38px !important; }
                        /* Textarea — icon aligns to the first line instead of
                           the vertical centre of the whole box. */
                        .att-field--textarea > .att-field-icon {
                            top: 14px;
                            transform: none;
                        }
                    `}</style>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="link" onClick={() => setShow(false)} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Cancel</Button>
                    <Button className="btn-accent" onClick={handleSave}>Save</Button>
                </Modal.Footer>
            </Modal>

            {/* Post-add: ask whether to email the new delegate. Shows only when
                a real email was captured. "Skip" closes silently; the row's
                envelope icon is always available later. */}
            <Modal show={!!confirmPrompt} onHide={() => setConfirmPrompt(null)} centered contentClassName="premium-modal">
                {confirmPrompt && (
                    <>
                        <div style={{
                            background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
                            padding: '28px 28px 22px', textAlign: 'center',
                            borderTopLeftRadius: 'var(--radius-lg)', borderTopRightRadius: 'var(--radius-lg)',
                        }}>
                            <div style={{
                                width: 56, height: 56, borderRadius: 14,
                                background: 'rgba(255,255,255,0.2)',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                color: '#fff', fontSize: 24, marginBottom: 12,
                            }}>
                                <BsEnvelopePaperFill />
                            </div>
                            <h4 style={{ margin: 0, color: '#fff', fontWeight: 700 }}>Delegate added</h4>
                            <p style={{ margin: '6px 0 0', color: 'rgba(255,255,255,0.9)', fontSize: 14 }}>
                                Send <strong>{confirmPrompt.name}</strong> a confirmation email?
                            </p>
                        </div>
                        <Modal.Body>
                            <div style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                                We'll email <strong style={{ color: 'var(--text-primary)' }}>{confirmPrompt.email}</strong> with their registration details for
                                {confirmPrompt.eventTitle ? <> <strong style={{ color: 'var(--text-primary)' }}>{confirmPrompt.eventTitle}</strong></> : ' the event'}.
                                You can resend later from the row's <BsEnvelopePaperFill style={{ verticalAlign: 'middle' }} /> button.
                            </div>
                        </Modal.Body>
                        <Modal.Footer>
                            <Button variant="link" onClick={() => setConfirmPrompt(null)} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
                                Skip for now
                            </Button>
                            <Button
                                className="btn-accent d-flex align-items-center gap-2"
                                disabled={loadingPreviewId === confirmPrompt.id}
                                onClick={() => handleOpenPreview(confirmPrompt)}
                            >
                                <BsEnvelopePaperFill /> {loadingPreviewId === confirmPrompt.id ? 'Loading…' : 'Preview & send'}
                            </Button>
                        </Modal.Footer>
                    </>
                )}
            </Modal>

            {/* Check-in ticket — designed as a shareable event ticket: gradient
                header with event name, attendee details, large QR, and a ticket
                reference id strip at the bottom. The whole card is captured to
                PNG via html-to-image for download (handier than a bare QR). */}
            <Modal show={!!qrAttendee} onHide={() => setQrAttendee(null)} centered contentClassName="premium-modal">
                <Modal.Header closeButton closeVariant="white" style={{ borderBottom: 'none', paddingBottom: 0 }}>
                    <Modal.Title style={{ color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8, fontSize: '1rem' }}>
                        <BsQrCode /> Check-in ticket
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body style={{ paddingTop: 14 }}>
                    {qrAttendee && qrAttendee.checkin_token && (
                        <div
                            ref={ticketRef}
                            style={{
                                background: '#ffffff',
                                borderRadius: 18,
                                overflow: 'hidden',
                                boxShadow: '0 20px 60px -20px rgba(139,92,246,0.5)',
                                fontFamily: 'Inter, system-ui, sans-serif',
                                color: '#0f172a',
                            }}
                        >
                            {/* Gradient header — event name big, ticket-type pill on the right. */}
                            <div style={{
                                background: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
                                padding: '22px 24px 26px',
                                color: '#fff',
                                position: 'relative',
                            }}>
                                <div style={{
                                    fontSize: 10, letterSpacing: '0.2em', textTransform: 'uppercase',
                                    fontWeight: 700, opacity: 0.85, marginBottom: 6,
                                }}>
                                    Event Pass
                                </div>
                                <div style={{
                                    fontSize: '1.35rem', fontWeight: 800, lineHeight: 1.15,
                                    letterSpacing: '-0.02em', wordBreak: 'break-word',
                                }}>
                                    {qrAttendee.event_title || 'Event'}
                                </div>
                                {qrAttendee.ticket_type && (
                                    <div style={{
                                        position: 'absolute', top: 18, right: 20,
                                        padding: '5px 12px', borderRadius: 999,
                                        background: 'rgba(255,255,255,0.22)',
                                        backdropFilter: 'blur(6px)',
                                        fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
                                        textTransform: 'uppercase',
                                        border: '1px solid rgba(255,255,255,0.35)',
                                    }}>
                                        {qrAttendee.ticket_type}
                                    </div>
                                )}
                            </div>

                            {/* Ticket perforation — dashed line between header and body
                                with two cutout circles on the edges so it reads as a
                                tearable ticket stub. */}
                            <div style={{ position: 'relative', height: 0 }}>
                                <div style={{
                                    position: 'absolute', top: -10, left: -10,
                                    width: 20, height: 20, borderRadius: '50%',
                                    background: 'var(--bg-secondary, #111128)',
                                }} />
                                <div style={{
                                    position: 'absolute', top: -10, right: -10,
                                    width: 20, height: 20, borderRadius: '50%',
                                    background: 'var(--bg-secondary, #111128)',
                                }} />
                                <div style={{
                                    position: 'absolute', top: -1, left: 16, right: 16,
                                    borderTop: '2px dashed #e2e8f0',
                                }} />
                            </div>

                            {/* Body — attendee identity + QR. */}
                            <div style={{ padding: '22px 24px 8px', textAlign: 'center' }}>
                                <div style={{ fontSize: 11, color: '#64748b', letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600, marginBottom: 4 }}>
                                    Delegate
                                </div>
                                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}>
                                    {qrAttendee.name}
                                </div>
                                <div style={{ fontSize: '0.85rem', color: '#475569', marginTop: 2, marginBottom: 18 }}>
                                    {[qrAttendee.designation, qrAttendee.company].filter(Boolean).join(' · ') || ' '}
                                </div>

                                <div style={{
                                    display: 'inline-block', padding: 14, borderRadius: 14,
                                    background: '#ffffff', border: '1px solid #e2e8f0',
                                    boxShadow: '0 4px 16px -6px rgba(15,23,42,0.18)',
                                }}>
                                    {qrDataUrl
                                        ? <img src={qrDataUrl} alt="Check-in QR" style={{ width: 240, height: 240, display: 'block' }} />
                                        : <div style={{ width: 240, height: 240, display: 'grid', placeItems: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>Rendering…</div>
                                    }
                                </div>

                                <div style={{ marginTop: 14, fontSize: '0.78rem', color: '#64748b' }}>
                                    Present this code at the registration desk
                                </div>
                            </div>

                            {/* Bottom padding to match top spacing now that
                                the footer strip is gone. */}
                            <div style={{ height: 16 }} />
                        </div>
                    )}

                    {qrAttendee && !qrAttendee.checkin_token && (
                        <div style={{
                            padding: 22, borderRadius: 12,
                            background: 'rgba(239,68,68,0.08)',
                            border: '1px solid rgba(239,68,68,0.25)',
                            color: '#fca5a5', fontSize: '0.88rem', lineHeight: 1.6,
                        }}>
                            <strong style={{ color: '#fecaca' }}>No check-in token yet for this attendee.</strong>
                            <div style={{ marginTop: 8 }}>This usually means one of:</div>
                            <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                                <li>The migration <code>node migrate_attendee_checkin.js</code> hasn't been run.</li>
                                <li>The backend wasn't restarted after the migration, so the API is returning a cached schema.</li>
                                <li>The page hasn't been refreshed since the migration finished.</li>
                            </ul>
                        </div>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="link" onClick={() => setQrAttendee(null)} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Close</Button>
                    {qrDataUrl && qrAttendee?.checkin_token && (
                        <Button
                            className="btn-accent d-flex align-items-center gap-2"
                            disabled={downloadingTicket}
                            onClick={async () => {
                                if (!ticketRef.current) return;
                                setDownloadingTicket(true);
                                try {
                                    // pixelRatio: 2 gives a crisp retina-quality PNG so
                                    // the ticket prints cleanly even at A6 badge size.
                                    const png = await toPng(ticketRef.current, { pixelRatio: 2, cacheBust: true });
                                    const a = document.createElement('a');
                                    a.href = png;
                                    a.download = `ticket-${(qrAttendee.name || 'attendee').replace(/[^a-z0-9-_]+/gi, '_')}.png`;
                                    a.click();
                                } catch (err) {
                                    setToast({ type: 'danger', text: 'Could not export ticket image. Try again.' });
                                } finally {
                                    setDownloadingTicket(false);
                                }
                            }}
                        >
                            <BsDownload /> {downloadingTicket ? 'Saving…' : 'Download ticket'}
                        </Button>
                    )}
                </Modal.Footer>
            </Modal>

            {/* Inline toast — auto-dismisses after 4s. Used for both the
                send-confirmation success and any SMTP / send failures. */}
            {toast && <ToastBanner type={toast.type} text={toast.text} onClose={() => setToast(null)} />}

            <EmailPreviewModal
                preview={preview}
                onHide={() => setPreview(null)}
                onSend={() => handleSendConfirmation({ id: preview.id, email: preview.to, name: preview.attendee_name })}
                sending={sendingId === preview?.id}
            />

            <style>{`
                .form-control-dark, .form-select-dark {
                    background-color: #111 !important;
                    color: #fff !important;
                    border: 1px solid rgba(255, 255, 255, 0.1) !important;
                }
                .form-control-dark:focus, .form-select-dark:focus {
                    background-color: #000 !important;
                    color: #fff !important;
                    box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.25) !important;
                    border-color: rgba(139, 92, 246, 0.5) !important;
                }
                .form-control-dark::placeholder {
                    color: rgba(255, 255, 255, 0.4) !important;
                }
                .form-select-dark option {
                    background-color: #111 !important;
                    color: #fff !important;
                }
            `}</style>
        </div>
    );
}

// Inline attendance-report panel. Mounted by the Reports toolbar button on
// AttendeesPage. Hoisted to module scope so the Bar/Doughnut canvases keep
// stable identity across parent re-renders (otherwise chart.js would tear
// down and recreate its WebGL context every keystroke in a filter input).
const REPORT_ACCENT = '#8b5cf6';
const REPORT_CHECKED = '#10b981';
const REPORT_PENDING = '#f59e0b';
const REPORT_CANCEL = '#ef4444';
const TICKET_PALETTE = ['#8b5cf6', '#ec4899', '#10b981', '#0ea5e9', '#f59e0b', '#6366f1', '#94a3b8'];

function ReportsPanel({ data, loading }) {
    const barData = data?.events?.length ? {
        labels: data.events.map(e => e.event_title || 'Untitled'),
        datasets: [
            {
                label: 'Checked in',
                data: data.events.map(e => e.checked_in),
                backgroundColor: REPORT_CHECKED,
                borderRadius: 8, maxBarThickness: 42,
            },
            {
                label: 'Not yet',
                data: data.events.map(e => e.not_checked_in),
                backgroundColor: REPORT_PENDING,
                borderRadius: 8, maxBarThickness: 42,
            },
        ],
    } : null;

    const barOptions = {
        responsive: true, maintainAspectRatio: false,
        plugins: {
            legend: { labels: { color: '#cbd5e1', font: { weight: 600 } } },
            tooltip: {
                backgroundColor: '#0f0f1e', titleColor: '#fff', bodyColor: '#cbd5e1',
                borderColor: 'rgba(255,255,255,0.08)', borderWidth: 1, padding: 12,
                callbacks: {
                    afterBody: (items) => {
                        if (!items?.length || !data?.events) return '';
                        const ev = data.events[items[0].dataIndex];
                        const rate = ev.total ? Math.round((ev.checked_in / ev.total) * 100) : 0;
                        return `Total: ${ev.total} · ${rate}% checked in`;
                    },
                },
            },
        },
        scales: {
            x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.04)' } },
            y: { beginAtZero: true, ticks: { color: '#94a3b8', precision: 0 }, grid: { color: 'rgba(255,255,255,0.06)' } },
        },
    };

    const doughnutData = data?.byTicketType?.length ? {
        labels: data.byTicketType.map(t => (t.ticket_type || 'unknown').toUpperCase()),
        datasets: [{
            data: data.byTicketType.map(t => t.count),
            backgroundColor: data.byTicketType.map((_, i) => TICKET_PALETTE[i % TICKET_PALETTE.length]),
            borderColor: '#0a0a1a', borderWidth: 3,
        }],
    } : null;

    const doughnutOptions = {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        plugins: {
            legend: { position: 'bottom', labels: { color: '#cbd5e1', font: { weight: 600 }, padding: 12, boxWidth: 12, boxHeight: 12 } },
            tooltip: { backgroundColor: '#0f0f1e', titleColor: '#fff', bodyColor: '#cbd5e1', padding: 10 },
        },
    };

    return (
        <div style={{
            background: 'linear-gradient(160deg, rgba(139,92,246,0.06), rgba(139,92,246,0.02))',
            border: '1px solid rgba(139,92,246,0.22)',
            borderRadius: 'var(--radius-lg)',
            padding: '18px 20px',
            marginBottom: 22,
            animation: 'fadeInUp 0.22s ease',
        }}>
            {/* Scope label — when one event is loaded we say its name, when
                many are loaded we say "all events". Makes it obvious that the
                charts respect whatever the user picked in the Event filter. */}
            <div className="d-flex justify-content-between align-items-center mb-3">
                <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#a78bfa', fontWeight: 700 }}>
                    Attendance Report
                </div>
                {data?.events?.length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
                        {data.events.length === 1
                            ? <>Scope: <span style={{ color: 'var(--text-secondary)' }}>{data.events[0].event_title}</span></>
                            : <>Scope: <span style={{ color: 'var(--text-secondary)' }}>{data.events.length} events</span></>
                        }
                    </div>
                )}
            </div>

            {loading && !data && (
                <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>
                    <Spinner size="sm" /> Loading report…
                </div>
            )}

            {!loading && (!data || !data.events?.length) && (
                <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    No data yet — add a few attendees to see the breakdown here.
                </div>
            )}

            {data?.events?.length > 0 && (
                <Row className="g-3">
                    <Col lg={8}>
                        <div style={{
                            background: 'var(--bg-card)', borderRadius: 12,
                            border: '1px solid var(--border-subtle)', padding: 16,
                            height: 320, display: 'flex', flexDirection: 'column',
                        }}>
                            <div className="d-flex justify-content-between align-items-center mb-2">
                                <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Per-event check-in</span>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Hover a bar for totals</span>
                            </div>
                            <div style={{ flex: 1, minHeight: 0 }}>
                                {barData && <Bar data={barData} options={barOptions} />}
                            </div>
                        </div>
                    </Col>
                    <Col lg={4}>
                        <div style={{
                            background: 'var(--bg-card)', borderRadius: 12,
                            border: '1px solid var(--border-subtle)', padding: 16,
                            height: 320, display: 'flex', flexDirection: 'column',
                        }}>
                            <div className="d-flex align-items-center gap-2 mb-2">
                                <BsTicketPerforated style={{ color: 'var(--accent)' }} />
                                <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>By ticket type</span>
                            </div>
                            <div style={{ flex: 1, minHeight: 0, display: 'grid', placeItems: 'center' }}>
                                {doughnutData
                                    ? <Doughnut data={doughnutData} options={doughnutOptions} />
                                    : <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No ticket data yet</div>
                                }
                            </div>
                        </div>
                    </Col>
                </Row>
            )}
        </div>
    );
}

// Tiny self-dismissing toast in the bottom-right. Lives outside the main
// component so its 4-second timer state doesn't churn the parent re-render.
function ToastBanner({ type, text, onClose }) {
    useEffect(() => {
        const id = setTimeout(onClose, 4000);
        return () => clearTimeout(id);
    }, [onClose]);
    const Icon = type === 'success' ? BsCheckCircleFill : BsExclamationTriangleFill;
    const accent = type === 'success' ? '#10b981' : '#ef4444';
    return (
        <div style={{
            position: 'fixed', right: 24, bottom: 24, zIndex: 1080,
            background: 'var(--bg-card)',
            border: `1px solid ${accent}40`,
            borderLeft: `3px solid ${accent}`,
            borderRadius: 12,
            boxShadow: '0 18px 40px rgba(0,0,0,0.35)',
            padding: '12px 16px',
            display: 'flex', alignItems: 'center', gap: 10,
            color: 'var(--text-primary)', fontSize: 13, fontWeight: 500,
            maxWidth: 360,
            animation: 'attendeeToastIn 0.3s ease',
        }}>
            <Icon size={16} style={{ color: accent, flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{text}</span>
            <style>{`
                @keyframes attendeeToastIn {
                    from { opacity: 0; transform: translateY(8px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
}

// Per-delegate confirmation preview. Server returns the rendered email HTML
// already merged with the saved template + this attendee's real data, so
// what we show here is what'll be delivered. Same icon-only viewport
// switcher pattern as the template editor.
const PREVIEW_DEVICE_WIDTHS = {
    mobile:  { width: 375,  label: 'Mobile' },
    tablet:  { width: 600,  label: 'Tablet' },
    desktop: { width: null, label: 'Desktop' },
};

function EmailPreviewModal({ preview, onHide, onSend, sending }) {
    const [device, setDevice] = useState('desktop');

    // Fixed-height iframe so the email content scrolls inside the iframe
    // itself. Auto-sizing the iframe to its full content (as on the template
    // editor page) breaks here: the modal would clip with overflow on the
    // outer wrapper, but wheel events over the iframe never bubble out, so
    // the user gets stuck unable to scroll.
    const html = preview?.html
        ? `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f8fafc;">${preview.html}</body></html>`
        : '';

    useEffect(() => { if (!preview) setDevice('desktop'); }, [preview]);

    if (!preview) return null;
    const w = PREVIEW_DEVICE_WIDTHS[device]?.width;

    return (
        <Modal show={!!preview} onHide={onHide} centered size="lg" contentClassName="premium-modal">
            <Modal.Header closeButton closeVariant="white">
                <Modal.Title style={{ color: 'var(--text-primary)' }} className="d-flex align-items-center gap-2">
                    <BsEnvelopePaperFill style={{ color: 'var(--accent)' }} /> Email Preview
                </Modal.Title>
            </Modal.Header>
            <Modal.Body style={{ padding: 0 }}>
                {/* Recipient + subject summary so the operator confirms who and what. */}
                <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>To</div>
                    <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600 }}>
                        {preview.attendee_name} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· {preview.to}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 10, marginBottom: 4 }}>Subject</div>
                    <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{preview.subject}</div>
                </div>

                {/* Device switcher */}
                <div className="d-flex align-items-center justify-content-between gap-2" style={{ padding: '12px 22px', borderBottom: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                        {w ? `${w}px viewport` : 'Full width'}
                    </div>
                    <div style={{
                        display: 'inline-flex',
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 10, padding: 3, gap: 2,
                    }}>
                        {Object.entries(PREVIEW_DEVICE_WIDTHS).map(([key, def]) => {
                            const active = device === key;
                            const Icon = key === 'mobile' ? BsPhone : key === 'tablet' ? BsTablet : BsDisplay;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => setDevice(key)}
                                    title={`${def.label}${def.width ? ` · ${def.width}px` : ''}`}
                                    style={{
                                        display: 'grid', placeItems: 'center',
                                        width: 32, height: 30, borderRadius: 8, border: 'none',
                                        background: active ? 'var(--accent)' : 'transparent',
                                        color: active ? '#fff' : 'var(--text-secondary)',
                                        cursor: 'pointer',
                                    }}
                                ><Icon size={15} /></button>
                            );
                        })}
                    </div>
                </div>

                {/* Stage — iframe scrolls internally so the user can read
                    the full email body without fighting wheel-event capture. */}
                <div style={{
                    background: 'rgba(0,0,0,0.18)',
                    padding: w ? '20px 16px' : '0',
                    display: 'flex', justifyContent: 'center',
                }}>
                    <div style={{
                        width: w ? `${w}px` : '100%',
                        maxWidth: '100%',
                        background: '#f8fafc',
                        borderRadius: w ? 16 : 0,
                        overflow: 'hidden',
                        boxShadow: w ? '0 18px 40px rgba(0,0,0,0.35)' : 'none',
                        transition: 'width 0.25s ease',
                    }}>
                        <iframe
                            title="Email preview"
                            srcDoc={html}
                            style={{ display: 'block', width: '100%', height: '60vh', border: 'none', background: '#f8fafc' }}
                        />
                    </div>
                </div>
            </Modal.Body>
            <Modal.Footer>
                <Button variant="link" onClick={onHide} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Cancel</Button>
                <Button className="btn-accent d-flex align-items-center gap-2" onClick={onSend} disabled={sending}>
                    {sending ? <Spinner size="sm" /> : <BsSendFill />}
                    {sending ? 'Sending…' : `Send to ${preview.to}`}
                </Button>
            </Modal.Footer>
        </Modal>
    );
}


