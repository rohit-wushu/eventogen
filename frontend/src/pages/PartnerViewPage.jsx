import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Container, Row, Col, Button, Badge, Spinner } from 'react-bootstrap';
import { getPartner } from '../services/api';
import { BsArrowLeft, BsGlobe, BsTag, BsCalendar3, BsPersonBadge, BsBuilding, BsJournalCheck, BsInfoCircle } from 'react-icons/bs';

export default function PartnerViewPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [partner, setPartner] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        setLoading(true);
        getPartner(id)
            .then(res => {
                setPartner(res.data);
            })
            .catch(err => {
                console.error(err);
                setError('Failed to load partner details');
            })
            .finally(() => setLoading(false));
    }, [id]);

    if (loading) return <div className="p-5 text-center"><Spinner animation="border" variant="accent" /><p className="mt-3 text-white opacity-75">Loading...</p></div>;
    if (error) return <div className="p-5 text-center"><h5 className="text-danger">{error}</h5><Button variant="link" className="text-accent" onClick={() => navigate('/partners')}>Back to Partners</Button></div>;
    if (!partner) return <div className="p-5 text-center"><h5 className="text-white">Partner not found</h5><Button variant="link" className="text-accent" onClick={() => navigate('/partners')}>Back to Partners</Button></div>;

    return (
        <div className="partner-view-minimal py-4 animate-in">
            {/* Header / Navigation */}
            <header className="container-fluid mb-4 d-flex align-items-center justify-content-between">
                <Button variant="link" className="p-0 text-decoration-none text-white-50 hover-white d-flex align-items-center gap-2" onClick={() => navigate('/partners')}>
                    <BsArrowLeft size={18} /> <span style={{ fontSize: '0.9rem' }}>Back</span>
                </Button>
                <div className="d-flex align-items-center gap-3">
                    <Badge className="badge-premium" style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.2)' }}>
                        {partner.category_name || 'Partner'}
                    </Badge>
                    <Badge className="badge-premium status-upcoming">
                        <BsCalendar3 className="me-2" /> {partner.event_title || '—'}
                    </Badge>
                </div>
            </header>

            <main className="container-fluid">
                <Row className="g-4">
                    {/* Compact Side Info */}
                    <Col lg={4}>
                        <div className="compact-card p-4 glass-effect">
                            <div className="text-center mb-4">
                                <div className="mx-auto mb-3 logo-box">
                                    {partner.logo_url ? (
                                        <img
                                            src={partner.logo_url}
                                            alt={partner.name}
                                            style={partner.logo_width || partner.logo_height ? {
                                                width: partner.logo_width ? `${partner.logo_width}px` : 'auto',
                                                height: partner.logo_height ? `${partner.logo_height}px` : 'auto',
                                                objectFit: 'contain',
                                                maxWidth: '100%'
                                            } : undefined}
                                        />
                                    ) : <BsBuilding size={40} className="text-white-50" />}
                                </div>
                                <h1 className="h4 fw-bold text-white mb-1">{partner.name}</h1>
                                {partner.website && (
                                    <a href={partner.website} target="_blank" rel="noopener noreferrer" className="text-accent small text-decoration-none hover-underline">
                                        <BsGlobe className="me-1" /> {partner.website.replace(/^https?:\/\//, '').split('/')[0]}
                                    </a>
                                )}
                            </div>

                            <div className="mt-4 pt-4 border-top border-white-5">
                                <h6 className="text-white-50 small fw-bold text-uppercase mb-3 tracking-wider">Additional Notes</h6>
                                <p className="text-white small lh-base" style={{ whiteSpace: 'pre-wrap' }}>
                                    {partner.wishlist || 'No additional notes.'}
                                </p>
                            </div>
                        </div>
                    </Col>

                    {/* Speakers Section */}
                    <Col lg={8}>
                        <div className="compact-card p-4 glass-effect h-100">
                            <div className="d-flex align-items-center gap-2 mb-4">
                                <BsJournalCheck className="text-accent" size={20} />
                                <h5 className="m-0 text-white fw-bold">Wishlist Speakers</h5>
                                <span className="ms-auto badge bg-white-5 text-white-50 small rounded-pill px-2">{partner.wishlist_speakers?.length || 0}</span>
                            </div>

                            {partner.wishlist_speakers && partner.wishlist_speakers.length > 0 ? (
                                <Row className="g-3">
                                    {partner.wishlist_speakers.map(s => (
                                        <Col xl={6} key={s.id}>
                                            <div className="minimal-speaker-card d-flex align-items-center gap-3 p-2" onClick={() => navigate(`/speakers/view/${s.id}`)}>
                                                <div className="mini-photo shadow-sm">
                                                    {s.photo_url ? <img src={s.photo_url} alt={s.name} /> : <div className="photo-init">{s.name?.charAt(0)}</div>}
                                                </div>
                                                <div className="mini-info overflow-hidden">
                                                    <div className="name text-white fw-bold text-truncate">{s.name}</div>
                                                    <div className="role text-accent-light small text-truncate">{s.designation}</div>
                                                    <div className="company text-white-50 x-small text-truncate mt-1">{s.company}</div>
                                                </div>
                                            </div>
                                        </Col>
                                    ))}
                                </Row>
                            ) : (
                                <div className="text-center py-5 text-white-50">
                                    <BsPersonBadge size={32} className="mb-2 opacity-20" />
                                    <div className="small">No speakers in wishlist.</div>
                                </div>
                            )}
                        </div>
                    </Col>
                </Row>
            </main>

            <style>{`
                .partner-view-minimal { min-height: 100vh; color: #ffffff; }
                .glass-effect {
                    background: rgba(255, 255, 255, 0.03);
                    backdrop-filter: blur(12px);
                    border: 1px solid rgba(255, 255, 255, 0.06);
                    border-radius: 20px;
                }
                .compact-card { box-shadow: 0 10px 30px rgba(0,0,0,0.2); }
                .logo-box {
                    width: 140px; height: 100px;
                    background: #fff; border-radius: 12px;
                    display: flex; align-items: center; justify-content: center;
                    padding: 12px; box-shadow: 0 5px 15px rgba(0,0,0,0.3);
                }
                .logo-box img { max-width: 100%; max-height: 100%; object-fit: contain; }
                .minimal-speaker-card {
                    background: rgba(255,255,255,0.02);
                    border: 1px solid rgba(255,255,255,0.05);
                    border-radius: 14px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                .minimal-speaker-card:hover {
                    background: rgba(255,255,255,0.07);
                    border-color: rgba(255,255,255,0.15);
                    transform: translateX(4px);
                }
                .mini-photo {
                    width: 48px; height: 48px;
                    border-radius: 10px; overflow: hidden;
                    background: var(--accent);
                    flex-shrink: 0;
                }
                .mini-photo img { width: 100%; height: 100%; object-fit: cover; }
                .photo-init { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-weight: bold; color: white; }
                .name { font-size: 0.9rem; }
                .role { font-size: 0.75rem; color: #a5b4fc; } /* Lighter indigo/accent */
                .x-small { font-size: 0.7rem; }
                .text-white-50 { color: rgba(255, 255, 255, 0.5) !important; }
                .bg-white-5 { background: rgba(255, 255, 255, 0.05); }
                .border-white-5 { border-color: rgba(255, 255, 255, 0.05) !important; }
                .hover-white:hover { color: #fff !important; }
                .italic { font-style: italic; }
                .tracking-wider { letter-spacing: 0.05em; }
                .text-accent-light { color: #818cf8; } /* Indigo 400 */
            `}</style>
        </div>
    );
}
