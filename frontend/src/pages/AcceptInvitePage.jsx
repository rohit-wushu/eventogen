import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Form, Button, Alert, Spinner } from 'react-bootstrap';
import { validateInvite, acceptInvite } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useBranding } from '../hooks/useBranding';
import { getImageUrl } from '../utils/imageUrl';
import { BsShieldLock, BsEnvelopeOpen, BsCalendarEventFill, BsCheckCircleFill } from 'react-icons/bs';

export default function AcceptInvitePage() {
    const { token } = useParams();
    const navigate = useNavigate();
    const { login } = useAuth();
    const brand = useBranding();
    const siteTitle = brand.site_title || 'Eventogen';

    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [inviteData, setInviteData] = useState(null);
    
    const [name, setName] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    useEffect(() => {
        const checkToken = async () => {
            try {
                const res = await validateInvite(token);
                setInviteData(res.data);
            } catch (err) {
                setError(err.response?.data?.error || 'Invalid or expired invitation link.');
            } finally {
                setLoading(false);
            }
        };
        checkToken();
    }, [token]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (password !== confirmPassword) {
            return setError("Passwords do not match.");
        }
        
        setError('');
        setSubmitting(true);
        try {
            const res = await acceptInvite({ token, name, password });
            login(res.data.token, res.data.user);
            navigate('/dashboard');
        } catch (err) {
            setError(err.response?.data?.error || 'Registration failed.');
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="invite-shell d-flex align-items-center justify-content-center">
                <Spinner animation="border" variant="primary" />
            </div>
        );
    }

    if (error && !inviteData) {
        return (
            <div className="invite-shell d-flex align-items-center justify-content-center">
                <div className="invite-card invite-error-card">
                    <div className="invite-logo-block">
                        <div className="invite-logo-ico" style={{ background: 'rgba(239, 68, 68, 0.12)', color: '#ef4444', boxShadow: '0 10px 30px rgba(239,68,68,0.25)' }}>
                            <BsShieldLock />
                        </div>
                    </div>
                    <h4 style={{ color: '#fff', fontWeight: 800, textAlign: 'center', marginBottom: 12 }}>Invitation Error</h4>
                    <Alert variant="danger" className="invite-inline-alert">{error}</Alert>
                    <Button variant="link" onClick={() => navigate('/login')} className="w-100 text-muted">Go to Login</Button>
                </div>
            </div>
        );
    }

    const roleBenefits = {
        admin:    ['Full platform access', 'Manage team & billing', 'Configure events & branding'],
        manager:  ['Manage assigned events', 'Invite & oversee staff', 'Track speakers & attendees'],
        employee: ['Work on assigned events', 'Manage your modules', 'Stay in sync with the team'],
    };
    const perks = roleBenefits[inviteData?.role] || roleBenefits.employee;

    return (
        <div className="invite-shell d-flex align-items-center justify-content-center">
            <div className="invite-card">
                {/* Left pane — branded marketing context */}
                <div className="invite-pane-left">
                    <div className="invite-brand-row">
                        {brand.portal_logo ? (
                            <img src={getImageUrl(brand.portal_logo)} alt={siteTitle} className="invite-brand-logo" />
                        ) : (
                            <div className="invite-logo-ico">
                                <BsEnvelopeOpen />
                            </div>
                        )}
                        <div className="invite-brand-text">
                            <div className="invite-brand-name">{siteTitle}</div>
                            {brand.portal_tagline && <div className="invite-brand-tag">{brand.portal_tagline}</div>}
                        </div>
                    </div>

                    <h2 className="invite-headline">
                        You're invited<br/>to join the team.
                    </h2>

                    <div className="invite-context-card">
                        <div className="invite-context-label">Role</div>
                        <div className="invite-context-value invite-role-pill">
                            {inviteData?.role?.charAt(0).toUpperCase() + inviteData?.role?.slice(1)}
                        </div>
                        {inviteData?.event_title && (
                            <>
                                <div className="invite-context-label mt-3">
                                    <BsCalendarEventFill style={{ marginRight: 6, opacity: 0.8 }} /> Event
                                </div>
                                <div className="invite-context-value">{inviteData.event_title}</div>
                            </>
                        )}
                        {inviteData?.assigned_task && (
                            <>
                                <div className="invite-context-label mt-3">Task</div>
                                <div className="invite-context-value" style={{ fontSize: '0.92rem', fontWeight: 500 }}>{inviteData.assigned_task}</div>
                            </>
                        )}
                    </div>

                    <ul className="invite-perks">
                        {perks.map((p, i) => (
                            <li key={i}><BsCheckCircleFill /> {p}</li>
                        ))}
                    </ul>
                </div>

                {/* Right pane — sign-up form */}
                <div className="invite-pane-right">
                    <h3 className="invite-form-title">Set up your account</h3>
                    <p className="invite-form-sub">A few details and you're in.</p>

                    {error && (
                        <Alert variant="danger" className="invite-inline-alert">{error}</Alert>
                    )}

                    <Form onSubmit={handleSubmit}>
                        <Form.Group className="mb-3">
                            <Form.Label className="invite-field-label">Email</Form.Label>
                            <Form.Control
                                type="email"
                                value={inviteData?.email || ''}
                                disabled
                                className="form-control-dark"
                                style={{ opacity: 0.7 }}
                            />
                        </Form.Group>
                        <Form.Group className="mb-3">
                            <Form.Label className="invite-field-label">Full Name</Form.Label>
                            <Form.Control
                                type="text"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="e.g. Priya Sharma"
                                required
                                autoFocus
                                className="form-control-dark"
                            />
                        </Form.Group>
                        <Form.Group className="mb-3">
                            <Form.Label className="invite-field-label">Create Password</Form.Label>
                            <Form.Control
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="At least 6 characters"
                                required
                                minLength={6}
                                className="form-control-dark"
                            />
                        </Form.Group>
                        <Form.Group className="mb-4">
                            <Form.Label className="invite-field-label">Confirm Password</Form.Label>
                            <Form.Control
                                type="password"
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                                placeholder="Re-enter the password"
                                required
                                minLength={6}
                                className="form-control-dark"
                            />
                        </Form.Group>
                        <Button type="submit" className="invite-submit-btn w-100" disabled={submitting}>
                            {submitting ? <Spinner size="sm" /> : `Join ${siteTitle}`}
                        </Button>
                    </Form>

                    <div className="invite-footer-note">
                        Already have an account? <a href="/login">Sign in</a>
                    </div>
                </div>
            </div>

            <style>{`
                .invite-shell {
                    min-height: 100vh;
                    background:
                        radial-gradient(circle at 15% 20%, rgba(139,92,246,0.35), transparent 45%),
                        radial-gradient(circle at 85% 80%, rgba(236,72,153,0.25), transparent 50%),
                        linear-gradient(135deg, #0a0a1f 0%, #1a1040 50%, #2a1060 100%);
                    padding: 32px 20px;
                    overflow-y: auto;
                }
                .invite-card {
                    width: 100%;
                    max-width: 920px;
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    background: #0f0f22;
                    border: 1px solid rgba(255,255,255,0.08);
                    border-radius: 22px;
                    overflow: hidden;
                    box-shadow: 0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04) inset;
                    color: #f5f5fa;
                }
                .invite-error-card {
                    grid-template-columns: 1fr;
                    max-width: 440px;
                    padding: 36px;
                }
                @media (max-width: 800px) {
                    .invite-card { grid-template-columns: 1fr; max-width: 480px; }
                    .invite-pane-left { padding: 26px 28px !important; }
                    .invite-headline { font-size: 1.4rem !important; }
                }

                /* LEFT PANE */
                .invite-pane-left {
                    padding: 36px 36px;
                    background:
                        radial-gradient(circle at 20% 20%, rgba(139,92,246,0.30), transparent 50%),
                        radial-gradient(circle at 80% 100%, rgba(236,72,153,0.22), transparent 55%),
                        linear-gradient(160deg, #1a1040 0%, #2a1060 100%);
                    position: relative;
                }
                .invite-pane-left::after {
                    content: '';
                    position: absolute; inset: 0;
                    background-image: radial-gradient(circle, rgba(255,255,255,0.05) 1px, transparent 1px);
                    background-size: 22px 22px;
                    mask-image: radial-gradient(ellipse at top left, #000 20%, transparent 80%);
                    pointer-events: none;
                }
                .invite-pane-left > * { position: relative; z-index: 1; }

                .invite-brand-row {
                    display: flex; align-items: center; gap: 12px;
                    margin-bottom: 28px;
                }
                .invite-brand-logo {
                    width: 44px; height: 44px;
                    border-radius: 10px;
                    background: rgba(255,255,255,0.06);
                    padding: 4px;
                    object-fit: contain;
                }
                .invite-logo-block { display: flex; justify-content: center; margin-bottom: 8px; }
                .invite-logo-ico {
                    width: 52px; height: 52px;
                    border-radius: 14px;
                    background: linear-gradient(135deg, #a78bfa, #ec4899);
                    display: flex; align-items: center; justify-content: center;
                    font-size: 22px; color: #fff;
                    box-shadow: 0 12px 32px rgba(139,92,246,0.45);
                }
                .invite-brand-text {}
                .invite-brand-name { font-size: 1.05rem; font-weight: 800; color: #fff; }
                .invite-brand-tag { font-size: 0.74rem; color: rgba(255,255,255,0.6); margin-top: 1px; }

                .invite-headline {
                    font-size: 1.85rem;
                    font-weight: 800;
                    color: #fff;
                    letter-spacing: -0.02em;
                    line-height: 1.15;
                    margin-bottom: 24px;
                }

                .invite-context-card {
                    background: rgba(255,255,255,0.05);
                    border: 1px solid rgba(255,255,255,0.08);
                    border-radius: 14px;
                    padding: 16px 18px;
                    margin-bottom: 22px;
                }
                .invite-context-label {
                    font-size: 0.68rem; font-weight: 700;
                    text-transform: uppercase; letter-spacing: 0.1em;
                    color: rgba(255,255,255,0.5);
                    margin-bottom: 4px;
                    display: flex; align-items: center;
                }
                .invite-context-value {
                    font-size: 1rem; font-weight: 700; color: #fff;
                }
                .invite-role-pill {
                    display: inline-block;
                    padding: 4px 12px;
                    border-radius: 8px;
                    background: linear-gradient(135deg, rgba(167,139,250,0.25), rgba(236,72,153,0.18));
                    border: 1px solid rgba(167,139,250,0.4);
                    color: #c4b5fd;
                    font-size: 0.88rem;
                }

                .invite-perks {
                    list-style: none; padding: 0; margin: 0;
                    display: flex; flex-direction: column; gap: 10px;
                }
                .invite-perks li {
                    display: flex; align-items: center; gap: 10px;
                    color: rgba(255,255,255,0.78);
                    font-size: 0.88rem;
                }
                .invite-perks svg {
                    color: #34d399; font-size: 16px; flex-shrink: 0;
                }

                /* RIGHT PANE */
                .invite-pane-right {
                    padding: 40px 38px;
                    display: flex; flex-direction: column; justify-content: center;
                    background: #0f0f22;
                }
                .invite-form-title {
                    font-size: 1.35rem; font-weight: 800;
                    color: #fff;
                    letter-spacing: -0.015em;
                    margin-bottom: 6px;
                }
                .invite-form-sub {
                    font-size: 0.85rem;
                    color: rgba(255,255,255,0.55);
                    margin-bottom: 22px;
                }
                .invite-field-label {
                    font-size: 0.78rem; font-weight: 600;
                    color: rgba(255,255,255,0.85);
                    margin-bottom: 6px;
                }
                .invite-inline-alert {
                    padding: 10px 14px !important;
                    border-radius: 10px !important;
                    font-size: 0.85rem !important;
                    background: rgba(239,68,68,0.1) !important;
                    border: 1px solid rgba(239,68,68,0.25) !important;
                    color: #fca5a5 !important;
                    margin-bottom: 14px;
                }
                .invite-submit-btn {
                    padding: 11px 22px !important;
                    background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%) !important;
                    border: none !important;
                    color: #fff !important;
                    font-weight: 700 !important;
                    font-size: 0.92rem !important;
                    border-radius: 10px !important;
                    box-shadow: 0 12px 30px rgba(139,92,246,0.35) !important;
                    transition: transform 0.15s, filter 0.15s !important;
                }
                .invite-submit-btn:hover:not(:disabled) {
                    filter: brightness(1.08);
                    transform: translateY(-1px);
                }
                .invite-footer-note {
                    text-align: center;
                    font-size: 0.8rem;
                    color: rgba(255,255,255,0.55);
                    margin-top: 18px;
                }
                .invite-footer-note a {
                    color: #c4b5fd;
                    text-decoration: none;
                    font-weight: 600;
                }
                .invite-footer-note a:hover { text-decoration: underline; }
            `}</style>
        </div>
    );
}
