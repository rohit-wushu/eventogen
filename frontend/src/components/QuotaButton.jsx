import { useNavigate } from 'react-router-dom';
import { Button } from 'react-bootstrap';
import { BsLock, BsExclamationTriangleFill } from 'react-icons/bs';
import { useQuota } from '../hooks/useQuota';

// Drop-in replacement for "Add X" buttons. Renders:
//   • The original button when the tenant is comfortably under the limit
//   • The button + small "X / Y used" badge when ≥ 75%
//   • A disabled button + "Upgrade plan" link when at 100% OR sub is inactive
//
// Props mirror react-bootstrap <Button>; `resource` is one of
// 'events' / 'speakers' / 'attendees' / 'users' / 'storage'.
export default function QuotaButton({ resource, children, onClick, className = '', ...rest }) {
    const navigate = useNavigate();
    const { info, sub, loading } = useQuota(resource);

    // No tenant context (super admin etc) — pass through silently.
    if (loading || !info) {
        return <Button className={className} onClick={onClick} {...rest}>{children}</Button>;
    }

    const subInactive = sub && ['cancelled', 'expired', 'past_due'].includes(sub.status);
    const pct = info.unlimited || info.limit <= 0 ? 0 : Math.min(100, Math.round((info.used / info.limit) * 100));
    const atLimit = !info.unlimited && info.used >= info.limit;
    // Same hybrid threshold as the dashboard PlanUsageCard — pct ≥ 70% OR
    // remaining ≤ 3 catches the "3 events left" case the dashboard pct rule misses.
    const remaining = info.unlimited ? Infinity : Math.max(0, info.limit - info.used);
    const cushion = info.unit === 'MB' ? 100 : 3;
    const warn = !info.unlimited && !atLimit && (pct >= 70 || remaining <= cushion);

    if (atLimit || subInactive) {
        return (
            <div className="d-flex align-items-center gap-2">
                <Button
                    className={className}
                    disabled
                    style={{ opacity: 0.6, cursor: 'not-allowed' }}
                    title={subInactive ? 'Subscription inactive — upgrade to continue' : `Plan limit reached (${info.used}/${info.limit})`}
                    {...rest}
                >
                    <BsLock className="me-1" /> {children}
                </Button>
                <button
                    type="button"
                    onClick={() => navigate('/billing')}
                    style={{
                        background: 'linear-gradient(135deg,#ef4444,#dc2626)',
                        color: '#fff', border: 'none', padding: '7px 12px',
                        borderRadius: 10, fontSize: '0.8rem', fontWeight: 700,
                        boxShadow: '0 6px 14px rgba(239,68,68,0.30)', cursor: 'pointer',
                        whiteSpace: 'nowrap'
                    }}
                >
                    Upgrade plan
                </button>
            </div>
        );
    }

    return (
        <div className="d-flex align-items-center gap-2">
            <Button className={className} onClick={onClick} {...rest}>{children}</Button>
            {!info.unlimited && (
                <span
                    onClick={warn ? () => navigate('/billing') : undefined}
                    title={warn ? `Approaching limit — click to upgrade` : `${info.used} of ${info.limit} used`}
                    style={{
                        fontSize: '0.72rem', fontWeight: 700,
                        padding: '4px 8px', borderRadius: 999,
                        whiteSpace: 'nowrap',
                        cursor: warn ? 'pointer' : 'default',
                        background: warn ? 'rgba(245,158,11,0.12)' : 'rgba(148,163,184,0.10)',
                        color: warn ? '#f59e0b' : '#94a3b8',
                        border: `1px solid ${warn ? 'rgba(245,158,11,0.3)' : 'rgba(148,163,184,0.2)'}`,
                        display: 'inline-flex', alignItems: 'center', gap: 4
                    }}
                >
                    {warn && <BsExclamationTriangleFill size={10} />}
                    {info.used}/{info.limit}
                </span>
            )}
        </div>
    );
}
