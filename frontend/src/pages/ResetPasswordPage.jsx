import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Form, Button, Alert, Spinner } from 'react-bootstrap';
import { resetPassword } from '../services/api';
import { BsShieldLock, BsCheckCircleFill } from 'react-icons/bs';

export default function ResetPasswordPage() {
    const { token } = useParams();
    const navigate = useNavigate();
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (password.length < 6) {
            return setError('Password must be at least 6 characters');
        }
        if (password !== confirmPassword) {
            return setError('Passwords do not match');
        }

        setLoading(true);
        try {
            await resetPassword(token, password);
            setSuccess(true);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to reset password. The link may have expired.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page d-flex align-items-center justify-content-center vh-100">
            <div className="login-card p-5">
                <div className="text-center mb-4">
                    <div className="logo-icon">
                        <BsShieldLock />
                    </div>
                    <h3 style={{ fontWeight: 800, color: 'var(--text-primary)' }}>Reset Password</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Create a new password for your account</p>
                </div>

                {success ? (
                    <div className="text-center animate-in">
                        <div className="p-4 mb-3" style={{ background: 'rgba(16,185,129,0.1)', borderRadius: 12, border: '1px solid rgba(16,185,129,0.2)' }}>
                            <BsCheckCircleFill size={40} style={{ color: '#10b981', marginBottom: 12 }} />
                            <h5 style={{ color: '#10b981', fontWeight: 700, marginBottom: 8 }}>Password Reset!</h5>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: 0 }}>Your password has been updated successfully.</p>
                        </div>
                        <Button className="btn-accent w-100 py-2" onClick={() => navigate('/login')}>
                            Sign In
                        </Button>
                    </div>
                ) : (
                    <>
                        {error && (
                            <Alert variant="danger" className="py-2" style={{ fontSize: '0.85rem', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>
                                {error}
                            </Alert>
                        )}

                        <Form onSubmit={handleSubmit}>
                            <Form.Group className="mb-3">
                                <Form.Label>New Password</Form.Label>
                                <Form.Control
                                    type="password"
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    required
                                    className="form-control-dark"
                                    minLength={6}
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
                                    className="form-control-dark"
                                />
                            </Form.Group>
                            <Button type="submit" className="btn-accent w-100 py-2" disabled={loading}>
                                {loading ? <Spinner size="sm" /> : 'Reset Password'}
                            </Button>
                        </Form>

                        <div className="mt-3 text-center">
                            <Button variant="link" onClick={() => navigate('/login')} style={{ color: 'var(--text-muted)', textDecoration: 'none', fontSize: '0.85rem' }}>
                                Back to Sign In
                            </Button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
