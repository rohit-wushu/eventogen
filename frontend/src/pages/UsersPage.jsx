import { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Alert, InputGroup } from 'react-bootstrap';
import { getUsers, inviteUser, updateUser, deleteUser, getEvents, deleteInvitation } from '../services/api';
import AsyncButton from '../components/AsyncButton';
import { useAuth } from '../context/AuthContext';
import { BsPlus, BsPencil, BsTrash, BsPeople, BsClipboard, BsListUl, BsDiagram3, BsEnvelopeAtFill, BsShieldLockFill, BsCalendarEventFill, BsClipboardCheck, BsCheckCircleFill, BsExclamationTriangleFill, BsEnvelopePaperFill, BsXLg, BsSendFill, BsPersonGear, BsSliders } from 'react-icons/bs';

// Per-event modules — what an employee may use on each event they're
// assigned to. Each module corresponds to one OR MORE section keys, which
// is what the backend actually checks against user_events.sections.
// The four modules cover the 6 event-scoped sections (speakers, partners,
// attendees, agendas, awards, travel); media + forms are tenant-wide.
const EVENT_MODULES = [
    { key: 'speakers',  label: 'Speakers',                sections: ['speakers'] },
    { key: 'partners',  label: 'Partners',                sections: ['partners'] },
    { key: 'attendees', label: 'Attendees',               sections: ['attendees'] },
    { key: 'agenda',    label: 'Agenda + Awards + Travel', sections: ['agendas', 'awards', 'travel'] },
];
// Expand a list of module keys to the full set of section keys we send to
// the backend. Stable order so equal sets stringify the same way.
const expandModules = (moduleKeys) => {
    const out = new Set();
    for (const k of moduleKeys) {
        const m = EVENT_MODULES.find(x => x.key === k);
        if (m) for (const s of m.sections) out.add(s);
    }
    return [...out];
};
// Reverse: which modules are "on" given a stored section list? A module is
// on when ALL of its sections are present. `null` = no restriction = all on.
const modulesFromSections = (sections) => {
    if (sections == null) return EVENT_MODULES.map(m => m.key);
    return EVENT_MODULES.filter(m => m.sections.every(s => sections.includes(s))).map(m => m.key);
};

