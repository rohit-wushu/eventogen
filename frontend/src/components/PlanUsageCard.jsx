import { useEffect, useState } from 'react';
import {
    BsCalendarEvent, BsPersonBadge, BsPeopleFill, BsPeople,
    BsExclamationTriangleFill, BsHddFill, BsInfinity, BsCheck2Circle
} from 'react-icons/bs';
import { getMySubscription } from '../services/api';

// Count resources render in a grid of 4 tiles. Storage renders as a wide row
// below — it's a different unit (MB) and benefits from more horizontal space
// for the used / free breakdown.
const TILE_RESOURCES = [
    { key: 'events',    label: 'Events',       Icon: BsCalendarEvent, accent: '#a78bfa' },
    { key: 'speakers',  label: 'Speakers',     Icon: BsPersonBadge,   accent: '#f472b6' },
    { key: 'attendees', label: 'Attendees',    Icon: BsPeopleFill,    accent: '#38bdf8' },
    { key: 'users',     label: 'Team members', Icon: BsPeople,        accent: '#34d399' },
];

const fmtStorage = (mb) => {
    if (mb == null) return '0 MB';
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
    if (mb >= 1)    return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`;
    return `${Math.round(mb * 1024)} KB`;
};

// Threshold logic: warn at 70% OR when ≤ cushion items remain. Cushion is
// 100 MB for storage, 3 rows otherwise. Caller renders the bar / ring with
// `tone.bar` / `tone.ring` / `tone.text`.
function tone(info) {
    if (!info) return { state: 'unknown', pct: 0, bar: '#475569', ring: 'rgba(255,255,255,0.06)', text: '#94a3b8', glow: 'transparent' };
    if (info.unlimited) return { state: 'unlimited', pct: 100, bar: 'linear-gradient(90deg,#34d399,#10b981)', ring: 'rgba(52,211,153,0.25)', text: '#34d399', glow: 'rgba(52,211,153,0.10)' };
    const pct = info.limit > 0 ? Math.min(100, Math.round((info.used / info.limit) * 100)) : 0;
    const remaining = Math.max(0, info.limit - info.used);
    const cushion = info.unit === 'MB' ? 100 : 3;
    if (pct >= 100) return { state: 'over',  pct, bar: 'linear-gradient(90deg,#ef4444,#dc2626)', ring: 'rgba(239,68,68,0.45)',  text: '#ef4444', glow: 'rgba(239,68,68,0.10)' };
    if (pct >= 70 || remaining <= cushion) return { state: 'warn', pct, bar: 'linear-gradient(90deg,#f59e0b,#d97706)', ring: 'rgba(245,158,11,0.45)', text: '#f59e0b', glow: 'rgba(245,158,11,0.08)' };
    return { state: 'ok', pct, bar: 'linear-gradient(90deg,#60a5fa,#3b82f6)', ring: 'rgba(255,255,255,0.06)', text: '#cbd5e1', glow: 'transparent' };
}

// ─── Layout primitives ──────────────────────────────────────────────────

function StatTile({ resource, info }) {
    const t = tone(info);
    const Icon = resource.Icon;
    const unlimited = info.unlimited;
    return (
        <div style={{
            position: 'relative',
            padding: '14px 16px',
            borderRadius: 14,
            background: `linear-gradient(140deg, rgba(255,255,255,0.025), rgba(255,255,255,0.01)), ${t.glow}`,
            border: `1px solid ${t.ring}`,
            overflow: 'hidden',
            transition: 'border-color 200ms ease, background 200ms ease'
        }}>
            <div className="d-flex align-items-center gap-2" style={{ marginBottom: 10 }}>
                <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 28, height: 28, borderRadius: 8,
                    background: `${resource.accent}1a`, color: resource.accent
                }}>
                    <Icon size={14} />
                </span>
                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {resource.label}
                </span>
            </div>

            {/* Big used number, then small "/ limit" */}
            <div className="d-flex align-items-baseline" style={{ gap: 6, marginBottom: 12 }}>
                <span style={{ fontSize: '1.6rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1 }}>
                    {info.used}
                </span>
                <span style={{ fontSize: '0.82rem', color: '#64748b', fontWeight: 600 }}>
                    {unlimited ? (
                        <span className="d-inline-flex align-items-center gap-1" style={{ color: '#34d399' }}>
                            / <BsInfinity />
                        </span>
                    ) : (
                        <>/ {info.limit}</>
                    )}
                </span>
            </div>

            {/* Bar + small footer (pct or "Unlimited") */}
            <div style={{ height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{
                    height: '100%',
                    width: unlimited ? '100%' : `${t.pct}%`,
                    background: t.bar,
                    transition: 'width 0.5s cubic-bezier(0.22, 1, 0.36, 1)'
                }} />
            </div>
            <div className="d-flex justify-content-between align-items-center" style={{ marginTop: 8, fontSize: '0.7rem' }}>
                <span style={{ color: '#64748b', fontWeight: 500 }}>
                    {unlimited ? 'Unlimited' : `${Math.max(0, info.limit - info.used)} left`}
                </span>
                {!unlimited && (
                    <span style={{ color: t.text, fontWeight: 700 }}>
                        {t.pct}%
                    </span>
                )}
            </div>
        </div>
    );
}

function StorageRow({ info }) {
    const t = tone(info);
    const unlimited = info.unlimited;
    const usedLabel = fmtStorage(info.used);
    const freeMb = Math.max(0, info.limit - info.used);
    const freeLabel = unlimited ? null : fmtStorage(freeMb);
    const totalLabel = unlimited ? '∞' : fmtStorage(info.limit);

    return (
        <div style={{
            padding: '16px 18px',
            borderRadius: 14,
            background: `linear-gradient(140deg, rgba(255,255,255,0.025), rgba(255,255,255,0.01)), ${t.glow}`,
            border: `1px solid ${t.ring}`
        }}>
            <div className="d-flex justify-content-between align-items-center" style={{ marginBottom: 12 }}>
                <div className="d-flex align-items-center gap-2">
                    <span style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 28, height: 28, borderRadius: 8,
                        background: 'rgba(96,165,250,0.18)', color: '#60a5fa'
                    }}>
                        <BsHddFill size={14} />
                    </span>
                    <span style={{ fontSize: '0.78rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Storage
                    </span>
                </div>
                {!unlimited && (
                    <span style={{ fontSize: '0.78rem', color: t.text, fontWeight: 700 }}>
                        {t.pct}%
                    </span>
                )}
            </div>

            {/* Big used / total */}
            <div className="d-flex align-items-baseline" style={{ gap: 6, marginBottom: 12 }}>
                <span style={{ fontSize: '1.6rem', fontWeight: 800, color: '#fff', letterSpacing: '-0.02em', lineHeight: 1 }}>
                    {usedLabel}
                </span>
                <span style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 600 }}>
                    of {totalLabel}
                </span>
            </div>

            <div style={{ height: 7, background: 'rgba(255,255,255,0.05)', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{
                    height: '100%',
                    width: unlimited ? '100%' : `${t.pct}%`,
                    background: t.bar,
                    transition: 'width 0.5s cubic-bezier(0.22, 1, 0.36, 1)'
                }} />
            </div>

            {/* Used · Free split — only meaningful for storage */}
            {!unlimited && (
                <div className="d-flex justify-content-between" style={{ marginTop: 10, fontSize: '0.74rem' }}>
                    <span className="d-flex align-items-center gap-2">
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: 'linear-gradient(135deg,#60a5fa,#3b82f6)' }} />
                        <span style={{ color: '#cbd5e1', fontWeight: 600 }}>{usedLabel}</span>
                        <span style={{ color: '#64748b' }}>used</span>
                    </span>
                    <span className="d-flex align-items-center gap-2">
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(148,163,184,0.25)' }} />
                        <span style={{ color: '#cbd5e1', fontWeight: 600 }}>{freeLabel}</span>
                        <span style={{ color: '#64748b' }}>free</span>
                    </span>
                </div>
            )}
        </div>
    );
}

// ─── Main component ─────────────────────────────────────────────────────

export default function PlanUsageCard() {
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState(null);
    const [err, setErr] = useState(null);

    useEffect(() => {
        let active = true;
        getMySubscription()
            .then(r => { if (active) setData(r.data); })
            .catch(e => { if (active) setErr(e.response?.data?.error || e.message); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    if (loading) {
        return (
            <div style={cardStyle}>
                <div style={{ height: 22, width: 180, background: 'rgba(255,255,255,0.06)', borderRadius: 6, marginBottom: 18 }} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 12 }}>
                    {TILE_RESOURCES.map(r => (
                        <div key={r.key} style={{ height: 116, background: 'rgba(255,255,255,0.03)', borderRadius: 14 }} />
                    ))}
                </div>
                <div style={{ height: 110, background: 'rgba(255,255,255,0.03)', borderRadius: 14 }} />
            </div>
        );
    }

    // Hide gracefully if the backend has no billing context (super admin etc).
    if (err || !data || !data.subscription) return null;

    const { subscription, usage } = data;
    const planName = subscription.plan_name || subscription.name || 'Free';
    const subInactive = ['cancelled', 'expired', 'past_due'].includes(subscription.status);

    const allInfos = TILE_RESOURCES.map(r => usage[r.key]).filter(Boolean);
    const anyOver = allInfos.some(i => tone(i).state === 'over') || (usage.storage && tone(usage.storage).state === 'over');
    const anyWarn = allInfos.some(i => tone(i).state === 'warn') || (usage.storage && tone(usage.storage).state === 'warn');

    return (
        <div style={cardStyle}>
            {/* Header strip */}
            <div className="d-flex justify-content-between align-items-center" style={{ marginBottom: 16 }}>
                <div className="d-flex align-items-center gap-3">
                    <div style={{
                        width: 38, height: 38, borderRadius: 10,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        background: 'linear-gradient(135deg, rgba(139,92,246,0.18), rgba(236,72,153,0.18))',
                        border: '1px solid rgba(139,92,246,0.25)'
                    }}>
                        <BsCheck2Circle size={18} style={{ color: '#a78bfa' }} />
                    </div>
                    <div>
                        <h6 style={{ fontWeight: 700, color: '#fff', margin: 0, marginBottom: 2, fontSize: '0.95rem', letterSpacing: '-0.01em' }}>
                            Plan usage
                        </h6>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                            {planName} plan{subscription.status === 'trial' ? ' · Trial' : ''}
                        </div>
                    </div>
                </div>
                {(anyWarn || anyOver) && (
                    <div className="d-flex align-items-center gap-1" style={{
                        background: anyOver ? 'rgba(239,68,68,0.12)' : 'rgba(245,158,11,0.12)',
                        color: anyOver ? '#ef4444' : '#f59e0b',
                        padding: '5px 11px', borderRadius: 999, fontSize: '0.7rem', fontWeight: 700,
                        border: `1px solid ${anyOver ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)'}`
                    }}>
                        <BsExclamationTriangleFill size={11} />
                        {anyOver ? 'Limit reached' : 'Approaching limit'}
                    </div>
                )}
            </div>

            {subInactive && (
                <div className="mb-3 p-2 d-flex align-items-center gap-2" style={{
                    background: 'rgba(239,68,68,0.08)', borderRadius: 10, border: '1px solid rgba(239,68,68,0.25)',
                    color: '#fca5a5', fontSize: '0.78rem'
                }}>
                    <BsExclamationTriangleFill />
                    Your subscription is {subscription.status}. Resource creation is blocked until you upgrade.
                </div>
            )}

            {/* Tile grid for count resources */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 12,
                marginBottom: usage.storage ? 12 : 0
            }}>
                {TILE_RESOURCES.map(r => {
                    const info = usage[r.key];
                    if (!info) return null;
                    return <StatTile key={r.key} resource={r} info={info} />;
                })}
            </div>

            {/* Storage gets its own row — MB unit, used/free split is worth the space */}
            {usage.storage && <StorageRow info={usage.storage} />}
        </div>
    );
}

const cardStyle = {
    background: 'var(--bg-card)',
    padding: 22,
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--border-subtle)',
    height: '100%'
};
