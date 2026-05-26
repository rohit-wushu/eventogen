import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Modal, Form, Alert } from 'react-bootstrap';
import { useAuth } from '../context/AuthContext';
import {
    getAwardCategories, createAwardCategory, updateAwardCategory, deleteAwardCategory,
    getEvents
} from '../services/api';
import { BsPlus, BsPencil, BsTrash, BsTags, BsArrowLeft, BsChevronDown, BsChevronRight, BsBuilding, BsTrophy, BsDot } from 'react-icons/bs';

// Three-level hierarchy:
//   Sector  (parent_id = null)         e.g. "BFSI"
//     Category  (parent_id = sector)   e.g. "Best NBFC"
//       Subcategory  (parent_id = cat) e.g. "Under ₹500 Cr AUM"
// Each level can carry a nomination fee (amount). When a nomination form
// charges per-category the deepest-level selection's amount wins — that's
// handled on the form side; this page just lets admins edit the tree.

export default function AwardCategoriesPage() {
    const navigate = useNavigate();
    const { user } = useAuth();
    const [categories, setCategories] = useState([]);
    const [events, setEvents] = useState([]);
    const [filterEvent, setFilterEvent] = useState('');
    const [show, setShow] = useState(false);
    const [editing, setEditing] = useState(null);
    const [parentForNew, setParentForNew] = useState(null);
    const [levelForNew, setLevelForNew] = useState('sector'); // sector | category | subcategory
    const [error, setError] = useState('');
    const [form, setForm] = useState({ name: '', event_id: '', amount: '' });

    const canManage = ['admin', 'manager', 'employee'].includes(user?.role);
    const [collapsed, setCollapsed] = useState(() => new Set());
    const toggleCollapse = (id) => setCollapsed(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const load = (eventId = filterEvent) => {
        getAwardCategories(eventId || undefined)
            .then(r => setCategories(Array.isArray(r.data) ? r.data : []))
            .catch(() => { });
    };
    useEffect(() => {
        getEvents().then(r => setEvents(Array.isArray(r.data) ? r.data : [])).catch(() => { });
        load();
    }, []);

    useEffect(() => { load(filterEvent); }, [filterEvent]);

    const openAddSector = () => {
        setEditing(null);
        setParentForNew(null);
        setLevelForNew('sector');
        setForm({
            name: '', amount: '',
            event_id: filterEvent || (user?.role === 'employee' ? (user?.assigned_event_id || '') : '')
        });
        setError('');
        setShow(true);
    };

    const openAddChild = (parent, level) => {
        setEditing(null);
        setParentForNew(parent);
        setLevelForNew(level);
        setForm({ name: '', amount: '', event_id: parent.event_id });
        setError('');
        setShow(true);
    };

    const openEdit = (item) => {
        setEditing(item);
        setParentForNew(null);
        setLevelForNew(depthOf(item) === 0 ? 'sector' : depthOf(item) === 1 ? 'category' : 'subcategory');
        setForm({
            name: item.name,
            event_id: item.event_id || '',
            amount: item.amount != null ? String(item.amount) : '',
            parent_id: item.parent_id ? String(item.parent_id) : '',
        });
        setError('');
        setShow(true);
    };

    // Compute depth of an item within the local categories list (0 = sector).
    const byId = new Map(categories.map(c => [Number(c.id), c]));
    function depthOf(item) {
        if (!item || item.parent_id == null) return 0;
        const p = byId.get(Number(item.parent_id));
        return p ? 1 + depthOf(p) : 1;
    }

    const handleSave = async () => {
        if (!form.name) return setError('Name is required');
        if (!form.event_id) return setError('Please select an event');
        const amt = form.amount === '' ? null : Number(form.amount);
        if (amt !== null && (isNaN(amt) || amt < 0)) return setError('Amount must be a positive number or blank');
        try {
            if (editing) {
                // Allow re-parenting from the edit modal (e.g. promote an existing
                // category under a new sector). Empty string = top-level (sector).
                const nextParentId = form.parent_id ? Number(form.parent_id) : null;
                await updateAwardCategory({
                    id: editing.id,
                    name: form.name,
                    event_id: form.event_id,
                    parent_id: nextParentId,
                    amount: amt,
                });
            } else {
                await createAwardCategory({
                    name: form.name,
                    event_id: form.event_id,
                    parent_id: parentForNew ? parentForNew.id : null,
                    amount: amt,
                });
            }
            setShow(false);
            load();
        } catch (err) { setError(err.response?.data?.error || 'Failed'); }
    };

    const handleDelete = async (item) => {
        const d = depthOf(item);
        const msg = d === 0
            ? 'Delete this sector? All its categories and subcategories will be removed.'
            : d === 1
                ? 'Delete this category? All its subcategories will be removed.'
                : 'Delete this subcategory?';
        if (window.confirm(msg)) {
            await deleteAwardCategory(item.id);
            load();
        }
    };

    const sectors = categories.filter(c => c.parent_id == null);
    const childrenOf = (parentId) => categories.filter(c => Number(c.parent_id) === Number(parentId));

    const labelForLevel = (level) => level === 'sector' ? 'Sector' : level === 'category' ? 'Category' : 'Subcategory';
    const currencyFor = (c) => {
        const ev = events.find(e => Number(e.id) === Number(c.event_id));
        return ev?.currency || 'INR';
    };
    const fmtMoney = (v, curr = 'INR') => {
        if (v == null) return null;
        try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: curr }).format(Number(v)); }
        catch { return `${curr} ${v}`; }
    };

    const modalTitle = editing
        ? `Edit ${labelForLevel(levelForNew)}`
        : parentForNew
            ? `Add ${labelForLevel(levelForNew)} under "${parentForNew.name}"`
            : 'Add Sector';

    // Options for the "Parent" select in the edit modal. A row can be moved
    // to top level (no parent = Sector) or under any other existing node in
    // the same event, as long as we don't exceed 3 levels or create a cycle.
    const parentOptions = editing
        ? categories.filter(c => {
            if (String(c.event_id) !== String(editing.event_id)) return false;
            if (c.id === editing.id) return false;
            // Prevent picking a descendant as parent (would create a cycle).
            let cursor = c.parent_id;
            while (cursor) {
                if (cursor === editing.id) return false;
                const row = byId.get(Number(cursor));
                cursor = row ? row.parent_id : null;
            }
            // Target depth after move must fit inside 3 levels given current subtree depth.
            const subtreeDepth = (id) => {
                const kids = categories.filter(k => Number(k.parent_id) === Number(id));
                if (kids.length === 0) return 0;
                return 1 + Math.max(...kids.map(k => subtreeDepth(k.id)));
            };
            const candidateDepth = depthOf(c); // 0 sector | 1 category
            const myDepthBelow = subtreeDepth(editing.id);
            if (candidateDepth + 1 + myDepthBelow > 2) return false;
            return true;
        })
        : [];

    return (
        <div className="animate-in">
            <style>{`
                /* ── Level badges ─────────────────────────────────────── */
                .ac-lvl {
                    display: inline-block;
                    padding: 2px 8px;
                    border-radius: 999px;
                    font-size: 0.6rem;
                    font-weight: 800;
                    letter-spacing: 0.08em;
                    line-height: 1.2;
                    flex-shrink: 0;
                }
                .ac-lvl-sector { background: rgba(139,92,246,0.18); color: #a78bfa; }
                .ac-lvl-cat    { background: rgba(236,72,153,0.18); color: #f472b6; }
                .ac-lvl-sub    { background: rgba(100,116,139,0.2);  color: #94a3b8; }

                /* ── Sector card ──────────────────────────────────────── */
                .ac-sector {
                    background: var(--bg-card);
                    border: 1px solid var(--border-subtle);
                    border-radius: var(--radius-lg);
                    overflow: hidden;
                    transition: border-color 0.15s;
                }
                .ac-sector:hover { border-color: rgba(139,92,246,0.35); }
                .ac-sector-head {
                    display: flex; align-items: center; gap: 12px;
                    padding: 14px 16px;
                    background: linear-gradient(135deg, rgba(139,92,246,0.08), rgba(236,72,153,0.04));
                    cursor: pointer;
                    user-select: none;
                }
                .ac-sector-ico {
                    width: 38px; height: 38px; border-radius: 10px;
                    display: grid; place-items: center;
                    background: linear-gradient(135deg, var(--accent), var(--accent-pink, #ec4899));
                    color: #fff; font-weight: 700; font-size: 1rem;
                    flex-shrink: 0;
                    box-shadow: 0 4px 12px -4px var(--accent);
                }
                .ac-sector-name {
                    color: var(--text-primary);
                    font-weight: 700;
                    font-size: 1.02rem;
                    line-height: 1.2;
                }
                .ac-sector-meta { font-size: 0.72rem; color: var(--text-muted); margin-top: 3px; }
                .ac-chev { color: var(--text-muted); transition: transform 0.15s; flex-shrink: 0; }
                .ac-sector-body { padding: 8px 16px 14px 60px; }
                .ac-sector-body.empty { padding: 8px 16px 14px 60px; color: var(--text-muted); font-style: italic; font-size: 0.82rem; }

                /* ── Category row (inside sector body) ────────────────── */
                .ac-cat {
                    position: relative;
                    padding: 10px 10px 10px 22px;
                    border-radius: 10px;
                    transition: background 0.15s;
                }
                .ac-cat:hover { background: rgba(236,72,153,0.06); }
                /* L-connector from sector's vertical rail to the category row */
                .ac-cat::before {
                    content: '';
                    position: absolute;
                    left: 0; top: 0; bottom: 50%;
                    border-left: 2px solid rgba(236,72,153,0.3);
                    border-bottom: 2px solid rgba(236,72,153,0.3);
                    border-bottom-left-radius: 10px;
                    width: 16px;
                }
                /* Full vertical rail for categories that have siblings below */
                .ac-cat.has-next::after {
                    content: '';
                    position: absolute;
                    left: 0; top: 50%; bottom: -8px;
                    border-left: 2px solid rgba(236,72,153,0.3);
                }
                .ac-cat-row {
                    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
                }
                .ac-cat-name { color: var(--text-primary); font-weight: 600; font-size: 0.94rem; }

                /* ── Subcategory row (inside category) ────────────────── */
                .ac-sub-list { margin-left: 22px; padding-left: 0; }
                .ac-sub {
                    position: relative;
                    padding: 7px 8px 7px 22px;
                    border-radius: 8px;
                    transition: background 0.15s;
                }
                .ac-sub:hover { background: rgba(255,255,255,0.03); }
                .ac-sub::before {
                    content: '';
                    position: absolute;
                    left: 0; top: 0; bottom: 50%;
                    border-left: 1.5px solid rgba(148,163,184,0.35);
                    border-bottom: 1.5px solid rgba(148,163,184,0.35);
                    border-bottom-left-radius: 8px;
                    width: 14px;
                }
                .ac-sub.has-next::after {
                    content: '';
                    position: absolute;
                    left: 0; top: 50%; bottom: -4px;
                    border-left: 1.5px solid rgba(148,163,184,0.35);
                }
                .ac-sub-row {
                    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
                }
                .ac-sub-name { color: var(--text-secondary); font-size: 0.9rem; }

                /* ── Money badge ──────────────────────────────────────── */
                .ac-fee {
                    display: inline-flex; align-items: center; gap: 4px;
                    padding: 2px 9px;
                    border-radius: 999px;
                    background: rgba(16,185,129,0.12);
                    color: #34d399;
                    font-size: 0.68rem; font-weight: 700;
                }

                /* ── Action buttons that only appear on row hover ─────── */
                .ac-actions {
                    display: flex; align-items: center; gap: 4px;
                    margin-left: auto;
                    opacity: 0.35;
                    transition: opacity 0.15s;
                }
                .ac-sector-head:hover .ac-actions,
                .ac-cat:hover .ac-actions,
                .ac-sub:hover .ac-actions { opacity: 1; }
                .ac-mini-btn {
                    display: inline-flex; align-items: center; gap: 4px;
                    padding: 3px 9px; font-size: 0.7rem; font-weight: 600;
                    border-radius: 7px;
                    background: rgba(255,255,255,0.04);
                    border: 1px solid var(--border-subtle);
                    color: var(--text-secondary);
                    cursor: pointer;
                    transition: all 0.15s;
                }
                .ac-mini-btn:hover { border-color: var(--accent); color: var(--accent); background: rgba(139,92,246,0.08); }
            `}</style>
            <div className="page-header d-flex justify-content-between align-items-center">
                <div className="d-flex align-items-center gap-3">
                    <Button variant="link" className="p-0 text-white opacity-75 hover-opacity-100" onClick={() => navigate('/awards')} title="Back to Awards">
                        <BsArrowLeft size={20} />
                    </Button>
                    <div>
                        <h4 className="m-0">Award Categories</h4>
                        <p className='text-white small m-0 opacity-75'>Sector → Category → Subcategory. Each level can carry a nomination fee.</p>
                    </div>
                </div>
                {canManage && (
                    <Button className="btn-accent d-flex align-items-center gap-2" onClick={openAddSector}>
                        <BsPlus size={18} /> Add Sector
                    </Button>
                )}
            </div>

            {user?.role !== 'employee' && events.length > 0 && (
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

            {sectors.length === 0 ? (
                <div className="empty-state" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
                    <div className="empty-state-icon"><BsTags /></div>
                    <p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>No Sectors Yet</p>
                    <p style={{ fontSize: '0.8rem' }}>Click "Add Sector" to create your first one, then add categories and subcategories under it.</p>
                </div>
            ) : (
                <div className="d-flex flex-column gap-3">
                    {sectors.map(sector => {
                        const cats = childrenOf(sector.id);
                        const sectorCurrency = currencyFor(sector);
                        const totalSubs = cats.reduce((n, c) => n + childrenOf(c.id).length, 0);
                        const isOpen = !collapsed.has(sector.id);
                        return (
                            <div key={sector.id} className="ac-sector">
                                {/* Sector header — click anywhere to toggle */}
                                <div className="ac-sector-head" onClick={() => toggleCollapse(sector.id)}>
                                    <span className="ac-chev" style={{ transform: isOpen ? 'rotate(0)' : 'rotate(-90deg)' }}>
                                        <BsChevronDown size={14} />
                                    </span>
                                    <div className="ac-sector-ico"><BsBuilding size={18} /></div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div className="ac-sector-name d-flex align-items-center gap-2 flex-wrap">
                                            <span className="ac-lvl ac-lvl-sector">SECTOR</span>
                                            <span>{sector.name}</span>
                                            {sector.amount != null && (
                                                <span className="ac-fee">{fmtMoney(sector.amount, sectorCurrency)}</span>
                                            )}
                                        </div>
                                        <div className="ac-sector-meta">
                                            {sector.event_title || 'No event'}
                                            {' · '}{cats.length} categor{cats.length === 1 ? 'y' : 'ies'}
                                            {totalSubs > 0 && <> · {totalSubs} subcategor{totalSubs === 1 ? 'y' : 'ies'}</>}
                                        </div>
                                    </div>
                                    {canManage && (
                                        <div className="ac-actions" onClick={(e) => e.stopPropagation()}>
                                            <button className="ac-mini-btn" onClick={() => openAddChild(sector, 'category')}>
                                                <BsPlus /> Category
                                            </button>
                                            <button className="btn-action" onClick={() => openEdit(sector)} title="Edit sector">
                                                <BsPencil size={13} />
                                            </button>
                                            <button className="btn-action danger" onClick={() => handleDelete(sector)} title="Delete sector">
                                                <BsTrash size={13} />
                                            </button>
                                        </div>
                                    )}
                                </div>

                                {/* Sector body — categories + their subs */}
                                {isOpen && (
                                    cats.length === 0 ? (
                                        <div className="ac-sector-body empty">
                                            No categories yet. Click <strong>+ Category</strong> in this sector's header to add one.
                                        </div>
                                    ) : (
                                        <div className="ac-sector-body">
                                            {cats.map((cat, ci) => {
                                                const subs = childrenOf(cat.id);
                                                const catHasNext = ci < cats.length - 1;
                                                return (
                                                    <div key={cat.id}>
                                                        <div className={`ac-cat ${catHasNext ? 'has-next' : ''}`}>
                                                            <div className="ac-cat-row">
                                                                <BsTrophy size={13} style={{ color: '#f472b6' }} />
                                                                <span className="ac-lvl ac-lvl-cat">CATEGORY</span>
                                                                <span className="ac-cat-name">{cat.name}</span>
                                                                {cat.amount != null && (
                                                                    <span className="ac-fee">{fmtMoney(cat.amount, sectorCurrency)}</span>
                                                                )}
                                                                {subs.length > 0 && (
                                                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                                                        {subs.length} sub{subs.length === 1 ? '' : 's'}
                                                                    </span>
                                                                )}
                                                                {canManage && (
                                                                    <div className="ac-actions">
                                                                        <button className="ac-mini-btn" onClick={() => openAddChild(cat, 'subcategory')}>
                                                                            <BsPlus /> Sub
                                                                        </button>
                                                                        <button className="btn-action" onClick={() => openEdit(cat)} title="Edit category">
                                                                            <BsPencil size={13} />
                                                                        </button>
                                                                        <button className="btn-action danger" onClick={() => handleDelete(cat)} title="Delete category">
                                                                            <BsTrash size={13} />
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {subs.length > 0 && (
                                                            <div className="ac-sub-list">
                                                                {subs.map((sub, si) => {
                                                                    const subHasNext = si < subs.length - 1;
                                                                    return (
                                                                        <div key={sub.id} className={`ac-sub ${subHasNext ? 'has-next' : ''}`}>
                                                                            <div className="ac-sub-row">
                                                                                <BsDot size={16} style={{ color: 'var(--text-muted)', margin: '0 -4px' }} />
                                                                                <span className="ac-lvl ac-lvl-sub">SUB</span>
                                                                                <span className="ac-sub-name">{sub.name}</span>
                                                                                {sub.amount != null && (
                                                                                    <span className="ac-fee">{fmtMoney(sub.amount, sectorCurrency)}</span>
                                                                                )}
                                                                                {canManage && (
                                                                                    <div className="ac-actions">
                                                                                        <button className="btn-action" onClick={() => openEdit(sub)} title="Edit subcategory">
                                                                                            <BsPencil size={13} />
                                                                                        </button>
                                                                                        <button className="btn-action danger" onClick={() => handleDelete(sub)} title="Delete subcategory">
                                                                                            <BsTrash size={13} />
                                                                                        </button>
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <Modal show={show} onHide={() => setShow(false)} centered contentClassName="premium-modal">
                <Modal.Header closeButton closeVariant="white">
                    <Modal.Title style={{ color: 'var(--text-primary)' }}>{modalTitle}</Modal.Title>
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
                    {parentForNew && (
                        <div className="mb-3 p-2" style={{
                            background: 'rgba(139,92,246,0.08)', borderRadius: 8,
                            color: 'var(--text-muted)', fontSize: '0.8rem'
                        }}>
                            Adding under: <strong style={{ color: 'var(--accent)' }}>{parentForNew.name}</strong>
                        </div>
                    )}
                    {!parentForNew && !editing?.parent_id && (
                        <Form.Group className="mb-3">
                            <Form.Label>Event *</Form.Label>
                            <Form.Select
                                className="form-control-dark"
                                value={form.event_id}
                                onChange={e => setForm({ ...form, event_id: e.target.value })}
                                disabled={user?.role === 'employee'}
                            >
                                <option value="">— Select event —</option>
                                {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                            </Form.Select>
                        </Form.Group>
                    )}
                    <Form.Group className="mb-3">
                        <Form.Label>Name *</Form.Label>
                        <Form.Control
                            className="form-control-dark"
                            value={form.name}
                            onChange={e => setForm({ ...form, name: e.target.value })}
                            placeholder={
                                levelForNew === 'sector' ? 'e.g. BFSI, Healthcare, EdTech'
                                    : levelForNew === 'category' ? 'e.g. Best NBFC, Best Bank'
                                        : 'e.g. Under ₹500 Cr AUM'
                            }
                            autoFocus
                        />
                    </Form.Group>

                    {editing && (
                        <Form.Group className="mb-3">
                            <Form.Label>Parent</Form.Label>
                            <Form.Select
                                className="form-control-dark"
                                value={form.parent_id || ''}
                                onChange={e => setForm({ ...form, parent_id: e.target.value })}
                            >
                                <option value="">— None (top-level Sector) —</option>
                                {parentOptions.map(p => (
                                    <option key={p.id} value={p.id}>
                                        {depthOf(p) === 0 ? 'Sector' : 'Category'} · {p.name}
                                    </option>
                                ))}
                            </Form.Select>
                            <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                                Re-parent this row. Leave as "None" to keep it as a top-level Sector. Moving it under a Sector makes it a Category; under a Category makes it a Subcategory.
                            </Form.Text>
                        </Form.Group>
                    )}
                    <Form.Group className="mb-1">
                        <Form.Label>Nomination fee <span className="text-muted">(optional)</span></Form.Label>
                        <Form.Control
                            type="number" min={0} step="0.01"
                            className="form-control-dark"
                            value={form.amount}
                            onChange={e => setForm({ ...form, amount: e.target.value })}
                            placeholder="Leave blank for free / inherit from parent"
                        />
                        <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                            If you charge different fees per level, the deepest selected level on the nomination form wins.
                        </Form.Text>
                    </Form.Group>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="link" onClick={() => setShow(false)} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
                        Cancel
                    </Button>
                    <Button className="btn-accent" onClick={handleSave}>
                        Save
                    </Button>
                </Modal.Footer>
            </Modal>
        </div>
    );
}
