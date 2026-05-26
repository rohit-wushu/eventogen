import { useState, useEffect } from 'react';
import { Row, Col } from 'react-bootstrap';
import { Bar, Doughnut } from 'react-chartjs-2';
import { BsCalendarEvent, BsPersonBadge, BsBriefcase, BsListTask, BsArrowUpRight, BsPeopleFill, BsCurrencyRupee } from 'react-icons/bs';
import { getEvents, getSpeakers, getPartners, getAgendas, getAttendees, getTravelStats, getUsers } from '../services/api';
import { useAuth } from '../context/AuthContext';
import DashboardAnnouncements from '../components/DashboardAnnouncements';

export default function DashboardPage() {
    const { user } = useAuth();
    const [stats, setStats] = useState({ events: 0, speakers: 0, partners: 0, agendas: 0, attendees: 0, travelBudget: 0 });
    const [recentEvents, setRecentEvents] = useState([]);

    const [chartData, setChartData] = useState({ labels: [], values: [] });
    const [userStats, setUserStats] = useState({ admins: 0, managers: 0, employees: 0 });
    const [employeeAgendas, setEmployeeAgendas] = useState([]);
    const [employeeEvent, setEmployeeEvent] = useState(null);
    const [fetchError, setFetchError] = useState(null);

    useEffect(() => {
        const loadStats = async () => {
            try {
                const [e, s, p, a, u, att, tr] = await Promise.all([
                    getEvents().catch(err => ({ data: [], error: err.message, status: err.response?.status || 500 })),
                    getSpeakers().catch(err => ({ data: [], error: err.message, status: err.response?.status || 500 })),
                    getPartners().catch(err => ({ data: [], error: err.message, status: err.response?.status || 500 })),
                    getAgendas().catch(err => ({ data: [], error: err.message, status: err.response?.status || 500 })),
                    getUsers().catch(err => ({ data: [], error: err.message, status: err.response?.status || 500 })),
                    getAttendees().catch(err => ({ data: [], error: err.message, status: err.response?.status || 500 })),
                    getTravelStats().catch(err => ({ data: { totalCost: 0 }, error: err.message, status: err.response?.status || 500 }))
                ]);

                console.log('Dashboard Debug - User:', user);
                console.log('API Responses:', { events: e.data, speakers: s.data, partners: p.data, agendas: a.data, users: u.data });

                if (e.status < 400 && s.status < 400 && p.status < 400) {
                    setStats({
                        events: Array.isArray(e.data) ? e.data.length : 0,
                        speakers: Array.isArray(s.data) ? s.data.length : 0,
                        partners: Array.isArray(p.data) ? p.data.length : 0,
                        agendas: Array.isArray(a.data) ? a.data.length : 0,
                        attendees: Array.isArray(att.data) ? att.data.length : 0,
                        travelBudget: tr.data?.totalCost || 0,
                    });
                } else {
                    const failed = [
                        e.status >= 400 && 'Events',
                        s.status >= 400 && 'Speakers',
                        p.status >= 400 && 'Partners'
                    ].filter(Boolean).join(', ');
                    setFetchError(`Failed to load: ${failed}. Please check if the server is running.`);
                }

                if (Array.isArray(e.data) && e.data.length > 0) {
                    setRecentEvents(e.data.slice(-5).reverse());
                    // ... (rest of chart data logic remains the same)

                    // Monthly data for chart
                    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const counts = new Array(12).fill(0);
                    e.data.forEach(ev => {
                        const date = new Date(ev.start_date);
                        if (!isNaN(date)) counts[date.getMonth()]++;
                    });

                    // Show last 6 months including current
                    const currentMonth = new Date().getMonth();
                    const filteredLabels = [];
                    const filteredValues = [];
                    for (let i = 5; i >= 0; i--) {
                        const idx = (currentMonth - i + 12) % 12;
                        filteredLabels.push(months[idx]);
                        filteredValues.push(counts[idx]);
                    }
                    setChartData({ labels: filteredLabels, values: filteredValues });

                    // Find assigned event for employee or manager
                    if (['employee', 'manager'].includes(user?.role) && user?.assigned_event_id) {
                        const found = e.data.find(ev => String(ev.id) === String(user.assigned_event_id));
                        console.log('Dashboard Debug - Found assigned event:', found);
                        setEmployeeEvent(found);
                    }
                }

                if (['employee', 'manager'].includes(user?.role) && Array.isArray(a.data)) {
                    setEmployeeAgendas(a.data);
                }

                if (Array.isArray(u.data)) {
                    const counts = { admins: 0, managers: 0, employees: 0 };
                    u.data.forEach(user => {
                        if (user.role === 'admin') counts.admins++;
                        else if (user.role === 'manager') counts.managers++;
                        else counts.employees++;
                    });
                    setUserStats(counts);
                }
            } catch (err) {
                console.error('Dashboard Stats Error:', err);
            }
        };
        loadStats();
    }, [user?.assigned_event_id]);

    const cards = [
        { title: 'Events', value: stats.events, icon: BsCalendarEvent, color: 'purple' },
        { title: 'Speakers', value: stats.speakers, icon: BsPersonBadge, color: 'pink' },
        { title: 'Partners', value: stats.partners, icon: BsBriefcase, color: 'emerald' },
        { title: 'Agenda Items', value: stats.agendas, icon: BsListTask, color: 'amber' },
        { title: 'Attendees', value: stats.attendees, icon: BsPeopleFill, color: 'sky' },
        { title: 'Travel Budget', value: '₹' + Number(stats.travelBudget).toLocaleString('en-IN'), icon: BsCurrencyRupee, color: 'emerald' },
    ];

    return (
        <div className="animate-in dashboard-glass">
            {/* Platform announcements — rich posts above the greeting so broadcasts
                feel like a newsfeed item, not a nag banner. The thin banner in
                AppLayout still shows critical items at the very top. */}
            <DashboardAnnouncements />

            <div className="page-header">
                <h4>Welcome back, {user?.name} 👋</h4>
                <p className='text-white small'>Here's what's happening across your events.</p>
            </div>

            {fetchError && (
                <div className="alert alert-danger d-flex justify-content-between align-items-center">
                    <span>{fetchError}</span>
                    <button className="btn btn-sm btn-outline-danger" onClick={() => window.location.reload()}>Retry</button>
                </div>
            )}

            {/* Stat Cards */}
            <Row className="g-3 g-md-4 mb-4">
                {cards.map(c => {
                    const Icon = c.icon;
                    return (
                        <Col xs={6} md={4} key={c.title}>
                            <div className={`stat-card ${c.color}`}>
                                <div className="d-flex justify-content-between align-items-start gap-2">
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <div className="stat-value">{c.value}</div>
                                        <div className="stat-label">{c.title}</div>
                                    </div>
                                    <div className="stat-icon">
                                        <Icon />
                                    </div>
                                </div>
                            </div>
                        </Col>
                    );
                })}
            </Row>

            {/* Charts Row */}
            <Row className="mb-4">
                <Col md={8}>
                    <div style={{ background: 'var(--bg-card)', padding: 20, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', height: '100%' }}>
                        <h6 style={{ fontWeight: 700, marginBottom: 20, color: '#fff' }}>Events Overview</h6>
                        <div style={{ height: 300 }}>
                            <Bar data={{
                                labels: chartData.labels,
                                datasets: [{
                                    label: 'Events Held',
                                    data: chartData.values,
                                    backgroundColor: 'rgba(139, 92, 246, 0.5)',
                                    borderColor: 'rgba(139, 92, 246, 1)',
                                    borderWidth: 1,
                                    borderRadius: 4
                                }]
                            }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { stepSize: 1, color: '#94a3b8' } }, x: { grid: { display: false }, ticks: { color: '#94a3b8' } } } }} />
                        </div>
                    </div>
                </Col>
                <Col md={4}>
                    <div style={{ background: 'var(--bg-card)', padding: 20, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', height: '100%' }}>
                        <h6 style={{ fontWeight: 700, marginBottom: 20, color: '#fff' }}>User Distribution</h6>
                        <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Doughnut data={{
                                labels: ['Admins', 'Managers', 'Employees'],
                                datasets: [{
                                    data: [userStats.admins, userStats.managers, userStats.employees],
                                    backgroundColor: [
                                        'rgba(236, 72, 153, 0.6)',
                                        'rgba(16, 185, 129, 0.6)',
                                        'rgba(59, 130, 246, 0.6)'
                                    ],
                                    borderColor: [
                                        'rgba(236, 72, 153, 1)',
                                        'rgba(16, 185, 129, 1)',
                                        'rgba(59, 130, 246, 1)'
                                    ],
                                    borderWidth: 1
                                }]
                            }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8' } } } }} />
                        </div>
                    </div>
                </Col>
            </Row>

            {['employee', 'manager'].includes(user?.role) && (
                <Row className="mb-4">
                    <Col md={12}>
                        <div style={{ background: 'var(--bg-card)', padding: 20, borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
                            <div className="d-flex justify-content-between align-items-center mb-3">
                                <h6 style={{ fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                                    <BsBriefcase color="var(--accent)" /> My Assignment
                                </h6>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                    Token Event ID: {user?.assigned_event_id || 'None'}
                                </div>
                            </div>

                            {/* Assigned Task Banner */}
                            {user?.assigned_task && (
                                <div className="mb-3 p-3 d-flex align-items-start gap-3" style={{ background: 'rgba(139,92,246,0.08)', borderRadius: 12, border: '1px solid rgba(139,92,246,0.2)' }}>
                                    <BsListTask size={20} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
                                    <div>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Assigned Task</div>
                                        <div style={{ fontSize: '0.9rem', color: '#fff', lineHeight: 1.5 }}>{user.assigned_task}</div>
                                    </div>
                                </div>
                            )}

                            {employeeEvent ? (
                                <Row className="g-4">
                                    <Col md={5}>
                                        <div className="p-3" style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid var(--border-subtle)', height: '100%' }}>
                                            <h5 style={{ color: '#05ed99', fontWeight: 700, marginBottom: 12 }}>{employeeEvent.title}</h5>
                                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 15 }}>{employeeEvent.description}</p>
                                            <div className="d-flex align-items-center gap-2 mb-2" style={{ fontSize: '0.85rem' }}>
                                                <BsCalendarEvent color="var(--text-muted)" /> <span style={{ color: '#fff' }}>{employeeEvent.start_date}</span>
                                            </div>
                                            <div className="d-flex align-items-center gap-2 mb-3" style={{ fontSize: '0.85rem' }}>
                                                <span className="badge bg-secondary">Venue</span> <strong style={{ color: '#fff' }}>{employeeEvent.venue}</strong>
                                            </div>
                                        </div>
                                    </Col>
                                    <Col md={7}>
                                        <div className="p-3" style={{ background: 'rgba(255,255,255,0.02)', borderRadius: 12, border: '1px solid var(--border-subtle)', height: '100%' }}>
                                            <h6 style={{ color: '#fff', fontWeight: 600, marginBottom: 15, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 10 }}>Agenda Sessions</h6>
                                            {employeeAgendas.length === 0 ? (
                                                <div className="text-muted small">No agenda sessions assigned to this event yet.</div>
                                            ) : (
                                                <div style={{ maxHeight: 200, overflowY: 'auto', paddingRight: 5 }}>
                                                    {employeeAgendas.map(agenda => (
                                                        <div key={agenda.id} className="mb-2 p-2" style={{ background: 'rgba(139,92,246,0.05)', borderRadius: 8, borderLeft: '3px solid var(--accent)' }}>
                                                            <div className="d-flex justify-content-between align-items-center">
                                                                <strong style={{ fontSize: '0.85rem', color: '#fff' }}>{agenda.title}</strong>
                                                                <span style={{ fontSize: '0.75rem', color: 'var(--accent)' }}>Day {agenda.day_number} • {agenda.start_time} - {agenda.end_time}</span>
                                                            </div>
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>{agenda.description}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </Col>
                                </Row>
                            ) : (
                                !user?.assigned_task && (
                                    <div className="text-center p-4" style={{ background: 'rgba(239,68,68,0.05)', borderRadius: 12, border: '1px dashed rgba(239,68,68,0.2)' }}>
                                        <div className="mb-3 text-white opacity-75">
                                            {user?.assigned_event_id 
                                                ? `Assigned Event (ID: ${user.assigned_event_id}) not found or data transfer issue.` 
                                                : "You haven't been assigned to an event yet. If you were recently assigned, please log out and back in to refresh your access."}
                                        </div>
                                        <button className="btn btn-sm btn-outline-light" onClick={() => window.location.reload()}>Refresh Page</button>
                                    </div>
                                )
                            )}
                        </div>
                    </Col>
                </Row>
            )}

            {/* Recent Events */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                <div className="d-flex justify-content-between align-items-center p-3 px-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem', color: '#fff' }}>Recent Events</span>
                    <a href="/events" style={{ color: 'var(--accent)', fontSize: '0.8rem', fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                        View All <BsArrowUpRight size={12} />
                    </a>
                </div>
                {recentEvents.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state-icon"><BsCalendarEvent /></div>
                        <p style={{ fontWeight: 600, marginBottom: 4 }}>No Events Yet</p>
                        <p style={{ fontSize: '0.8rem' }}>
                            {user?.role === 'employee' ? 'Waiting for event assignment.' : 'Create your first event to get started.'}
                        </p>
                    </div>
                ) : (
                    <div>
                        {recentEvents.map(e => (
                            <div key={e.id} className="d-flex justify-content-between align-items-center px-4 py-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                                <div>
                                    <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#fff' }}>{e.title}</div>
                                    <div style={{ color: '#fff', fontSize: '0.8rem' }}>
                                        {e.venue} · {e.start_date} · <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{e.speaker_count || 0} Speakers</span>
                                    </div>
                                </div>
                                <span className={`badge-premium status-${e.status}`}>{e.status}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Dashboard glass — "Tinted Aurora" variant.
                Each stat card frosts in its own hue (radial wash from the
                top-left corner) with a coloured glow underneath, plus a
                diagonal sheen that sweeps across on hover. Premium cards
                get a neutral glass with two corner colour-glows. The body
                aurora (see index.css [data-theme="dark"] body) is what's
                actually behind the blur. Light mode is left untouched. */}
            <style>{`
                /* ── Stat cards (top tiles) ── */
                [data-theme="dark"] .dashboard-glass .stat-card {
                    --tint: #a78bfa;
                    background:
                        radial-gradient(140% 120% at 0% 0%,
                            color-mix(in srgb, var(--tint) 18%, transparent),
                            transparent 55%),
                        linear-gradient(160deg,
                            rgba(255, 255, 255, 0.10),
                            rgba(255, 255, 255, 0.02) 70%);
                    backdrop-filter: blur(28px) saturate(180%);
                    -webkit-backdrop-filter: blur(28px) saturate(180%);
                    border: 1px solid rgba(255, 255, 255, 0.10);
                    box-shadow:
                        0 14px 36px -14px rgba(0, 0, 0, 0.55),
                        0 0 28px -14px var(--tint),
                        inset 0 1px 0 rgba(255, 255, 255, 0.12),
                        inset 0 0 0 1px rgba(255, 255, 255, 0.02);
                    transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1),
                                box-shadow 0.3s,
                                border-color 0.3s;
                    position: relative;
                    overflow: hidden;
                }
                /* Per-tile colour tint (matches existing .purple/.pink/etc
                   modifiers on the stat-card markup). */
                [data-theme="dark"] .dashboard-glass .stat-card.purple  { --tint: #a78bfa; }
                [data-theme="dark"] .dashboard-glass .stat-card.pink    { --tint: #f472b6; }
                [data-theme="dark"] .dashboard-glass .stat-card.emerald { --tint: #34d399; }
                [data-theme="dark"] .dashboard-glass .stat-card.amber   { --tint: #fbbf24; }
                [data-theme="dark"] .dashboard-glass .stat-card.sky     { --tint: #38bdf8; }

                [data-theme="dark"] .dashboard-glass .stat-card:hover {
                    transform: translateY(-4px);
                    border-color: color-mix(in srgb, var(--tint) 30%, rgba(255, 255, 255, 0.15));
                    box-shadow:
                        0 22px 50px -16px rgba(0, 0, 0, 0.6),
                        0 0 48px -16px var(--tint),
                        inset 0 1px 0 rgba(255, 255, 255, 0.18);
                }

                /* ── Premium cards (event-of-the-day, recent events) ──
                   Neutral glass with two diagonal corner colour-glows so
                   they read as part of the same family without competing
                   with the tinted stat tiles above. */
                [data-theme="dark"] .dashboard-glass .premium-card {
                    background:
                        radial-gradient(120% 90% at 100% 0%,
                            rgba(167, 139, 250, 0.14),
                            transparent 55%),
                        radial-gradient(120% 90% at 0% 100%,
                            rgba(236, 72, 153, 0.10),
                            transparent 55%),
                        linear-gradient(160deg,
                            rgba(255, 255, 255, 0.08),
                            rgba(255, 255, 255, 0.02) 70%);
                    backdrop-filter: blur(28px) saturate(170%);
                    -webkit-backdrop-filter: blur(28px) saturate(170%);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    box-shadow:
                        0 14px 40px -16px rgba(0, 0, 0, 0.55),
                        inset 0 1px 0 rgba(255, 255, 255, 0.10);
                    transition: border-color 0.25s, box-shadow 0.25s;
                }
                [data-theme="dark"] .dashboard-glass .premium-card:hover {
                    border-color: rgba(255, 255, 255, 0.16);
                    box-shadow:
                        0 18px 50px -18px rgba(0, 0, 0, 0.6),
                        inset 0 1px 0 rgba(255, 255, 255, 0.16);
                }

                /* Nested inline surfaces inside the dashboard (event-of-
                   the-day blocks, agenda strip, recent-events rows) get
                   a lighter blur so they blend with the parent cards. */
                [data-theme="dark"] .dashboard-glass [style*="background: rgba(255,255,255,0.02)"],
                [data-theme="dark"] .dashboard-glass [style*="background: rgba(139,92,246,0.05)"],
                [data-theme="dark"] .dashboard-glass [style*="background: rgba(139,92,246,0.08)"] {
                    backdrop-filter: blur(14px) saturate(140%);
                    -webkit-backdrop-filter: blur(14px) saturate(140%);
                    border-color: rgba(255, 255, 255, 0.08) !important;
                }
                [data-theme="dark"] .dashboard-glass .empty-state {
                    background: rgba(255, 255, 255, 0.05);
                    backdrop-filter: blur(18px) saturate(150%);
                    -webkit-backdrop-filter: blur(18px) saturate(150%);
                    border: 1px solid rgba(255, 255, 255, 0.10);
                }

                @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
                    [data-theme="dark"] .dashboard-glass .premium-card,
                    [data-theme="dark"] .dashboard-glass .stat-card {
                        background: rgba(255, 255, 255, 0.08);
                    }
                }
            `}</style>
        </div>
    );
}
