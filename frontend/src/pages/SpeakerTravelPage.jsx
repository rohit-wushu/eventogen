import { useState, useEffect } from 'react';
import { Button, Modal, Form, Alert, Row, Col } from 'react-bootstrap';
import { useAuth } from '../context/AuthContext';
import { getAllTravel, createTravel, updateTravel, deleteTravel, getSpeakers } from '../services/api';
import { BsPlus, BsPencil, BsTrash, BsFunnel, BsGeoAlt, BsCalendar3, BsCurrencyRupee, BsTicketPerforated, BsAirplane, BsDownload, BsFileEarmarkPdf, BsFileEarmarkSpreadsheet } from 'react-icons/bs';
import jsPDF from 'jspdf';

const TYPE_META = {
    flight: { icon: '✈️', label: 'Flight', color: '#60a5fa' },
    hotel: { icon: '🏨', label: 'Hotel', color: '#fbbf24' },
    cab: { icon: '🚕', label: 'Cab', color: '#4ade80' },
    train: { icon: '🚆', label: 'Train', color: '#f472b6' },
    other: { icon: '📦', label: 'Other', color: '#94a3b8' },
};

const STATUS_COLORS = {
    pending: { bg: 'rgba(234,179,8,0.12)', color: '#facc15', border: 'rgba(234,179,8,0.25)' },
    booked: { bg: 'rgba(59,130,246,0.12)', color: '#60a5fa', border: 'rgba(59,130,246,0.25)' },
    confirmed: { bg: 'rgba(34,197,94,0.12)', color: '#4ade80', border: 'rgba(34,197,94,0.25)' },
    cancelled: { bg: 'rgba(239,68,68,0.12)', color: '#f87171', border: 'rgba(239,68,68,0.25)' },
};

const formatDate = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
const formatTime = (d) => {
    if (!d) return '';
    return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
};
const formatCost = (v) => {
    if (!v || v === 0) return '—';
    return '₹' + Number(v).toLocaleString('en-IN');
};

