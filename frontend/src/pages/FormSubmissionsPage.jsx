import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Table, Modal, Form as BsForm } from 'react-bootstrap';
import { BsArrowLeft, BsTrash, BsDownload, BsEye, BsLink45Deg, BsCheck2, BsChevronLeft, BsChevronRight, BsCashCoin, BsGraphUp } from 'react-icons/bs';
import { getForm, getFormSubmissions, deleteFormSubmission } from '../services/api';

// View + export responses to one form. Answers are stored as a {fieldId: value}
// blob on each submission — we join them to the current field list for display.

// Collapse a submission value into a scalar string, handling the object-typed
// values (file upload, award category) the form builder can produce.
const asScalar = (v) => {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.join(', ');
    if (typeof v === 'object') {
        if (v.url) return v.name || v.url;                              // file
        if (v.sector_name || v.category_name) {                         // award category (sector → category → subcategory)
            return [v.sector_name, v.category_name, v.subcategory_name].filter(Boolean).join(' → ');
        }
        return JSON.stringify(v);
    }
    return String(v);
};

const renderValue = (v) => {
    if (v === null || v === undefined || v === '') return <span style={{ color: 'var(--text-muted)' }}>—</span>;
    if (typeof v === 'object' && v.url) {
        return <a href={v.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{v.name || 'Download'}</a>;
    }
    return asScalar(v);
};

const csvEscape = (v) => {
    if (v === null || v === undefined) return '';
    const s = Array.isArray(v) ? v.join('; ') : asScalar(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
};

const STATUS_OPTIONS = [
    { value: 'all',       label: 'All statuses' },
    { value: 'paid',      label: 'Paid' },
    { value: 'pending',   label: 'Pending' },
    { value: 'failed',    label: 'Failed' },
    { value: 'cancelled', label: 'Cancelled' },
    { value: 'none',      label: 'No payment' },
];

const STATUS_BADGE = {
    paid:      { cls: 'status-ongoing',  label: 'PAID' },
    pending:   { cls: 'status-upcoming', label: 'PENDING' },
    failed:    { cls: 'status-canceled', label: 'FAILED' },
    cancelled: { cls: 'status-canceled', label: 'CANCELLED' },
};

export default function FormSubmissionsPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [form, setForm] = useState(null);
    const [submissions, setSubmissions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('all');
    const [searchQ, setSearchQ] = useState('');
    const [dateFrom, setDateFrom] = useState('');      // YYYY-MM-DD, inclusive
    const [dateTo, setDateTo] = useState('');          // YYYY-MM-DD, inclusive
    const [awardFilter, setAwardFilter] = useState('all'); // "all" | sector_id | "sector_id/category_id" | "sector_id/category_id/subcategory_id"
    const [viewSub, setViewSub] = useState(null);
    const [copiedToken, setCopiedToken] = useState(null);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);

    const load = async () => {
        try {
            setLoading(true);
            const [{ data: f }, { data: s }] = await Promise.all([
                getForm(id),
                getFormSubmissions(id),
            ]);
            setForm(f);
            setSubmissions(Array.isArray(s) ? s : []);
        } catch { /* handled via empty states */ }
        finally { setLoading(false); }
    };

    useEffect(() => { load(); }, [id]);

    const fieldsInOrder = useMemo(() => form?.fields || [], [form]);
    const awardField = useMemo(
        () => fieldsInOrder.find(f => f.field_type === 'award_category') || null,
        [fieldsInOrder]
    );

    // Unique award paths actually present in the current submission set, so the
    // dropdown only offers options that match at least one row. Grouped by
    // depth: sector, sector+category, sector+category+subcategory.
    const awardOptions = useMemo(() => {
        if (!awardField) return [];
        const seen = new Map();
        submissions.forEach(sub => {
            const v = sub.data?.[awardField.id];
            if (!v || typeof v !== 'object' || !v.sector_id) return;
            // Every row contributes up to three unique prefixes.
            const chain = [
                { key: String(v.sector_id), label: v.sector_name, depth: 1 },
            ];
            if (v.category_id) chain.push({
                key: `${v.sector_id}/${v.category_id}`,
                label: `${v.sector_name} → ${v.category_name}`,
                depth: 2,
            });
            if (v.subcategory_id) chain.push({
                key: `${v.sector_id}/${v.category_id}/${v.subcategory_id}`,
                label: `${v.sector_name} → ${v.category_name} → ${v.subcategory_name}`,
                depth: 3,
            });
            chain.forEach(c => { if (!seen.has(c.key)) seen.set(c.key, c); });
        });
        return Array.from(seen.values()).sort((a, b) => {
            if (a.depth !== b.depth) return a.depth - b.depth;
            return a.label.localeCompare(b.label);
        });
    }, [awardField, submissions]);

    const filtered = useMemo(() => {
        const q = searchQ.trim().toLowerCase();
        // Inclusive ends: "from 2026-04-01 to 2026-04-01" should include everything
        // submitted that day. We push `to` to end-of-day locally.
        const fromTs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
        const toTs = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;
        // Award filter is a "/"-joined prefix: e.g. "7" = sector 7 and
        // everything under it; "7/12" = that specific category; etc.
        const awardParts = awardFilter !== 'all' ? awardFilter.split('/') : null;

        return submissions.filter(sub => {
            // Status filter — 'none' captures rows without any payment at all
            // (non-payment forms or paid-off path without a gateway touch).
            const status = sub.payment_status || 'none';
            if (statusFilter !== 'all' && statusFilter !== status) return false;

            if (fromTs || toTs) {
                const t = new Date(sub.submitted_at).getTime();
                if (fromTs && t < fromTs) return false;
                if (toTs && t > toTs) return false;
            }

            if (awardField && awardFilter !== 'all') {
                const v = sub.data?.[awardField.id];
                const hasAward = v && typeof v === 'object' && v.sector_id;
                if (awardFilter === 'none') {
                    if (hasAward) return false;
                } else {
                    if (!hasAward) return false;
                    const have = [v.sector_id, v.category_id, v.subcategory_id].map(x => x == null ? '' : String(x));
                    // Match as a prefix — picking "Sector" returns everything under it.
                    for (let i = 0; i < awardParts.length; i++) {
                        if (have[i] !== awardParts[i]) return false;
                    }
                }
            }

            if (!q) return true;
            // Search across IP, tier, payment ids, and every answer value.
            const hay = [
                sub.submitter_ip,
                sub.payment_tier_label,
                sub.payment_id,
                sub.payment_order_id,
                ...Object.values(sub.data || {}).map(asScalar),
            ].filter(Boolean).join(' ').toLowerCase();
            return hay.includes(q);
        });
    }, [submissions, statusFilter, searchQ, dateFrom, dateTo, awardFilter, awardField]);

    // Reset to page 1 whenever filters change so pagination doesn't strand the
    // user on an empty page past the new filtered length.
    useEffect(() => { setPage(1); }, [statusFilter, searchQ, dateFrom, dateTo, awardFilter, pageSize]);

    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    const currentPage = Math.min(page, totalPages);
    const paged = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return filtered.slice(start, start + pageSize);
    }, [filtered, currentPage, pageSize]);

    // Revenue & funnel metrics — computed from the filtered set so the KPIs
    // reflect the active status / date / search filters. "attempts" excludes
    // rows that never touched the gateway (status === 'none').
    const metrics = useMemo(() => {
        const paid = filtered.filter(s => s.payment_status === 'paid');
        const pending = filtered.filter(s => s.payment_status === 'pending');
        const failed = filtered.filter(s => s.payment_status === 'failed');
        const cancelled = filtered.filter(s => s.payment_status === 'cancelled');
        const attempts = paid.length + pending.length + failed.length + cancelled.length;
        const revenuePaise = paid.reduce((sum, s) => sum + (Number(s.payment_amount) || 0), 0);
        const currency = paid[0]?.payment_currency || form?.payment_currency || 'INR';

        // Top 5 tiers/categories by revenue among paid rows.
        const byTier = new Map();
        paid.forEach(s => {
            const key = s.payment_tier_label || '—';
            const cur = byTier.get(key) || { label: key, count: 0, paise: 0 };
            cur.count += 1;
            cur.paise += Number(s.payment_amount) || 0;
            byTier.set(key, cur);
        });
        const topTiers = Array.from(byTier.values()).sort((a, b) => b.paise - a.paise).slice(0, 5);

        // Last 14 days of paid revenue — bucketed by local YYYY-MM-DD.
        const days = [];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (let i = 13; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const key = d.toISOString().slice(0, 10);
            days.push({ key, label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), paise: 0 });
        }
        const dayMap = new Map(days.map(d => [d.key, d]));
        paid.forEach(s => {
            const k = new Date(s.submitted_at).toISOString().slice(0, 10);
            const bucket = dayMap.get(k);
            if (bucket) bucket.paise += Number(s.payment_amount) || 0;
        });
        const maxDay = days.reduce((m, d) => Math.max(m, d.paise), 0);

        return {
            paid, pending, failed, cancelled, attempts,
            revenuePaise, currency, topTiers, days, maxDay,
            conversion: attempts > 0 ? (paid.length / attempts) * 100 : 0,
        };
    }, [filtered, form]);

    const formatMoney = (paise, currency) => {
        const major = (Number(paise) || 0) / 100;
        try {
            return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 0 }).format(major);
        } catch {
            return `${currency || ''} ${major.toFixed(0)}`;
        }
    };

    const statusCounts = useMemo(() => {
        const counts = { all: submissions.length, paid: 0, pending: 0, failed: 0, cancelled: 0, none: 0 };
        submissions.forEach(s => { counts[s.payment_status || 'none'] = (counts[s.payment_status || 'none'] || 0) + 1; });
        return counts;
    }, [submissions]);

    const handleDelete = async (subId) => {
        if (!window.confirm('Delete this response?')) return;
        try { await deleteFormSubmission(id, subId); load(); }
        catch (err) { alert(err.response?.data?.error || 'Delete failed'); }
    };

    const buildRetryUrl = (token) => `${window.location.origin}/pay/${token}`;

    const copyRetryLink = async (token) => {
        try {
            await navigator.clipboard.writeText(buildRetryUrl(token));
            setCopiedToken(token);
            setTimeout(() => setCopiedToken(c => c === token ? null : c), 1800);
        } catch {
            window.prompt('Copy this link:', buildRetryUrl(token));
        }
    };

    const exportCsv = () => {
        if (!form || filtered.length === 0) return;
        const paid = !!form.payment_enabled;
        const header = [
            'Submitted at',
            ...fieldsInOrder.map(f => f.label),
            ...(paid ? ['Payment status', 'Tier', 'Amount', 'Currency', 'Payment ID', 'Order ID'] : []),
            'IP',
        ];
        const rows = filtered.map(sub => {
            const data = sub.data || {};
            return [
                new Date(sub.submitted_at).toISOString(),
                ...fieldsInOrder.map(f => data[f.id]),
                ...(paid ? [
                    sub.payment_status || '',
                    sub.payment_tier_label || '',
                    sub.payment_amount ? (sub.payment_amount / 100).toFixed(2) : '',
                    sub.payment_currency || '',
                    sub.payment_id || '',
                    sub.payment_order_id || '',
                ] : []),
                sub.submitter_ip || '',
            ].map(csvEscape).join(',');
        });
        const csv = [header.map(csvEscape).join(','), ...rows].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const safeTitle = (form.title || 'form').replace(/[^a-z0-9_-]+/gi, '_').toLowerCase();
        a.download = `${safeTitle}_responses_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    if (loading) return <div style={{ padding: 40, color: 'var(--text-muted)' }}>Loading responses…</div>;
    if (!form) return <div style={{ padding: 40, color: 'var(--text-muted)' }}>Form not found.</div>;

    const showRetryCol = !!form.payment_enabled;

    return (
        <div className="animate-in">
            <Button variant="link" className="mb-3 p-0 text-decoration-none text-white" onClick={() => navigate('/forms')}>
                <BsArrowLeft /> All Forms
            </Button>

            <div className="page-header d-flex justify-content-between align-items-center">
                <div>
                    <h4 className="m-0">{form.title} — Responses</h4>
                    <p className="text-white small m-0 opacity-75">
                        {submissions.length} response{submissions.length === 1 ? '' : 's'} collected
                        {filtered.length !== submissions.length && ` · ${filtered.length} shown`}
                    </p>
                </div>
                <div className="d-flex gap-2">
                    <Button variant="outline-light" size="sm" className="d-flex align-items-center gap-2"
                        onClick={exportCsv} disabled={filtered.length === 0}>
                        <BsDownload /> Export CSV
                    </Button>
                </div>
            </div>

            {form.payment_enabled && submissions.length > 0 && (
                <RevenueDashboard metrics={metrics} formatMoney={formatMoney} />
            )}

            {submissions.length > 0 && (
                <div className="submissions-toolbar">
                    <BsForm.Control
                        type="search"
                        placeholder="Search answers, payment ID, IP…"
                        value={searchQ}
                        onChange={e => setSearchQ(e.target.value)}
                        size="sm"
                        className="submissions-search"
                    />
                    <div className="submissions-date-range">
                        <BsForm.Control
                            type="date"
                            size="sm"
                            value={dateFrom}
                            max={dateTo || undefined}
                            onChange={e => setDateFrom(e.target.value)}
                            className="submissions-date"
                            title="From date"
                        />
                        <span className="submissions-date-sep">→</span>
                        <BsForm.Control
                            type="date"
                            size="sm"
                            value={dateTo}
                            min={dateFrom || undefined}
                            onChange={e => setDateTo(e.target.value)}
                            className="submissions-date"
                            title="To date"
                        />
                        {(dateFrom || dateTo) && (
                            <button
                                type="button"
                                className="submissions-date-clear"
                                onClick={() => { setDateFrom(''); setDateTo(''); }}
                                title="Clear date range"
                            >×</button>
                        )}
                    </div>
                    {form.payment_enabled && (
                        <BsForm.Select
                            size="sm"
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value)}
                            className="submissions-status-select"
                        >
                            {STATUS_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label} ({statusCounts[opt.value] ?? 0})
                                </option>
                            ))}
                        </BsForm.Select>
                    )}
                    {awardField && (awardOptions.length > 0 || submissions.length > 0) && (
                        <BsForm.Select
                            size="sm"
                            value={awardFilter}
                            onChange={e => setAwardFilter(e.target.value)}
                            className="submissions-award-select"
                            title="Filter by award sector / category / subcategory"
                        >
                            <option value="all">All awards</option>
                            <option value="none">— No award selected —</option>
                            {awardOptions.map(o => (
                                <option key={o.key} value={o.key}>
                                    {'— '.repeat(o.depth - 1)}{o.label}
                                </option>
                            ))}
                        </BsForm.Select>
                    )}
                </div>
            )}

            {submissions.length === 0 ? (
                <div className="empty-state" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
                    <p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>No responses yet</p>
                    <p style={{ fontSize: '0.8rem' }}>Share your public link to start collecting.</p>
                </div>
            ) : filtered.length === 0 ? (
                <div className="empty-state" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
                    <p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>No responses match these filters</p>
                    <p style={{ fontSize: '0.8rem' }}>Try clearing the search or switching back to “All statuses”.</p>
                </div>
            ) : (
                <Table responsive className="premium-table">
                    <thead>
                        <tr>
                            <th style={{ width: 180 }}>Submitted</th>
                            {fieldsInOrder.map(f => <th key={f.id}>{f.label}</th>)}
                            {form.payment_enabled && <th style={{ width: 200 }}>Payment</th>}
                            {showRetryCol && <th style={{ width: 120 }}>Retry link</th>}
                            <th style={{ width: 110 }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {paged.map(sub => {
                            const status = sub.payment_status || 'none';
                            const badge = STATUS_BADGE[status];
                            const canRetry = showRetryCol && sub.payment_retry_token && status !== 'paid' && status !== 'none';
                            return (
                                <tr key={sub.id}>
                                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                                        {new Date(sub.submitted_at).toLocaleString()}
                                    </td>
                                    {fieldsInOrder.map(f => (
                                        <td key={f.id} style={{ fontSize: '0.85rem', maxWidth: 240, wordBreak: 'break-word' }}>
                                            {renderValue(sub.data?.[f.id])}
                                        </td>
                                    ))}
                                    {form.payment_enabled && (
                                        <td style={{ fontSize: '0.8rem' }}>
                                            {status === 'none' ? (
                                                <span style={{ color: 'var(--text-muted)' }}>—</span>
                                            ) : (
                                                <>
                                                    <span className={`badge-premium ${badge.cls}`}>{badge.label}</span>
                                                    <div style={{ color: 'var(--text-secondary)', marginTop: 4 }}>
                                                        {sub.payment_amount ? (sub.payment_amount / 100).toFixed(2) : '—'} {sub.payment_currency || ''}
                                                        {sub.payment_tier_label && <> · {sub.payment_tier_label}</>}
                                                    </div>
                                                    {sub.payment_id && (
                                                        <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: 2 }}>
                                                            <code>{sub.payment_id}</code>
                                                        </div>
                                                    )}
                                                    {!sub.payment_id && sub.payment_order_id && (
                                                        <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: 2 }}>
                                                            Order: <code>{sub.payment_order_id}</code>
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </td>
                                    )}
                                    {showRetryCol && (
                                        <td>
                                            {canRetry ? (
                                                <button
                                                    className="btn-action"
                                                    title="Copy shareable payment link"
                                                    onClick={() => copyRetryLink(sub.payment_retry_token)}
                                                    style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: '0.72rem' }}
                                                >
                                                    {copiedToken === sub.payment_retry_token
                                                        ? <><BsCheck2 size={13} /> Copied</>
                                                        : <><BsLink45Deg size={13} /> Copy link</>}
                                                </button>
                                            ) : (
                                                <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>—</span>
                                            )}
                                        </td>
                                    )}
                                    <td>
                                        <div style={{ display: 'flex', gap: 6 }}>
                                            <button className="btn-action" title="View" onClick={() => setViewSub(sub)}>
                                                <BsEye size={13} />
                                            </button>
                                            <button className="btn-action danger" title="Delete" onClick={() => handleDelete(sub.id)}>
                                                <BsTrash size={13} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </Table>
            )}

            {submissions.length > 0 && filtered.length > 0 && (
                <div className="submissions-pagination">
                    <div className="submissions-pagination-info">
                        Showing <strong>{((currentPage - 1) * pageSize) + 1}</strong>–<strong>{Math.min(currentPage * pageSize, filtered.length)}</strong> of <strong>{filtered.length}</strong>
                    </div>
                    <div className="submissions-pagination-controls">
                        <BsForm.Select
                            size="sm"
                            value={pageSize}
                            onChange={e => setPageSize(Number(e.target.value))}
                            className="submissions-page-size"
                        >
                            {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
                        </BsForm.Select>
                        <button
                            type="button"
                            className="submissions-page-btn"
                            disabled={currentPage <= 1}
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                        ><BsChevronLeft /></button>
                        <span className="submissions-page-pos">Page {currentPage} / {totalPages}</span>
                        <button
                            type="button"
                            className="submissions-page-btn"
                            disabled={currentPage >= totalPages}
                            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                        ><BsChevronRight /></button>
                    </div>
                </div>
            )}

            <ResponseModal
                sub={viewSub}
                form={form}
                fields={fieldsInOrder}
                onClose={() => setViewSub(null)}
                onCopyLink={copyRetryLink}
                copiedToken={copiedToken}
                buildRetryUrl={buildRetryUrl}
            />

            <style>{`
                .submissions-toolbar {
                    display: flex; flex-wrap: wrap; gap: 14px;
                    align-items: center; margin: 16px 0 14px;
                    padding: 12px 14px;
                    background: var(--bg-card);
                    border: 1px solid var(--border-subtle);
                    border-radius: var(--radius-md);
                }
                .submissions-search {
                    max-width: 320px; min-width: 220px; flex: 1 1 240px;
                    background: var(--bg-input, rgba(255,255,255,0.05)) !important;
                    color: var(--text-primary) !important;
                    border-color: var(--border-subtle) !important;
                }
                .submissions-search::placeholder { color: var(--text-muted); }
                .submissions-status-select {
                    max-width: 220px; min-width: 180px; flex: 0 1 200px;
                    background: var(--bg-input, rgba(255,255,255,0.05)) !important;
                    color: var(--text-primary) !important;
                    border-color: var(--border-subtle) !important;
                }
                .submissions-award-select {
                    max-width: 280px; min-width: 200px; flex: 0 1 260px;
                    background: var(--bg-input, rgba(255,255,255,0.05)) !important;
                    color: var(--text-primary) !important;
                    border-color: var(--border-subtle) !important;
                }

                .submissions-date-range {
                    display: inline-flex; align-items: center; gap: 6px;
                    flex: 0 1 auto;
                }
                .submissions-date {
                    width: 150px;
                    background: var(--bg-input, rgba(255,255,255,0.05)) !important;
                    color: var(--text-primary) !important;
                    border-color: var(--border-subtle) !important;
                    color-scheme: dark;
                }
                .submissions-date-sep { color: var(--text-muted); font-size: 0.85rem; }
                .submissions-date-clear {
                    width: 24px; height: 24px;
                    border-radius: 50%;
                    background: var(--bg-input, rgba(255,255,255,0.08));
                    color: var(--text-secondary);
                    border: 1px solid var(--border-subtle);
                    cursor: pointer;
                    line-height: 1;
                    font-size: 1rem;
                    padding: 0;
                }
                .submissions-date-clear:hover { color: var(--text-primary); border-color: var(--accent); }

                .submissions-pagination {
                    display: flex; flex-wrap: wrap; gap: 12px;
                    justify-content: space-between; align-items: center;
                    margin-top: 14px; padding: 10px 14px;
                    background: var(--bg-card);
                    border: 1px solid var(--border-subtle);
                    border-radius: var(--radius-md);
                    font-size: 0.82rem; color: var(--text-secondary);
                }
                .submissions-pagination-info strong { color: var(--text-primary); }
                .submissions-pagination-controls {
                    display: inline-flex; align-items: center; gap: 8px;
                }
                .submissions-page-size {
                    width: 120px;
                    background: var(--bg-input, rgba(255,255,255,0.05)) !important;
                    color: var(--text-primary) !important;
                    border-color: var(--border-subtle) !important;
                }
                .submissions-page-btn {
                    width: 30px; height: 30px;
                    border-radius: 8px;
                    background: transparent;
                    border: 1px solid var(--border-subtle);
                    color: var(--text-secondary);
                    display: inline-flex; align-items: center; justify-content: center;
                    cursor: pointer;
                    transition: all 0.12s;
                }
                .submissions-page-btn:hover:not(:disabled) { color: var(--text-primary); border-color: var(--accent); }
                .submissions-page-btn:disabled { opacity: 0.35; cursor: not-allowed; }
                .submissions-page-pos { color: var(--text-secondary); min-width: 96px; text-align: center; }

                .revenue-dash {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                    gap: 10px;
                    margin: 0 0 14px;
                }
                .revenue-kpi {
                    padding: 14px 16px;
                    background: var(--bg-card);
                    border: 1px solid var(--border-subtle);
                    border-radius: var(--radius-md);
                }
                .revenue-kpi-label {
                    font-size: 0.68rem;
                    letter-spacing: 0.1em;
                    text-transform: uppercase;
                    color: var(--text-muted);
                    font-weight: 700;
                }
                .revenue-kpi-value {
                    color: var(--text-primary);
                    font-size: 1.35rem;
                    font-weight: 800;
                    margin-top: 4px;
                    line-height: 1.2;
                }
                .revenue-kpi-sub { font-size: 0.72rem; color: var(--text-secondary); margin-top: 2px; }
                .revenue-kpi.revenue-hero {
                    background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 18%, var(--bg-card)), var(--bg-card));
                    border-color: color-mix(in srgb, var(--accent) 40%, var(--border-subtle));
                }
                .revenue-kpi.revenue-hero .revenue-kpi-value { color: var(--accent); }

                .revenue-extra {
                    display: grid;
                    grid-template-columns: minmax(260px, 1fr) minmax(260px, 1.2fr);
                    gap: 12px;
                    margin-bottom: 14px;
                }
                @media (max-width: 780px) { .revenue-extra { grid-template-columns: 1fr; } }

                .revenue-panel {
                    padding: 14px 16px;
                    background: var(--bg-card);
                    border: 1px solid var(--border-subtle);
                    border-radius: var(--radius-md);
                }
                .revenue-panel-title {
                    display: flex; align-items: center; gap: 8px;
                    font-size: 0.7rem;
                    letter-spacing: 0.1em;
                    text-transform: uppercase;
                    color: var(--text-muted);
                    font-weight: 700;
                    margin-bottom: 10px;
                }
                .revenue-tier-row {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 7px 0;
                    font-size: 0.85rem;
                    border-bottom: 1px dashed var(--border-subtle);
                }
                .revenue-tier-row:last-child { border-bottom: none; }
                .revenue-tier-label { color: var(--text-primary); flex: 1; min-width: 0; word-break: break-word; }
                .revenue-tier-count { color: var(--text-muted); font-size: 0.72rem; margin: 0 10px; white-space: nowrap; }
                .revenue-tier-amount { color: var(--accent); font-weight: 700; white-space: nowrap; }

                .revenue-spark {
                    display: flex; align-items: flex-end; gap: 3px;
                    height: 64px; margin-bottom: 6px;
                }
                .revenue-spark-col {
                    flex: 1;
                    background: color-mix(in srgb, var(--accent) 55%, transparent);
                    border-radius: 3px 3px 0 0;
                    min-height: 2px;
                    transition: background 0.15s;
                }
                .revenue-spark-col:hover { background: var(--accent); }
                .revenue-spark-labels {
                    display: flex; justify-content: space-between;
                    font-size: 0.65rem; color: var(--text-muted);
                }
            `}</style>
        </div>
    );
}

function RevenueDashboard({ metrics, formatMoney }) {
    const { revenuePaise, currency, paid, pending, failed, cancelled, attempts, conversion, topTiers, days, maxDay } = metrics;
    if (attempts === 0 && revenuePaise === 0) return null;
    return (
        <>
            <div className="revenue-dash">
                <div className="revenue-kpi revenue-hero">
                    <div className="revenue-kpi-label d-flex align-items-center gap-1">
                        <BsCashCoin /> Revenue
                    </div>
                    <div className="revenue-kpi-value">{formatMoney(revenuePaise, currency)}</div>
                    <div className="revenue-kpi-sub">{paid.length} paid submission{paid.length === 1 ? '' : 's'}</div>
                </div>
                <div className="revenue-kpi">
                    <div className="revenue-kpi-label">Conversion</div>
                    <div className="revenue-kpi-value">{conversion.toFixed(0)}%</div>
                    <div className="revenue-kpi-sub">{paid.length} of {attempts} attempt{attempts === 1 ? '' : 's'}</div>
                </div>
                <div className="revenue-kpi">
                    <div className="revenue-kpi-label">Pending</div>
                    <div className="revenue-kpi-value">{pending.length}</div>
                    <div className="revenue-kpi-sub">awaiting completion</div>
                </div>
                <div className="revenue-kpi">
                    <div className="revenue-kpi-label">Failed</div>
                    <div className="revenue-kpi-value">{failed.length}</div>
                    <div className="revenue-kpi-sub">gateway errors</div>
                </div>
                <div className="revenue-kpi">
                    <div className="revenue-kpi-label">Cancelled</div>
                    <div className="revenue-kpi-value">{cancelled.length}</div>
                    <div className="revenue-kpi-sub">closed checkout</div>
                </div>
            </div>

            {(topTiers.length > 0 || maxDay > 0) && (
                <div className="revenue-extra">
                    <div className="revenue-panel">
                        <div className="revenue-panel-title"><BsGraphUp /> Top tiers / categories</div>
                        {topTiers.length === 0 ? (
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', fontStyle: 'italic' }}>No paid submissions yet.</div>
                        ) : topTiers.map(t => (
                            <div key={t.label} className="revenue-tier-row">
                                <span className="revenue-tier-label" title={t.label}>{t.label}</span>
                                <span className="revenue-tier-count">×{t.count}</span>
                                <span className="revenue-tier-amount">{formatMoney(t.paise, currency)}</span>
                            </div>
                        ))}
                    </div>
                    <div className="revenue-panel">
                        <div className="revenue-panel-title"><BsGraphUp /> Revenue · last 14 days</div>
                        {maxDay === 0 ? (
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', fontStyle: 'italic' }}>No paid revenue in this window.</div>
                        ) : (
                            <>
                                <div className="revenue-spark">
                                    {days.map(d => (
                                        <div
                                            key={d.key}
                                            className="revenue-spark-col"
                                            style={{ height: `${(d.paise / maxDay) * 100}%` }}
                                            title={`${d.label}: ${formatMoney(d.paise, currency)}`}
                                        />
                                    ))}
                                </div>
                                <div className="revenue-spark-labels">
                                    <span>{days[0].label}</span>
                                    <span>{days[days.length - 1].label}</span>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}

function ResponseModal({ sub, form, fields, onClose, onCopyLink, copiedToken, buildRetryUrl }) {
    if (!sub || !form) return null;
    const status = sub.payment_status || 'none';
    const badge = STATUS_BADGE[status];
    const canRetry = form.payment_enabled && sub.payment_retry_token && status !== 'paid' && status !== 'none';
    const retryUrl = sub.payment_retry_token ? buildRetryUrl(sub.payment_retry_token) : '';
    const paymentNote = sub.data?._payment_note;

    return (
        <Modal show={!!sub} onHide={onClose} size="lg" centered className="premium-modal">
            <Modal.Header closeButton closeVariant="white">
                <Modal.Title>Response #{sub.id}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 18, fontSize: '0.85rem' }}>
                    <div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Submitted</div>
                        <div>{new Date(sub.submitted_at).toLocaleString()}</div>
                    </div>
                    {sub.submitter_ip && (
                        <div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>IP</div>
                            <code style={{ background: 'var(--bg-input, rgba(255,255,255,0.05))', padding: '2px 8px', borderRadius: 6 }}>{sub.submitter_ip}</code>
                        </div>
                    )}
                    {form.payment_enabled && status !== 'none' && (
                        <div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>Payment</div>
                            <span className={`badge-premium ${badge.cls}`}>{badge.label}</span>
                        </div>
                    )}
                </div>

                {form.payment_enabled && status !== 'none' && (
                    <div style={{ background: 'var(--bg-card-elevated, rgba(255,255,255,0.02))', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '12px 14px', marginBottom: 18 }}>
                        <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 8 }}>Payment details</div>
                        <div className="response-kv">
                            <span>Amount</span>
                            <span>{sub.payment_amount ? (sub.payment_amount / 100).toFixed(2) : '—'} {sub.payment_currency || ''}</span>
                        </div>
                        {sub.payment_tier_label && (
                            <div className="response-kv">
                                <span>Tier / Category</span>
                                <span>{sub.payment_tier_label}</span>
                            </div>
                        )}
                        {sub.payment_id && (
                            <div className="response-kv">
                                <span>Payment ID</span>
                                <code>{sub.payment_id}</code>
                            </div>
                        )}
                        {sub.payment_order_id && (
                            <div className="response-kv">
                                <span>Order ID</span>
                                <code>{sub.payment_order_id}</code>
                            </div>
                        )}
                        {paymentNote && (
                            <div className="response-kv">
                                <span>Note</span>
                                <span style={{ fontStyle: 'italic', color: 'var(--text-secondary)' }}>{paymentNote}</span>
                            </div>
                        )}
                        {canRetry && (
                            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--border-subtle)' }}>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                                    Share this link with the customer so they can retry or complete payment:
                                </div>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <code style={{ flex: 1, minWidth: 220, background: 'var(--bg-input, rgba(255,255,255,0.05))', padding: '6px 10px', borderRadius: 6, fontSize: '0.78rem', wordBreak: 'break-all' }}>
                                        {retryUrl}
                                    </code>
                                    <Button
                                        size="sm"
                                        variant={copiedToken === sub.payment_retry_token ? 'success' : 'outline-light'}
                                        onClick={() => onCopyLink(sub.payment_retry_token)}
                                        className="d-flex align-items-center gap-2"
                                    >
                                        {copiedToken === sub.payment_retry_token
                                            ? <><BsCheck2 /> Copied</>
                                            : <><BsLink45Deg /> Copy</>}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 10 }}>Answers</div>
                <div className="response-answers">
                    {fields.map(f => (
                        <div key={f.id} className="response-answer">
                            <div className="response-answer-label">{f.label}</div>
                            <div className="response-answer-value">{renderValue(sub.data?.[f.id])}</div>
                        </div>
                    ))}
                </div>
            </Modal.Body>
            <Modal.Footer>
                <Button variant="outline-light" onClick={onClose}>Close</Button>
            </Modal.Footer>
            <style>{`
                .response-kv {
                    display: flex; justify-content: space-between; gap: 12px;
                    padding: 4px 0; font-size: 0.85rem;
                }
                .response-kv > span:first-child { color: var(--text-muted); }
                .response-kv code {
                    background: var(--bg-input, rgba(255,255,255,0.05));
                    padding: 2px 8px; border-radius: 6px; font-size: 0.78rem;
                    word-break: break-all;
                }
                .response-answers { display: flex; flex-direction: column; gap: 10px; }
                .response-answer {
                    padding: 10px 12px;
                    background: var(--bg-input, rgba(255,255,255,0.03));
                    border: 1px solid var(--border-subtle);
                    border-radius: 10px;
                }
                .response-answer-label {
                    font-size: 0.72rem; text-transform: uppercase;
                    letter-spacing: 0.06em; color: var(--text-muted);
                    margin-bottom: 4px;
                }
                .response-answer-value {
                    font-size: 0.9rem; color: var(--text-primary);
                    word-break: break-word;
                }
            `}</style>
        </Modal>
    );
}
