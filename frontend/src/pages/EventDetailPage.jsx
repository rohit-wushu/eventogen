import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button, Spinner, Alert, Card } from 'react-bootstrap';
import { getEvent } from '../services/api';
import { BsArrowLeft, BsCheckCircle } from 'react-icons/bs';
import { ApiEndpointsPanel } from '../components/ApiEndpointsModal';

export default function EventDetailPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [event, setEvent] = useState(null);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState({ type: '', text: '' });

    useEffect(() => {
        getEvent(id).then(r => setEvent(r.data))
            .catch(() => setMessage({ type: 'danger', text: 'Failed to load event' }))
            .finally(() => setLoading(false));
    }, [id]);

    if (loading) return <div className="p-5 text-center"><Spinner animation="border" variant="light" /></div>;
    if (!event) return <div className="p-5 text-center"><h5 className="edp-heading">Event not found</h5></div>;

    return (
        <div className="animate-in edp-page">
            <div className="d-flex align-items-center gap-3 mb-4">
                <Button variant="link" onClick={() => navigate('/events')} style={{ padding: 0 }} className="edp-muted">
                    <BsArrowLeft size={20} />
                </Button>
                <div>
                    <h4 className="m-0 edp-heading">{event.title}</h4>
                    <span className="edp-muted" style={{ fontSize: '0.8rem' }}>Web Integration & API Endpoints</span>
                </div>
            </div>

            {message.text && (
                <Alert variant={message.type} className="mb-3 d-flex align-items-center gap-2" style={{ borderRadius: 10 }}>
                    {message.type === 'success' && <BsCheckCircle />} {message.text}
                </Alert>
            )}

            <Card className="premium-card p-4">
                <Card.Body>
                    <ApiEndpointsPanel apiEvent={event} compact />
                </Card.Body>
            </Card>

            <style>{`
                .edp-heading { color: #e2e8f0 !important; }
                .edp-muted { color: #94a3b8 !important; }
                [data-theme="light"] .edp-heading { color: #1e293b !important; }
                [data-theme="light"] .edp-muted { color: #64748b !important; }

                /* Force this page's Card to honour the dark theme — bootstrap's
                   .card rule loads after index.css and can win the cascade,
                   which was painting the outer card white in dark mode. */
                .edp-page .card {
                    background: #1a1b2e !important;
                    border: 1px solid rgba(255, 255, 255, 0.08) !important;
                    color: #e2e8f0 !important;
                }
                .edp-page .card-body { background: transparent !important; }

                /* Endpoint tiles inside the card */
                .edp-page .api-endpoint-card {
                    background: rgba(255, 255, 255, 0.04) !important;
                    border-color: rgba(255, 255, 255, 0.08) !important;
                }
                .edp-page .api-ep-label { color: #f1f5f9 !important; }
                .edp-page .api-ep-desc  { color: #94a3b8 !important; }

                /* Light-theme adjustments */
                [data-theme="light"] .edp-page .card {
                    background: #ffffff !important;
                    border-color: #e2e8f0 !important;
                    color: #1e293b !important;
                }
                [data-theme="light"] .edp-page .api-endpoint-card {
                    background: #f8fafc !important;
                    border-color: #e2e8f0 !important;
                }
                [data-theme="light"] .edp-page .api-ep-label { color: #1e293b !important; }
                [data-theme="light"] .edp-page .api-ep-desc  { color: #64748b !important; }
            `}</style>
        </div>
    );
}
