import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Form, Spinner, Alert, Badge, Row, Col } from 'react-bootstrap';
import {
    BsArrowLeft, BsClockHistory, BsArrowClockwise, BsDownload,
    BsCheckCircleFill, BsExclamationTriangleFill, BsXCircleFill,
    BsEnvelopePaperFill,
} from 'react-icons/bs';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { getEvent, getCertificateSendLog } from '../services/api';

// Dedicated "Send History" page. Lives at /events/:eventId/certificate-send-history.
// Three-zone layout:
//   1. Filter bar (date range, status, search) — single source of truth that
//      drives every query below.
//   2. KPI cards + stacked bar chart of daily sends.
//   3. Filtered detail table with CSV export.

const STATUSES = ['sent', 'skipped', 'failed'];

const STATUS_STYLE = {
    sent:    { bg: 'rgba(16,185,129,0.18)', fg: '#10b981' },
    skipped: { bg: 'rgba(245,158,11,0.18)', fg: '#f59e0b' },
    failed:  { bg: 'rgba(239,68,68,0.18)',  fg: '#ef4444' },
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
};

// Quick-pick range presets — wire into setFrom/setTo on click. "All time"
// resets to empty strings so the backend skips the date predicate entirely.
const RANGE_PRESETS = [
    { label: 'Today',     from: () => todayISO(),     to: () => todayISO() },
    { label: 'Last 7d',   from: () => daysAgoISO(6),  to: () => todayISO() },
    { label: 'Last 30d',  from: () => daysAgoISO(29), to: () => todayISO() },
    { label: 'Last 90d',  from: () => daysAgoISO(89), to: () => todayISO() },
    { label: 'All time',  from: () => '',             to: () => ''         },
];

function StatCard({ icon: Icon, label, value, color, hint }) {
    return (
        <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 14,
            padding: '18px 20px',
            display: 'flex', flexDirection: 'column', gap: 6,
            height: '100%',
        }}>
            <div className="d-flex align-items-center gap-2" style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                {Icon && <Icon size={13} style={{ color }} />} {label}
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>{value}</div>
            {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{hint}</div>}
        </div>
    );
}