export default function UsersPage() {
    const { user: currentUser } = useAuth();
    const [users, setUsers] = useState([]);
    const [events, setEvents] = useState([]);
    const [show, setShow] = useState(false);
    const [editing, setEditing] = useState(null);
    const [error, setError] = useState('');
    const [successLink, setSuccessLink] = useState('');
    const [emailStatus, setEmailStatus] = useState(null);
    const [copied, setCopied] = useState(false);
    const [form, setForm] = useState({ name: '', email: '', password: '', role: 'employee', event_ids: [], assigned_task: '' });
    // Per-event modules ("section access scoped to a specific event"). Shape:
    //   { [eventId: number]: string[] | null }
    //     null  → full access on that event (default, same as omitting the key)
    //     []    → no modules at all on that event
    //     ['speakers', 'partners'] → only those modules
    // Stored separately from `form` so we can detect if the modal touched it.
    const [eventSections, setEventSections] = useState({});
    const [viewMode, setViewMode] = useState('table');

    // Filters
    const [roleFilter, setRoleFilter] = useState('');
    const [eventFilter, setEventFilter] = useState('');

    const loadUsers = () => getUsers().then(r => setUsers(Array.isArray(r.data) ? r.data : [])).catch(() => { });
    const loadEvents = () => getEvents().then(r => setEvents(Array.isArray(r.data) ? r.data : [])).catch(() => { });

    useEffect(() => {
        loadUsers();
        loadEvents();
    }, []);

    const openModal = (item = null) => {
        if (item) {
            setEditing(item);
            setForm({
                name: item.name, email: item.email, password: '', role: item.role,
                // Multi-event: prefer the server-sent array, fall back to the
                // single assigned event for older payloads.
                event_ids: Array.isArray(item.assigned_event_ids) && item.assigned_event_ids.length
                    ? item.assigned_event_ids.map(Number)
                    : (item.assigned_event_id ? [Number(item.assigned_event_id)] : []),
                assigned_task: item.assigned_task || ''
            });
            // Hydrate per-event modules. Server returns event_sections as a
            // { eventId: string[] | null } map; treat missing/non-object as {}.
            setEventSections(item.event_sections && typeof item.event_sections === 'object' ? item.event_sections : {});
        } else {
            setEditing(null);
            setForm({ email: '', role: currentUser?.role === 'manager' ? 'employee' : 'employee', event_ids: [], assigned_task: '' });
            setEventSections({});
        }
        setError('');
        setSuccessLink(''); setEmailStatus(null);
        setShow(true);
    };

    const handleSave = async () => {
        try {
            setError('');
            const eventIds = Array.isArray(form.event_ids) ? form.event_ids : [];
            if (editing) {
                if (editing.status === 'accepted') {
                    // Existing user → full multi-event assignment.
                    // Only include event_sections for employees (admins/managers
                    // ignore per-event module restrictions on the backend
                    // anyway, and keeping the payload smaller for them is nice).
                    // Drop entries for events that aren't in event_ids — saving
                    // stale state would resurrect modules for an unassigned event.
                    const sectionsToSend = form.role === 'employee'
                        ? Object.fromEntries(
                            Object.entries(eventSections).filter(([eid]) => eventIds.includes(Number(eid)))
                        )
                        : null;
                    await updateUser({
                        ...form, event_ids: eventIds, id: editing.id,
                        event_sections: sectionsToSend,
                    });
                    // Note: tenant-wide users.permissions is no longer editable
                    // from the modal — Per-Event Modules supersede it. Any
                    // existing value in users.permissions stays untouched.
                } else {
                    // Pending invite → invite carries a single event; the rest
                    // can be added once they accept.
                    await inviteUser({ email: form.email, role: form.role, event_id: eventIds[0] || null, assigned_task: form.assigned_task || null });
                }
                setShow(false);
                loadUsers();
            } else {
                const res = await inviteUser({ email: form.email, role: form.role, event_id: eventIds[0] || null, assigned_task: form.assigned_task || null });
                setSuccessLink(window.location.origin + res.data.inviteLink);
                setEmailStatus(res.data.emailStatus || null);
            }
        } catch (err) { setError(err.response?.data?.error || 'Failed'); }
    };

    const handleDelete = async (item) => {
        const isUser = item.status === 'accepted';
        if (!isUser && !item.email && !item.invite_id) {
            alert('Cannot delete: invitation has no email or ID.');
            return;
        }
        const msg = isUser ? 'Delete this user permanently?' : `Revoke invitation${item.email ? ' for ' + item.email : ''}?`;
        if (window.confirm(msg)) {
            try {
                if (isUser) await deleteUser(item.id);
                else await deleteInvitation(item.email, item.invite_id);
                loadUsers();
            } catch (err) { alert(err.response?.data?.error || 'Failed to delete'); }
        }
    };

    const availableRoles = currentUser?.role === 'admin' ? ['admin', 'manager', 'employee'] : ['employee'];

    const filteredUsers = users.filter(u => {
        if (currentUser?.role !== 'admin') return true;
        let matchRole = true;
        if (roleFilter) matchRole = u.role === roleFilter;
        // A user can now belong to multiple events; match if ANY of them fits.
        const eventIds = Array.isArray(u.assigned_event_ids) && u.assigned_event_ids.length
            ? u.assigned_event_ids.map(Number)
            : (u.assigned_event_id ? [Number(u.assigned_event_id)] : []);
        let matchEvent = true;
        if (eventFilter) {
            if (eventFilter === 'unassigned') matchEvent = eventIds.length === 0;
            else matchEvent = eventIds.includes(Number(eventFilter));
        }
        return matchRole && matchEvent;
    });

    const isManager = currentUser?.role === 'manager';

    return (
        <div className="animate-in">
            <div className="page-header d-flex justify-content-between align-items-center">
                <div><h4>{isManager ? 'My Team' : 'Users & Invitations'}</h4><p className="text-white small">Manage system access and assign events to staff.</p></div>
                <div className="d-flex gap-3 align-items-center">
                    {currentUser?.role === 'admin' && (
                        <>
                            <Form.Select className="form-select-dark" style={{ width: 140, padding: '6px 10px', fontSize: '0.8rem' }} value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
                                <option value="">All Roles</option>
                                <option value="admin">Admin</option>
                                <option value="manager">Manager</option>
                                <option value="employee">Employee</option>
                            </Form.Select>
                            <Form.Select className="form-select-dark" style={{ width: 180, padding: '6px 10px', fontSize: '0.8rem' }} value={eventFilter} onChange={e => setEventFilter(e.target.value)}>
                                <option value="">All Events</option>
                                <option value="unassigned">General / Unassigned</option>
                                {events.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
                            </Form.Select>
                        </>
                    )}
                    {/* View Toggle */}
                    <div className="d-flex" style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
                        <button
                            onClick={() => setViewMode('table')}
                            style={{ padding: '6px 12px', border: 'none', background: viewMode === 'table' ? 'var(--accent)' : 'transparent', color: viewMode === 'table' ? '#fff' : 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem' }}
                        >
                            <BsListUl size={14} /> Table
                        </button>
                        <button
                            onClick={() => setViewMode('tree')}
                            style={{ padding: '6px 12px', border: 'none', borderLeft: '1px solid var(--border-subtle)', background: viewMode === 'tree' ? 'var(--accent)' : 'transparent', color: viewMode === 'tree' ? '#fff' : 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem' }}
                        >
                            <BsDiagram3 size={14} /> Org Tree
                        </button>
                    </div>
                    <Button className="btn-accent d-flex align-items-center gap-2" onClick={() => openModal()}><BsPlus size={18} /> Invite User</Button>
                </div>
            </div>

            {filteredUsers.length === 0 ? (
                <div className="empty-state" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
                    <div className="empty-state-icon"><BsPeople /></div>
                    <p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>No Team Members Yet</p>
                    <p style={{ fontSize: '0.8rem' }}>Invite users to your team.</p>
                </div>
            ) : viewMode === 'table' ? (
                <Table responsive className="premium-table mobile-cards">
                    <thead><tr><th>#</th><th>Name</th><th>Email</th><th>Role</th><th>Event / Task</th><th>Status</th><th>Activity</th><th style={{ width: 100 }}>Actions</th></tr></thead>
                    <tbody>
                        {filteredUsers.map((u, i) => (
                            <tr key={u.id + '-' + u.email}>
                                <td className="mob-hide" style={{ color: 'var(--text-muted)' }}>{i + 1}</td>
                                <td data-label="Name">
                                    <div className="d-flex align-items-center gap-2">
                                        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(139,92,246,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontWeight: 700, fontSize: '0.8rem' }}>
                                            {u.name?.charAt(0)?.toUpperCase() || '?'}
                                        </div>
                                        <span style={{ fontWeight: u.name ? 600 : 400, opacity: u.name ? 1 : 0.6 }}>
                                            {u.name || '(Pending Invite)'}
                                        </span>
                                    </div>
                                </td>
                                <td data-label="Email" style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{u.email}</td>
                                <td data-label="Role"><span className={`badge-premium role-${u.role}`}>{u.role}</span></td>
                                <td data-label="Event / Task" style={{ fontSize: '0.85rem' }}>
                                    {/* Inherit the cell's theme-correct color — the .premium-table
                                        td color flips per theme; hard-coding var(--text-primary)
                                        here renders near-white and vanishes on the light cell. */}
                                    <div style={{ fontWeight: 600, color: 'inherit' }}>
                                        {(() => {
                                            // Show every assigned event; fall back to the single field.
                                            const ids = Array.isArray(u.assigned_event_ids) && u.assigned_event_ids.length
                                                ? u.assigned_event_ids
                                                : (u.assigned_event_id ? [u.assigned_event_id] : []);
                                            if (ids.length === 0) return <span className="opacity-50">General</span>;
                                            const titles = ids.map(id => events.find(e => e.id === Number(id))?.title || `Event #${id}`);
                                            if (titles.length === 1) return titles[0];
                                            return (
                                                <span title={titles.join(', ')}>
                                                    {titles[0]} <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 500 }}>+{titles.length - 1} more</span>
                                                </span>
                                            );
                                        })()}
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        {u.assigned_task || <span className="opacity-50">No task assigned</span>}
                                    </div>
                                </td>
                                <td data-label="Status">
                                    <span className={`badge-premium status-${u.status === 'accepted' ? 'ongoing' : 'upcoming'}`} style={{ fontSize: '0.65rem' }}>
                                        {u.status === 'accepted' ? 'Accepted' : 'Pending'}
                                    </span>
                                </td>
                                <td data-label="Activity">
                                    <div className="d-flex gap-2 align-items-center" style={{ fontSize: '0.75rem' }}>
                                        <div title="Speakers added"><span style={{ color: 'var(--accent-pink)' }}>S:</span> <strong>{u.speaker_count || 0}</strong></div>
                                        <div title="Partners added"><span style={{ color: 'var(--accent-sky)' }}>P:</span> <strong>{u.partner_count || 0}</strong></div>
                                        <div title="Delegates added"><span style={{ color: 'var(--accent)' }}>D:</span> <strong>{u.attendee_count || 0}</strong></div>
                                    </div>
                                </td>
                                <td className="mob-full">
                                    <div className="d-flex align-items-center gap-2">
                                        <button className="btn-action" onClick={() => openModal(u)}><BsPencil size={13} /></button>
                                        <button className="btn-action danger" title={u.status === 'accepted' ? 'Delete User' : 'Revoke Invitation'} onClick={() => handleDelete(u)}><BsTrash size={13} /></button>
                                        {u.status !== 'accepted' && <div className="text-muted small" style={{ fontStyle: 'italic' }}>Invite sent</div>}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            ) : (
                <OrgTree users={filteredUsers} events={events} currentUser={currentUser} onEdit={openModal} onDelete={handleDelete} />
            )}

            <Modal show={show} onHide={() => { setShow(false); setSuccessLink(''); setEmailStatus(null); setCopied(false); }} centered contentClassName="invite-modal-content" backdropClassName="invite-modal-backdrop">
                <div className="invite-modal">
                    {/* HEADER — compact horizontal hero (icon + text) */}
                    <div className="invite-hero">
                        <button className="invite-close" onClick={() => { setShow(false); setSuccessLink(''); setEmailStatus(null); setCopied(false); }} aria-label="Close">
                            <BsXLg />
                        </button>
                        <div className="invite-hero-ico">
                            {successLink ? <BsEnvelopePaperFill /> : editing ? <BsPersonGear /> : <BsSendFill />}
                        </div>
                        <div className="invite-hero-text">
                            <h4 className="invite-hero-title">
                                {successLink ? 'Invitation Ready' : editing ? 'Edit User' : 'Invite a Teammate'}
                            </h4>
                            <p className="invite-hero-sub">
                                {successLink
                                    ? (emailStatus?.sent ? `We emailed the invite to ${form.email}` : `Share the link with ${form.email}`)
                                    : editing ? 'Update role, event assignment or password.' : 'They\'ll receive an email with a secure sign-up link.'}
                            </p>
                        </div>
                    </div>

                    {/* BODY */}
                    <div className="invite-body">
                        {error && (
                            <div className="invite-alert invite-alert-error">
                                <BsExclamationTriangleFill /> <span>{error}</span>
                            </div>
                        )}

                        {successLink ? (
                            <div className="animate-in">
                                {/* Status card */}
                                {emailStatus?.sent ? (
                                    <div className="invite-status invite-status-ok">
                                        <div className="invite-status-ico"><BsCheckCircleFill /></div>
                                        <div>
                                            <div className="invite-status-title">Invitation email sent</div>
                                            <div className="invite-status-desc">Delivered to <strong>{form.email}</strong>. The backup link below is copyable.</div>
                                        </div>
                                    </div>
                                ) : emailStatus?.error ? (
                                    <div className="invite-status invite-status-warn">
                                        <div className="invite-status-ico"><BsExclamationTriangleFill /></div>
                                        <div>
                                            <div className="invite-status-title">Email delivery failed</div>
                                            <div className="invite-status-desc">{emailStatus.error}</div>
                                            <div className="invite-status-desc" style={{ marginTop: 4 }}>Share the link below manually.</div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="invite-status invite-status-ok">
                                        <div className="invite-status-ico"><BsCheckCircleFill /></div>
                                        <div>
                                            <div className="invite-status-title">Invitation link generated</div>
                                            <div className="invite-status-desc">Share this with <strong>{form.email}</strong> to complete setup.</div>
                                        </div>
                                    </div>
                                )}

                                {/* Link card */}
                                <div className="invite-link-card">
                                    <div className="invite-link-label">Invitation Link</div>
                                    <div className="invite-link-row">
                                        <code className="invite-link-value">{successLink}</code>
                                        <button
                                            className={`invite-copy-btn ${copied ? 'copied' : ''}`}
                                            onClick={() => {
                                                navigator.clipboard.writeText(successLink);
                                                setCopied(true);
                                                setTimeout(() => setCopied(false), 2000);
                                            }}
                                        >
                                            {copied ? <><BsClipboardCheck /> Copied</> : <><BsClipboard /> Copy</>}
                                        </button>
                                    </div>
                                    <div className="invite-link-hint">Expires when used, or when revoked by an admin.</div>
                                </div>
                            </div>
                        ) : (
                            <div className="invite-form">
                                {editing && (
                                    <div className="invite-field">
                                        <label className="invite-label">Full Name</label>
                                        <input
                                            className="invite-input"
                                            value={form.name}
                                            onChange={e => setForm({ ...form, name: e.target.value })}
                                            placeholder="e.g. Priya Sharma"
                                        />
                                    </div>
                                )}

                                <div className="invite-field">
                                    <label className="invite-label">
                                        <BsEnvelopeAtFill /> Email Address
                                        {editing && editing.status === 'accepted' && currentUser?.role === 'admin' && (
                                            <span className="invite-label-opt">(editable — admin only)</span>
                                        )}
                                    </label>
                                    <input
                                        type="email"
                                        className="invite-input"
                                        /* Admin can change the email of any existing user.
                                           Managers and pending invites stay read-only so
                                           a manager can't silently reassign someone else's
                                           sign-in. Pending invites carry the email as a
                                           token key, so editing it would orphan the link. */
                                        readOnly={editing && (currentUser?.role !== 'admin' || editing.status !== 'accepted')}
                                        value={form.email}
                                        onChange={e => setForm({ ...form, email: e.target.value })}
                                        placeholder="name@company.com"
                                        autoFocus={!editing}
                                    />
                                    {editing && editing.status === 'accepted' && currentUser?.role === 'admin' && form.email !== editing.email && (
                                        <div style={{ fontSize: '0.72rem', color: 'var(--accent-amber, #f59e0b)', marginTop: 4 }}>
                                            Changing this updates the user's sign-in email. They'll need to use the new address from their next login.
                                        </div>
                                    )}
                                </div>

                                <div className="invite-field">
                                    <label className="invite-label"><BsShieldLockFill /> Role</label>
                                    <div className="invite-role-grid">
                                        {availableRoles.map(r => (
                                            <button
                                                type="button"
                                                key={r}
                                                className={`invite-role-chip ${form.role === r ? 'active' : ''}`}
                                                onClick={() => setForm({ ...form, role: r })}
                                            >
                                                <span className="invite-role-name">{r.charAt(0).toUpperCase() + r.slice(1)}</span>
                                                <span className="invite-role-hint">
                                                    {r === 'admin' && 'Full platform access'}
                                                    {r === 'manager' && 'Manage team & events'}
                                                    {r === 'employee' && 'Limited scope tasks'}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {(form.role === 'employee' || form.role === 'manager') && (
                                    <div className="invite-field">
                                        <label className="invite-label">
                                            <BsCalendarEventFill /> Assign to Events <span className="invite-label-opt">(optional)</span>
                                        </label>
                                        {/* Multi-select checklist — a user can be assigned to several
                                            events. For pending invites only the first selection is sent;
                                            the rest can be added after they accept. */}
                                        <div style={{
                                            maxHeight: 110, overflowY: 'auto', border: '1px solid var(--border-subtle)',
                                            borderRadius: 8, padding: '4px 4px', background: 'var(--bg-card)'
                                        }}>
                                            {events.length === 0 ? (
                                                <div style={{ padding: '6px 10px', fontSize: '0.78rem', color: 'var(--text-muted)' }}>No events available</div>
                                            ) : events.map(e => {
                                                const checked = form.event_ids.includes(Number(e.id));
                                                return (
                                                    <label key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', cursor: 'pointer', fontSize: '0.82rem' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={() => setForm(f => ({
                                                                ...f,
                                                                event_ids: checked
                                                                    ? f.event_ids.filter(id => id !== Number(e.id))
                                                                    : [...f.event_ids, Number(e.id)]
                                                            }))}
                                                        />
                                                        <span>{e.title}</span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
                                            {form.event_ids.length === 0
                                                ? 'No events selected — general access'
                                                : `${form.event_ids.length} event${form.event_ids.length > 1 ? 's' : ''} selected`}
                                            {editing && editing.status !== 'accepted' && form.event_ids.length > 1 && (
                                                <span> · only the first applies until the invite is accepted</span>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Per-event modules — only meaningful for an
                                    employee who is actually assigned to at least
                                    one event. Admins/managers always have full
                                    access to every module on every event. */}
                                {editing && editing.status === 'accepted' && form.role === 'employee' && form.event_ids.length > 0 && (
                                    <div className="invite-field">
                                        <label className="invite-label"><BsSliders /> Per-Event Modules</label>
                                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.45 }}>
                                            Choose which modules this employee can use on each event. Unticking a module hides that section's data on that event only. Tenant-wide Section Access (below) still applies on top.
                                        </div>
                                        <div style={{
                                            border: '1px solid var(--border-subtle)', borderRadius: 8,
                                            background: 'var(--bg-card)', overflow: 'hidden',
                                        }}>
                                            {form.event_ids.map((eid, idx) => {
                                                const evt = events.find(e => Number(e.id) === Number(eid));
                                                const eidNum = Number(eid);
                                                const storedSections = eventSections[eidNum];
                                                const activeModules = modulesFromSections(storedSections);
                                                const allOn = activeModules.length === EVENT_MODULES.length;

                                                // Toggle one module on/off for this event. Recomputes
                                                // the stored sections from the resulting module set so
                                                // the source of truth is always the section list.
                                                const toggleModule = (mKey) => {
                                                    const next = activeModules.includes(mKey)
                                                        ? activeModules.filter(k => k !== mKey)
                                                        : [...activeModules, mKey];
                                                    setEventSections(prev => ({
                                                        ...prev,
                                                        // If the user re-enables every module, store null
                                                        // (= "full access" sentinel) so it matches the
                                                        // default and stays clean in the DB.
                                                        [eidNum]: next.length === EVENT_MODULES.length ? null : expandModules(next),
                                                    }));
                                                };
                                                const setAll = (on) => {
                                                    setEventSections(prev => ({
                                                        ...prev,
                                                        [eidNum]: on ? null : [],
                                                    }));
                                                };

                                                return (
                                                    <div key={eidNum} style={{
                                                        padding: '10px 12px',
                                                        borderTop: idx === 0 ? 'none' : '1px solid var(--border-subtle)',
                                                    }}>
                                                        <div className="d-flex justify-content-between align-items-center" style={{ marginBottom: 6 }}>
                                                            <strong style={{ fontSize: '0.85rem' }}>{evt?.title || `Event #${eidNum}`}</strong>
                                                            <div className="d-flex gap-2" style={{ fontSize: 11 }}>
                                                                <button type="button" onClick={() => setAll(true)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, fontWeight: 600 }}>All</button>
                                                                <span style={{ color: 'var(--text-muted)' }}>·</span>
                                                                <button type="button" onClick={() => setAll(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0, fontWeight: 600 }}>None</button>
                                                            </div>
                                                        </div>
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6 }}>
                                                            {EVENT_MODULES.map(m => {
                                                                const checked = activeModules.includes(m.key);
                                                                return (
                                                                    <label key={m.key} style={{
                                                                        display: 'flex', alignItems: 'center', gap: 6,
                                                                        padding: '5px 8px', borderRadius: 6, cursor: 'pointer',
                                                                        background: checked ? 'rgba(139,92,246,0.10)' : 'transparent',
                                                                        border: `1px solid ${checked ? 'var(--accent)' : 'var(--border-subtle)'}`,
                                                                        fontSize: '0.78rem',
                                                                    }}>
                                                                        <input type="checkbox" checked={checked} onChange={() => toggleModule(m.key)} />
                                                                        <span>{m.label}</span>
                                                                    </label>
                                                                );
                                                            })}
                                                        </div>
                                                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                                                            {storedSections == null || allOn
                                                                ? 'Full access on this event'
                                                                : activeModules.length === 0
                                                                    ? 'Blocked — sees only Dashboard / Events on this event'
                                                                    : `${activeModules.length} of ${EVENT_MODULES.length} modules enabled`}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {editing && editing.status === 'accepted' && (
                                    <div className="invite-field">
                                        <label className="invite-label">New Password <span className="invite-label-opt">(optional)</span></label>
                                        <input
                                            type="password"
                                            className="invite-input"
                                            value={form.password}
                                            onChange={e => setForm({ ...form, password: e.target.value })}
                                            placeholder="Leave blank to keep current"
                                            autoComplete="new-password"
                                            name="new-password-field"
                                        />
                                    </div>
                                )}

                                {editing && editing.status !== 'accepted' && (
                                    <div className="invite-field">
                                        <label className="invite-label">Password</label>
                                        <div
                                            style={{
                                                padding: '10px 12px',
                                                borderRadius: 8,
                                                background: 'rgba(234, 179, 8, 0.08)',
                                                border: '1px solid rgba(234, 179, 8, 0.35)',
                                                color: '#b45309',
                                                fontSize: 13,
                                                lineHeight: 1.45
                                            }}
                                        >
                                            Pending — password cannot be set yet. The user will choose their own password when they accept the invitation.
                                        </div>
                                    </div>
                                )}

                                {(form.role === 'employee' || form.role === 'manager') && (
                                    <div className="invite-field">
                                        <label className="invite-label">Task / Responsibility <span className="invite-label-opt">(optional)</span></label>
                                        <input
                                            type="text"
                                            className="invite-input"
                                            value={form.assigned_task}
                                            onChange={e => setForm({ ...form, assigned_task: e.target.value })}
                                            placeholder="e.g. Manage speaker travel logistics"
                                        />
                                    </div>
                                )}

                                {/* Tenant-wide Section Access used to live here.
                                    Removed — superseded by Per-Event Modules above,
                                    which control the same 6 sections at a finer
                                    grain. Existing tenant-wide restrictions in
                                    users.permissions still apply on the backend;
                                    they're just not editable from this modal. */}
                            </div>
                        )}
                    </div>

                    {/* FOOTER */}
                    <div className="invite-footer">
                        {successLink ? (
                            <button className="invite-btn-primary" onClick={() => { setShow(false); setSuccessLink(''); setEmailStatus(null); setCopied(false); }}>
                                Done
                            </button>
                        ) : (
                            <>
                                <button className="invite-btn-ghost" onClick={() => { setShow(false); setSuccessLink(''); setEmailStatus(null); }}>
                                    Cancel
                                </button>
                                <AsyncButton className="invite-btn-primary" onClick={handleSave}
                                    loadingText={editing ? 'Saving…' : 'Sending…'}>
                                    {editing ? <>Save Changes</> : <><BsSendFill /> Send Invitation</>}
                                </AsyncButton>
                            </>
                        )}
                    </div>
                </div>
            </Modal>

            <style>{`
                .org-tree-container { padding: 20px 0; }
                .org-node {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                }
                .org-card {
                    background: var(--bg-card);
                    border: 2px solid var(--border-subtle);
                    border-radius: 14px;
                    padding: 16px 20px;
                    min-width: 200px;
                    max-width: 240px;
                    text-align: center;
                    position: relative;
                    transition: all 0.2s;
                    box-shadow: 0 2px 12px rgba(0,0,0,0.08);
                }
                .org-card:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 6px 20px rgba(0,0,0,0.12);
                    border-color: var(--accent);
                }
                .org-card.role-admin { border-top: 3px solid #ef4444; }
                .org-card.role-manager { border-top: 3px solid #0ea5e9; }
                .org-card.role-employee { border-top: 3px solid #10b981; }
                .org-card.pending { opacity: 0.7; border-style: dashed; }
                .org-avatar {
                    width: 48px; height: 48px; border-radius: 12px;
                    display: flex; align-items: center; justify-content: center;
                    font-weight: 800; font-size: 1.1rem;
                    margin: 0 auto 10px;
                }
                .org-connector-v {
                    width: 2px; height: 30px;
                    background: var(--border-subtle);
                    margin: 0 auto;
                }
                .org-connector-h {
                    height: 2px;
                    background: var(--border-subtle);
                }
                .org-children {
                    display: flex;
                    gap: 20px;
                    justify-content: center;
                    flex-wrap: wrap;
                    position: relative;
                    padding-top: 30px;
                }
                .org-children::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 50%;
                    width: 2px;
                    height: 30px;
                    background: var(--border-subtle);
                    transform: translateX(-50%);
                }
                .org-child-branch {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    position: relative;
                }
                .org-child-branch::before {
                    content: '';
                    position: absolute;
                    top: -30px;
                    left: 50%;
                    width: 2px;
                    height: 30px;
                    background: var(--border-subtle);
                    transform: translateX(-50%);
                }
                .org-children-row {
                    display: flex;
                    gap: 20px;
                    flex-wrap: wrap;
                    position: relative;
                }
                .org-children-row::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 20%;
                    right: 20%;
                    height: 2px;
                    background: var(--border-subtle);
                }
                .org-event-group {
                    background: var(--bg-card);
                    border: 1px solid var(--border-subtle);
                    border-radius: 14px;
                    padding: 16px;
                    margin-bottom: 16px;
                }
            `}</style>
        </div>
    );
}

// Organization Tree Component
function OrgTree({ users, events, currentUser, onEdit, onDelete }) {
    const admins = users.filter(u => u.role === 'admin');
    const managers = users.filter(u => u.role === 'manager');
    const employees = users.filter(u => u.role === 'employee');

    // Group employees by event
    const employeesByEvent = {};
    employees.forEach(emp => {
        const key = emp.assigned_event_id || 'unassigned';
        if (!employeesByEvent[key]) employeesByEvent[key] = [];
        employeesByEvent[key].push(emp);
    });

    const getEventName = (eventId) => {
        if (!eventId || eventId === 'unassigned') return 'General Team';
        return events.find(e => e.id === eventId)?.title || 'Event #' + eventId;
    };

    const roleColors = { admin: { bg: 'rgba(239,68,68,0.12)', text: '#ef4444' }, manager: { bg: 'rgba(14,165,233,0.12)', text: '#0ea5e9' }, employee: { bg: 'rgba(16,185,129,0.12)', text: '#10b981' } };

    const UserCard = ({ user }) => {
        const colors = roleColors[user.role] || roleColors.employee;
        const isPending = user.status !== 'accepted';
        return (
            <div className={`org-card role-${user.role} ${isPending ? 'pending' : ''}`}>
                <div className="org-avatar" style={{ background: colors.bg, color: colors.text }}>
                    {user.name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: 2 }}>
                    {user.name || '(Pending)'}
                </div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>{user.email}</div>
                <span className={`badge-premium role-${user.role}`} style={{ fontSize: '0.6rem' }}>{user.role}</span>
                {user.assigned_task && (
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: 6, padding: '4px 8px', background: 'rgba(139,92,246,0.06)', borderRadius: 6 }}>
                        {user.assigned_task}
                    </div>
                )}
                {isPending && (
                    <div style={{ fontSize: '0.65rem', color: '#f59e0b', marginTop: 6, fontWeight: 600 }}>Pending Invite</div>
                )}
                <div className="d-flex gap-1 justify-content-center mt-2">
                    <button className="btn-action" style={{ width: 26, height: 26 }} onClick={() => onEdit(user)}><BsPencil size={11} /></button>
                    <button className="btn-action danger" style={{ width: 26, height: 26 }} onClick={() => onDelete(user)}><BsTrash size={11} /></button>
                </div>
            </div>
        );
    };

    // For manager view — show flat tree: Manager at top, employees below grouped by event
    if (currentUser?.role === 'manager') {
        return (
            <div className="org-tree-container">
                <div className="d-flex flex-column align-items-center">
                    <UserCard user={{ ...currentUser, status: 'accepted', speaker_count: 0, partner_count: 0, attendee_count: 0 }} />
                    {employees.length > 0 && (
                        <div className="org-children">
                            {Object.keys(employeesByEvent).map(eventKey => (
                                <div key={eventKey} className="org-event-group">
                                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12, textAlign: 'center' }}>
                                        {getEventName(eventKey === 'unassigned' ? null : Number(eventKey))}
                                    </div>
                                    <div className="d-flex gap-3 flex-wrap justify-content-center">
                                        {employeesByEvent[eventKey].map(emp => (
                                            <UserCard key={emp.id + '-' + emp.email} user={emp} />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Admin view — full hierarchy: Admins > Managers > Employees (grouped by event)
    return (
        <div className="org-tree-container">
            <div className="d-flex flex-column align-items-center">
                {/* Admin Level */}
                <div className="d-flex gap-4 flex-wrap justify-content-center">
                    {admins.map(a => <UserCard key={a.id + '-' + a.email} user={a} />)}
                </div>

                {/* Connector */}
                {(managers.length > 0 || employees.length > 0) && <div className="org-connector-v" style={{ height: 40 }} />}

                {/* Manager Level */}
                {managers.length > 0 && (
                    <>
                        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Managers</div>
                        <div className="d-flex gap-4 flex-wrap justify-content-center">
                            {managers.map(m => <UserCard key={m.id + '-' + m.email} user={m} />)}
                        </div>
                    </>
                )}

                {/* Connector */}
                {employees.length > 0 && <div className="org-connector-v" style={{ height: 40 }} />}

                {/* Employee Level — grouped by event */}
                {employees.length > 0 && (
                    <>
                        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>Team Members</div>
                        <div className="d-flex gap-4 flex-wrap justify-content-center">
                            {Object.keys(employeesByEvent).map(eventKey => (
                                <div key={eventKey} className="org-event-group">
                                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12, textAlign: 'center' }}>
                                        {getEventName(eventKey === 'unassigned' ? null : Number(eventKey))}
                                    </div>
                                    <div className="d-flex gap-3 flex-wrap justify-content-center">
                                        {employeesByEvent[eventKey].map(emp => (
                                            <UserCard key={emp.id + '-' + emp.email} user={emp} />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
