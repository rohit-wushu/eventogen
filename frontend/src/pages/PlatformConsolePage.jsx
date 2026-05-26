import { useEffect, useState } from 'react';
import { Spinner, Alert, Badge, Table, Button, Modal, Form } from 'react-bootstrap';
import {
    getPlatformStats, getPlatformTenants, getPlatformTenant,
    updatePlatformTenant, deletePlatformTenant, resetPlatformUserPassword,
    extendTenantTrial, suspendTenant, activateTenant, changeTenantPlan, updateTenantFeatures,
    getPlatformInvoices, getPlatformPlans, createPlatformPlan, updatePlatformPlan, deletePlatformPlan,
    getPlatformAnalytics, getPlatformAnnouncements, createPlatformAnnouncement,
    updatePlatformAnnouncement, deletePlatformAnnouncement, uploadAnnouncementPoster
} from '../services/api';
import { getImageUrl } from '../utils/imageUrl';
import {
    BsShieldLockFill, BsBuilding, BsReceipt, BsBarChart, BsStars,
    BsCurrencyRupee, BsPeople, BsClockHistory, BsPauseCircle,
    BsPlayCircle, BsPencilSquare, BsCalendarEvent, BsMegaphone,
    BsKey, BsCheckCircleFill, BsEye, BsEyeSlash,
    BsGraphUpArrow, BsTrash, BsPlusLg, BsBellFill, BsAward
} from 'react-icons/bs';
import {
    LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, Legend
} from 'recharts';

// Common page shell — each platform page renders its own section with a
// consistent header. The sidebar carries the navigation now, not tabs.
function PageShell({ icon: Icon, title, children }) {
    return (
        <div className="animate-in" style={{ padding: 8 }}>
            <div className="d-flex align-items-center gap-2 mb-3">
                <Icon size={22} style={{ color: 'var(--accent)' }} />
                <h4 className="m-0" style={{ color: 'var(--text-primary)' }}>{title}</h4>
                <Badge bg="danger" className="ms-2">Super Admin</Badge>
            </div>
            {children}
        </div>
    );
}

export function PlatformDashboardPage() {
    return <PageShell icon={BsBarChart} title="Platform Dashboard"><DashboardTab /></PageShell>;
}
export function PlatformOrganizationsPage() {
    return <PageShell icon={BsBuilding} title="Organizations"><OrganizationsTab /></PageShell>;
}
export function PlatformInvoicesPage() {
    return <PageShell icon={BsReceipt} title="All Invoices"><InvoicesTab /></PageShell>;
}
export function PlatformPlansPage() {
    return <PageShell icon={BsStars} title="Plans"><PlansTab /></PageShell>;
}
export function PlatformAnnouncementsPage() {
    return <PageShell icon={BsMegaphone} title="Announcements"><AnnouncementsTab /></PageShell>;
}

// Kept as the default export for backwards compat if anything else imports it.
export default PlatformDashboardPage;