// Recharts tooltip — dark theme to match the rest of the SaaS chrome.
function ChartTooltip({ active, payload, label }) {
    if (!active || !payload?.length) return null;
    return (
        <div style={{
            background: 'rgba(15,23,42,0.96)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 10,
            padding: '10px 14px',
            color: '#fff',
            fontSize: 12,
            boxShadow: '0 10px 30px rgba(0,0,0,0.4)',
        }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>{label}</div>
            {payload.map(p => (
                <div key={p.dataKey} style={{ color: p.color, marginTop: 2 }}>
                    {p.dataKey}: <strong>{p.value}</strong>
                </div>
            ))}
        </div>
    );
}

// Best-effort CSV builder — quotes any cell containing a comma, quote or
// newline. Keeps us off papaparse for a tiny job.
const toCsv = (rows) => {
    const headers = ['Sent at', 'Attendee', 'Email', 'Status', 'Reason', 'Sent by'];
    const esc = (v) => {
        const s = String(v ?? '');
        return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(',')];
    rows.forEach(r => {
        lines.push([
            new Date(r.sent_at).toISOString(),
            esc(r.attendee_name || ''),
            esc(r.attendee_email || ''),
            r.status,
            esc(r.reason || ''),
            esc(r.sent_by_name || ''),
        ].join(','));
    });
    return lines.join('\n');
};

export default function CertificateSendHistoryPage() {
    const { eventId } = useParams();
    const navigate = useNavigate();

    const [event, setEvent] = useState(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');

    // Default range = last 30 days; the operator can widen via preset or
    // pick custom dates. Empty strings = unfiltered (i.e., All time).
    const [from, setFrom] = useState(daysAgoISO(29));
    const [to, setTo] = useState(todayISO());
    const [status, setStatus] = useState('');
    const [q, setQ] = useState('');
    // `qDebounced` is what we actually ship to the backend, so typing
    // doesn't fire one request per keystroke.
    const [qDebounced, setQDebounced] = useState('');
    useEffect(() => {
        const t = setTimeout(() => setQDebounced(q), 300);
        return () => clearTimeout(t);
    }, [q]);

    const [rows, setRows] = useState([]);
    const [counts, setCounts] = useState({ sent: 0, skipped: 0, failed: 0, total: 0 });
    const [daily, setDaily] = useState([]);

    // First load — split out from the filter-driven fetch so we can show a
    // page-level spinner only on initial mount, not on every filter change.
    useEffect(() => {
        let cancelled = false;
        async function loadEvent() {
            try {
                const { data } = await getEvent(eventId);
                if (!cancelled) setEvent(data || null);
            } catch (err) {
                if (!cancelled) setError(err.response?.data?.error || 'Failed to load event');
            }
        }
        loadEvent();
        return () => { cancelled = true; };
    }, [eventId]);

    // Filter-driven fetch. Triggers on every filter change (debounced for
    // search) and refresh-button presses. `loading` only flips for the
    // first paint; subsequent fetches use `refreshing` so the UI stays put.
    useEffect(() => {
        let cancelled = false;
        async function load() {
            if (rows.length === 0 && counts.total === 0) setLoading(true);
            else setRefreshing(true);
            setError('');
            try {
                const filters = {};
                if (from) filters.from = from;
                if (to) filters.to = to;
                if (status) filters.status = status;
                if (qDebounced) filters.q = qDebounced;
                const { data } = await getCertificateSendLog(eventId, filters);
                if (cancelled) return;
                setRows(Array.isArray(data?.rows) ? data.rows : []);
                setCounts(data?.counts || { sent: 0, skipped: 0, failed: 0, total: 0 });
                setDaily(Array.isArray(data?.daily) ? data.daily : []);
            } catch (err) {
                if (!cancelled) setError(err.response?.data?.error || 'Failed to load history');
            } finally {
                if (!cancelled) { setLoading(false); setRefreshing(false); }
            }
        }
        load();
        return () => { cancelled = true; };
    // We intentionally don't include rows/counts in deps — they're set
    // _by_ this effect, so listing them would cause an infinite loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eventId, from, to, status, qDebounced]);

    const handlePreset = (preset) => {
        setFrom(preset.from());
        setTo(preset.to());
    };

    const handleExport = () => {
        if (!rows.length) return;
        const csv = toCsv(rows);
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const stamp = new Date().toISOString().slice(0, 10);
        a.download = `certificate-sends-event${eventId}-${stamp}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // Display-formatted dataset for the chart — bar labels are pretty
    // "5 Jun" so the X axis isn't a wall of YYYY-MM-DD timestamps.
    const chartData = useMemo(() => daily.map(d => {
        const dt = new Date(d.day);
        const label = dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
        return { ...d, label };
    }), [daily]);

    const successRate = counts.total > 0
        ? Math.round((counts.sent / counts.total) * 100)
        : 0;

    if (loading) {
        return (
            <div className="d-flex justify-content-center align-items-center" style={{ minHeight: 400 }}>
                <Spinner animation="border" style={{ color: '#8b5cf6' }} />
            </div>
        );
    }

    const activePreset = RANGE_PRESETS.find(p => p.from() === from && p.to() === to);

    return (
        <div className="animate-in">
            {/* Header */}
            <div className="page-header" style={{ marginBottom: 20 }}>
                <div className="d-flex align-items-center gap-3 mb-2 flex-wrap">
                    <button
                        type="button"
                        onClick={() => navigate(`/events/${eventId}/certificate-email-template`)}
                        title="Back to Email Template"
                        style={{
                            width: 36, height: 36, borderRadius: 10,
                            background: 'rgba(255,255,255,0.04)',
                            border: '1px solid var(--border-subtle)',
                            color: 'var(--text-primary)',
                            display: 'grid', placeItems: 'center',
                            cursor: 'pointer',
                        }}
                    >
                        <BsArrowLeft size={16} />
                    </button>
                    <div style={{ flex: 1, minWidth: 200 }}>
                        <div className="d-flex align-items-center gap-2 flex-wrap">
                            <BsClockHistory size={20} style={{ color: '#a78bfa' }} />
                            <h4 className="m-0" style={{ color: 'var(--text-primary)' }}>Certificate Send History</h4>
                            {refreshing && <Spinner size="sm" animation="border" style={{ color: '#8b5cf6' }} />}
                        </div>
                        <p className="m-0" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                            Audit log of every certificate emailed for <strong style={{ color: 'var(--text-primary)' }}>{event?.title || `event #${eventId}`}</strong>.
                        </p>
                    </div>
                    <div className="d-flex gap-2 flex-wrap">
                        <Button
                            variant="outline-light" size="sm"
                            onClick={() => navigate(`/events/${eventId}/certificate-email-template`)}
                            style={{ border: '1px solid var(--border-subtle)', borderRadius: 10 }}
                        >
                            <BsEnvelopePaperFill className="me-1" /> Email template
                        </Button>
                        <Button
                            variant="outline-light" size="sm"
                            onClick={handleExport}
                            disabled={!rows.length}
                            style={{ border: '1px solid var(--border-subtle)', borderRadius: 10 }}
                        >
                            <BsDownload className="me-1" /> Export CSV
                        </Button>
                    </div>
                </div>
                {error && (
                    <Alert variant="danger" className="py-2 mb-0" style={{ fontSize: 13 }} dismissible onClose={() => setError('')}>
                        {error}
                    </Alert>
                )}
            </div>

            {/* Filter bar */}
            <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 14,
                padding: '14px 18px',
                marginBottom: 18,
                display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
            }}>
                <div className="d-flex flex-wrap gap-1" role="group" aria-label="Date range presets">
                    {RANGE_PRESETS.map(p => {
                        const isActive = activePreset?.label === p.label;
                        return (
                            <button
                                key={p.label}
                                type="button"
                                onClick={() => handlePreset(p)}
                                style={{
                                    background: isActive ? 'linear-gradient(135deg, #8b5cf6, #ec4899)' : 'rgba(255,255,255,0.04)',
                                    border: '1px solid var(--border-subtle)',
                                    color: isActive ? '#fff' : 'var(--text-secondary)',
                                    fontSize: 12, fontWeight: 600,
                                    borderRadius: 8, padding: '5px 12px', cursor: 'pointer',
                                }}
                            >{p.label}</button>
                        );
                    })}
                </div>
                <div style={{ width: 1, height: 26, background: 'var(--border-subtle)' }} />
                <div className="d-flex align-items-center gap-2">
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>FROM</span>
                    <Form.Control
                        type="date" value={from}
                        onChange={(e) => setFrom(e.target.value)}
                        style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontSize: 12, padding: '5px 8px', width: 140 }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>TO</span>
                    <Form.Control
                        type="date" value={to}
                        onChange={(e) => setTo(e.target.value)}
                        style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontSize: 12, padding: '5px 8px', width: 140 }}
                    />
                </div>
                <div style={{ width: 1, height: 26, background: 'var(--border-subtle)' }} />
                <Form.Select
                    size="sm"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontSize: 12, maxWidth: 140 }}
                >
                    <option value="">All statuses</option>
                    {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </Form.Select>
                <Form.Control
                    size="sm"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search name or email…"
                    style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontSize: 12, flex: '1 1 220px', minWidth: 180 }}
                />
            </div>

            {/* KPI cards */}
            <Row className="g-3" style={{ marginBottom: 18 }}>
                <Col md={3} sm={6}>
                    <StatCard icon={BsClockHistory} label="Total" value={counts.total} color="#a78bfa" hint={from ? `${from} → ${to}` : 'All time'} />
                </Col>
                <Col md={3} sm={6}>
                    <StatCard icon={BsCheckCircleFill} label="Sent" value={counts.sent} color="#10b981" hint={`${successRate}% success rate`} />
                </Col>
                <Col md={3} sm={6}>
                    <StatCard icon={BsExclamationTriangleFill} label="Skipped" value={counts.skipped} color="#f59e0b" hint="usually no email on file" />
                </Col>
                <Col md={3} sm={6}>
                    <StatCard icon={BsXCircleFill} label="Failed" value={counts.failed} color="#ef4444" hint="SMTP / network errors" />
                </Col>
            </Row>

            {/* Daily chart */}
            <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 14,
                padding: '20px 22px',
                marginBottom: 18,
            }}>
                <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Daily activity</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Stacked bar: sent / skipped / failed per day.</div>
                    </div>
                </div>
                {chartData.length === 0 ? (
                    <div style={{
                        padding: 50, textAlign: 'center',
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px dashed var(--border-subtle)',
                        borderRadius: 10,
                        color: 'var(--text-muted)', fontSize: 13,
                    }}>
                        No data in the selected range.
                    </div>
                ) : (
                    <div style={{ width: '100%', height: 280 }}>
                        <ResponsiveContainer>
                            <BarChart data={chartData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                <XAxis dataKey="label" stroke="var(--text-muted)" style={{ fontSize: 11 }} />
                                <YAxis stroke="var(--text-muted)" style={{ fontSize: 11 }} allowDecimals={false} />
                                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(139,92,246,0.08)' }} />
                                <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" />
                                <Bar dataKey="sent"    stackId="a" fill="#10b981" radius={[0, 0, 0, 0]} />
                                <Bar dataKey="skipped" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                                <Bar dataKey="failed"  stackId="a" fill="#ef4444" radius={[6, 6, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>

            {/* Detail table */}
            <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 14,
                padding: '20px 22px',
            }}>
                <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Detail log</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {rows.length} record{rows.length === 1 ? '' : 's'} match the current filter (newest first).
                        </div>
                    </div>
                    <Button
                        variant="outline-light" size="sm"
                        onClick={() => { setFrom(daysAgoISO(29)); setTo(todayISO()); setStatus(''); setQ(''); }}
                        style={{ border: '1px solid var(--border-subtle)', borderRadius: 8 }}
                    >
                        <BsArrowClockwise className="me-1" /> Reset filters
                    </Button>
                </div>

                {rows.length === 0 ? (
                    <div style={{
                        padding: 40, textAlign: 'center',
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px dashed var(--border-subtle)',
                        borderRadius: 10,
                        color: 'var(--text-muted)', fontSize: 13,
                    }}>
                        No certificate emails match the current filter.
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
                        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'separate', borderSpacing: 0 }}>
                            <thead style={{ background: 'rgba(255,255,255,0.03)' }}>
                                <tr style={{ color: 'var(--text-muted)', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.06em' }}>
                                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }}>When</th>
                                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, borderBottom: '1px solid var(--border-subtle)' }}>Attendee</th>
                                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, borderBottom: '1px solid var(--border-subtle)' }}>Status</th>
                                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, borderBottom: '1px solid var(--border-subtle)' }}>Reason</th>
                                    <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }}>Sent by</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(r => {
                                    const style = STATUS_STYLE[r.status] || STATUS_STYLE.failed;
                                    const dt = new Date(r.sent_at);
                                    return (
                                        <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                            <td style={{ padding: '10px 14px', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                                <div>{dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                                                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
                                            </td>
                                            <td style={{ padding: '10px 14px', color: 'var(--text-primary)' }}>
                                                <div style={{ fontWeight: 600 }}>{r.attendee_name || '—'}</div>
                                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.attendee_email || 'no email'}</div>
                                            </td>
                                            <td style={{ padding: '10px 14px' }}>
                                                <Badge bg="" style={{ background: style.bg, color: style.fg, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                                    {r.status}
                                                </Badge>
                                            </td>
                                            <td style={{ padding: '10px 14px', color: 'var(--text-secondary)', fontSize: 12, maxWidth: 320 }}>
                                                {r.reason || '—'}
                                            </td>
                                            <td style={{ padding: '10px 14px', color: 'var(--text-secondary)', fontSize: 12, whiteSpace: 'nowrap' }}>
                                                {r.sent_by_name || '—'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
                {rows.length >= 500 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, textAlign: 'center' }}>
                        Showing the 500 most recent entries — narrow the date range or status filter to drill in further.
                    </div>
                )}
            </div>
        </div>
    );
}