export default function SpeakerTravelPage() {
    const { user } = useAuth();
    const [records, setRecords] = useState([]);
    const [speakers, setSpeakers] = useState([]);
    const [show, setShow] = useState(false);
    const [editing, setEditing] = useState(null);
    const [error, setError] = useState('');
    const [filterSpeaker, setFilterSpeaker] = useState('');
    const [filterType, setFilterType] = useState('');
    const [selectedTypes, setSelectedTypes] = useState([]);

    const canManage = ['admin', 'manager'].includes(user?.role) || (user?.role === 'employee' && !!user?.assigned_event_id);

    const blankForm = {
        speaker_id: '', travel_type: 'flight', title: '', details: '',
        from_location: '', to_location: '', departure_date: '', arrival_date: '',
        booking_ref: '', cost: '', currency: 'INR', status: 'pending', notes: ''
    };
    const [form, setForm] = useState({ ...blankForm });

    const load = () => {
        getAllTravel(filterSpeaker || undefined).then(r => setRecords(Array.isArray(r.data) ? r.data : [])).catch(() => { });
    };

    useEffect(() => {
        getSpeakers().then(r => setSpeakers(Array.isArray(r.data) ? r.data : [])).catch(() => { });
    }, []);
    useEffect(() => { load(); }, [filterSpeaker]);

    const openModal = (item = null) => {
        if (item) {
            setEditing(item);
            setSelectedTypes([item.travel_type]);
            setForm({
                speaker_id: item.speaker_id, travel_type: item.travel_type || 'flight',
                title: item.title || '', details: item.details || '',
                from_location: item.from_location || '', to_location: item.to_location || '',
                departure_date: item.departure_date ? item.departure_date.slice(0, 16) : '',
                arrival_date: item.arrival_date ? item.arrival_date.slice(0, 16) : '',
                booking_ref: item.booking_ref || '', cost: item.cost || '',
                currency: item.currency || 'INR', status: item.status || 'pending',
                notes: item.notes || ''
            });
        } else {
            setEditing(null);
            setSelectedTypes(['flight']);
            setForm({ ...blankForm });
        }
        setError('');
        setShow(true);
    };

    const handleSave = async () => {
        if (!form.speaker_id) { setError('Please select a speaker'); return; }
        try {
            if (editing) {
                await updateTravel({ ...form, id: editing.id });
            } else {
                await createTravel(form);
            }
            setShow(false);
            load();
        } catch (err) { setError(err.response?.data?.error || 'Failed'); }
    };

    const handleDelete = async (id) => {
        if (window.confirm('Delete this travel record?')) { await deleteTravel(id); load(); }
    };

    const handleExportCSV = () => {
        const headers = ['Speaker', 'Type', 'Title', 'From', 'To', 'Departure', 'Arrival', 'Booking Ref', 'Cost', 'Currency', 'Status', 'Details'];
        const rows = filtered.map(r => [
            r.speaker_name || '', r.travel_type, r.title || '', r.from_location || '', r.to_location || '',
            r.departure_date ? new Date(r.departure_date).toLocaleString() : '',
            r.arrival_date ? new Date(r.arrival_date).toLocaleString() : '',
            r.booking_ref || '', r.cost || 0, r.currency || 'INR', r.status, r.details || ''
        ]);
        const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `travel-report-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    };

    const handleExportPDF = () => {
        const doc = new jsPDF();
        const pw = doc.internal.pageSize.getWidth();
        const margin = 14;
        const contentW = pw - margin * 2;
        let y = 0;
        const INR = (v) => 'INR ' + Number(v || 0).toLocaleString('en-IN');
        const truncate = (s, max) => { s = s || '-'; return s.length > max ? s.substring(0, max - 1) + '..' : s; };
        const filterLabel = filterSpeaker ? speakers.find(s => String(s.id) === String(filterSpeaker))?.name : 'All Speakers';

        // ── Header Banner ──
        doc.setFillColor(88, 48, 210);
        doc.rect(0, 0, pw, 44, 'F');
        doc.setFillColor(139, 92, 246);
        doc.rect(0, 0, pw, 36, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text('Travel Expense Report', margin, 16);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(`Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}   |   Records: ${filtered.length}   |   Speaker: ${filterLabel}   |   Type: ${filterType || 'All'}`, margin, 28);
        y = 54;

        // ── Cost Summary Cards ──
        doc.setFillColor(245, 247, 250);
        doc.roundedRect(margin, y, contentW, 36, 3, 3, 'F');
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(margin, y, contentW, 36, 3, 3, 'S');

        // Total
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(100, 116, 139);
        doc.text('TOTAL EXPENSE', margin + 6, y + 10);
        doc.setFontSize(18);
        doc.setTextColor(30, 41, 59);
        doc.text(INR(totalCost), margin + 6, y + 26);

        // Breakdown by type
        const types = Object.entries(costByType);
        if (types.length > 0) {
            const startX = 90;
            const gap = 30;
            doc.setFontSize(7);
            types.forEach(([type, cost], i) => {
                const x = startX + i * gap;
                doc.setTextColor(100, 116, 139);
                doc.setFont('helvetica', 'normal');
                doc.text((TYPE_META[type]?.label || type).toUpperCase(), x, y + 10);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(50, 60, 80);
                doc.text(INR(cost), x, y + 18);
            });
        }

        // Status counts
        const statusCounts = {};
        filtered.forEach(r => { statusCounts[r.status] = (statusCounts[r.status] || 0) + 1; });
        const statEntries = Object.entries(statusCounts);
        if (statEntries.length > 0) {
            const startX = 90;
            const gap = 30;
            doc.setFontSize(7);
            doc.setFont('helvetica', 'normal');
            statEntries.forEach(([status, count], i) => {
                doc.setTextColor(100, 116, 139);
                doc.text(`${status.charAt(0).toUpperCase() + status.slice(1)}: ${count}`, startX + i * gap, y + 28);
            });
        }

        y += 46;

        // ── Table ──
        const colDefs = [
            { header: 'Speaker', width: 30 },
            { header: 'Type', width: 18 },
            { header: 'Title', width: 28 },
            { header: 'Route', width: 32 },
            { header: 'Dates', width: 26 },
            { header: 'Ref', width: 20 },
            { header: 'Status', width: 18 },
            { header: 'Amount', width: 24 },
        ];
        const rowH = 9;
        const headerH = 8;

        const drawTableHeader = () => {
            doc.setFillColor(139, 92, 246);
            doc.rect(margin, y, contentW, headerH, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(7.5);
            doc.setFont('helvetica', 'bold');
            let cx = margin;
            colDefs.forEach(col => {
                doc.text(col.header, cx + 2, y + 5.5);
                cx += col.width;
            });
            y += headerH;
        };

        drawTableHeader();

        doc.setFontSize(7.5);
        filtered.forEach((r, idx) => {
            if (y > 272) {
                doc.addPage();
                y = 16;
                drawTableHeader();
            }

            // Alternate row
            if (idx % 2 === 0) {
                doc.setFillColor(250, 250, 252);
                doc.rect(margin, y, contentW, rowH, 'F');
            }

            // Row border
            doc.setDrawColor(235, 238, 242);
            doc.line(margin, y + rowH, margin + contentW, y + rowH);

            doc.setTextColor(40, 50, 70);
            doc.setFont('helvetica', 'normal');

            const route = [r.from_location, r.to_location].filter(Boolean).join(' > ') || '-';
            const depDate = r.departure_date ? new Date(r.departure_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '';
            const arrDate = r.arrival_date ? new Date(r.arrival_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '';
            const dates = [depDate, arrDate].filter(Boolean).join(' - ') || '-';

            let cx = margin;
            const vals = [
                truncate(r.speaker_name, 18),
                TYPE_META[r.travel_type]?.label || r.travel_type,
                truncate(r.title, 16),
                truncate(route, 20),
                truncate(dates, 18),
                truncate(r.booking_ref, 12),
                (r.status || '-').charAt(0).toUpperCase() + (r.status || '-').slice(1),
                r.cost > 0 ? INR(r.cost) : '-',
            ];

            vals.forEach((val, i) => {
                if (i === vals.length - 1 && r.cost > 0) doc.setFont('helvetica', 'bold');
                doc.text(val, cx + 2, y + 6);
                if (i === vals.length - 1) doc.setFont('helvetica', 'normal');
                cx += colDefs[i].width;
            });

            y += rowH;
        });

        // ── Footer ──
        y += 12;
        if (y > 275) { doc.addPage(); y = 20; }
        doc.setDrawColor(200, 210, 220);
        doc.line(margin, y, pw - margin, y);
        y += 8;
        doc.setFontSize(7);
        doc.setTextColor(160, 170, 185);
        doc.setFont('helvetica', 'italic');
        doc.text('EventHub - Event Management System', margin, y);
        doc.text(new Date().toLocaleString('en-IN'), pw - margin, y, { align: 'right' });

        doc.save(`travel-report-${new Date().toISOString().split('T')[0]}.pdf`);
    };

    // Filter
    let filtered = records;
    if (filterType) filtered = filtered.filter(r => r.travel_type === filterType);

    // Cost summary
    const totalCost = filtered.filter(r => r.status !== 'cancelled').reduce((s, r) => s + Number(r.cost || 0), 0);
    const costByType = {};
    filtered.filter(r => r.status !== 'cancelled').forEach(r => {
        costByType[r.travel_type] = (costByType[r.travel_type] || 0) + Number(r.cost || 0);
    });

    return (
        <div className="animate-in">
            <div className="page-header d-flex justify-content-between align-items-center">
                <div><h4>Travel Management</h4><p>Track speaker flights, hotels, and travel logistics.</p></div>
                <div className="d-flex gap-2 align-items-center">
                    {['admin', 'manager'].includes(user?.role) && filtered.length > 0 && (
                        <>
                            <Button variant="outline-light" size="sm" className="d-flex align-items-center gap-2" style={{ border: '1px solid var(--border-subtle)', borderRadius: 10 }} onClick={handleExportCSV}>
                                <BsFileEarmarkSpreadsheet /> CSV
                            </Button>
                            <Button variant="outline-light" size="sm" className="d-flex align-items-center gap-2" style={{ border: '1px solid var(--border-subtle)', borderRadius: 10 }} onClick={handleExportPDF}>
                                <BsFileEarmarkPdf /> PDF Report
                            </Button>
                        </>
                    )}
                    {canManage && (
                        <Button className="btn-accent d-flex align-items-center gap-2" onClick={() => openModal()}>
                            <BsPlus size={18} /> {user?.role === 'employee' ? 'Request Travel' : 'Add Travel'}
                        </Button>
                    )}
                </div>
            </div>

            {/* Cost Summary */}
            <div className="mb-4" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)', padding: '20px 24px' }}>
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-3">
                    <div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Total Budget</div>
                        <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
                            <BsCurrencyRupee style={{ fontSize: '1.4rem', opacity: 0.6 }} />{totalCost.toLocaleString('en-IN')}
                        </div>
                    </div>
                    <div className="d-flex gap-4 flex-wrap">
                        {Object.entries(costByType).map(([type, cost]) => (
                            <div key={type} className="text-center">
                                <div style={{ fontSize: '1.4rem' }}>{TYPE_META[type]?.icon}</div>
                                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: TYPE_META[type]?.color }}>{formatCost(cost)}</div>
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{TYPE_META[type]?.label}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Filters */}
            <div className="d-flex gap-2 mb-3 align-items-center flex-wrap">
                <BsFunnel size={16} style={{ color: 'var(--text-primary)', opacity: 0.85 }} />
                <Form.Select size="sm" className="form-select-dark" style={{ width: 200 }} value={filterSpeaker} onChange={e => setFilterSpeaker(e.target.value)}>
                    <option value="">All Speakers</option>
                    {speakers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Form.Select>
                <Form.Select size="sm" className="form-select-dark" style={{ width: 150 }} value={filterType} onChange={e => setFilterType(e.target.value)}>
                    <option value="">All Types</option>
                    {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                </Form.Select>
                {(filterSpeaker || filterType) && (
                    <Button size="sm" variant="link" className="text-muted text-decoration-none" onClick={() => { setFilterSpeaker(''); setFilterType(''); }}>Clear</Button>
                )}
            </div>

            {/* Travel Cards */}
            {filtered.length === 0 ? (
                <div className="empty-state" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
                    <div className="empty-state-icon"><BsAirplane /></div>
                    <p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>No Travel Records</p>
                    <p style={{ fontSize: '0.8rem' }}>Add travel arrangements for speakers.</p>
                </div>
            ) : (
                <div className="d-flex flex-column gap-3">
                    {filtered.map(r => {
                        const meta = TYPE_META[r.travel_type] || TYPE_META.other;
                        const sc = STATUS_COLORS[r.status] || STATUS_COLORS.pending;
                        return (
                            <div key={r.id} style={{
                                background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)',
                                border: '1px solid var(--border-subtle)', padding: '18px 22px',
                                transition: 'border-color 0.2s',
                            }}
                                onMouseEnter={e => e.currentTarget.style.borderColor = meta.color + '44'}
                                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-subtle)'}
                            >
                                <div className="d-flex align-items-start gap-3 flex-wrap">
                                    {/* Type Icon */}
                                    <div style={{
                                        width: 48, height: 48, borderRadius: 14,
                                        background: meta.color + '15', display: 'flex',
                                        alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem',
                                        flexShrink: 0
                                    }}>
                                        {meta.icon}
                                    </div>

                                    {/* Main Info */}
                                    <div className="flex-grow-1" style={{ minWidth: 0 }}>
                                        <div className="d-flex align-items-center gap-2 mb-1 flex-wrap">
                                            <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{r.title || meta.label}</span>
                                            <span style={{
                                                display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: '0.65rem',
                                                fontWeight: 600, textTransform: 'uppercase',
                                                background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`
                                            }}>{r.status}</span>
                                        </div>

                                        <div className="d-flex flex-wrap gap-3 mb-2" style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                            {r.speaker_name && (
                                                <span className="d-flex align-items-center gap-1">
                                                    <span style={{ width: 20, height: 20, borderRadius: 6, background: 'rgba(236,72,153,0.15)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', color: '#f472b6', fontWeight: 700 }}>
                                                        {r.speaker_name.charAt(0)}
                                                    </span>
                                                    {r.speaker_name}
                                                </span>
                                            )}
                                            {(r.from_location || r.to_location) && (
                                                <span className="d-flex align-items-center gap-1">
                                                    <BsGeoAlt size={12} style={{ color: meta.color }} />
                                                    {r.from_location}{r.from_location && r.to_location && ' → '}{r.to_location}
                                                </span>
                                            )}
                                            {r.departure_date && (
                                                <span className="d-flex align-items-center gap-1">
                                                    <BsCalendar3 size={11} />
                                                    {formatDate(r.departure_date)} {formatTime(r.departure_date)}
                                                    {r.arrival_date && <> — {formatDate(r.arrival_date)} {formatTime(r.arrival_date)}</>}
                                                </span>
                                            )}
                                        </div>

                                        {r.booking_ref && (
                                            <div className="d-flex align-items-center gap-1 mb-1" style={{ fontSize: '0.75rem' }}>
                                                <BsTicketPerforated size={12} style={{ color: 'var(--accent)' }} />
                                                <span style={{ color: 'var(--text-secondary)' }}>Ref:</span>
                                                <span style={{ fontFamily: 'monospace', color: 'var(--accent)', fontWeight: 600 }}>{r.booking_ref}</span>
                                            </div>
                                        )}

                                        {r.details && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{r.details}</div>}
                                    </div>

                                    {/* Cost + Actions */}
                                    <div className="text-end" style={{ flexShrink: 0 }}>
                                        {r.cost > 0 && (
                                            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: meta.color, marginBottom: 8 }}>
                                                {formatCost(r.cost)}
                                            </div>
                                        )}
                                        {canManage && (
                                            <div className="d-flex gap-1 justify-content-end">
                                                <button className="btn-action" onClick={() => openModal(r)}><BsPencil size={12} /></button>
                                                <button className="btn-action danger" onClick={() => handleDelete(r.id)}><BsTrash size={12} /></button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Modal */}
            <Modal show={show} onHide={() => setShow(false)} centered contentClassName="premium-modal" size="lg">
                <Modal.Header closeButton closeVariant="white">
                    <Modal.Title style={{ color: 'var(--text-primary)' }}>{editing ? 'Edit Travel' : 'Add Travel Record'}</Modal.Title></Modal.Header>
                <Modal.Body>
                    {error && <Alert variant="danger" className="py-2" style={{ fontSize: '0.85rem', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>{error}</Alert>}

                    <Row>
                        <Col md={6}>
                            <Form.Group className="mb-3"><Form.Label>Speaker *</Form.Label>
                                <Form.Select className="form-select-dark" value={form.speaker_id} onChange={e => setForm({ ...form, speaker_id: e.target.value })}>
                                    <option value="">Select Speaker</option>
                                    {speakers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                </Form.Select>
                            </Form.Group>
                        </Col>
                        <Col md={6}>
                            <Form.Group className="mb-3">
                                <Form.Label>Travel Type</Form.Label>
                                <Form.Select className="form-select-dark" value={form.travel_type} onChange={e => setForm({ ...form, travel_type: e.target.value })}>
                                    {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
                                </Form.Select>
                            </Form.Group>
                        </Col>
                    </Row>

                    {/* Dynamic fields based on travel type */}
                    {(() => {
                        const t = form.travel_type || 'flight';
                        const isHotel = t === 'hotel';
                        const isCab = t === 'cab';
                        const isFlight = t === 'flight';
                        const isTrain = t === 'train';

                        const titlePlaceholder = isFlight ? 'e.g. IndiGo 6E-204' : isTrain ? 'e.g. Rajdhani Express 12301' : isHotel ? 'e.g. Taj Palace, New Delhi' : isCab ? 'e.g. Airport Pickup - Sedan' : 'e.g. Bus Transfer';
                        const titleLabel = isHotel ? 'Hotel Name' : isCab ? 'Cab Service / Description' : isFlight ? 'Airline / Flight No.' : isTrain ? 'Train Name / No.' : 'Title';
                        const fromLabel = isFlight ? 'Origin City' : isTrain ? 'From Station' : isHotel ? 'Hotel Address / Area' : isCab ? 'Pickup Location' : 'From';
                        const toLabel = isFlight ? 'Destination City' : isTrain ? 'To Station' : isCab ? 'Drop Location' : 'To';
                        const fromPlaceholder = isFlight ? 'e.g. New Delhi (DEL)' : isTrain ? 'e.g. New Delhi Railway Station' : isHotel ? 'e.g. Connaught Place, Delhi' : isCab ? 'e.g. IGI Airport T3' : 'Origin';
                        const toPlaceholder = isFlight ? 'e.g. Mumbai (BOM)' : isTrain ? 'e.g. Mumbai CST' : isCab ? 'e.g. Hotel Taj Palace' : 'Destination';
                        const departureDateLabel = isHotel ? 'Check-in' : isCab ? 'Pickup Time' : 'Departure';
                        const arrivalDateLabel = isHotel ? 'Check-out' : isCab ? 'Drop Time (approx)' : 'Arrival';
                        const bookingRefLabel = isFlight ? 'PNR' : isTrain ? 'PNR' : isHotel ? 'Booking ID' : isCab ? 'Booking Ref' : 'Reference';
                        const bookingRefPlaceholder = isFlight ? 'e.g. ABC123' : isTrain ? 'e.g. 4521678901' : isHotel ? 'e.g. HTL-98765' : isCab ? 'e.g. OLA-12345' : 'Reference No.';

                        return (
                            <>
                                <Form.Group className="mb-3"><Form.Label>{titleLabel}</Form.Label>
                                    <Form.Control className="form-control-dark" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={titlePlaceholder} />
                                </Form.Group>

                                <Row>
                                    <Col md={6}>
                                        <Form.Group className="mb-3"><Form.Label>{fromLabel}</Form.Label>
                                            <Form.Control className="form-control-dark" value={form.from_location} onChange={e => setForm({ ...form, from_location: e.target.value })} placeholder={fromPlaceholder} />
                                        </Form.Group>
                                    </Col>
                                    {!isHotel && (
                                        <Col md={6}>
                                            <Form.Group className="mb-3"><Form.Label>{toLabel}</Form.Label>
                                                <Form.Control className="form-control-dark" value={form.to_location} onChange={e => setForm({ ...form, to_location: e.target.value })} placeholder={toPlaceholder} />
                                            </Form.Group>
                                        </Col>
                                    )}
                                </Row>

                                <Row>
                                    <Col md={6}>
                                        <Form.Group className="mb-3"><Form.Label>{departureDateLabel}</Form.Label>
                                            <Form.Control type="datetime-local" className="form-control-dark" value={form.departure_date} onChange={e => setForm({ ...form, departure_date: e.target.value })} />
                                        </Form.Group>
                                    </Col>
                                    <Col md={6}>
                                        <Form.Group className="mb-3"><Form.Label>{arrivalDateLabel}</Form.Label>
                                            <Form.Control type="datetime-local" className="form-control-dark" value={form.arrival_date} onChange={e => setForm({ ...form, arrival_date: e.target.value })} />
                                        </Form.Group>
                                    </Col>
                                </Row>

                                <Row>
                                    {user.role !== 'employee' && (
                                        <>
                                            <Col md={4}>
                                                <Form.Group className="mb-3"><Form.Label>{bookingRefLabel}</Form.Label>
                                                    <Form.Control className="form-control-dark" value={form.booking_ref} onChange={e => setForm({ ...form, booking_ref: e.target.value })} placeholder={bookingRefPlaceholder} />
                                                </Form.Group>
                                            </Col>
                                            <Col md={3}>
                                                <Form.Group className="mb-3"><Form.Label>Cost</Form.Label>
                                                    <Form.Control type="number" className="form-control-dark" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })} placeholder="0" />
                                                </Form.Group>
                                            </Col>
                                            <Col md={2}>
                                                <Form.Group className="mb-3"><Form.Label>Currency</Form.Label>
                                                    <Form.Select className="form-select-dark" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>
                                                        <option value="INR">INR</option>
                                                        <option value="USD">USD</option>
                                                        <option value="EUR">EUR</option>
                                                        <option value="GBP">GBP</option>
                                                    </Form.Select>
                                                </Form.Group>
                                            </Col>
                                        </>
                                    )}
                                    <Col md={user.role === 'employee' ? 12 : 3}>
                                        <Form.Group className="mb-3"><Form.Label>Status</Form.Label>
                                            <Form.Select
                                                className="form-select-dark"
                                                value={form.status}
                                                onChange={e => setForm({ ...form, status: e.target.value })}
                                                disabled={user?.role === 'employee'}
                                            >
                                                <option value="pending">Pending</option>
                                                <option value="booked">Booked</option>
                                                <option value="confirmed">Confirmed</option>
                                                <option value="cancelled">Cancelled</option>
                                            </Form.Select>
                                        </Form.Group>
                                    </Col>
                                </Row>

                                <Form.Group className="mb-3"><Form.Label>Details</Form.Label>
                                    <Form.Control as="textarea" rows={2} className="form-control-dark" value={form.details} onChange={e => setForm({ ...form, details: e.target.value })} placeholder={isHotel ? 'Room type, meal plan, special requests...' : isCab ? 'Vehicle preference, passenger count...' : isFlight ? 'Baggage, meal preference, seat...' : 'Additional details...'} />
                                </Form.Group>

                                {user.role !== 'employee' && (
                                    <Form.Group className="mb-3"><Form.Label>Notes</Form.Label>
                                        <Form.Control as="textarea" rows={2} className="form-control-dark" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Internal notes..." />
                                    </Form.Group>
                                )}
                            </>
                        );
                    })()}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="link" onClick={() => setShow(false)} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Cancel</Button>
                    <Button className="btn-accent" onClick={handleSave}>Save</Button>
                </Modal.Footer>
            </Modal>
        </div>
    );
}
