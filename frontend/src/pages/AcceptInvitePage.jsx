import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Form, Button, Alert, Spinner } from 'react-bootstrap';
import { validateInvite, acceptInvite } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { BsShieldLock, BsEnvelopeOpen } from 'react-icons/bs';

export default function AcceptInvitePage() {
    const { token } = useParams();
    const navigate = useNavigate();
    const { login } = useAuth();
    
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
            <div className="login-page d-flex align-items-center justify-content-center vh-100">
                <Spinner animation="border" variant="primary" />
            </div>
        );
    }

    if (error && !inviteData) {
        return (
            <div className="login-page d-flex align-items-center justify-content-center vh-100">
                <div className="login-card p-5 text-center">
                    <div className="logo-icon mb-3" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}>
                        <BsShieldLock />
                    </div>
                    <h4 style={{ color: 'var(--text-primary)' }}>Invitation Error</h4>
                    <Alert variant="danger" className="mt-3">{error}</Alert>
                    <Button variant="link" onClick={() => navigate('/login')} className="mt-3 text-muted">Go to Login</Button>
                </div>
            </div>
        );
    }

    return (
        <div className="login-page d-flex align-items-center justify-content-center vh-100">
            <div className="login-card p-5">
                <div className="text-center mb-4">
                    <div className="logo-icon mb-3">
                        <BsEnvelopeOpen />
                    </div>
                    <h3 style={{ fontWeight: 800, color: 'var(--text-primary)' }}>Welcome to EventHub</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
                        You've been invited as a <strong style={{ color: 'var(--accent)', textTransform: 'capitalize' }}>{inviteData?.role}</strong>.
                    </p>
                    {inviteData?.assigned_task && (
                        <div className="mt-3 p-2 px-3" style={{ background: 'rgba(139,92,246,0.1)', borderRadius: 10, border: '1px solid rgba(139,92,246,0.2)', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                            <small className="d-block opacity-75 mb-1" style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Your Primary Task:</small>
                            <strong>{inviteData.assigned_task}</strong>
                        </div>
                    )}
                </div>

                {error && <Alert variant="danger" className="py-2" style={{ fontSize: '0.85rem', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>{error}</Alert>}

                <Form onSubmit={handleSubmit}>
                    <Form.Group className="mb-3">
                        <Form.Label>Email</Form.Label>
                        <Form.Control
                            type="email"
                            value={inviteData?.email || ''}
                            disabled
                            className="form-control-dark"
                            style={{ opacity: 0.7 }}
                        />
                    </Form.Group>
                    <Form.Group className="mb-3">
                        <Form.Label>Full Name</Form.Label>
                        <Form.Control
                            type="text"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="John Doe"
                            required
                            className="form-control-dark"
                        />
                    </Form.Group>
                    <Form.Group className="mb-3">
                        <Form.Label>Create Password</Form.Label>
                        <Form.Control
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                            minLength={6}
                            className="form-control-dark"
                        />
                    </Form.Group>
                    <Form.Group className="mb-4">
                        <Form.Label>Confirm Password</Form.Label>
                        <Form.Control
                            type="password"
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                            minLength={6}
                            className="form-control-dark"
                        />
                    </Form.Group>
                    <Button type="submit" className="btn-accent w-100 py-2" disabled={submitting}>
                        {submitting ? <Spinner size="sm" /> : 'Complete Setup & Login'}
                    </Button>
                </Form>
            </div>
        </div>
    );
}
