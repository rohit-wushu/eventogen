import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Container, Row, Col, Button, Badge, Spinner, ListGroup } from 'react-bootstrap';
import { getSpeaker, getSpeakerAgendas, getSpeakerTravel } from '../services/api';
import { BsArrowLeft, BsMic, BsClock, BsBuilding, BsEnvelope, BsGeoAlt, BsCalendar3, BsTicketPerforated, BsCurrencyRupee, BsPhone, BsLinkedin, BsJournalText, BsPeople } from 'react-icons/bs';

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

export default function SpeakerViewPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [speaker, setSpeaker] = useState(null);
    const [agendas, setAgendas] = useState([]);
    const [travel, setTravel] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        setLoading(true);
        Promise.all([getSpeaker(id), getSpeakerAgendas(id), getSpeakerTravel(id)])
            .then(([speakerRes, agendaRes, travelRes]) => {
                setSpeaker(speakerRes.data);
                setAgendas(agendaRes.data);
                setTravel(Array.isArray(travelRes.data) ? travelRes.data : []);
            })
            .catch(err => {
                console.error(err);
                setError('Failed to load speaker details');
            })
            .finally(() => setLoading(false));
    }, [id]);

    const totalTravelCost = travel.filter(t => t.status !== 'cancelled').reduce((s, t) => s + Number(t.cost || 0), 0);

    if (loading) return <div className="p-5 text-center"><Spinner animation="border" variant="light" /><p className="mt-3 text-white">Loading speaker details...</p></div>;
    if (error) return <div className="p-5 text-center"><h5 className="text-danger">{error}</h5><Button variant="link" onClick={() => navigate('/speakers')}>Back to Speakers</Button></div>;
    if (!speaker) return <div className="p-5 text-center"><h5 className="text-white">Speaker not found</h5><Button variant="link" onClick={() => navigate('/speakers')}>Back to Speakers</Button></div>;

    return (
        <div className="container-fluid py-4 animate-in">
            <div className="d-flex align-items-center mb-4">
                <Button variant="link" className="p-0 text-decoration-none text-muted me-3" onClick={() => navigate('/speakers')}>
                    <BsArrowLeft size={20} />
                </Button>
                <h4 className="m-0 text-white">Speaker Profile</h4>
            </div>

            <div className="row g-4">
                <Col lg={4}>
                    <div className="premium-card p-4 text-center">
                        <div className="mx-auto mb-3" style={{ width: 150, height: 150, borderRadius: '20px', overflow: 'hidden', background: 'rgba(236,72,153,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-pink)', fontWeight: 700, fontSize: '2rem', border: '2px solid rgba(255,255,255,0.05)' }}>
                            {speaker.photo_url ? <img src={speaker.photo_url} alt={speaker.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : speaker.name?.charAt(0)}
                        </div>
                        <h4 className="mb-1">{speaker.name}</h4>
                        <Badge className="badge-premium status-ongoing mb-3" style={{ fontSize: '0.8rem', textTransform: 'uppercase' }}>{speaker.role || 'Speaker'}</Badge>

                        <div className="d-flex flex-column gap-2 text-start mt-3">
                            <div className="d-flex align-items-center gap-2 text-muted small">
                                <BsMic className="text-accent" /> {speaker.designation || 'Presenter'}
                            </div>
                            <div className="d-flex align-items-center gap-2 text-muted small">
                                <BsBuilding className="text-accent" /> {speaker.company || '—'}
                            </div>
                            <div className="d-flex align-items-center gap-2 text-muted small">
                                <BsEnvelope className="text-accent" /> {speaker.email || '—'}
                            </div>
                            <div className="d-flex align-items-center gap-2 text-muted small">
                                <BsPhone className="text-accent" /> {speaker.mobile_no || '—'}
                            </div>
                            {speaker.linkedin_url && (
                                <a href={speaker.linkedin_url.startsWith('http') ? speaker.linkedin_url : `https://${speaker.linkedin_url}`} target="_blank" rel="noopener noreferrer" className="d-flex align-items-center gap-2 text-muted small text-decoration-none hover-accent">
                                    <BsLinkedin className="text-accent" /> LinkedIn Profile
                                </a>
                            )}
                        </div>

                        <hr className="my-4 opacity-10" />

                        <div className="text-start mb-3">
                            <h6 className="small text-uppercase text-accent fw-bold mb-2">Session Details</h6>
                            <div className="d-flex flex-column gap-2">
                                <div className="d-flex align-items-start gap-2 text-muted small">
                                    <BsJournalText className="text-accent mt-1" /> 
                                    <span><strong>Topic:</strong> {speaker.topic || '—'}</span>
                                </div>
                                <div className="d-flex align-items-center gap-2 text-muted small">
                                    <BsPeople className="text-accent" /> 
                                    <span><strong>Panel:</strong> {speaker.panel || '—'}</span>
                                </div>
                            </div>
                        </div>

                        <div className="text-start">
                            <h6 className="small text-uppercase text-accent fw-bold mb-2">Biography</h6>
                            <p className="small text-muted" style={{ lineHeight: 1.6 }}>{speaker.bio || 'No biography provided.'}</p>
                        </div>
                    </div>
                </Col>

                <Col lg={8}>
                    {/* Sessions */}
                    <div className="premium-card p-4 mb-4">
                        <h5 className="mb-4 d-flex align-items-center gap-2">
                            Allotted Sessions
                            <Badge bg="dark" className="ms-2" style={{ border: '1px solid var(--border-subtle)', borderRadius: '20px' }}>{agendas.length}</Badge>
                        </h5>

                        {agendas.length === 0 ? (
                            <div className="text-center py-5 opacity-50">
                                <p className="m-0">No sessions allotted to this speaker yet.</p>
                            </div>
                        ) : (
                            <div className="d-flex flex-column gap-3">
                                {agendas.map(agenda => (
                                    <div key={agenda.id} className="agenda-item p-3 d-flex gap-3 align-items-center" style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '15px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                        <div className="text-center" style={{ minWidth: '70px', borderRight: '1px solid rgba(255,255,255,0.1)', paddingRight: '15px' }}>
                                            <div className="text-accent fw-bold small">Day {agenda.day_number}</div>
                                            <div className="small">{agenda.start_time?.slice(0, 5)}</div>
                                        </div>
                                        <div className="flex-grow-1">
                                            <h6 className="mb-1">{agenda.title}</h6>
                                            <p className="small text-muted m-0 line-clamp-1">{agenda.description}</p>
                                        </div>
                                        <Button variant="link" className="text-accent p-0 text-decoration-none small" onClick={() => navigate('/agendas')}>
                                            View Agenda Link
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Travel Details */}
                    <div className="premium-card p-4">
                        <div className="d-flex justify-content-between align-items-center mb-4">
                            <h5 className="m-0 d-flex align-items-center gap-2">
                                Travel Details
                                <Badge bg="dark" className="ms-2" style={{ border: '1px solid var(--border-subtle)', borderRadius: '20px' }}>{travel.length}</Badge>
                            </h5>
                            <div className="d-flex align-items-center gap-3">
                                {totalTravelCost > 0 && (
                                    <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent)' }}>
                                        <BsCurrencyRupee style={{ fontSize: '0.85rem', opacity: 0.7 }} />{totalTravelCost.toLocaleString('en-IN')}
                                    </span>
                                )}
                                <Button size="sm" variant="link" className="text-accent text-decoration-none p-0" style={{ fontSize: '0.8rem', fontWeight: 600 }} onClick={() => navigate('/travel')}>
                                    Manage →
                                </Button>
                            </div>
                        </div>

                        {travel.length === 0 ? (
                            <div className="text-center py-5 opacity-50">
                                <p className="m-0">No travel arrangements added yet.</p>
                            </div>
                        ) : (
                            <div className="d-flex flex-column gap-3">
                                {travel.map(t => {
                                    const meta = TYPE_META[t.travel_type] || TYPE_META.other;
                                    const sc = STATUS_COLORS[t.status] || STATUS_COLORS.pending;
                                    return (
                                        <div key={t.id} className="p-3 d-flex gap-3 align-items-start" style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '15px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                            <div style={{
                                                width: 40, height: 40, borderRadius: 12,
                                                background: meta.color + '15', display: 'flex',
                                                alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
                                                flexShrink: 0
                                            }}>
                                                {meta.icon}
                                            </div>
                                            <div className="flex-grow-1" style={{ minWidth: 0 }}>
                                                <div className="d-flex align-items-center gap-2 mb-1">
                                                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{t.title || meta.label}</span>
                                                    <span style={{
                                                        padding: '1px 7px', borderRadius: 12, fontSize: '0.6rem',
                                                        fontWeight: 600, textTransform: 'uppercase',
                                                        background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`
                                                    }}>{t.status}</span>
                                                </div>
                                                <div className="d-flex flex-wrap gap-3" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                    {(t.from_location || t.to_location) && (
                                                        <span className="d-flex align-items-center gap-1">
                                                            <BsGeoAlt size={11} style={{ color: meta.color }} />
                                                            {t.from_location}{t.from_location && t.to_location && ' → '}{t.to_location}
                                                        </span>
                                                    )}
                                                    {t.departure_date && (
                                                        <span className="d-flex align-items-center gap-1">
                                                            <BsCalendar3 size={10} /> {formatDate(t.departure_date)}
                                                            {t.arrival_date && <> — {formatDate(t.arrival_date)}</>}
                                                        </span>
                                                    )}
                                                    {t.booking_ref && (
                                                        <span className="d-flex align-items-center gap-1">
                                                            <BsTicketPerforated size={11} style={{ color: 'var(--accent)' }} />
                                                            <span style={{ fontFamily: 'monospace', color: 'var(--accent)', fontWeight: 600 }}>{t.booking_ref}</span>
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            {t.cost > 0 && (
                                                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: meta.color, flexShrink: 0 }}>
                                                    ₹{Number(t.cost).toLocaleString('en-IN')}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </Col>
            </div>
        </div>
    );
}

