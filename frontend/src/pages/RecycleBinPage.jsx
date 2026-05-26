import { useEffect, useState, useMemo } from 'react';
import { Spinner, Alert, Badge, Button, Form } from 'react-bootstrap';
import { BsTrash, BsArrowCounterclockwise, BsExclamationTriangleFill, BsPersonBadge, BsBriefcase, BsTrophy, BsListTask, BsPeopleFill, BsArchive } from 'react-icons/bs';
import { getRecycleBin, restoreRecycleBinItem, purgeRecycleBinItem, emptyRecycleBin } from '../services/api';
import { getImageUrl } from '../utils/imageUrl';

// Recycle Bin — single page for admins/managers showing every soft-deleted
// speaker/partner/award/agenda/attendee in the tenant. 30-day retention; the
// server lazily purges expired items every time this page is loaded.
const ENTITY_META = {
    speakers:  { label: 'Speaker',  icon: BsPersonBadge, color: '#8b5cf6' },
    partners:  { label: 'Partner',  icon: BsBriefcase,   color: '#0ea5e9' },
    awards:    { label: 'Award',    icon: BsTrophy,      color: '#f59e0b' },
    agendas:   { label: 'Agenda',   icon: BsListTask,    color: '#10b981' },
    attendees: { label: 'Attendee', icon: BsPeopleFill,  color: '#ec4899' },
};

const fmtRelative = (iso) => {
    const ms = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

// Build a richer countdown payload: how much of the retention window has
// elapsed (for a progress bar), human-friendly remaining text, and a tone
// that drives the colour as the deadline approaches.
const fmtCountdown = (deletedIso, expIso, retentionDays) => {
    const now = Date.now();
    const deletedAt = new Date(deletedIso).getTime();
    const expiresAt = new Date(expIso).getTime();
    const totalMs = retentionDays * 86400000;
    const elapsedMs = Math.max(0, now - deletedAt);
    const remainingMs = Math.max(0, expiresAt - now);
    const pct = Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100));

    let text, tone;
    if (remainingMs <= 0) {
        text = 'Auto-deleting…'; tone = 'danger';
    } else if (remainingMs < 3600 * 1000) {
        text = `Auto-deletes in ${Math.max(1, Math.floor(remainingMs / 60000))}m`; tone = 'danger';
    } else if (remainingMs < 86400 * 1000) {
        text = `Auto-deletes in ${Math.floor(remainingMs / 3600000)}h`; tone = 'danger';
    } else {
        const days = Math.ceil(remainingMs / 86400000);
        text = `Auto-deletes in ${days} day${days === 1 ? '' : 's'}`;
        if (days <= 3) tone = 'danger';
        else if (days <= 7) tone = 'warning';
        else tone = 'ok';
    }
    return { text, tone, pct };
};

