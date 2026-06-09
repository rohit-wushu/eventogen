import { useNavigate } from 'react-router-dom';
import { BsArrowUpRight, BsStars, BsExclamationTriangleFill, BsLockFill } from 'react-icons/bs';
import { useQuota } from '../hooks/useQuota';

// Header-corner upgrade pill. Calls /billing/subscription via the shared
// useQuota cache so it doesn't double-fetch with the PlanUsageCard below.
// Hides itself when:
//   • the user has no tenant (super admin)
//   • the current plan is Enterprise (already top tier)
//
// Tone escalates with quota pressure:
//   • subscription inactive  → red, "Reactivate plan"
//   • any resource at 100%   → red, "Plan limit reached"
//   • any resource ≥ 70% or low cushion → orange, "Approaching limit"
//   • otherwise              → subtle purple, "Upgrade plan" (still useful for upsell)
const RESOURCE_KEYS = ['events', 'speakers', 'attendees', 'users', 'storage'];

const isWarn = (info) => {
    if (!info || info.unlimited) return false;
    const pct = info.limit > 0 ? (info.used / info.limit) * 100 : 0;
    const remaining = Math.max(0, info.limit - info.used);
    const cushion = info.unit === 'MB' ? 100 : 3;
    return pct >= 70 || remaining <= cushion;
};
const isOver = (info) => info && !info.unlimited && info.used >= info.limit;

export default function UpgradeBanner() {
    const navigate = useNavigate();
    // Read each resource individually so the shared cache populates once.
    const events    = useQuota('events');
    const speakers  = useQuota('speakers');
    const attendees = useQuota('attendees');
    const users     = useQuota('users');
    const storage   = useQuota('storage');

    const sub = events.sub;
    if (events.loading) return null;
    if (!sub) return null;
    if (sub.plan_code === 'enterprise') return null;

    const all = [events.info, speakers.info, attendees.info, users.info, storage.info].filter(Boolean);
    const subInactive = ['cancelled', 'expired', 'past_due'].includes(sub.status);
    const anyOver = all.some(isOver);
    const anyWarn = all.some(isWarn);

    let tone, label, Icon;
    if (subInactive) {
        tone = 'danger';
        label = 'Reactivate plan';
        Icon = BsLockFill;
    } else if (anyOver) {
        tone = 'danger';
        label = 'Plan limit reached — upgrade';
        Icon = BsExclamationTriangleFill;
    } else if (anyWarn) {
        tone = 'warn';
        label = 'Approaching limit — upgrade';
        Icon = BsExclamationTriangleFill;
    } else {
        tone = 'subtle';
        label = `Upgrade from ${sub.plan_name || 'Free'}`;
        Icon = BsStars;
    }

    const styles = {
        danger: {
            background: 'linear-gradient(135deg,#ef4444,#dc2626)',
            shadow: '0 10px 24px rgba(239,68,68,0.35)',
            ring: 'rgba(239,68,68,0.45)'
        },
        warn: {
            background: 'linear-gradient(135deg,#f59e0b,#d97706)',
            shadow: '0 10px 24px rgba(245,158,11,0.32)',
            ring: 'rgba(245,158,11,0.45)'
        },
        subtle: {
            background: 'linear-gradient(135deg,#8b5cf6,#ec4899)',
            shadow: '0 8px 20px rgba(139,92,246,0.30)',
            ring: 'rgba(139,92,246,0.40)'
        }
    }[tone];

    return (
        <button
            type="button"
            onClick={() => navigate('/billing')}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 16px',
                border: 'none',
                borderRadius: 12,
                color: '#fff',
                fontWeight: 700,
                fontSize: '0.85rem',
                letterSpacing: '-0.005em',
                cursor: 'pointer',
                background: styles.background,
                boxShadow: styles.shadow,
                outline: `1px solid ${styles.ring}`,
                whiteSpace: 'nowrap',
                transition: 'transform 120ms ease, filter 120ms ease'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.08)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)'; e.currentTarget.style.transform = 'translateY(0)'; }}
        >
            <Icon />
            {label}
            <BsArrowUpRight />
        </button>
    );
}