// ───────────────── Dashboard ─────────────────
function DashboardTab() {
    const [stats, setStats] = useState(null);
    const [analytics, setAnalytics] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Fire both in parallel so the dashboard paints in one pass.
        Promise.allSettled([getPlatformStats(), getPlatformAnalytics()])
            .then(([statsRes, analyticsRes]) => {
                if (statsRes.status === 'fulfilled') setStats(statsRes.value.data);
                if (analyticsRes.status === 'fulfilled') setAnalytics(analyticsRes.value.data);
            })
            .finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="p-5 text-center"><Spinner animation="border" /></div>;
    if (!stats) return <Alert variant="danger">Failed to load stats</Alert>;

    const kpis = [
        { icon: BsBuilding, label: 'Total tenants', value: stats.tenants.total_tenants, hint: `${stats.tenants.active_tenants} active · ${stats.tenants.trial_tenants} on trial` },
        { icon: BsCurrencyRupee, label: 'Monthly recurring revenue', value: `₹${Number(stats.mrr_inr).toLocaleString('en-IN')}`, hint: 'from active paid subscriptions' },
        { icon: BsReceipt, label: 'Invoices', value: stats.invoices.total_invoices, hint: `${stats.invoices.paid_count} paid · ${stats.invoices.stub_count} dev-stub` },
        { icon: BsPeople, label: 'Total users', value: stats.users.total_users, hint: `${stats.users.super_admins} super admin(s)` },
    ];

    return (
        <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 20 }}>
                {kpis.map((k, i) => (
                    <div key={i} className="premium-card p-3">
                        <div className="d-flex align-items-center gap-2" style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            <k.icon /> {k.label}
                        </div>
                        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', marginTop: 6 }}>
                            {k.value}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{k.hint}</div>
                    </div>
                ))}
            </div>

            {/* 12-month revenue chart — headline chart. Area chart reads as a
                "growth curve" more than a line, so it's the dashboard hero. */}
            {analytics && (
                <div className="premium-card p-3 mb-3">
                    <div className="d-flex justify-content-between align-items-end mb-3">
                        <div>
                            <div className="d-flex align-items-center gap-2" style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                <BsGraphUpArrow /> Revenue trend
                            </div>
                            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}>
                                ₹{Number(analytics.totals.total_revenue_inr).toLocaleString('en-IN')}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>last 12 months</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                Peak month
                            </div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>
                                ₹{Number(analytics.totals.peak_month_revenue).toLocaleString('en-IN')}
                            </div>
                        </div>
                    </div>
                    <ResponsiveContainer width="100%" height={220}>
                        <AreaChart data={analytics.months} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                            <defs>
                                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.5} />
                                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                            <XAxis dataKey="label" stroke="var(--text-muted)" tick={{ fontSize: 11 }} />
                            <YAxis stroke="var(--text-muted)" tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${v / 1000}k` : v} />
                            <Tooltip contentStyle={chartTooltipStyle} formatter={(v) => [`₹${Number(v).toLocaleString('en-IN')}`, 'Revenue']} />
                            <Area type="monotone" dataKey="revenue_inr" stroke="#8b5cf6" strokeWidth={2.5} fill="url(#revGrad)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* Signups + churn paired — bar + line, same width. Complementary
                operational metrics (top-of-funnel vs. leakage). */}
            {analytics && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 14, marginBottom: 14 }}>
                    <div className="premium-card p-3">
                        <div className="d-flex justify-content-between align-items-center mb-2">
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                New signups
                            </div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent-emerald)' }}>
                                {analytics.totals.total_signups}
                            </div>
                        </div>
                        <ResponsiveContainer width="100%" height={160}>
                            <BarChart data={analytics.months} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                                <XAxis dataKey="label" stroke="var(--text-muted)" tick={{ fontSize: 10 }} />
                                <YAxis stroke="var(--text-muted)" tick={{ fontSize: 10 }} allowDecimals={false} />
                                <Tooltip contentStyle={chartTooltipStyle} />
                                <Bar dataKey="signups" fill="#10b981" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="premium-card p-3">
                        <div className="d-flex justify-content-between align-items-center mb-2">
                            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                Churn (cancellations)
                            </div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: '#f87171' }}>
                                {analytics.totals.total_churn}
                            </div>
                        </div>
                        <ResponsiveContainer width="100%" height={160}>
                            <LineChart data={analytics.months} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                                <XAxis dataKey="label" stroke="var(--text-muted)" tick={{ fontSize: 10 }} />
                                <YAxis stroke="var(--text-muted)" tick={{ fontSize: 10 }} allowDecimals={false} />
                                <Tooltip contentStyle={chartTooltipStyle} />
                                <Line type="monotone" dataKey="churn" stroke="#ef4444" strokeWidth={2.5} dot={{ r: 3, fill: '#ef4444' }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}

            <div className="premium-card p-3 mb-3">
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                    Plan distribution
                </div>
                {stats.plan_distribution.map(p => (
                    <div key={p.code} className="d-flex justify-content-between align-items-center" style={{ padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }}>
                        <span style={{ color: 'var(--text-primary)' }}>{p.name}</span>
                        <Badge bg="secondary">{p.tenant_count} tenants</Badge>
                    </div>
                ))}
            </div>

            <div className="premium-card p-3" style={{ background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1), rgba(236, 72, 153, 0.05))' }}>
                <div className="d-flex align-items-center gap-2 mb-2" style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    <BsCurrencyRupee /> Total revenue collected
                </div>
                <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--accent)' }}>
                    ₹{Number(stats.invoices.total_revenue_inr).toLocaleString('en-IN')}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    Across {stats.invoices.paid_count} paid invoices (excludes dev-stub entries)
                </div>
            </div>
        </div>
    );
}

// Recharts tooltip styling — dark, borderless, matches the premium-card look.
const chartTooltipStyle = {
    background: '#0f0f1f',
    border: '1px solid var(--border-subtle)',
    borderRadius: 8,
    fontSize: 12,
    color: 'var(--text-primary)',
    padding: '8px 10px'
};

// ───────────────── Organizations tab ─────────────────
function OrganizationsTab() {
    const [tenants, setTenants] = useState([]);
    const [loading, setLoading] = useState(true);
    const [detail, setDetail] = useState(null);
    const [busy, setBusy] = useState(null);

    const load = () => {
        setLoading(true);
        getPlatformTenants().then(r => setTenants(r.data)).finally(() => setLoading(false));
    };
    useEffect(load, []);

    const openDetail = async (id) => {
        try {
            const r = await getPlatformTenant(id);
            setDetail(r.data);
        } catch {}
    };

    const act = async (id, fn, ...args) => {
        setBusy(id);
        try {
            await fn(id, ...args);
            load();
            if (detail?.tenant?.id === id) openDetail(id);
        } finally { setBusy(null); }
    };

    if (loading) return <div className="p-5 text-center"><Spinner animation="border" /></div>;

    return (
        <div>
            <div className="premium-card p-0" style={{ overflow: 'hidden' }}>
                <Table hover responsive className="mb-0" style={{ color: 'var(--text-primary)' }}>
                    <thead>
                        <tr style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
                            <th style={{ border: 'none', padding: '12px 16px' }}>Organization</th>
                            <th style={{ border: 'none', padding: '12px 16px' }}>Admin</th>
                            <th style={{ border: 'none', padding: '12px 16px' }}>Plan</th>
                            <th style={{ border: 'none', padding: '12px 16px' }}>Status</th>
                            <th style={{ border: 'none', padding: '12px 16px', textAlign: 'center' }}>Users</th>
                            <th style={{ border: 'none', padding: '12px 16px', textAlign: 'center' }}>Events</th>
                            <th style={{ border: 'none', padding: '12px 16px', textAlign: 'right' }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {tenants.map(t => (
                            <tr key={t.id} style={{ fontSize: 13 }}>
                                <td style={{ padding: '12px 16px' }}>
                                    <div style={{ fontWeight: 600 }}>{t.name}</div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                        joined {new Date(t.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                    </div>
                                </td>
                                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
                                    {t.admin_name || '—'}<br />{t.admin_email || ''}
                                </td>
                                <td style={{ padding: '12px 16px' }}>
                                    <Badge bg={t.plan_code === 'enterprise' ? 'primary' : t.plan_code === 'pro' ? 'info' : 'secondary'}>
                                        {t.plan_name || '—'}
                                    </Badge>
                                    {t.price_inr > 0 && (
                                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                                            ₹{Number(t.price_inr).toLocaleString('en-IN')}/mo
                                        </div>
                                    )}
                                </td>
                                <td style={{ padding: '12px 16px' }}>
                                    <Badge bg={
                                        t.sub_status === 'active' ? 'success' :
                                        t.sub_status === 'trial' ? 'warning' :
                                        t.tenant_status === 'suspended' ? 'danger' :
                                        'secondary'
                                    } text={t.sub_status === 'trial' ? 'dark' : undefined}>
                                        {t.tenant_status === 'suspended' ? 'suspended' : (t.sub_status || t.tenant_status)}
                                    </Badge>
                                </td>
                                <td style={{ padding: '12px 16px', textAlign: 'center' }}>{t.user_count}</td>
                                <td style={{ padding: '12px 16px', textAlign: 'center' }}>{t.event_count}</td>
                                <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                                    <Button size="sm" className="btn-accent" onClick={() => openDetail(t.id)}>
                                        Manage
                                    </Button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </Table>
            </div>

            <OrganizationDetailModal
                detail={detail}
                onHide={() => setDetail(null)}
                busy={busy}
                onRefresh={() => openDetail(detail.tenant.id)}
                onExtendTrial={(days) => act(detail.tenant.id, extendTenantTrial, days)}
                onSuspend={() => act(detail.tenant.id, suspendTenant)}
                onActivate={() => act(detail.tenant.id, activateTenant)}
                onChangePlan={(code) => act(detail.tenant.id, changeTenantPlan, code)}
                onToggleFeature={(features) => act(detail.tenant.id, updateTenantFeatures, features)}
                onDeleted={() => { setDetail(null); load(); }}
            />
        </div>
    );
}

function OrganizationDetailModal({ detail, onHide, busy, onRefresh, onExtendTrial, onSuspend, onActivate, onChangePlan, onToggleFeature, onDeleted }) {
    const [extendDays, setExtendDays] = useState(30);
    const [planCode, setPlanCode] = useState('');
    const [editForm, setEditForm] = useState(null);
    const [saving, setSaving] = useState(false);
    const [editMsg, setEditMsg] = useState('');
    const [deleteConfirm, setDeleteConfirm] = useState('');
    const [deleting, setDeleting] = useState(false);
    const [deleteErr, setDeleteErr] = useState('');

    // Reset the edit form whenever the displayed tenant changes — stops stale
    // values from a previous org bleeding into the form.
    useEffect(() => {
        if (detail?.tenant) {
            setEditForm({
                name: detail.tenant.name || '',
                slug: detail.tenant.slug || '',
                primary_color: detail.tenant.primary_color || '#8b5cf6',
                logo_url: detail.tenant.logo_url || ''
            });
            setEditMsg('');
            setDeleteConfirm('');
            setDeleteErr('');
        }
    }, [detail?.tenant?.id]);

    const handleDelete = async () => {
        if (!detail?.tenant) return;
        setDeleting(true); setDeleteErr('');
        try {
            await deletePlatformTenant(detail.tenant.id, deleteConfirm);
            onDeleted?.();
        } catch (err) {
            setDeleteErr(err.response?.data?.error || 'Delete failed');
        } finally {
            setDeleting(false);
        }
    };

    if (!detail) return null;
    const t = detail.tenant;
    const suspended = t.status === 'suspended';

    const saveEdits = async () => {
        setSaving(true); setEditMsg('');
        try {
            await updatePlatformTenant(t.id, editForm);
            setEditMsg('Saved.');
            onRefresh?.();
        } catch (err) {
            setEditMsg(err.response?.data?.error || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    // Tenant-flavored chrome: apply the org's own brand color on accents (header
    // underline, stat chip) so each org feels distinct inside the modal.
    const brand = t.primary_color || '#8b5cf6';

    return (
        <Modal show={!!detail} onHide={onHide} size="lg" centered dialogClassName="org-detail-modal">
            {/* Custom header block with a gradient banner + logo + quick identifiers. */}
            <div style={{
                background: `linear-gradient(135deg, ${brand}33 0%, rgba(139,92,246,0.12) 45%, rgba(236,72,153,0.08) 100%)`,
                borderTopLeftRadius: 'var(--radius-lg)',
                borderTopRightRadius: 'var(--radius-lg)',
                padding: '22px 26px 18px',
                borderBottom: '1px solid var(--border-subtle)',
                position: 'relative'
            }}>
                <button onClick={onHide} aria-label="close" style={{
                    position: 'absolute', top: 14, right: 16, width: 32, height: 32,
                    border: 'none', borderRadius: 8, background: 'rgba(0,0,0,0.25)',
                    color: '#fff', fontSize: 20, lineHeight: 1, cursor: 'pointer',
                }}>×</button>

                <div className="d-flex align-items-center gap-3">
                    <div style={{
                        width: 56, height: 56, borderRadius: 14,
                        background: t.logo_url ? `url(${t.logo_url}) center/cover, white` : `linear-gradient(135deg, ${brand}, #7c3aed)`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: 'white', fontSize: 22, fontWeight: 700,
                        boxShadow: `0 6px 18px ${brand}55, inset 0 1px 0 rgba(255,255,255,0.25)`,
                        flexShrink: 0
                    }}>
                        {!t.logo_url && (t.name || '?').charAt(0).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                            Organization
                        </div>
                        <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.15 }}>
                            {t.name}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                            #{t.id} · slug <span style={{ fontFamily: 'monospace' }}>{t.slug || '—'}</span> · joined {t.created_at ? new Date(t.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                        </div>
                    </div>
                </div>
            </div>

            <Modal.Body style={{ background: 'var(--bg-secondary)', padding: 22, maxHeight: '70vh', overflowY: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 18 }}>
                    <Stat label="Plan" value={t.plan_name || '—'} />
                    <Stat label="Status" value={t.sub_status || t.status} tone={suspended ? 'danger' : t.sub_status === 'active' ? 'success' : 'warning'} />
                    <Stat label="Users" value={detail.users.length} />
                    <Stat label="Events" value={detail.events.length} />
                    <Stat label="Invoices" value={detail.invoices.length} />
                    <Stat label="Trial ends" value={t.trial_ends_at ? new Date(t.trial_ends_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'} />
                </div>

                <SectionCard title="Subscription controls" subtitle="Extend trial · suspend · change plan">
                    <div className="d-flex flex-wrap gap-2 align-items-center">
                        <div className="d-flex align-items-center gap-1">
                            <Form.Control
                                type="number" size="sm" min={1} max={365}
                                value={extendDays}
                                onChange={(e) => setExtendDays(e.target.value)}
                                style={{ width: 70 }}
                            />
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>days</span>
                        </div>
                        <Button size="sm" variant="outline-info" disabled={busy === t.id} onClick={() => onExtendTrial(Number(extendDays))}>
                            <BsClockHistory className="me-1" /> Extend trial
                        </Button>
                        {suspended ? (
                            <Button size="sm" variant="outline-success" disabled={busy === t.id} onClick={onActivate}>
                                <BsPlayCircle className="me-1" /> Reactivate
                            </Button>
                        ) : (
                            <Button size="sm" variant="outline-danger" disabled={busy === t.id} onClick={onSuspend}>
                                <BsPauseCircle className="me-1" /> Suspend
                            </Button>
                        )}

                        <div style={{ width: 1, height: 26, background: 'var(--border-subtle)' }} />

                        <Form.Select size="sm" style={{ width: 150 }} value={planCode} onChange={(e) => setPlanCode(e.target.value)}>
                            <option value="">Change plan…</option>
                            <option value="free">Free</option>
                            <option value="pro">Pro</option>
                            <option value="enterprise">Enterprise</option>
                        </Form.Select>
                        <Button size="sm" className="btn-accent" disabled={!planCode || busy === t.id} onClick={() => { onChangePlan(planCode); setPlanCode(''); }}>
                            <BsPencilSquare className="me-1" /> Apply
                        </Button>
                    </div>
                </SectionCard>

                {/* Per-tenant feature toggles. Off here = the tenant's UI hides
                    the entry point and the API rejects every cert request. */}
                <SectionCard title="Features" subtitle="Enable or disable add-on tools for this organization">
                    <FeatureToggleRow
                        icon={BsAward}
                        label="Bulk Certificate Generator"
                        description="Lets admins/managers design certificate templates and generate branded PDFs in bulk for attendees."
                        enabled={t.bulk_certificate_enabled !== 0}
                        busy={busy === t.id}
                        onToggle={(next) => onToggleFeature?.({ bulk_certificate_enabled: next })}
                    />
                </SectionCard>

                {/* Edit tenant info — name, slug, branding */}
                <SectionCard
                    title="Organization profile"
                    subtitle="Name · slug · branding"
                    badge={editMsg && (
                        <span style={{
                            fontSize: 11, fontWeight: 600,
                            color: editMsg === 'Saved.' ? 'var(--accent-emerald)' : '#f87171'
                        }}>
                            {editMsg}
                        </span>
                    )}
                >
                    {editForm && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                            <Form.Group>
                                <Form.Label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Name</Form.Label>
                                <Form.Control
                                    size="sm"
                                    value={editForm.name}
                                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                />
                            </Form.Group>
                            <Form.Group>
                                <Form.Label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Slug (URL handle)</Form.Label>
                                <Form.Control
                                    size="sm"
                                    value={editForm.slug}
                                    onChange={(e) => setEditForm({ ...editForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                                    placeholder="acme-events"
                                />
                            </Form.Group>
                            <Form.Group>
                                <Form.Label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Brand color</Form.Label>
                                <div className="d-flex gap-2 align-items-center">
                                    <Form.Control
                                        type="color"
                                        size="sm"
                                        value={editForm.primary_color}
                                        onChange={(e) => setEditForm({ ...editForm, primary_color: e.target.value })}
                                        style={{ width: 46, padding: 2, cursor: 'pointer' }}
                                    />
                                    <Form.Control
                                        size="sm"
                                        value={editForm.primary_color}
                                        onChange={(e) => setEditForm({ ...editForm, primary_color: e.target.value })}
                                    />
                                </div>
                            </Form.Group>
                            <Form.Group>
                                <Form.Label style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Logo URL</Form.Label>
                                <Form.Control
                                    size="sm"
                                    value={editForm.logo_url}
                                    onChange={(e) => setEditForm({ ...editForm, logo_url: e.target.value })}
                                    placeholder="/uploads/..."
                                />
                            </Form.Group>
                        </div>
                    )}
                    {editForm?.logo_url && (
                        <div style={{ marginTop: 12 }}>
                            <img src={editForm.logo_url} alt="logo preview"
                                 style={{ maxHeight: 44, background: 'white', padding: 6, borderRadius: 8 }}
                                 onError={(e) => { e.target.style.display = 'none'; }} />
                        </div>
                    )}
                    <div className="d-flex justify-content-end mt-3">
                        <Button size="sm" className="btn-accent" onClick={saveEdits} disabled={saving}>
                            {saving ? <><Spinner size="sm" className="me-1" /> Saving…</> : <><BsPencilSquare className="me-1" /> Save changes</>}
                        </Button>
                    </div>
                </SectionCard>

                <UsersList users={detail.users} />
                <SubList title="Recent events" icon={BsCalendarEvent} rows={detail.events.map(e => ({ left: e.title, right: e.start_date ? new Date(e.start_date).toLocaleDateString() : '' }))} />
                <SubList title="Invoices" icon={BsReceipt} rows={detail.invoices.map(i => ({ left: `${i.invoice_number} · ${i.plan_name}`, right: `₹${Number(i.amount_inr).toLocaleString('en-IN')} (${i.status})` }))} />
                <SubList title="Audit log (recent)" icon={BsMegaphone} rows={detail.audit.map(a => ({ left: `${a.action}`, right: `${a.actor_name || '—'} · ${new Date(a.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}` }))} />

                {/* Danger zone — destructive cascade delete, guarded by name-typing
                    so an accidental click can't nuke a real tenant. */}
                <div style={{
                    marginTop: 20,
                    padding: 16,
                    borderRadius: 12,
                    background: 'rgba(239, 68, 68, 0.05)',
                    border: '1px solid rgba(239, 68, 68, 0.35)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <BsTrash style={{ color: '#f87171' }} />
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            Danger zone
                        </div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.55 }}>
                        Permanently delete <strong style={{ color: 'var(--text-primary)' }}>{t.name}</strong> and every piece of their data — events, speakers, partners, invoices, users, everything. This cannot be undone.
                    </div>
                    <Form.Label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Type <code style={{ color: '#f87171' }}>{t.name}</code> to confirm
                    </Form.Label>
                    <div className="d-flex gap-2 align-items-start">
                        <Form.Control
                            size="sm"
                            value={deleteConfirm}
                            onChange={(e) => setDeleteConfirm(e.target.value)}
                            placeholder={t.name}
                            style={{ flex: 1 }}
                        />
                        <Button
                            size="sm"
                            variant="outline-danger"
                            disabled={deleting || deleteConfirm.trim() !== t.name}
                            onClick={handleDelete}
                        >
                            {deleting
                                ? <><Spinner size="sm" className="me-1" /> Deleting…</>
                                : <><BsTrash className="me-1" /> Delete organization</>}
                        </Button>
                    </div>
                    {deleteErr && (
                        <div style={{ fontSize: 11, color: '#f87171', marginTop: 6 }}>{deleteErr}</div>
                    )}
                </div>
            </Modal.Body>
        </Modal>
    );
}

// Richer version of SubList for tenant users — each row has a reset-password
// affordance. Kept here (not as a SubList variant) so the general list stays
// dumb and the logic lives next to the only caller that needs it.
function UsersList({ users }) {
    const [activeId, setActiveId] = useState(null);    // row currently in reset mode
    const [pw, setPw] = useState('');
    const [showPw, setShowPw] = useState(false);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState({ id: null, type: '', text: '' });

    const startReset = (id) => {
        setActiveId(id);
        // Seed a memorable random password — admin can edit before submitting
        // or generate a new one with the regenerate button.
        setPw(generateTempPassword());
        setShowPw(true);
        setMsg({ id: null, type: '', text: '' });
    };

    const submit = async (id) => {
        if (!pw || pw.length < 6) {
            setMsg({ id, type: 'danger', text: 'Password must be at least 6 characters' });
            return;
        }
        setSaving(true);
        try {
            await resetPlatformUserPassword(id, pw);
            setMsg({ id, type: 'success', text: `New password: ${pw}` });
            setActiveId(null);
            setPw('');
        } catch (err) {
            setMsg({ id, type: 'danger', text: err.response?.data?.error || 'Reset failed' });
        } finally {
            setSaving(false);
        }
    };

    if (!users || users.length === 0) return null;

    return (
        <div className="mb-3">
            <div className="d-flex align-items-center gap-2 mb-2" style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                <BsPeople /> Users <span style={{ fontWeight: 400 }}>({users.length})</span>
            </div>
            <div className="premium-card p-0" style={{ overflow: 'hidden' }}>
                {users.map((u, i) => {
                    const isActive = activeId === u.id;
                    const showMsg = msg.id === u.id;
                    return (
                        <div key={u.id} style={{ borderBottom: i < users.length - 1 ? '1px solid var(--border-subtle)' : 'none' }}>
                            <div className="d-flex justify-content-between align-items-center" style={{ padding: '10px 12px', fontSize: 12 }}>
                                <div>
                                    <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{u.name}</div>
                                    <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{u.email} · {u.role}</div>
                                </div>
                                {!isActive ? (
                                    <Button size="sm" variant="outline-light" onClick={() => startReset(u.id)}>
                                        <BsKey className="me-1" /> Reset password
                                    </Button>
                                ) : (
                                    <div className="d-flex gap-2 align-items-center">
                                        <Form.Control
                                            size="sm"
                                            type={showPw ? 'text' : 'password'}
                                            value={pw}
                                            onChange={(e) => setPw(e.target.value)}
                                            placeholder="New password"
                                            style={{ width: 180 }}
                                        />
                                        <Button size="sm" variant="outline-light" onClick={() => setShowPw(!showPw)} title={showPw ? 'Hide' : 'Show'}>
                                            {showPw ? <BsEyeSlash /> : <BsEye />}
                                        </Button>
                                        <Button size="sm" variant="outline-secondary" onClick={() => setPw(generateTempPassword())} title="Regenerate">
                                            ↻
                                        </Button>
                                        <Button size="sm" className="btn-accent" disabled={saving} onClick={() => submit(u.id)}>
                                            {saving ? <Spinner size="sm" /> : 'Save'}
                                        </Button>
                                        <Button size="sm" variant="outline-secondary" onClick={() => { setActiveId(null); setPw(''); }}>
                                            Cancel
                                        </Button>
                                    </div>
                                )}
                            </div>
                            {showMsg && (
                                <div style={{
                                    padding: '6px 12px 10px',
                                    fontSize: 11,
                                    color: msg.type === 'success' ? 'var(--accent-emerald)' : '#ef4444',
                                    display: 'flex', alignItems: 'center', gap: 6
                                }}>
                                    {msg.type === 'success' && <BsCheckCircleFill />}
                                    {msg.text}
                                    {msg.type === 'success' && (
                                        <Button
                                            size="sm" variant="link" style={{ padding: 0, marginLeft: 8, fontSize: 11 }}
                                            onClick={() => navigator.clipboard?.writeText(msg.text.replace('New password: ', ''))}
                                        >
                                            copy
                                        </Button>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// Generates an easy-to-communicate temporary password: 3 short chunks so it
// can be read out over a call without ambiguity. Still has enough entropy
// since the user can (and should) change it after first login.
function generateTempPassword() {
    const chunk = () => Math.random().toString(36).slice(2, 6);
    return `${chunk()}-${chunk()}-${chunk()}`;
}

// Compact read-only pill used on each plan card's limits grid. 0 renders as
// the infinity glyph so "unlimited" reads instantly.
function LimitPill({ label, value }) {
    const unlimited = Number(value) === 0;
    const display = unlimited ? '∞' : Number(value).toLocaleString('en-IN');
    return (
        <div style={{ padding: '2px 4px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, marginBottom: 2 }}>
                {label}
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: unlimited ? 'var(--accent)' : 'var(--text-primary)', lineHeight: 1, letterSpacing: '-0.01em' }}>
                {display}
            </div>
        </div>
    );
}

// Gradient-stroke checkmark for the light pricing cards. Uses an SVG so the
// gradient tracks whichever plan-specific CSS gradient was passed in.
function CheckIcon({ gradient }) {
    // Generate a stable id per gradient string so multiple cards don't collide.
    const gid = 'grad-' + btoa(gradient).replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
    return (
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
            <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#34d399" />
                    <stop offset="55%" stopColor="#fbbf24" />
                    <stop offset="100%" stopColor="#f97316" />
                </linearGradient>
            </defs>
            <path d="M5 12.5l4.5 4.5L19 7.5" stroke={`url(#${gid})`} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

// Compact grey limits pill for the light pricing cards — lives inside the
// white card body, so its palette is the opposite of the dark-mode LimitPill.
function MiniLimit({ label, value }) {
    const unlimited = Number(value) === 0;
    const display = unlimited ? '∞' : Number(value).toLocaleString('en-IN');
    return (
        <div style={{ padding: '2px 4px' }}>
            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
                {label}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: unlimited ? '#8b5cf6' : '#111', lineHeight: 1.2, marginTop: 1 }}>
                {display}
            </div>
        </div>
    );
}

// Editable limit field used inside the edit modal. Typing 0 = unlimited, and
// we surface that hint inline so admins don't need to guess.
function LimitInput({ label, value, onChange }) {
    return (
        <Form.Group>
            <Form.Label style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {label} {Number(value) === 0 && <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>· unlimited</span>}
            </Form.Label>
            <Form.Control
                size="sm"
                type="number"
                min={0}
                value={value}
                onChange={(e) => onChange(e.target.value)}
            />
        </Form.Group>
    );
}

function Stat({ label, value, tone }) {
    const color = tone === 'success' ? 'var(--accent-emerald)' :
                  tone === 'danger' ? '#f87171' :
                  tone === 'warning' ? 'var(--accent-amber)' : 'var(--text-primary)';
    const glow = tone === 'success' ? 'rgba(16, 185, 129, 0.15)' :
                 tone === 'danger' ? 'rgba(239, 68, 68, 0.15)' :
                 tone === 'warning' ? 'rgba(245, 158, 11, 0.15)' :
                 'rgba(139, 92, 246, 0.08)';
    return (
        <div style={{
            padding: 12,
            borderRadius: 12,
            background: `linear-gradient(135deg, ${glow}, rgba(255, 255, 255, 0.02))`,
            border: '1px solid var(--border-subtle)',
            position: 'relative',
            overflow: 'hidden'
        }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color, marginTop: 4, textTransform: 'capitalize' }}>{value}</div>
        </div>
    );
}

// Reusable card for each section inside the premium modal. A small accent bar
// at the left edge + a title/subtitle pair gives every section a consistent,
// editorial feel without extra chrome.
function SectionCard({ title, subtitle, badge, children }) {
    return (
        <div style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0))',
            border: '1px solid var(--border-subtle)',
            borderRadius: 14,
            padding: '14px 16px 16px',
            marginBottom: 14,
            position: 'relative',
            overflow: 'hidden'
        }}>
            <div style={{
                position: 'absolute', top: 14, bottom: 14, left: 0,
                width: 3, borderRadius: '0 3px 3px 0',
                background: 'linear-gradient(180deg, var(--accent), var(--accent-pink))'
            }} />
            <div className="d-flex justify-content-between align-items-start mb-2" style={{ paddingLeft: 6 }}>
                <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                        {title}
                    </div>
                    {subtitle && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                            {subtitle}
                        </div>
                    )}
                </div>
                {badge}
            </div>
            <div style={{ paddingLeft: 6 }}>{children}</div>
        </div>
    );
}

// Single-feature row used inside the Features section of the org modal.
// Pill toggle on the right; disabled while the parent action is in flight.
function FeatureToggleRow({ icon: Icon, label, description, enabled, busy, onToggle }) {
    return (
        <div className="d-flex align-items-center gap-3" style={{
            padding: '10px 12px',
            borderRadius: 10,
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid var(--border-subtle)',
        }}>
            <div style={{
                width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                background: enabled
                    ? 'linear-gradient(135deg, rgba(139,92,246,0.25), rgba(236,72,153,0.18))'
                    : 'rgba(255,255,255,0.04)',
                color: enabled ? '#fff' : 'var(--text-muted)',
                display: 'grid', placeItems: 'center',
                border: '1px solid var(--border-subtle)',
            }}>
                {Icon && <Icon size={18} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
                {description && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.45 }}>
                        {description}
                    </div>
                )}
            </div>
            <button
                type="button"
                onClick={() => !busy && onToggle?.(!enabled)}
                disabled={busy}
                aria-pressed={enabled}
                title={enabled ? 'Click to disable' : 'Click to enable'}
                style={{
                    width: 46, height: 26, borderRadius: 999,
                    background: enabled ? 'var(--accent)' : 'rgba(255,255,255,0.12)',
                    border: 'none', position: 'relative', cursor: busy ? 'wait' : 'pointer',
                    transition: 'background 0.2s ease',
                    opacity: busy ? 0.6 : 1,
                    flexShrink: 0,
                }}
            >
                <span style={{
                    position: 'absolute',
                    top: 3, left: enabled ? 23 : 3,
                    width: 20, height: 20, borderRadius: '50%',
                    background: '#fff',
                    transition: 'left 0.2s ease',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
                }} />
            </button>
        </div>
    );
}

function SubList({ title, icon: Icon, rows }) {
    if (!rows || rows.length === 0) return null;
    return (
        <div className="mb-3">
            <div className="d-flex align-items-center gap-2 mb-2" style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                <Icon /> {title} <span style={{ fontWeight: 400 }}>({rows.length})</span>
            </div>
            <div className="premium-card p-0" style={{ overflow: 'hidden' }}>
                {rows.slice(0, 15).map((r, i) => (
                    <div key={i} className="d-flex justify-content-between" style={{
                        padding: '8px 12px',
                        fontSize: 12,
                        borderBottom: i < rows.length - 1 ? '1px solid var(--border-subtle)' : 'none'
                    }}>
                        <span style={{ color: 'var(--text-primary)' }}>{r.left}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{r.right}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ───────────────── Invoices tab ─────────────────
function InvoicesTab() {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        getPlatformInvoices().then(r => setRows(r.data)).finally(() => setLoading(false));
    }, []);

    if (loading) return <div className="p-5 text-center"><Spinner animation="border" /></div>;

    return (
        <div className="premium-card p-0" style={{ overflow: 'hidden' }}>
            <Table hover responsive className="mb-0" style={{ color: 'var(--text-primary)' }}>
                <thead>
                    <tr style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
                        <th style={{ border: 'none', padding: '12px 16px' }}>Invoice</th>
                        <th style={{ border: 'none', padding: '12px 16px' }}>Tenant</th>
                        <th style={{ border: 'none', padding: '12px 16px' }}>Plan</th>
                        <th style={{ border: 'none', padding: '12px 16px' }}>Status</th>
                        <th style={{ border: 'none', padding: '12px 16px' }}>Date</th>
                        <th style={{ border: 'none', padding: '12px 16px', textAlign: 'right' }}>Amount</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.length === 0 && (
                        <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)', fontSize: 13 }}>No invoices yet.</td></tr>
                    )}
                    {rows.map(r => (
                        <tr key={r.id} style={{ fontSize: 13 }}>
                            <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 12 }}>{r.invoice_number}</td>
                            <td style={{ padding: '12px 16px' }}>{r.tenant_name}</td>
                            <td style={{ padding: '12px 16px' }}>{r.plan_name}</td>
                            <td style={{ padding: '12px 16px' }}>
                                <Badge bg={r.status === 'paid' ? 'success' : r.status === 'stub' ? 'warning' : 'secondary'} text={r.status === 'stub' ? 'dark' : undefined}>{r.status}</Badge>
                            </td>
                            <td style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>
                                {new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </td>
                            <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600 }}>
                                ₹{Number(r.amount_inr).toLocaleString('en-IN')}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </Table>
        </div>
    );
}

// ───────────────── Plans tab ─────────────────
// Each plan code gets its own visual identity so the page reads as a pricing
// board at a glance — the Pro card is the "highlight", Enterprise is muted
// prestige, Free is understated. Colors match the public Billing page so the
// super admin is editing what customers see.
const PLAN_THEMES = {
    free: {
        icon: '🌱',
        accent: '#10b981',
        gradient: 'linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(5, 150, 105, 0.04))',
        glow: 'rgba(16, 185, 129, 0.2)',
        label: 'Starter'
    },
    pro: {
        icon: '⚡',
        accent: '#8b5cf6',
        gradient: 'linear-gradient(135deg, rgba(139, 92, 246, 0.22), rgba(236, 72, 153, 0.08))',
        glow: 'rgba(139, 92, 246, 0.35)',
        label: 'Most popular'
    },
    enterprise: {
        icon: '✨',
        accent: '#f59e0b',
        gradient: 'linear-gradient(135deg, rgba(245, 158, 11, 0.18), rgba(239, 68, 68, 0.06))',
        glow: 'rgba(245, 158, 11, 0.25)',
        label: 'Custom-tier'
    }
};

// Per-plan taglines and "ideal for" copy — keeps the card readable even when
// the DB's features list is short. Edit these to tune marketing tone.
const PLAN_COPY = {
    free: {
        tagline: 'Try the platform with zero commitment.',
        idealFor: 'Individuals and small teams evaluating the product before moving to a paid tier.',
        ctaGradient: 'linear-gradient(90deg, #a3e635 0%, #facc15 55%, #f97316 100%)'
    },
    pro: {
        tagline: 'Scale your events without guardrails.',
        idealFor: 'Growing organisations running multiple conferences with larger speaker and attendee lists.',
        ctaGradient: 'linear-gradient(90deg, #38bdf8 0%, #22d3ee 55%, #34d399 100%)'
    },
    enterprise: {
        tagline: 'Unlimited scale with white-glove support.',
        idealFor: 'Enterprises that need custom branding, unlimited capacity, and an SLA-backed support relationship.',
        ctaGradient: 'linear-gradient(90deg, #f59e0b 0%, #ec4899 55%, #8b5cf6 100%)'
    }
};

function PlansTab() {
    const [plans, setPlans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);
    const [msg, setMsg] = useState({ type: '', text: '' });

    const load = () => {
        setLoading(true);
        getPlatformPlans().then(r => setPlans(r.data)).finally(() => setLoading(false));
    };
    useEffect(load, []);

    const save = async (payload) => {
        try {
            if (editing.id) {
                await updatePlatformPlan(editing.id, payload);
                setMsg({ type: 'success', text: `${editing.name} saved.` });
            } else {
                // Creating: code + billing_cycle must be in the payload (edit
                // never touches these, so the handler passes them through here).
                await createPlatformPlan({
                    ...payload,
                    code: editing.code,
                    billing_cycle: editing.billing_cycle || 'monthly'
                });
                setMsg({ type: 'success', text: `Plan "${editing.name}" created.` });
            }
            setEditing(null);
            load();
        } catch (err) {
            setMsg({ type: 'danger', text: err.response?.data?.error || 'Save failed' });
        }
    };

    const handleDelete = async () => {
        if (!editing?.id) return;
        const name = editing.name || editing.code;
        if (!window.confirm(`Delete plan "${name}"? This can't be undone. Hidden plans stay invisible to customers without losing data.`)) return;
        try {
            await deletePlatformPlan(editing.id);
            setMsg({ type: 'success', text: `Plan "${name}" deleted.` });
            setEditing(null);
            load();
        } catch (err) {
            // 409 in_use -> show the friendly server-side message inside the modal.
            setMsg({ type: 'danger', text: err.response?.data?.message || err.response?.data?.error || 'Delete failed' });
        }
    };

    // Seed state for the "New plan" flow — empty fields with sensible defaults.
    const newPlanDraft = () => ({
        id: null,
        code: '',
        name: '',
        price_inr: 0,
        billing_cycle: 'monthly',
        max_events: 1,
        max_speakers: 50,
        max_attendees: 200,
        max_users: 3,
        features: '',
        is_public: 1
    });

    if (loading) return <div className="p-5 text-center"><Spinner animation="border" /></div>;

    return (
        <div className="plans-page-v2">
            {msg.text && (
                <Alert variant={msg.type} className="py-2" style={{ fontSize: 12 }} dismissible onClose={() => setMsg({ type: '', text: '' })}>
                    {msg.text}
                </Alert>
            )}

            {/* Toolbar — New plan CTA. Kept simple; most admins will edit existing
                plans, occasionally add new ones (e.g. a yearly Pro or a comp tier). */}
            <div className="d-flex justify-content-between align-items-center mb-3" style={{ padding: '0 10px' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
                    {plans.length} plan{plans.length === 1 ? '' : 's'} in catalog
                </div>
                <Button className="btn-accent" size="sm" onClick={() => setEditing(newPlanDraft())}>
                    <BsPlusLg className="me-1" /> New plan
                </Button>
            </div>

            {/* ───── Pricing cards — light/white cards floating on the dark canvas.
                Matches a marketing-style pricing layout: clean white body, colored
                gradient CTA strip at the bottom, "Ideal for" footnote beneath. */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: 40,
                padding: '20px 10px',
                alignItems: 'start'
            }}>
                {plans.map(p => {
                    const theme = PLAN_THEMES[p.code] || PLAN_THEMES.free;
                    const copy = PLAN_COPY[p.code] || PLAN_COPY.free;
                    const highlighted = p.code === 'pro';
                    const features = Array.isArray(p.features) ? p.features : [];
                    return (
                        <div key={p.id} style={{ display: 'flex', flexDirection: 'column' }}>
                            <div className="plan-card-v2" style={{
                                position: 'relative',
                                background: '#ffffff',
                                borderRadius: 18,
                                padding: '30px 28px 0',
                                boxShadow: highlighted
                                    ? '0 24px 48px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(255, 255, 255, 0.9)'
                                    : '0 16px 36px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(255, 255, 255, 0.8)',
                                overflow: 'hidden',
                                display: 'flex', flexDirection: 'column'
                            }}>
                                {/* Header row — plan name + optional POPULAR pill */}
                                <div className="d-flex justify-content-between align-items-start">
                                    <div style={{
                                        fontSize: 22, fontWeight: 700, color: '#111',
                                        letterSpacing: '-0.01em'
                                    }}>
                                        {p.name}
                                    </div>
                                    {highlighted && (
                                        <span className="plan-pill-popular">POPULAR</span>
                                    )}
                                    {!p.is_public && !highlighted && (
                                        <span className="plan-pill-hidden">HIDDEN</span>
                                    )}
                                </div>

                                {/* Price */}
                                <div style={{ display: 'flex', alignItems: 'baseline', marginTop: 14, gap: 4 }}>
                                    <span style={{ fontSize: 46, fontWeight: 800, color: '#111', letterSpacing: '-0.03em', lineHeight: 1 }}>
                                        {p.price_inr === 0 ? 'Free' : `₹${Number(p.price_inr).toLocaleString('en-IN')}`}
                                    </span>
                                    {p.price_inr > 0 && (
                                        <span style={{ fontSize: 14, color: '#6b7280', fontWeight: 500 }}>
                                            / month
                                        </span>
                                    )}
                                </div>

                                {/* Tagline */}
                                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 10, marginBottom: 18 }}>
                                    {copy.tagline}
                                </div>

                                {/* Gradient divider — colored strip between price and features */}
                                <div style={{
                                    height: 1.5,
                                    background: copy.ctaGradient,
                                    marginBottom: 20,
                                    opacity: 0.7
                                }} />

                                {/* Features list */}
                                {features.length > 0 && (
                                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, flexGrow: 1 }}>
                                        {features.map((f, i) => {
                                            // Support optional "Title | Description" format; fall back to
                                            // just showing the title if no pipe is present.
                                            const [title, ...descParts] = String(f).split('|').map(s => s.trim());
                                            const desc = descParts.join(' | ');
                                            return (
                                                <li key={i} style={{
                                                    display: 'flex', gap: 12, alignItems: 'flex-start',
                                                    padding: '10px 0',
                                                }}>
                                                    <span style={{ marginTop: 2, flexShrink: 0 }}>
                                                        <CheckIcon gradient={copy.ctaGradient} />
                                                    </span>
                                                    <div>
                                                        <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>
                                                            {title}
                                                        </div>
                                                        {desc && (
                                                            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2, lineHeight: 1.5 }}>
                                                                {desc}
                                                            </div>
                                                        )}
                                                    </div>
                                                </li>
                                            );
                                        })}
                                    </ul>
                                )}

                                {/* Limits block — small, grey, underneath features. */}
                                <div style={{
                                    display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
                                    gap: 8, marginTop: 18, marginBottom: 26,
                                    padding: '12px 14px', borderRadius: 12,
                                    background: '#f9fafb', border: '1px solid #eef0f3'
                                }}>
                                    <MiniLimit label="Events" value={p.max_events} />
                                    <MiniLimit label="Speakers" value={p.max_speakers} />
                                    <MiniLimit label="Attendees" value={p.max_attendees} />
                                    <MiniLimit label="Team" value={p.max_users} />
                                </div>
                            </div>

                            {/* Gradient CTA strip — overlaps the card's bottom edge.
                                zIndex must be > 0 so the button sits ABOVE the card
                                and stays clickable; zIndex: -1 hid it behind the
                                white card body and ate the click event. */}
                            <button
                                type="button"
                                onClick={() => setEditing({
                                    ...p,
                                    features: features.join('\n')
                                })}
                                style={{
                                    width: 'calc(100% - 20px)',
                                    margin: '-14px auto 0',
                                    padding: '18px 20px',
                                    border: 'none',
                                    borderRadius: 18,
                                    background: copy.ctaGradient,
                                    color: '#fff',
                                    fontSize: 16,
                                    fontWeight: 700,
                                    letterSpacing: '-0.01em',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 10,
                                    boxShadow: '0 12px 28px rgba(0, 0, 0, 0.35)',
                                    textShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
                                    transition: 'filter 150ms ease, transform 150ms ease',
                                    position: 'relative',
                                    zIndex: 2
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.08)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)'; }}
                            >
                                Edit this plan <span style={{ fontSize: 20 }}>→</span>
                            </button>

                            {/* Footnote outside the card */}
                            <div style={{
                                fontSize: 12, color: 'rgba(255, 255, 255, 0.55)',
                                marginTop: 22, padding: '0 8px', lineHeight: 1.5
                            }}>
                                <span style={{ fontWeight: 700, color: 'rgba(255, 255, 255, 0.75)' }}>*Ideal for:</span> {copy.idealFor}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Edit modal — same premium shell as organizations modal */}
            <Modal show={!!editing} onHide={() => setEditing(null)} centered size="lg" dialogClassName="org-detail-modal">
                {editing && (() => {
                    const theme = PLAN_THEMES[editing.code] || PLAN_THEMES.free;
                    return (
                        <>
                            <div style={{
                                background: theme.gradient + ', #0f0f1f',
                                borderTopLeftRadius: 18, borderTopRightRadius: 18,
                                padding: '22px 26px 18px',
                                borderBottom: '1px solid var(--border-subtle)',
                                position: 'relative'
                            }}>
                                <button onClick={() => setEditing(null)} aria-label="close" style={{
                                    position: 'absolute', top: 14, right: 16, width: 32, height: 32,
                                    border: 'none', borderRadius: 8, background: 'rgba(0,0,0,0.25)',
                                    color: '#fff', fontSize: 20, lineHeight: 1, cursor: 'pointer',
                                }}>×</button>
                                <div className="d-flex align-items-center gap-3">
                                    <div style={{
                                        width: 52, height: 52, borderRadius: 14,
                                        background: `linear-gradient(135deg, ${theme.accent}, #7c3aed)`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: 26, boxShadow: `0 6px 18px ${theme.glow}`
                                    }}>
                                        {theme.icon}
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                            {editing.id ? `Edit plan · ${editing.code}` : 'New plan'}
                                        </div>
                                        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
                                            {editing.name || 'Untitled plan'}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <Modal.Body style={{ background: 'var(--bg-secondary)', padding: 22, maxHeight: '65vh', overflowY: 'auto' }}>
                                {/* Identity only matters at create time — the code is the
                                    stable reference used in subscriptions + checkout. */}
                                {!editing.id && (
                                    <SectionCard title="Identity" subtitle="Code is permanent after creation, so pick carefully">
                                        <div className="d-flex gap-2">
                                            <Form.Group className="flex-fill">
                                                <Form.Label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Plan code (URL-safe)</Form.Label>
                                                <Form.Control
                                                    size="sm"
                                                    value={editing.code}
                                                    placeholder="pro-yearly"
                                                    onChange={e => setEditing({
                                                        ...editing,
                                                        code: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-')
                                                    })}
                                                />
                                            </Form.Group>
                                            <Form.Group style={{ width: 160 }}>
                                                <Form.Label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Billing cycle</Form.Label>
                                                <Form.Select
                                                    size="sm"
                                                    value={editing.billing_cycle || 'monthly'}
                                                    onChange={e => setEditing({ ...editing, billing_cycle: e.target.value })}
                                                >
                                                    <option value="monthly">Monthly</option>
                                                    <option value="yearly">Yearly</option>
                                                </Form.Select>
                                            </Form.Group>
                                        </div>
                                    </SectionCard>
                                )}

                                <SectionCard title="Pricing" subtitle="Price per month, shown on the Billing page">
                                    <div className="d-flex gap-2">
                                        <Form.Group className="flex-fill">
                                            <Form.Label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Display name</Form.Label>
                                            <Form.Control size="sm" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />
                                        </Form.Group>
                                        <Form.Group style={{ width: 160 }}>
                                            <Form.Label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Price (₹/{editing.billing_cycle === 'yearly' ? 'yr' : 'mo'})</Form.Label>
                                            <Form.Control size="sm" type="number" value={editing.price_inr}
                                                onChange={e => setEditing({ ...editing, price_inr: e.target.value })} />
                                        </Form.Group>
                                    </div>
                                </SectionCard>

                                <SectionCard title="Usage limits" subtitle="0 means unlimited for that resource">
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                                        <LimitInput label="Max events" value={editing.max_events} onChange={v => setEditing({ ...editing, max_events: v })} />
                                        <LimitInput label="Max speakers" value={editing.max_speakers} onChange={v => setEditing({ ...editing, max_speakers: v })} />
                                        <LimitInput label="Max attendees" value={editing.max_attendees} onChange={v => setEditing({ ...editing, max_attendees: v })} />
                                        <LimitInput label="Max team users" value={editing.max_users} onChange={v => setEditing({ ...editing, max_users: v })} />
                                    </div>
                                </SectionCard>

                                <SectionCard title="Marketing features" subtitle="One per line — rendered as a checkmark list on the Billing page">
                                    <Form.Control as="textarea" rows={5}
                                        value={editing.features}
                                        onChange={e => setEditing({ ...editing, features: e.target.value })}
                                        style={{ fontSize: 13 }} />
                                </SectionCard>

                                <SectionCard title="Visibility" subtitle="Hide a plan to grandfather it without removing data">
                                    <Form.Check
                                        type="switch"
                                        label={editing.is_public ? 'Public — shown on the Billing page' : 'Hidden — not shown to customers'}
                                        checked={!!editing.is_public}
                                        onChange={e => setEditing({ ...editing, is_public: e.target.checked })}
                                    />
                                </SectionCard>
                            </Modal.Body>

                            <Modal.Footer style={{ background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-subtle)', padding: '12px 22px', justifyContent: 'space-between' }}>
                                <div>
                                    {editing.id && (
                                        <Button variant="outline-danger" size="sm" onClick={handleDelete}>
                                            <BsTrash className="me-1" /> Delete plan
                                        </Button>
                                    )}
                                </div>
                                <div className="d-flex gap-2">
                                    <Button variant="outline-secondary" size="sm" onClick={() => setEditing(null)}>Cancel</Button>
                                    <Button className="btn-accent" size="sm" onClick={() => {
                                        const featuresArr = (editing.features || '').split('\n').map(s => s.trim()).filter(Boolean);
                                        save({
                                            name: editing.name,
                                            price_inr: Number(editing.price_inr),
                                            max_events: Number(editing.max_events),
                                            max_speakers: Number(editing.max_speakers),
                                            max_attendees: Number(editing.max_attendees),
                                            max_users: Number(editing.max_users),
                                            features: featuresArr,
                                            is_public: editing.is_public ? 1 : 0
                                        });
                                    }}>
                                        <BsPencilSquare className="me-1" /> {editing.id ? 'Save plan' : 'Create plan'}
                                    </Button>
                                </div>
                            </Modal.Footer>
                        </>
                    );
                })()}
            </Modal>
        </div>
    );
}

// ───────────────── Announcements tab ─────────────────
// Super admin composes platform-wide banners here. Active ones appear on every
// tenant's app via the useAnnouncements hook consumed by AppLayout.
const ANNOUNCEMENT_TYPES = [
    { value: 'info',    label: 'Info',    accent: '#0ea5e9', icon: 'ℹ️' },
    { value: 'success', label: 'Success', accent: '#10b981', icon: '✅' },
    { value: 'warning', label: 'Warning', accent: '#f59e0b', icon: '⚠️' },
    { value: 'danger',  label: 'Critical',accent: '#ef4444', icon: '🚨' }
];

function blankAnnouncement() {
    return { title: '', message: '', image_url: '', type: 'info', is_active: 1, dismissible: 1, starts_at: '', ends_at: '' };
}

function AnnouncementsTab() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);     // either blankAnnouncement() or an existing row
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState({ type: '', text: '' });

    const load = () => {
        setLoading(true);
        getPlatformAnnouncements().then(r => setItems(r.data)).finally(() => setLoading(false));
    };
    useEffect(load, []);

    const save = async () => {
        if (!editing.title || !editing.message) {
            setMsg({ type: 'danger', text: 'Title and message are required' });
            return;
        }
        setSaving(true); setMsg({ type: '', text: '' });
        try {
            const payload = {
                title: editing.title,
                message: editing.message,
                image_url: editing.image_url || null,
                type: editing.type,
                is_active: editing.is_active ? 1 : 0,
                dismissible: editing.dismissible ? 1 : 0,
                starts_at: editing.starts_at || null,
                ends_at: editing.ends_at || null
            };
            if (editing.id) {
                await updatePlatformAnnouncement(editing.id, payload);
            } else {
                await createPlatformAnnouncement(payload);
            }
            setMsg({ type: 'success', text: 'Saved. Active announcements appear in every workspace.' });
            setEditing(null);
            load();
        } catch (err) {
            setMsg({ type: 'danger', text: err.response?.data?.error || 'Save failed' });
        } finally {
            setSaving(false);
        }
    };

    const remove = async (id) => {
        if (!window.confirm('Delete this announcement? It will vanish from every tenant immediately.')) return;
        try {
            await deletePlatformAnnouncement(id);
            setMsg({ type: 'success', text: 'Deleted.' });
            load();
        } catch (err) {
            setMsg({ type: 'danger', text: err.response?.data?.error || 'Delete failed' });
        }
    };

    const toggleActive = async (row) => {
        try {
            await updatePlatformAnnouncement(row.id, { is_active: row.is_active ? 0 : 1 });
            load();
        } catch (err) {
            setMsg({ type: 'danger', text: err.response?.data?.error || 'Toggle failed' });
        }
    };

    if (loading) return <div className="p-5 text-center"><Spinner animation="border" /></div>;

    return (
        <div>
            {msg.text && (
                <Alert variant={msg.type} className="py-2" style={{ fontSize: 12 }} dismissible onClose={() => setMsg({ type: '', text: '' })}>
                    {msg.text}
                </Alert>
            )}

            <div className="d-flex justify-content-between align-items-center mb-3">
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Shown as a banner on the top of every tenant's app when active and inside the schedule window.
                </div>
                <Button className="btn-accent" size="sm" onClick={() => setEditing(blankAnnouncement())}>
                    <BsPlusLg className="me-1" /> New announcement
                </Button>
            </div>

            {items.length === 0 ? (
                <div className="premium-card p-5 text-center" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                    <BsBellFill size={32} style={{ opacity: 0.3, marginBottom: 10 }} />
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>No announcements yet</div>
                    Click <strong>New announcement</strong> to push a banner to every workspace.
                </div>
            ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                    {items.map(a => {
                        const typeMeta = ANNOUNCEMENT_TYPES.find(t => t.value === a.type) || ANNOUNCEMENT_TYPES[0];
                        const inWindow = (!a.starts_at || new Date(a.starts_at) <= new Date()) &&
                                         (!a.ends_at || new Date(a.ends_at) >= new Date());
                        const liveNow = a.is_active && inWindow;
                        return (
                            <div key={a.id} className="premium-card p-3" style={{
                                borderLeft: `4px solid ${typeMeta.accent}`,
                                opacity: a.is_active ? 1 : 0.6
                            }}>
                                <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
                                    <div style={{ flex: '1 1 280px', minWidth: 0 }}>
                                        <div className="d-flex align-items-center gap-2 flex-wrap" style={{ marginBottom: 4 }}>
                                            <span style={{ fontSize: 18 }}>{typeMeta.icon}</span>
                                            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                                                {a.title}
                                            </span>
                                            <Badge bg={liveNow ? 'success' : a.is_active ? 'warning' : 'secondary'}
                                                   text={liveNow ? undefined : 'dark'}>
                                                {liveNow ? 'LIVE' : a.is_active ? 'scheduled' : 'disabled'}
                                            </Badge>
                                        </div>
                                        <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 8, lineHeight: 1.5 }}>
                                            {a.message}
                                        </div>
                                        <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                                            <span>type · <strong style={{ color: typeMeta.accent }}>{typeMeta.label}</strong></span>
                                            {a.starts_at && <span>starts · {new Date(a.starts_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</span>}
                                            {a.ends_at && <span>ends · {new Date(a.ends_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</span>}
                                            <span>dismissible · {a.dismissible ? 'yes' : 'no'}</span>
                                            {a.created_by_name && <span>by · {a.created_by_name}</span>}
                                        </div>
                                    </div>
                                    <div className="d-flex gap-2 align-items-start" style={{ flexShrink: 0 }}>
                                        <Button size="sm" variant="outline-light" onClick={() => toggleActive(a)}>
                                            {a.is_active ? 'Disable' : 'Enable'}
                                        </Button>
                                        <Button size="sm" variant="outline-light" onClick={() => setEditing({
                                            ...a,
                                            image_url: a.image_url || '',
                                            is_active: !!a.is_active,
                                            dismissible: !!a.dismissible,
                                            starts_at: a.starts_at ? a.starts_at.slice(0, 16).replace(' ', 'T') : '',
                                            ends_at: a.ends_at ? a.ends_at.slice(0, 16).replace(' ', 'T') : ''
                                        })}>
                                            <BsPencilSquare />
                                        </Button>
                                        <Button size="sm" variant="outline-danger" onClick={() => remove(a.id)}>
                                            <BsTrash />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Edit / Create modal */}
            <Modal show={!!editing} onHide={() => !saving && setEditing(null)} centered size="lg" dialogClassName="org-detail-modal">
                {editing && (
                    <>
                        <div style={{
                            background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.18), rgba(236, 72, 153, 0.08)), #0f0f1f',
                            borderTopLeftRadius: 18, borderTopRightRadius: 18,
                            padding: '22px 26px 18px',
                            borderBottom: '1px solid var(--border-subtle)',
                            position: 'relative'
                        }}>
                            <button onClick={() => setEditing(null)} aria-label="close" style={{
                                position: 'absolute', top: 14, right: 16, width: 32, height: 32,
                                border: 'none', borderRadius: 8, background: 'rgba(0,0,0,0.25)',
                                color: '#fff', fontSize: 20, lineHeight: 1, cursor: 'pointer',
                            }}>×</button>
                            <div className="d-flex align-items-center gap-3">
                                <div style={{
                                    width: 52, height: 52, borderRadius: 14,
                                    background: 'linear-gradient(135deg, var(--accent), #7c3aed)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: 26
                                }}>
                                    <BsMegaphone color="white" />
                                </div>
                                <div>
                                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                        {editing.id ? 'Edit announcement' : 'New announcement'}
                                    </div>
                                    <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
                                        {editing.title || 'Untitled announcement'}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <Modal.Body style={{ background: 'var(--bg-secondary)', padding: 22, maxHeight: '65vh', overflowY: 'auto' }}>
                            <SectionCard title="Content" subtitle="Title is bold in the banner, message is the body text">
                                <Form.Group className="mb-2">
                                    <Form.Label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Title</Form.Label>
                                    <Form.Control size="sm" value={editing.title}
                                        onChange={e => setEditing({ ...editing, title: e.target.value })}
                                        placeholder="Scheduled maintenance tonight" />
                                </Form.Group>
                                <Form.Group>
                                    <Form.Label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Message</Form.Label>
                                    <Form.Control as="textarea" rows={3} size="sm" value={editing.message}
                                        onChange={e => setEditing({ ...editing, message: e.target.value })}
                                        placeholder="Event Hive will be briefly unavailable between 2:00 AM and 2:30 AM IST." />
                                </Form.Group>
                            </SectionCard>

                            <SectionCard title="Poster (optional)" subtitle="Shown as a thumbnail on the left side of the banner">
                                <PosterUploader
                                    value={editing.image_url}
                                    onChange={(url) => setEditing({ ...editing, image_url: url })}
                                />
                            </SectionCard>

                            <SectionCard title="Appearance" subtitle="Banner color + whether users can dismiss it">
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 12 }}>
                                    {ANNOUNCEMENT_TYPES.map(t => {
                                        const active = editing.type === t.value;
                                        return (
                                            <button
                                                key={t.value}
                                                type="button"
                                                onClick={() => setEditing({ ...editing, type: t.value })}
                                                style={{
                                                    border: `2px solid ${active ? t.accent : 'var(--border-subtle)'}`,
                                                    background: active ? `${t.accent}22` : 'var(--bg-primary)',
                                                    color: active ? t.accent : 'var(--text-muted)',
                                                    borderRadius: 10,
                                                    padding: '10px 6px',
                                                    fontSize: 12,
                                                    fontWeight: 600,
                                                    cursor: 'pointer',
                                                    transition: 'all 120ms ease'
                                                }}
                                            >
                                                <div style={{ fontSize: 18 }}>{t.icon}</div>
                                                {t.label}
                                            </button>
                                        );
                                    })}
                                </div>
                                <Form.Check
                                    type="switch"
                                    label="Allow users to dismiss (hidden for their session after clicking ×)"
                                    checked={!!editing.dismissible}
                                    onChange={e => setEditing({ ...editing, dismissible: e.target.checked })}
                                />
                            </SectionCard>

                            <SectionCard title="Schedule" subtitle="Leave blank to show immediately and indefinitely">
                                <div className="d-flex gap-2">
                                    <Form.Group className="flex-fill">
                                        <Form.Label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Starts at</Form.Label>
                                        <Form.Control size="sm" type="datetime-local" value={editing.starts_at || ''}
                                            onChange={e => setEditing({ ...editing, starts_at: e.target.value })} />
                                    </Form.Group>
                                    <Form.Group className="flex-fill">
                                        <Form.Label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Ends at</Form.Label>
                                        <Form.Control size="sm" type="datetime-local" value={editing.ends_at || ''}
                                            onChange={e => setEditing({ ...editing, ends_at: e.target.value })} />
                                    </Form.Group>
                                </div>
                                <div className="mt-3">
                                    <Form.Check
                                        type="switch"
                                        label="Active — turn off to hide without deleting"
                                        checked={!!editing.is_active}
                                        onChange={e => setEditing({ ...editing, is_active: e.target.checked })}
                                    />
                                </div>
                            </SectionCard>

                            {/* Live preview */}
                            {editing.title && editing.message && (
                                <SectionCard title="Preview" subtitle="How it'll appear in every workspace">
                                    <AnnouncementBanner
                                        a={{
                                            ...editing,
                                            type: editing.type || 'info'
                                        }}
                                        preview
                                    />
                                </SectionCard>
                            )}
                        </Modal.Body>

                        <Modal.Footer style={{ background: 'var(--bg-secondary)', borderTop: '1px solid var(--border-subtle)' }}>
                            <Button variant="outline-secondary" size="sm" onClick={() => setEditing(null)} disabled={saving}>Cancel</Button>
                            <Button className="btn-accent" size="sm" onClick={save} disabled={saving}>
                                {saving ? <><Spinner size="sm" className="me-1" /> Saving…</> : (editing.id ? 'Save changes' : 'Publish announcement')}
                            </Button>
                        </Modal.Footer>
                    </>
                )}
            </Modal>
        </div>
    );
}

// Drag-and-drop + click-to-upload poster picker for announcements. Uploads
// straight to /platform/announcements/poster and sets the returned image_url
// back on the parent form. Also supports pasting an external URL.
function PosterUploader({ value, onChange }) {
    const [uploading, setUploading] = useState(false);
    const [err, setErr] = useState('');

    const handleFile = async (file) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            setErr('Please pick an image file.');
            return;
        }
        if (file.size > 8 * 1024 * 1024) {
            setErr('Poster must be under 8 MB.');
            return;
        }
        setUploading(true); setErr('');
        try {
            const res = await uploadAnnouncementPoster(file);
            onChange(res.data.image_url);
        } catch (e) {
            setErr(e.response?.data?.error || 'Upload failed');
        } finally {
            setUploading(false);
        }
    };

    return (
        <div>
            {value ? (
                <div style={{
                    position: 'relative',
                    borderRadius: 10,
                    overflow: 'hidden',
                    border: '1px solid var(--border-subtle)',
                    background: '#0a0a1a',
                    maxWidth: 360
                }}>
                    <img src={getImageUrl(value)} alt="poster"
                         style={{ width: '100%', maxHeight: 200, objectFit: 'cover', display: 'block' }}
                         onError={(e) => { e.target.style.display = 'none'; }} />
                    <button
                        type="button"
                        onClick={() => onChange('')}
                        style={{
                            position: 'absolute', top: 8, right: 8,
                            background: 'rgba(0, 0, 0, 0.7)', color: '#fff',
                            border: 'none', borderRadius: 6, padding: '4px 10px',
                            fontSize: 11, cursor: 'pointer'
                        }}
                    >
                        Remove
                    </button>
                </div>
            ) : (
                <label style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    padding: '24px 16px',
                    border: '1.5px dashed var(--border-subtle)',
                    borderRadius: 10,
                    background: 'rgba(255, 255, 255, 0.02)',
                    cursor: 'pointer',
                    transition: 'border-color 150ms ease, background 150ms ease'
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}>
                    <div style={{ fontSize: 28, marginBottom: 6 }}>🖼️</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {uploading ? 'Uploading…' : 'Click to upload poster'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        PNG, JPG, or GIF · up to 8 MB
                    </div>
                    <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => handleFile(e.target.files?.[0])}
                        disabled={uploading}
                    />
                </label>
            )}
            <Form.Control
                size="sm"
                className="mt-2"
                placeholder="…or paste an external image URL"
                value={value || ''}
                onChange={(e) => onChange(e.target.value)}
            />
            {err && <div style={{ fontSize: 11, color: '#f87171', marginTop: 4 }}>{err}</div>}
        </div>
    );
}

// Full-width "post" style announcement. Larger than the thin banner — includes
// the poster prominently, the title, and the full message. Used on the tenant
// Dashboard above the greeting so broadcasts feel like a proper newsfeed item
// instead of a nag banner.
export function AnnouncementPost({ a, onDismiss }) {
    const typeMeta = ANNOUNCEMENT_TYPES.find(t => t.value === a.type) || ANNOUNCEMENT_TYPES[0];
    const hasPoster = !!a.image_url;
    return (
        <div style={{
            position: 'relative',
            borderRadius: 16,
            overflow: 'hidden',
            marginBottom: 20,
            background: `linear-gradient(135deg, ${typeMeta.accent}18, rgba(255, 255, 255, 0.02))`,
            border: `1px solid ${typeMeta.accent}55`,
            boxShadow: `0 10px 30px ${typeMeta.accent}20`,
            display: 'grid',
            gridTemplateColumns: hasPoster ? 'minmax(180px, 260px) 1fr' : '1fr',
            gap: 0,
            alignItems: 'stretch'
        }}>
            {hasPoster && (
                <div style={{
                    background: `url(${getImageUrl(a.image_url)}) center/cover no-repeat, ${typeMeta.accent}22`,
                    minHeight: 140
                }} />
            )}
            <div style={{ padding: '18px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    fontSize: 10, fontWeight: 700, letterSpacing: '0.12em',
                    textTransform: 'uppercase', color: typeMeta.accent, marginBottom: 6
                }}>
                    <span style={{ fontSize: 14 }}>{typeMeta.icon}</span> Platform {typeMeta.label}
                </div>
                <h5 style={{
                    margin: 0, fontSize: 18, fontWeight: 700,
                    color: 'var(--text-primary)', letterSpacing: '-0.01em', lineHeight: 1.25
                }}>
                    {a.title}
                </h5>
                {a.message && (
                    <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                        {a.message}
                    </p>
                )}
                {a.created_at && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10 }}>
                        Posted {new Date(a.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                )}
            </div>
            {a.dismissible && onDismiss && (
                <button
                    onClick={onDismiss}
                    aria-label="Dismiss"
                    style={{
                        position: 'absolute', top: 10, right: 12,
                        width: 28, height: 28, borderRadius: 8,
                        border: 'none',
                        background: 'rgba(0, 0, 0, 0.3)',
                        color: '#fff', fontSize: 18, lineHeight: 1,
                        cursor: 'pointer', display: 'flex',
                        alignItems: 'center', justifyContent: 'center'
                    }}
                >
                    ×
                </button>
            )}
        </div>
    );
}

// Shared banner renderer — used in the preview inside the edit modal AND in
// AppLayout to show active announcements across the app. onDismiss is provided
// when rendered inside a real banner; preview mode has no dismiss.
export function AnnouncementBanner({ a, onDismiss, preview }) {
    const typeMeta = ANNOUNCEMENT_TYPES.find(t => t.value === a.type) || ANNOUNCEMENT_TYPES[0];
    const hasPoster = !!a.image_url;
    return (
        <div style={{
            background: `linear-gradient(90deg, ${typeMeta.accent}33 0%, ${typeMeta.accent}11 100%)`,
            borderLeft: `4px solid ${typeMeta.accent}`,
            padding: hasPoster ? '10px 14px 10px 10px' : '10px 14px',
            fontSize: 13,
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: 12
        }}>
            {hasPoster && (
                <img
                    src={getImageUrl(a.image_url)}
                    alt=""
                    style={{
                        width: 44, height: 44, borderRadius: 8,
                        objectFit: 'cover', flexShrink: 0,
                        border: `2px solid ${typeMeta.accent}55`
                    }}
                    onError={(e) => { e.target.style.display = 'none'; }}
                />
            )}
            {!hasPoster && <span style={{ fontSize: 18 }}>{typeMeta.icon}</span>}
            <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{a.title}</strong> {a.message && <span style={{ color: 'var(--text-secondary)' }}>— {a.message}</span>}
            </div>
            {(a.dismissible || preview) && onDismiss && (
                <button
                    onClick={onDismiss}
                    aria-label="Dismiss"
                    style={{
                        border: 'none', background: 'transparent',
                        color: 'var(--text-muted)', fontSize: 18,
                        cursor: 'pointer', padding: '0 6px', lineHeight: 1, flexShrink: 0
                    }}
                >
                    ×
                </button>
            )}
        </div>
    );
}

