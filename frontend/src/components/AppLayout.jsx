import { useState, useEffect, useRef } from 'react';
import { NavLink, Outlet, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { Nav, Button, Modal, Form, Spinner, Alert } from 'react-bootstrap';
import { useAuth } from '../context/AuthContext';
import { getSettings, updateSetting, changePassword, getNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead, getMySubscription, getActiveAnnouncements } from '../services/api';
import { BsCalendarEvent, BsPeople, BsPersonBadge, BsBriefcase, BsListTask, BsSpeedometer2, BsBoxArrowRight, BsPeopleFill, BsAirplane, BsGear, BsPerson, BsKey, BsBell, BsSun, BsMoon, BsCheck2All, BsTrash, BsCircleFill, BsImages, BsTrophy, BsBuilding, BsCreditCard2Front, BsShieldLockFill, BsBarChart, BsReceipt, BsStars, BsMegaphone, BsList, BsCardChecklist, BsEnvelope, BsAward, BsTools, BsArchive } from 'react-icons/bs';
import { AnnouncementBanner } from '../pages/PlatformConsolePage';
import { getImageUrl } from '../utils/imageUrl';
import GlobalSearch from './GlobalSearch';
import ChatWidget from './ChatWidget';

const menuItems = [
    { path: '/dashboard', label: 'Dashboard', icon: BsSpeedometer2, roles: ['admin', 'manager', 'employee'] },
    { path: '/events', label: 'Events', icon: BsCalendarEvent, roles: ['admin', 'manager', 'employee'] },
    { path: '/speakers', label: 'Speakers', icon: BsPersonBadge, roles: ['admin', 'manager', 'employee'], section: 'speakers' },
    { path: '/partners', label: 'Partners', icon: BsBriefcase, roles: ['admin', 'manager', 'employee'], section: 'partners' },
    { path: '/awards', label: 'Awards', icon: BsTrophy, roles: ['admin', 'manager', 'employee'], section: 'awards' },
    { path: '/agendas', label: 'Agendas', icon: BsListTask, roles: ['admin', 'manager', 'employee'], section: 'agendas' },
    { path: '/attendees', label: 'Attendees', icon: BsPeopleFill, roles: ['admin', 'manager', 'employee'], section: 'attendees' },
    { path: '/forms', label: 'Forms', icon: BsCardChecklist, roles: ['admin', 'manager'] },
    { path: '/travel', label: 'Travel', icon: BsAirplane, roles: ['admin', 'manager', 'employee'], section: 'travel' },
    { path: '/media', label: 'Media Library', icon: BsImages, roles: ['admin', 'manager', 'employee'], section: 'speakers' },
    { path: '/users', label: 'Users', icon: BsPeople, roles: ['admin', 'manager'] },
    { path: '/recycle-bin', label: 'Recycle Bin', icon: BsArchive, roles: ['admin', 'manager'] },
    { path: '/organization', label: 'Organization', icon: BsBuilding, roles: ['admin', 'manager'] },
    { path: '/billing', label: 'Billing', icon: BsReceipt, roles: ['admin', 'manager'] },
    { path: '/payment-settings', label: 'Payments', icon: BsCreditCard2Front, roles: ['admin'] },
    { path: '/settings', label: 'Settings', icon: BsGear, roles: ['admin'] },
];

const timeAgo = (dateStr) => {
    const now = new Date();
    const date = new Date(dateStr);
    const seconds = Math.floor((now - date) / 1000);
    if (seconds < 60) return 'Just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

const TOPBAR_COLORS = [
    { name: 'Purple', value: '#8b5cf6' },
    { name: 'Blue', value: '#0ea5e9' },
    { name: 'Pink', value: '#ec4899' },
    { name: 'Green', value: '#10b981' },
    { name: 'Orange', value: '#f59e0b' },
];

export default function AppLayout() {
    const { user, logout, pendingInvite, clearInvite, updateAuth } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [portalLogo, setPortalLogo] = useState('');
    const [logoWidth, setLogoWidth] = useState(36);
    const [showProfileMenu, setShowProfileMenu] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
    const [passwordMsg, setPasswordMsg] = useState({ type: '', text: '' });
    const [savingPassword, setSavingPassword] = useState(false);
    const profileRef = useRef(null);
    const bellRef = useRef(null);
    const toolsRef = useRef(null);
    const [showNotifications, setShowNotifications] = useState(false);
    const [showTools, setShowTools] = useState(false);

    // Esc closes the Tools launcher; lock body scroll while it's open so
    // the overlay always wins focus and the page underneath doesn't drift.
    useEffect(() => {
        if (!showTools) return;
        const onKey = (e) => { if (e.key === 'Escape') setShowTools(false); };
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', onKey);
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [showTools]);
    const [notifications, setNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [subStatus, setSubStatus] = useState(null);    // 'trial' | 'active' | 'past_due' | 'cancelled' | 'expired'
    const [trialDaysLeft, setTrialDaysLeft] = useState(null);
    const [announcements, setAnnouncements] = useState([]);
    // Dismissed announcement IDs are snoozed for 4 hours. Stored as
    // `{ [id]: dismissedAtMs }` in localStorage so it survives refresh /
    // new tabs, but the banner reappears after the window elapses.
    const DISMISS_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
    const readDismissedMap = () => {
        try { return JSON.parse(localStorage.getItem('announcements-dismissed') || '{}') || {}; }
        catch { return {}; }
    };
    const [dismissed, setDismissed] = useState(() => {
        const map = readDismissedMap();
        const now = Date.now();
        return Object.keys(map)
            .filter(id => now - map[id] < DISMISS_TTL_MS)
            .map(id => Number(id));
    });

    // Theme state (per-user)
    const userKey = user?.id || 'default';
    const [themeMode, setThemeMode] = useState(() => localStorage.getItem(`themeMode_${user?.id || 'default'}`) || 'dark');
    const [topbarColor, setTopbarColor] = useState(() => localStorage.getItem(`topbarColor_${user?.id || 'default'}`) || '#8b5cf6');

    useEffect(() => {
        getSettings().then(r => {
            if (r.data.portal_logo) setPortalLogo(r.data.portal_logo);
            if (r.data.portal_logo_width) setLogoWidth(parseInt(r.data.portal_logo_width, 10));
            if (r.data.site_title) document.title = r.data.site_title;
            if (r.data.meta_description) {
                let meta = document.querySelector('meta[name="description"]');
                if (!meta) {
                    meta = document.createElement('meta');
                    meta.name = 'description';
                    document.head.appendChild(meta);
                }
                meta.setAttribute('content', r.data.meta_description);
            }
            if (r.data.favicon) {
                let link = document.querySelector("link[rel~='icon']");
                if (!link) {
                    link = document.createElement('link');
                    link.rel = 'icon';
                    document.head.appendChild(link);
                }
                link.href = r.data.favicon;
            }
        }).catch(() => {});
    }, []);

    // Apply theme (per-user)
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', themeMode);
        localStorage.setItem(`themeMode_${userKey}`, themeMode);
    }, [themeMode, userKey]);

    useEffect(() => {
        document.documentElement.style.setProperty('--topbar-accent', topbarColor);
        localStorage.setItem(`topbarColor_${userKey}`, topbarColor);
    }, [topbarColor, userKey]);

    // Close dropdowns on outside click. Tools overlay is a full-screen
    // launcher, so we don't shrink it via outside-click here — the overlay
    // handles its own backdrop click. Esc closes it (handled below).
    useEffect(() => {
        const handleClick = (e) => {
            if (profileRef.current && !profileRef.current.contains(e.target)) setShowProfileMenu(false);
            if (bellRef.current && !bellRef.current.contains(e.target)) setShowNotifications(false);
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    // Close mobile sidebar on route change so nav tap dismisses the drawer.
    useEffect(() => { setSidebarOpen(false); }, [location.pathname]);

    // Fetch notifications
    const fetchNotifications = () => {
        getNotifications().then(r => setNotifications(Array.isArray(r.data) ? r.data : [])).catch(() => {});
        getUnreadCount().then(r => setUnreadCount(r.data?.count || 0)).catch(() => {});
    };

    useEffect(() => {
        fetchNotifications();
        const interval = setInterval(() => {
            // Don't waste requests on a backgrounded tab; we re-fetch
            // immediately when the user returns via the visibilitychange
            // handler below.
            if (document.hidden) return;
            fetchNotifications();
        }, 30000);
        const onVisible = () => { if (!document.hidden) fetchNotifications(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, []);

    // Fetch subscription status once on mount so the banner can render. Re-fetch
    // on window focus so a just-paid upgrade dismisses the banner without reload.
    // Super admins have no tenant subscription — skip entirely.
    useEffect(() => {
        if (user?.is_super_admin) return;
        const refresh = () => {
            getMySubscription().then(r => {
                const s = r.data?.subscription;
                if (!s) return;
                setSubStatus(s.status);
                if (s.status === 'trial' && s.trial_ends_at) {
                    setTrialDaysLeft(Math.max(0, Math.ceil((new Date(s.trial_ends_at) - Date.now()) / 86400000)));
                } else {
                    setTrialDaysLeft(null);
                }
            }).catch(() => {});
        };
        refresh();
        window.addEventListener('focus', refresh);
        return () => window.removeEventListener('focus', refresh);
    }, [user?.is_super_admin]);

    // Fetch platform-wide announcements. Every user sees them (not just tenant
    // admins), so this runs for anyone logged in — super admins included, so
    // they can preview what their audience sees.
    useEffect(() => {
        const refresh = () => {
            getActiveAnnouncements().then(r => setAnnouncements(r.data || [])).catch(() => {});
        };
        refresh();
        const interval = setInterval(() => {
            // Skip while tab is backgrounded — the focus listener below
            // refreshes the moment the user comes back.
            if (document.hidden) return;
            refresh();
        }, 5 * 60 * 1000);
        window.addEventListener('focus', refresh);
        return () => { clearInterval(interval); window.removeEventListener('focus', refresh); };
    }, []);

    const dismissAnnouncement = (id) => {
        const next = [...dismissed, id];
        setDismissed(next);
        // Persist with timestamp so the 4-hour window is measured from now.
        // Also prune expired entries so the map doesn't grow unbounded.
        const map = readDismissedMap();
        const now = Date.now();
        const pruned = Object.fromEntries(
            Object.entries(map).filter(([, ts]) => now - ts < DISMISS_TTL_MS)
        );
        pruned[id] = now;
        localStorage.setItem('announcements-dismissed', JSON.stringify(pruned));
    };

    const handleMarkRead = async (id) => {
        await markNotificationRead(id).catch(() => {});
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: 1 } : n));
        setUnreadCount(prev => Math.max(0, prev - 1));
    };

    const handleMarkAllRead = async () => {
        await markAllNotificationsRead().catch(() => {});
        setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })));
        setUnreadCount(0);
    };

    const handleAcceptInvite = async () => {
        try {
            const { acceptExistingInvite } = await import('../services/api');
            const res = await acceptExistingInvite();
            updateAuth(res.data.token, res.data.user);
            clearInvite();
            alert('Invitation accepted! Your role and assigned event have been updated.');
        } catch (err) { alert('Failed to accept invitation'); }
    };

    const handleDeclineInvite = async () => {
        if (window.confirm('Are you sure you want to decline this invitation?')) {
            try {
                const { declineInvite } = await import('../services/api');
                await declineInvite();
                clearInvite();
            } catch (err) { alert('Failed to decline invitation'); }
        }
    };

    const handleLogout = () => {
        logout();
        navigate('/login');
    };

    const handleChangePassword = async (e) => {
        e.preventDefault();
        setPasswordMsg({ type: '', text: '' });
        if (passwordForm.newPassword !== passwordForm.confirmPassword) {
            return setPasswordMsg({ type: 'danger', text: 'New passwords do not match' });
        }
        if (passwordForm.newPassword.length < 6) {
            return setPasswordMsg({ type: 'danger', text: 'Password must be at least 6 characters' });
        }
        setSavingPassword(true);
        try {
            await changePassword({
                currentPassword: passwordForm.currentPassword,
                newPassword: passwordForm.newPassword
            });
            setPasswordMsg({ type: 'success', text: 'Password changed successfully!' });
            setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
            setTimeout(() => setShowPasswordModal(false), 1500);
        } catch (err) {
            setPasswordMsg({ type: 'danger', text: err.response?.data?.error || 'Failed to change password' });
        } finally {
            setSavingPassword(false);
        }
    };

    // Super admins live entirely in the Platform Console. Any URL-typed attempt
    // to reach a tenant-scoped page bounces them back — their tenant_id is NULL
    // so those pages would render empty (or 500 on subscription fetch) anyway.
    // Kept AFTER all hooks so React's hook-order invariant isn't broken on the
    // first render where this returns <Navigate/>.
    if (user?.is_super_admin && !location.pathname.startsWith('/platform')) {
        return <Navigate to="/platform" replace />;
    }

    // Visible announcements = active (from server) minus the ones the current
    // user has dismissed for this session.
    const visibleAnnouncements = announcements.filter(a => !dismissed.includes(a.id));

    return (
        <div className="d-flex flex-column vh-100">
            {/* Platform-wide announcements — rendered first so they're the top banner. */}
            {visibleAnnouncements.map(a => (
                <AnnouncementBanner
                    key={a.id}
                    a={a}
                    onDismiss={a.dismissible ? () => dismissAnnouncement(a.id) : undefined}
                />
            ))}

            {/* Subscription banner — past due / cancelled / ending trial */}
            {(subStatus === 'past_due' || subStatus === 'cancelled' || subStatus === 'expired' || (subStatus === 'trial' && trialDaysLeft !== null && trialDaysLeft <= 3)) && (
                <div style={{
                    background: subStatus === 'trial'
                        ? 'linear-gradient(90deg, #f59e0b, #f97316)'
                        : 'linear-gradient(90deg, #ef4444, #dc2626)',
                    padding: '10px 24px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    boxShadow: '0 4px 15px rgba(0,0,0,0.2)', zIndex: 1001
                }}>
                    <div style={{ color: '#fff', fontSize: '0.85rem', fontWeight: 500 }}>
                        {subStatus === 'trial' && (
                            <>Trial ends in <strong>{trialDaysLeft} day{trialDaysLeft === 1 ? '' : 's'}</strong> — upgrade to keep your workspace active.</>
                        )}
                        {subStatus === 'past_due' && (
                            <>Your subscription payment is <strong>past due</strong>. New events, speakers, and attendees can't be added until you update billing.</>
                        )}
                        {subStatus === 'cancelled' && (
                            <>Your subscription is <strong>cancelled</strong>. Upgrade any plan to unlock writes again.</>
                        )}
                        {subStatus === 'expired' && (
                            <>Your subscription has <strong>expired</strong>. Upgrade any plan to unlock writes again.</>
                        )}
                    </div>
                    <Button size="sm" variant="light" style={{ fontWeight: 600, borderRadius: 8 }}
                        onClick={() => navigate('/billing')}>
                        Go to billing
                    </Button>
                </div>
            )}

            {/* Pending Invitation Banner */}
            {pendingInvite && (
                <div style={{
                    background: 'linear-gradient(90deg, var(--accent), var(--accent-pink))',
                    padding: '10px 24px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
                    zIndex: 1000
                }}>
                    <div style={{ color: '#fff', fontSize: '0.9rem', fontWeight: 500 }}>
                        You have a pending invitation to join as <strong style={{ textTransform: 'capitalize' }}>{pendingInvite.role}</strong> {pendingInvite.event_title && <>for event: <strong>{pendingInvite.event_title}</strong></>}
                        {pendingInvite.assigned_task && <div className="mt-1" style={{ fontSize: '0.75rem', opacity: 0.9 }}>Your Primary Task: <strong>{pendingInvite.assigned_task}</strong></div>}
                    </div>
                    <div className="d-flex gap-2">
                        <Button size="sm" variant="light" style={{ fontWeight: 600, borderRadius: 8 }} onClick={handleAcceptInvite}>Accept</Button>
                        <Button size="sm" variant="outline-light" style={{ fontWeight: 600, borderRadius: 8 }} onClick={handleDeclineInvite}>Decline</Button>
                    </div>
                </div>
            )}

            {/* Topbar - Full Width */}
            <div className="topbar d-flex align-items-center justify-content-between px-4 gap-3" style={{ height: 56, minHeight: 56, position: 'relative', zIndex: 100, width: '100%', maxWidth: '100vw', minWidth: 0 }}>
                <div className="d-flex align-items-center gap-2" style={{ flexShrink: 0, minWidth: 0 }}>
                    {!user?.is_super_admin && (
                        <button
                            type="button"
                            className="mobile-menu-btn"
                            onClick={() => setSidebarOpen(o => !o)}
                            aria-label="Toggle navigation"
                        >
                            <BsList size={22} />
                        </button>
                    )}
                    {portalLogo ? (
                        <img src={getImageUrl(portalLogo)} alt="Logo" className="topbar-logo" style={{ width: logoWidth, height: 'auto', maxHeight: 44, maxWidth: '100%', objectFit: 'contain', borderRadius: 6 }} />
                    ) : (
                        <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: '1rem', fontWeight: 700 }}>
                            Event Management System
                        </span>
                    )}
                </div>
                {!user?.is_super_admin && <GlobalSearch />}
                <div className="d-flex align-items-center gap-3" style={{ flexShrink: 0 }}>
                    <span className="topbar-date" style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.75rem' }}>
                        {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                    </span>

                    {/* Tools button — opens a full-screen launcher of admin
                        utilities. Also hidden when every tool inside is gated
                        off for this tenant, since an empty launcher is worse
                        than no entry point at all. */}
                    {!user?.is_super_admin && (user?.role === 'admin' || user?.role === 'manager') && user?.bulk_certificate_enabled !== false && (
                        <div
                            onClick={() => setShowTools(s => !s)}
                            title="Tools"
                            style={{
                                cursor: 'pointer', padding: '4px 8px',
                                display: 'flex', alignItems: 'center', gap: 6,
                                borderRadius: 8,
                                color: 'rgba(255,255,255,0.85)',
                                background: showTools ? 'rgba(255,255,255,0.12)' : 'transparent',
                                transition: 'background 0.15s',
                            }}
                            onMouseEnter={e => { if (!showTools) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                            onMouseLeave={e => { if (!showTools) e.currentTarget.style.background = 'transparent'; }}
                        >
                            <BsTools size={16} />
                            <BsList size={14} />
                        </div>
                    )}

                    {/* Notification Bell */}
                    <div ref={bellRef} style={{ position: 'relative' }}>
                        <div
                            onClick={() => { setShowNotifications(!showNotifications); if (!showNotifications) fetchNotifications(); }}
                            style={{ cursor: 'pointer', position: 'relative', padding: 4 }}
                        >
                            <BsBell size={18} style={{ color: 'rgba(255,255,255,0.7)' }} />
                            {unreadCount > 0 && (
                                <span style={{
                                    position: 'absolute', top: 0, right: 0,
                                    background: '#ef4444', color: '#fff', fontSize: '0.6rem',
                                    fontWeight: 700, borderRadius: '50%', width: 16, height: 16,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    border: '2px solid var(--topbar-accent)'
                                }}>{unreadCount > 9 ? '9+' : unreadCount}</span>
                            )}
                        </div>
                        {showNotifications && (
                            <div className="profile-dropdown" style={{
                                position: 'absolute', top: '100%', right: 0, marginTop: 8,
                                background: 'var(--bg-dropdown)', border: '1px solid var(--border-subtle)',
                                borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
                                zIndex: 9999, width: 340, overflow: 'hidden',
                                animation: 'fadeInUp 0.2s ease'
                            }}>
                                {/* Header */}
                                <div className="d-flex align-items-center justify-content-between" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)' }}>
                                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Notifications</span>
                                    {unreadCount > 0 && (
                                        <button onClick={handleMarkAllRead} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                                            <BsCheck2All size={14} /> Mark all read
                                        </button>
                                    )}
                                </div>
                                {/* List */}
                                <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                                    {notifications.length === 0 ? (
                                        <div style={{ padding: '30px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                                            No notifications yet
                                        </div>
                                    ) : notifications.map(n => (
                                        <div
                                            key={n.id}
                                            onClick={() => { if (!n.is_read) handleMarkRead(n.id); if (n.link) { navigate(n.link); setShowNotifications(false); } }}
                                            style={{
                                                padding: '12px 16px', cursor: 'pointer',
                                                borderBottom: '1px solid var(--border-subtle)',
                                                background: n.is_read ? 'transparent' : 'rgba(139,92,246,0.06)',
                                                transition: 'background 0.15s'
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(139,92,246,0.08)'}
                                            onMouseLeave={e => e.currentTarget.style.background = n.is_read ? 'transparent' : 'rgba(139,92,246,0.06)'}
                                        >
                                            <div className="d-flex align-items-start gap-3">
                                                {/* Avatar / Image */}
                                                <div style={{
                                                    width: 38, height: 38, borderRadius: 10, flexShrink: 0, overflow: 'hidden',
                                                    background: n.image_url ? 'transparent' : 'rgba(139,92,246,0.12)',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    color: 'var(--accent)', fontWeight: 700, fontSize: '0.85rem'
                                                }}>
                                                    {n.image_url ? (
                                                        <img src={getImageUrl(n.image_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    ) : (
                                                        (n.actor_name?.charAt(0) || n.title?.charAt(0) || '?').toUpperCase()
                                                    )}
                                                </div>
                                                {/* Content */}
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div className="d-flex align-items-center gap-1">
                                                        {!n.is_read && <BsCircleFill size={5} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                                                        <span style={{ fontWeight: n.is_read ? 500 : 700, fontSize: '0.82rem', color: 'var(--text-primary)' }}>{n.title}</span>
                                                    </div>
                                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.4, marginTop: 2 }}>{n.message}</div>
                                                    <div className="d-flex align-items-center gap-2" style={{ marginTop: 4 }}>
                                                        {n.actor_name && (
                                                            <span style={{ fontSize: '0.65rem', color: 'var(--accent)', fontWeight: 600 }}>by {n.actor_name}</span>
                                                        )}
                                                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{timeAgo(n.created_at)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    <div ref={profileRef} style={{ position: 'relative' }}>
                        <div
                            onClick={() => setShowProfileMenu(!showProfileMenu)}
                            style={{
                                width: 36, height: 36, borderRadius: '50%',
                                background: `linear-gradient(135deg, ${topbarColor}, ${topbarColor}cc)`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                color: '#fff', fontWeight: 700, fontSize: '0.85rem',
                                cursor: 'pointer', border: '2px solid rgba(255,255,255,0.2)',
                                transition: 'transform 0.2s'
                            }}
                        >
                            {user?.name?.charAt(0)?.toUpperCase()}
                        </div>
                        {showProfileMenu && (
                            <div className="profile-dropdown" style={{
                                position: 'absolute', top: '100%', right: 0, marginTop: 8,
                                background: 'var(--bg-dropdown)', border: '1px solid var(--border-subtle)',
                                borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,0.4)',
                                zIndex: 9999, width: 260, overflow: 'hidden',
                                animation: 'fadeInUp 0.2s ease'
                            }}>
                                <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border-subtle)' }}>
                                    <div className="d-flex align-items-center gap-2">
                                        <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>{user?.name}</span>
                                        <span className={`badge-premium role-${user?.role}`} style={{ fontSize: '0.6rem' }}>{user?.role}</span>
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{user?.email}</div>
                                </div>
                                <div style={{ padding: '6px' }}>
                                    <button className="profile-menu-item" onClick={() => { setShowProfileMenu(false); navigate('/settings'); }}>
                                        <BsPerson size={16} /> View Profile
                                    </button>
                                    <button className="profile-menu-item" onClick={() => { setShowProfileMenu(false); setShowPasswordModal(true); }}>
                                        <BsKey size={16} /> Change Password
                                    </button>
                                    <button className="profile-menu-item" onClick={() => { setShowProfileMenu(false); handleLogout(); }}>
                                        <BsBoxArrowRight size={16} /> Logout
                                    </button>
                                </div>
                                <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border-subtle)' }}>
                                    <div className="d-flex gap-2 justify-content-center align-items-center">
                                        {TOPBAR_COLORS.map(c => (
                                            <div
                                                key={c.value}
                                                onClick={() => setTopbarColor(c.value)}
                                                title={c.name}
                                                style={{
                                                    width: 28, height: 28, borderRadius: 6,
                                                    background: c.value, cursor: 'pointer',
                                                    border: topbarColor === c.value ? '2px solid #fff' : '2px solid transparent',
                                                    boxShadow: topbarColor === c.value ? `0 0 0 2px ${c.value}` : 'none',
                                                    transition: 'all 0.2s'
                                                }}
                                            />
                                        ))}
                                        {/* Custom color picker */}
                                        <label title="Pick custom color" style={{
                                            width: 28, height: 28, borderRadius: 6,
                                            background: `conic-gradient(red, yellow, lime, aqua, blue, magenta, red)`,
                                            cursor: 'pointer', position: 'relative', overflow: 'hidden',
                                            border: '2px solid rgba(255,255,255,0.3)',
                                            flexShrink: 0
                                        }}>
                                            <input
                                                type="color"
                                                value={topbarColor}
                                                onChange={(e) => setTopbarColor(e.target.value)}
                                                style={{
                                                    position: 'absolute', top: 0, left: 0,
                                                    width: '100%', height: '100%',
                                                    opacity: 0, cursor: 'pointer', border: 'none'
                                                }}
                                            />
                                        </label>
                                    </div>
                                </div>
                                <div style={{ padding: '10px 18px 14px', borderTop: '1px solid var(--border-subtle)' }}>
                                    <div className="d-flex align-items-center justify-content-center gap-2">
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>Light</span>
                                        <div
                                            onClick={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
                                            style={{
                                                width: 44, height: 24, borderRadius: 12,
                                                background: themeMode === 'dark' ? topbarColor : '#ccc',
                                                cursor: 'pointer', position: 'relative',
                                                transition: 'background 0.3s'
                                            }}
                                        >
                                            <div style={{
                                                width: 18, height: 18, borderRadius: '50%',
                                                background: '#fff', position: 'absolute',
                                                top: 3, left: themeMode === 'dark' ? 23 : 3,
                                                transition: 'left 0.3s',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                                            }}>
                                                {themeMode === 'dark' ? <BsMoon size={10} color="#333" /> : <BsSun size={10} color="#f59e0b" />}
                                            </div>
                                        </div>
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>Dark</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Sidebar + Content Row */}
            <div className="d-flex flex-grow-1 app-body-row" style={{ overflow: 'hidden' }}>
                {/* Dark overlay behind the drawer on mobile — tapping it dismisses the sidebar. */}
                {sidebarOpen && (
                    <div
                        className="sidebar-overlay"
                        onClick={() => setSidebarOpen(false)}
                        aria-hidden="true"
                    />
                )}
                <div className={`sidebar d-flex flex-column${sidebarOpen ? ' mobile-open' : ''}`} style={{ width: 250, minWidth: 250 }}>
                    <Nav className="flex-column p-3 flex-grow-1">
                        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '8px 14px 10px', marginBottom: 4 }}>
                            Navigation
                        </div>
                        {/* Super admins operate above any one tenant — they only get the
                            Platform Console. Tenant-scoped menus are hidden entirely so
                            they don't click into empty pages and get confused. */}
                        {!user?.is_super_admin && menuItems
                            .filter(item => item.roles.includes(user?.role || 'employee'))
                            .filter(item => {
                                // Per-employee section gate. Admins/managers always see everything;
                                // employees only see sections their permissions array allows.
                                // permissions = null/undefined ⇒ default full access.
                                if (user?.role !== 'employee') return true;
                                if (!item.section) return true;
                                if (user?.permissions == null) return true;
                                return Array.isArray(user.permissions) && user.permissions.includes(item.section);
                            })
                            .map(item => {
                                const Icon = item.icon;
                                const displayLabel = (item.path === '/users' && user?.role === 'manager') ? 'My Team' : item.label;
                                return (
                                    <Nav.Link
                                        as={NavLink}
                                        to={item.path}
                                        key={item.path}
                                        className="d-flex align-items-center gap-3"
                                    >
                                        <Icon size={16} /> {displayLabel}
                                    </Nav.Link>
                                );
                            })}

                        {user?.is_super_admin && (
                            <>
                                <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '8px 14px 10px', marginBottom: 4 }}>
                                    Platform
                                </div>
                                <Nav.Link as={NavLink} to="/platform/dashboard" className="d-flex align-items-center gap-3">
                                    <BsBarChart size={16} /> Dashboard
                                </Nav.Link>
                                <Nav.Link as={NavLink} to="/platform/organizations" className="d-flex align-items-center gap-3">
                                    <BsBuilding size={16} /> Organizations
                                </Nav.Link>
                                <Nav.Link as={NavLink} to="/platform/invoices" className="d-flex align-items-center gap-3">
                                    <BsReceipt size={16} /> Invoices
                                </Nav.Link>
                                <Nav.Link as={NavLink} to="/platform/plans" className="d-flex align-items-center gap-3">
                                    <BsStars size={16} /> Plans
                                </Nav.Link>
                                <Nav.Link as={NavLink} to="/platform/announcements" className="d-flex align-items-center gap-3">
                                    <BsMegaphone size={16} /> Announcements
                                </Nav.Link>
                            </>
                        )}
                    </Nav>
                </div>
                <div className="flex-grow-1 d-flex flex-column" style={{ background: 'var(--bg-primary)', overflow: 'hidden', minWidth: 0 }}>
                    <div className="content-area flex-grow-1 p-4" style={{ overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}>
                        <Outlet />
                    </div>
                </div>
            </div>

            {!user?.is_super_admin && <ChatWidget />}

            {/* ── Tools full-screen launcher ─────────────────────────
                A premium app-launcher overlay that takes the entire viewport
                with a staggered tile entrance animation. Backdrop blur +
                radial gradient sets the stage; tiles scale-in with a tiny
                stagger so the grid feels alive. Esc closes; outside click
                closes; tile hover lifts. */}
            {!user?.is_super_admin && (user?.role === 'admin' || user?.role === 'manager') && user?.bulk_certificate_enabled !== false && showTools && (
                <div
                    ref={toolsRef}
                    onClick={(e) => { if (e.target === e.currentTarget) setShowTools(false); }}
                    style={{
                        position: 'fixed', inset: 0,
                        zIndex: 1600,
                        display: 'flex', flexDirection: 'column',
                        background: `
                            radial-gradient(1200px 800px at 30% 20%, rgba(139,92,246,0.22), transparent 60%),
                            radial-gradient(900px 700px at 80% 80%, rgba(236,72,153,0.18), transparent 60%),
                            rgba(8, 11, 25, 0.94)`,
                        backdropFilter: 'blur(18px)',
                        WebkitBackdropFilter: 'blur(18px)',
                        animation: 'toolsBackdropIn 0.4s cubic-bezier(0.22, 1, 0.36, 1)',
                        // Establish a 3D space so child rotateX/rotateY have
                        // real perspective foreshortening, not flat skew.
                        perspective: '1400px',
                        transformStyle: 'preserve-3d',
                    }}
                >
                    {/* Top bar inside the overlay */}
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '22px 32px',
                        animation: 'toolsHeaderIn3D 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.05s both',
                    }}>
                        <div className="d-flex align-items-center gap-3">
                            <div style={{
                                width: 44, height: 44, borderRadius: 12,
                                background: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
                                display: 'grid', placeItems: 'center',
                                boxShadow: '0 12px 32px -10px rgba(139,92,246,0.7)',
                            }}>
                                <BsTools size={20} style={{ color: '#fff' }} />
                            </div>
                            <div>
                                <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', fontWeight: 700 }}>
                                    Utilities
                                </div>
                                <div style={{ fontWeight: 800, fontSize: '1.4rem', color: '#fff', letterSpacing: '-0.01em' }}>
                                    Tools
                                </div>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowTools(false)}
                            title="Close (Esc)"
                            style={{
                                width: 42, height: 42, borderRadius: 12,
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.14)',
                                color: '#fff', cursor: 'pointer',
                                display: 'grid', placeItems: 'center',
                                transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.transform = 'rotate(90deg)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.transform = 'rotate(0deg)'; }}
                        >
                            <span style={{ fontSize: 22, lineHeight: 1, fontWeight: 300 }}>×</span>
                        </button>
                    </div>

                    {/* Hero copy */}
                    <div style={{
                        textAlign: 'center', padding: '20px 24px 36px',
                        animation: 'toolsHeroIn3D 0.8s cubic-bezier(0.22, 1, 0.36, 1) 0.18s both',
                    }}>
                        <div style={{
                            display: 'inline-block',
                            fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase',
                            color: 'rgba(255,255,255,0.55)', fontWeight: 700,
                            padding: '6px 14px', borderRadius: 999,
                            border: '1px solid rgba(255,255,255,0.14)',
                            background: 'rgba(255,255,255,0.04)',
                        }}>
                            Pick a tool to get started
                        </div>
                        <h2 style={{
                            margin: '14px 0 0',
                            fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 800,
                            color: '#fff', letterSpacing: '-0.02em',
                            background: 'linear-gradient(135deg, #fff, #c7d2fe 60%, #fbcfe8)',
                            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
                        }}>
                            What would you like to do?
                        </h2>
                    </div>

                    {/* Tile grid */}
                    <div style={{
                        flex: 1, overflowY: 'auto',
                        padding: '0 32px 40px',
                        display: 'flex', justifyContent: 'center',
                    }}>
                        <div style={{
                            display: 'grid', gap: 20,
                            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 360px))',
                            width: '100%', maxWidth: 1140,
                            justifyContent: 'center',
                            alignContent: 'start',
                        }}>
                            {[
                                {
                                    label: 'Bulk Certificate',
                                    desc: 'Design once, generate hundreds of branded certificates for your attendees.',
                                    icon: BsAward,
                                    accent: 'linear-gradient(135deg, #8b5cf6, #ec4899)',
                                    glow: 'rgba(139,92,246,0.45)',
                                    path: '/tools/bulk-certificate',
                                    badge: 'New',
                                },
                            ].map((tool, idx) => {
                                const Icon = tool.icon;
                                const active = location.pathname === tool.path;
                                return (
                                    <div
                                        key={tool.path}
                                        onClick={() => { setShowTools(false); navigate(tool.path); }}
                                        className="tools-tile"
                                        style={{
                                            position: 'relative', cursor: 'pointer',
                                            padding: '28px 24px 22px',
                                            borderRadius: 22,
                                            background: 'linear-gradient(160deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
                                            border: active ? '1px solid rgba(139,92,246,0.6)' : '1px solid rgba(255,255,255,0.10)',
                                            boxShadow: active
                                                ? `0 20px 60px -18px ${tool.glow}`
                                                : '0 18px 46px -22px rgba(0,0,0,0.6)',
                                            transition: 'transform 0.35s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.3s ease, background 0.25s ease, border-color 0.25s ease',
                                            animation: `toolsTileIn3D 0.9s cubic-bezier(0.22, 1, 0.36, 1) ${0.32 + idx * 0.1}s both`,
                                            overflow: 'hidden',
                                            minHeight: 230,
                                            display: 'flex', flexDirection: 'column',
                                        }}
                                    >
                                        {/* corner glow */}
                                        <div style={{
                                            position: 'absolute', top: -50, right: -50,
                                            width: 170, height: 170, borderRadius: '50%',
                                            background: tool.accent, opacity: 0.22,
                                            filter: 'blur(36px)', pointerEvents: 'none',
                                        }} />
                                        {/* hairline highlight along the top edge */}
                                        <div style={{
                                            position: 'absolute', top: 0, left: 24, right: 24, height: 1,
                                            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)',
                                            pointerEvents: 'none',
                                        }} />
                                        {tool.badge && (
                                            <div style={{
                                                position: 'absolute', top: 18, right: 18,
                                                padding: '4px 10px', borderRadius: 999,
                                                fontSize: 10, fontWeight: 800, letterSpacing: '0.1em',
                                                textTransform: 'uppercase',
                                                background: 'rgba(16,185,129,0.18)',
                                                color: '#34d399',
                                                border: '1px solid rgba(16,185,129,0.35)',
                                            }}>{tool.badge}</div>
                                        )}
                                        <div style={{
                                            width: 58, height: 58, borderRadius: 16,
                                            background: tool.accent,
                                            display: 'grid', placeItems: 'center',
                                            boxShadow: `0 14px 30px -10px ${tool.glow}`,
                                            marginBottom: 20,
                                        }}>
                                            <Icon size={26} style={{ color: '#fff' }} />
                                        </div>
                                        <div style={{ fontWeight: 800, fontSize: '1.15rem', color: '#fff', marginBottom: 8, letterSpacing: '-0.01em' }}>
                                            {tool.label}
                                        </div>
                                        <div style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.62)', lineHeight: 1.55, flex: 1 }}>
                                            {tool.desc}
                                        </div>
                                        <div style={{
                                            marginTop: 18, paddingTop: 14,
                                            borderTop: '1px solid rgba(255,255,255,0.12)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        }}>
                                            <span style={{
                                                fontSize: '0.82rem', fontWeight: 700, color: '#fff',
                                                letterSpacing: '0.02em',
                                            }}>
                                                Open tool
                                            </span>
                                            <span className="tools-arrow" style={{
                                                width: 32, height: 32, borderRadius: '50%',
                                                background: 'rgba(255,255,255,0.12)',
                                                border: '1px solid rgba(255,255,255,0.18)',
                                                color: '#fff', fontSize: 16, fontWeight: 700,
                                                display: 'grid', placeItems: 'center',
                                                transition: 'transform 0.25s ease, background 0.2s ease',
                                            }}>→</span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div style={{
                        textAlign: 'center', padding: '14px 20px 24px',
                        fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.06em',
                        animation: 'toolsHeroIn3D 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.55s both',
                    }}>
                        Press <kbd style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 4, padding: '1px 6px', color: '#fff', fontSize: 10 }}>Esc</kbd> to close
                    </div>

                    {/* Local keyframes — scoped to this overlay so they don't
                        leak into the rest of the app. Uses perspective +
                        rotateX/Y/Z so the entrance reads as truly 3D. */}
                    <style>{`
                        @keyframes toolsBackdropIn {
                            from { opacity: 0; }
                            to   { opacity: 1; }
                        }
                        /* Header drops into place from above, tilting like a
                           sign being lowered onto a desk. */
                        @keyframes toolsHeaderIn3D {
                            from {
                                opacity: 0;
                                transform: perspective(1200px) translateY(-32px) rotateX(-25deg);
                                transform-origin: top center;
                            }
                            to {
                                opacity: 1;
                                transform: perspective(1200px) translateY(0) rotateX(0deg);
                                transform-origin: top center;
                            }
                        }
                        /* Hero copy floats forward from deeper in the scene. */
                        @keyframes toolsHeroIn3D {
                            from {
                                opacity: 0;
                                transform: perspective(1200px) translateZ(-160px) translateY(28px) rotateX(12deg);
                            }
                            to {
                                opacity: 1;
                                transform: perspective(1200px) translateZ(0) translateY(0) rotateX(0deg);
                            }
                        }
                        /* Tiles flip in like cards being dealt — start tilted
                           on X+Y, deep in Z, and rotate to neutral at rest. */
                        @keyframes toolsTileIn3D {
                            0% {
                                opacity: 0;
                                transform: perspective(1400px)
                                           rotateX(45deg) rotateY(-20deg)
                                           translateZ(-220px) translateY(60px);
                                filter: blur(8px);
                            }
                            55% {
                                opacity: 1;
                                filter: blur(0);
                            }
                            80% {
                                transform: perspective(1400px)
                                           rotateX(-4deg) rotateY(2deg)
                                           translateZ(20px) translateY(-4px);
                            }
                            100% {
                                opacity: 1;
                                transform: perspective(1400px)
                                           rotateX(0deg) rotateY(0deg)
                                           translateZ(0) translateY(0);
                                filter: blur(0);
                            }
                        }
                        .tools-tile {
                            transform-style: preserve-3d;
                        }
                        .tools-tile:hover {
                            background: linear-gradient(160deg, rgba(255,255,255,0.09), rgba(255,255,255,0.03)) !important;
                            border-color: rgba(255,255,255,0.18) !important;
                            transform: translateY(-4px) !important;
                            box-shadow: 0 28px 60px -22px rgba(139,92,246,0.55) !important;
                        }
                        .tools-tile:hover .tools-arrow {
                            transform: translateX(4px);
                            background: rgba(255,255,255,0.22) !important;
                        }
                    `}</style>
                </div>
            )}

            {/* Change Password Modal */}
            <Modal show={showPasswordModal} onHide={() => { setShowPasswordModal(false); setPasswordMsg({ type: '', text: '' }); }} centered contentClassName="premium-modal">
                <Modal.Header closeButton>
                    <Modal.Title>Change Password</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {passwordMsg.text && <Alert variant={passwordMsg.type} className="mb-3">{passwordMsg.text}</Alert>}
                    <Form onSubmit={handleChangePassword}>
                        <Form.Group className="mb-3">
                            <Form.Label className="small" style={{ color: 'var(--text-secondary)' }}>Current Password</Form.Label>
                            <Form.Control
                                type="password"
                                className="form-control-dark"
                                value={passwordForm.currentPassword}
                                onChange={e => setPasswordForm(p => ({ ...p, currentPassword: e.target.value }))}
                                required
                            />
                        </Form.Group>
                        <Form.Group className="mb-3">
                            <Form.Label className="small" style={{ color: 'var(--text-secondary)' }}>New Password</Form.Label>
                            <Form.Control
                                type="password"
                                className="form-control-dark"
                                value={passwordForm.newPassword}
                                onChange={e => setPasswordForm(p => ({ ...p, newPassword: e.target.value }))}
                                required
                            />
                        </Form.Group>
                        <Form.Group className="mb-4">
                            <Form.Label className="small" style={{ color: 'var(--text-secondary)' }}>Confirm New Password</Form.Label>
                            <Form.Control
                                type="password"
                                className="form-control-dark"
                                value={passwordForm.confirmPassword}
                                onChange={e => setPasswordForm(p => ({ ...p, confirmPassword: e.target.value }))}
                                required
                            />
                        </Form.Group>
                        <Button type="submit" className="btn-accent w-100" disabled={savingPassword}>
                            {savingPassword ? <Spinner size="sm" /> : 'Update Password'}
                        </Button>
                    </Form>
                </Modal.Body>
            </Modal>
        </div>
    );
}
