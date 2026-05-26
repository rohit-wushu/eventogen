import { useState } from 'react';
import { Modal, Button } from 'react-bootstrap';
import { BsCodeSlash, BsClipboard, BsClipboardCheck } from 'react-icons/bs';

// Inline content panel — the JSON endpoint list, copy buttons, and example snippet.
// Exported separately so it can be embedded directly into a tab (EventsPage edit modal)
// or any other layout, without the Modal chrome.
export function ApiEndpointsPanel({ apiEvent, compact = false }) {
    const [copiedKey, setCopiedKey] = useState(null);
    if (!apiEvent) return null;

    const apiBase = (() => {
        const envUrl = import.meta.env.VITE_BACKEND_URL;
        if (envUrl) return envUrl.replace(/\/$/, '');
        return import.meta.env.DEV ? 'http://localhost:5001' : window.location.origin;
    })();

    const endpoints = [
        { key: 'speakers', label: 'Speakers', url: `${apiBase}/api/public/speakers?event_id=${apiEvent.id}`, description: 'All speakers for this event (photos, bios, roles, SNS cards).' },
        { key: 'partners', label: 'Partners', url: `${apiBase}/api/public/partners?event_id=${apiEvent.id}`, description: 'Partner logos grouped by category, in display order.' },
        { key: 'agendas', label: 'Agendas', url: `${apiBase}/api/public/agendas?event_id=${apiEvent.id}`, description: 'Schedule by day with assigned speakers nested.' },
        { key: 'event', label: 'Event Details', url: `${apiBase}/api/public/events/${apiEvent.id}`, description: 'Event metadata — title, dates, venue, branding colors, logos.' },
    ];

    const copyToClipboard = async (text, key) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedKey(key);
            setTimeout(() => setCopiedKey(null), 1500);
        } catch (err) {
            alert('Copy failed. Please select and copy manually.');
        }
    };

    return (
        <div>
          
            {endpoints.map(ep => (
                <div key={ep.key} className="mb-3 p-3 api-endpoint-card" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
                    <div className="d-flex justify-content-between align-items-center mb-1">
                        <div className="api-ep-label" style={{ fontWeight: 700, fontSize: '0.95rem' }}>{ep.label}</div>
                        <div className="d-flex gap-2">
                            <Button
                                size="sm"
                                variant="outline-info"
                                style={{ fontSize: '0.72rem' }}
                                onClick={() => window.open(ep.url, '_blank', 'noopener')}
                            >
                                Open
                            </Button>
                            <Button
                                size="sm"
                                variant={copiedKey === ep.key ? 'success' : 'outline-info'}
                                style={{ fontSize: '0.72rem' }}
                                onClick={() => copyToClipboard(ep.url, ep.key)}
                            >
                                {copiedKey === ep.key ? (<><BsClipboardCheck size={12} /> Copied</>) : (<><BsClipboard size={12} /> Copy URL</>)}
                            </Button>
                        </div>
                    </div>
                    <div className="api-ep-desc" style={{ fontSize: '0.72rem', marginBottom: 8 }}>{ep.description}</div>
                    <div style={{ background: '#0a0a14', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6, padding: '8px 12px', fontFamily: 'monospace', fontSize: '0.75rem', color: '#13d999', wordBreak: 'break-all' }}>
                        GET {ep.url}
                    </div>
                </div>
            ))}


        </div>
    );
}

// Standalone modal wrapper around the panel — used by SpeakersPage and anywhere else
// that wants to pop the endpoints in their own dialog.
export default function ApiEndpointsModal({ apiEvent, onHide }) {
    if (!apiEvent) return null;
    return (
        <Modal show={!!apiEvent} onHide={onHide} centered size="lg" contentClassName="premium-modal">
            <Modal.Header closeButton closeVariant="white">
                <Modal.Title style={{ fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <BsCodeSlash style={{ color: '#60a5fa' }} /> Website Integration — <span style={{ color: '#60a5fa' }}>{apiEvent.title}</span>
                </Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <ApiEndpointsPanel apiEvent={apiEvent} />
            </Modal.Body>
            <Modal.Footer>
                <Button variant="link" onClick={onHide} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Close</Button>
            </Modal.Footer>
        </Modal>
    );
}