export default function RecycleBinPage() {
    const [data, setData] = useState({ items: [], retention_days: 30 });
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [busyId, setBusyId] = useState(null);
    const [msg, setMsg] = useState({ type: '', text: '' });

    // Tick once a minute so the "Auto-deletes in N days" countdown updates
    // live without a manual refresh. The state value itself is unused — it
    // just forces a re-render.
    const [, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setTick(t => t + 1), 60 * 1000);
        return () => clearInterval(id);
    }, []);

    const load = () => {
        setLoading(true);
        getRecycleBin()
            .then(r => setData(r.data || { items: [], retention_days: 30 }))
            .catch(err => setMsg({ type: 'danger', text: err.response?.data?.error || 'Failed to load' }))
            .finally(() => setLoading(false));
    };
    useEffect(load, []);

    const filtered = useMemo(() => {
        const q = search.trim().toLowerCase();
        return (data.items || []).filter(it => {
            if (filter !== 'all' && it.entity_type !== filter) return false;
            if (q) {
                const hay = `${it.title || ''} ${it.subtitle || ''} ${it.event_title || ''} ${it.deleted_by_name || ''}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    }, [data.items, filter, search]);

    const counts = useMemo(() => {
        const c = { all: data.items?.length || 0 };
        for (const it of data.items || []) c[it.entity_type] = (c[it.entity_type] || 0) + 1;
        return c;
    }, [data.items]);

    const handleRestore = async (it) => {
        const key = `${it.entity_type}-${it.id}`;
        setBusyId(key); setMsg({ type: '', text: '' });
        try {
            await restoreRecycleBinItem(it.entity_type, it.id);
            setMsg({ type: 'success', text: `Restored "${it.title}".` });
            setData(d => ({ ...d, items: d.items.filter(x => !(x.entity_type === it.entity_type && x.id === it.id)) }));
        } catch (err) {
            setMsg({ type: 'danger', text: err.response?.data?.error || 'Restore failed' });
        } finally { setBusyId(null); }
    };

    const handlePurge = async (it) => {
        if (!window.confirm(`Permanently delete "${it.title}"? This can't be undone.`)) return;
        const key = `${it.entity_type}-${it.id}`;
        setBusyId(key); setMsg({ type: '', text: '' });
        try {
            await purgeRecycleBinItem(it.entity_type, it.id);
            setData(d => ({ ...d, items: d.items.filter(x => !(x.entity_type === it.entity_type && x.id === it.id)) }));
        } catch (err) {
            setMsg({ type: 'danger', text: err.response?.data?.error || 'Purge failed' });
        } finally { setBusyId(null); }
    };

    const handleEmptyAll = async () => {
        if (!filtered.length) return;
        if (!window.confirm(`Permanently delete ${filtered.length} item${filtered.length === 1 ? '' : 's'}? This can't be undone.`)) return;
        setBusyId('empty');
        try {
            await emptyRecycleBin();
            load();
        } catch (err) {
            setMsg({ type: 'danger', text: err.response?.data?.error || 'Failed to empty' });
        } finally { setBusyId(null); }
    };

    return (
        <div className="animate-in" style={{ padding: 8 }}>
            <div className="d-flex justify-content-between align-items-start gap-3 mb-3 flex-wrap">
                <div className="d-flex align-items-center gap-2">
                    <BsArchive size={22} style={{ color: 'var(--accent)' }} />
                    <div>
                        <h4 className="m-0" style={{ color: 'var(--text-primary)' }}>Recycle Bin</h4>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            Deleted items stay here for {data.retention_days} days. After that they're permanently removed.
                        </div>
                    </div>
                </div>
                <div className="d-flex gap-2 align-items-center">
                    <Form.Control
                        size="sm"
                        type="search"
                        placeholder="Search…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        style={{ width: 200 }}
                    />
                    <Button
                        size="sm"
                        variant="outline-danger"
                        disabled={!filtered.length || busyId === 'empty'}
                        onClick={handleEmptyAll}
                    >
                        {busyId === 'empty' ? <Spinner size="sm" /> : <><BsTrash className="me-1" /> Empty</>}
                    </Button>
                </div>
            </div>

            {msg.text && (
                <Alert variant={msg.type} dismissible onClose={() => setMsg({ type: '', text: '' })} className="py-2" style={{ fontSize: 13 }}>
                    {msg.text}
                </Alert>
            )}

            {/* Filter pills */}
            <div className="d-flex flex-wrap gap-2 mb-3">
                <FilterPill label="All" count={counts.all || 0} active={filter === 'all'} onClick={() => setFilter('all')} />
                {Object.entries(ENTITY_META).map(([k, m]) => (
                    <FilterPill
                        key={k} label={m.label + 's'} count={counts[k] || 0}
                        color={m.color}
                        active={filter === k} onClick={() => setFilter(k)}
                    />
                ))}
            </div>

            {loading ? (
                <div className="p-5 text-center"><Spinner animation="border" /></div>
            ) : filtered.length === 0 ? (
                <EmptyState filter={filter} totalAll={counts.all} />
            ) : (
                <div className="premium-card p-0" style={{ overflow: 'hidden' }}>
                    {filtered.map((it, i) => (
                        <BinRow
                            key={`${it.entity_type}-${it.id}`}
                            item={it}
                            retentionDays={data.retention_days}
                            isLast={i === filtered.length - 1}
                            busy={busyId === `${it.entity_type}-${it.id}`}
                            onRestore={() => handleRestore(it)}
                            onPurge={() => handlePurge(it)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function FilterPill({ label, count, color = 'var(--accent)', active, onClick }) {
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                background: active ? color : 'rgba(255,255,255,0.04)',
                color: active ? '#fff' : 'var(--text-primary)',
                border: `1px solid ${active ? color : 'var(--border-subtle)'}`,
                padding: '6px 14px',
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.15s',
            }}
        >
            {label}
            <span style={{
                background: active ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.06)',
                padding: '1px 8px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
            }}>{count}</span>
        </button>
    );
}

function BinRow({ item, retentionDays, isLast, busy, onRestore, onPurge }) {
    const meta = ENTITY_META[item.entity_type] || {};
    const Icon = meta.icon || BsArchive;
    const cd = fmtCountdown(item.deleted_at, item.expires_at, retentionDays || 30);
    const toneColor = cd.tone === 'danger' ? '#ef4444' : cd.tone === 'warning' ? '#f59e0b' : '#10b981';
    return (
        <div className="d-flex align-items-center gap-3" style={{
            padding: '14px 16px',
            borderBottom: isLast ? 'none' : '1px solid var(--border-subtle)',
        }}>
            {/* Avatar / icon */}
            <div style={{
                width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                background: item.image_url ? `url(${getImageUrl(item.image_url)}) center/cover` : `${meta.color}22`,
                display: 'grid', placeItems: 'center',
                color: meta.color,
                border: '1px solid var(--border-subtle)',
            }}>
                {!item.image_url && <Icon size={18} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div className="d-flex align-items-center gap-2 flex-wrap">
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{item.title || '—'}</span>
                    <Badge bg="" style={{ background: `${meta.color}1f`, color: meta.color, fontWeight: 600, fontSize: 10 }}>
                        {item.entity_label}
                    </Badge>
                    {item.event_title && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· {item.event_title}</span>
                    )}
                </div>
                {item.subtitle && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.subtitle}
                    </div>
                )}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Deleted {fmtRelative(item.deleted_at)}
                    {item.deleted_by_name && <> by <span style={{ color: 'var(--text-primary)' }}>{item.deleted_by_name}</span></>}
                </div>

                {/* Inline timer + progress bar — fills as the 30-day window
                    elapses, turns amber under a week, red under 3 days. */}
                <div style={{ marginTop: 8 }}>
                    <div className="d-flex align-items-center gap-1" style={{
                        fontSize: 11, fontWeight: 700, color: toneColor, letterSpacing: '0.01em',
                    }}>
                        {cd.tone === 'danger' && <BsExclamationTriangleFill size={11} />}
                        <span>{cd.text}</span>
                    </div>
                    <div style={{
                        marginTop: 4,
                        height: 4, borderRadius: 999,
                        background: 'rgba(255,255,255,0.06)',
                        overflow: 'hidden', maxWidth: 320,
                    }}>
                        <div style={{
                            width: `${cd.pct}%`,
                            height: '100%',
                            background: toneColor,
                            transition: 'width 0.4s ease, background 0.3s ease',
                        }} />
                    </div>
                </div>
            </div>
            <div className="d-flex gap-2 flex-shrink-0">
                <Button size="sm" className="btn-accent" disabled={busy} onClick={onRestore} title="Restore">
                    {busy ? <Spinner size="sm" /> : <><BsArrowCounterclockwise className="me-1" /> Restore</>}
                </Button>
                <Button size="sm" variant="outline-danger" disabled={busy} onClick={onPurge} title="Delete forever">
                    <BsTrash />
                </Button>
            </div>
        </div>
    );
}

function EmptyState({ filter, totalAll }) {
    const filterLabel = filter === 'all' ? '' : (ENTITY_META[filter]?.label || filter) + 's';
    return (
        <div className="premium-card text-center" style={{ padding: '60px 20px' }}>
            <BsArchive size={42} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', marginTop: 14 }}>
                {filter === 'all' || totalAll === 0 ? 'Recycle Bin is empty' : `No deleted ${filterLabel} right now`}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                {filter === 'all' || totalAll === 0
                    ? 'Deleted speakers, partners, awards, agendas and attendees will show up here.'
                    : 'Try a different filter or clear the search.'}
            </div>
        </div>
    );
}
