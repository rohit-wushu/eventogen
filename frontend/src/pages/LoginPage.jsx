import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Form, Alert, Spinner } from 'react-bootstrap';
import { useAuth } from '../context/AuthContext';
import { loginUser, forgotPassword, signupTenant } from '../services/api';
import { useBranding } from '../hooks/useBranding';
import { getImageUrl } from '../utils/imageUrl';
import { BsArrowLeft, BsCheckCircleFill, BsEye, BsEyeSlash, BsArrowRight, BsStars, BsLightningChargeFill, BsShieldCheck, BsCalendarEvent, BsMic } from 'react-icons/bs';

export default function LoginPage() {
    const { login } = useAuth();
    const location = useLocation();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPwd, setShowPwd] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    // Initial mode = 'signup' when landing on /signup, otherwise 'login'.
    const [mode, setMode] = useState(location.pathname === '/signup' ? 'signup' : 'login');
    const [forgotEmail, setForgotEmail] = useState('');
    const [forgotSent, setForgotSent] = useState(false);
    const [forgotLoading, setForgotLoading] = useState(false);
    const [signupForm, setSignupForm] = useState({ org_name: '', name: '', email: '', password: '' });
    const [signupLoading, setSignupLoading] = useState(false);
    // useBranding fetches once globally, caches, and updates <head> (title,
    // favicon, meta description). The shape returned matches the backing
    // settings keys so the JSX below reads them directly.
    const bx = useBranding();
    const brand = {
        logo: bx.portal_logo,
        favicon: bx.favicon,
        title: bx.site_title,
        tagline: bx.portal_tagline,
        heroHeadline: bx.hero_headline,
        heroSub: bx.hero_sub
    };

    const handleSubmit = async (e) => {
        e.preventDefault(); setError(''); setLoading(true);
        try {
            const res = await loginUser(email, password);
            login(res.data.token, res.data.user, res.data.pendingInvite);
        } catch (err) {
            const msg = err.response?.data?.error || err.message || 'Login failed.';
            setError(err.message === 'Network Error' ? 'Cannot connect to server.' : msg);
        }
        setLoading(false);
    };

    const handleForgot = async (e) => {
        e.preventDefault(); setError(''); setForgotLoading(true);
        try { await forgotPassword(forgotEmail); setForgotSent(true); }
        catch (err) { setError(err.response?.data?.error || 'Failed to send reset email.'); }
        setForgotLoading(false);
    };

    const setSignupField = (k, v) => setSignupForm(f => ({ ...f, [k]: v }));

    const handleSignup = async (e) => {
        e.preventDefault(); setError('');
        if (signupForm.password.length < 6) return setError('Password must be at least 6 characters');
        setSignupLoading(true);
        try {
            const res = await signupTenant(signupForm);
            login(res.data.token, res.data.user, null);
        } catch (err) {
            setError(err.response?.data?.error || 'Signup failed');
        } finally {
            setSignupLoading(false);
        }
    };

    return (
        <div className="lx-root">
            {/* ═══════════ LEFT — Product showcase ═══════════ */}
            <aside className="lx-left">
                <div className="lx-mesh" />
                <div className="lx-mesh-2" />
                <div className="lx-dots" />

                {/* Brand */}
                <div className="lx-brand">
                    {brand.logo ? (
                        <img src={getImageUrl(brand.logo)} alt={brand.title} className="lx-brand-logo" />
                    ) : (
                        <>
                            <div className="lx-brand-mark">
                                <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
                                    <path d="M12 2L4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6l-8-4z" fill="url(#gm)" />
                                    <defs>
                                        <linearGradient id="gm" x1="0" y1="0" x2="24" y2="24">
                                            <stop offset="0" stopColor="#c4b5fd" />
                                            <stop offset="0.5" stopColor="#f0abfc" />
                                            <stop offset="1" stopColor="#fda4af" />
                                        </linearGradient>
                                    </defs>
                                </svg>
                            </div>
                            <div>
                                <div className="lx-brand-name">{brand.title}</div>
                                <div className="lx-brand-sub">{brand.tagline}</div>
                            </div>
                        </>
                    )}
                </div>

                {/* Hero copy */}
                <div className="lx-hero">
                    <div className="lx-tag">
                        <BsStars /> New · AI-powered SNS cards
                    </div>
                    <h1 className="lx-headline">
                        {/* Render *word* as <em>word</em> so super admins can keep the italic accent. */}
                        {brand.heroHeadline.split(/(\*[^*]+\*)/g).map((p, i) =>
                            p.startsWith('*') && p.endsWith('*') && p.length > 2
                                ? <em key={i}>{p.slice(1, -1)}</em>
                                : p
                        )}
                    </h1>
                    <p className="lx-sub">{brand.heroSub}</p>

                    {/* Floating product preview cards */}
                    <div className="lx-previews">
                        <div className="lx-pv lx-pv-1">
                            <div className="lx-pv-head">
                                <div className="lx-pv-ico" style={{ background: 'linear-gradient(135deg,#a78bfa,#c4b5fd)' }}><BsMic /></div>
                                <div>
                                    <div className="lx-pv-t">Dr. Sarah Chen</div>
                                    <div className="lx-pv-s">Keynote · AI & Ethics</div>
                                </div>
                                <span className="lx-pill lx-pill-green">Confirmed</span>
                            </div>
                        </div>

                        <div className="lx-pv lx-pv-2">
                            <div className="lx-pv-head">
                                <div className="lx-pv-ico" style={{ background: 'linear-gradient(135deg,#f472b6,#fb7185)' }}><BsCalendarEvent /></div>
                                <div>
                                    <div className="lx-pv-t">Global Summit 2026</div>
                                    <div className="lx-pv-s">Apr 18 — 3 days · Singapore</div>
                                </div>
                            </div>
                            <div className="lx-pv-stats">
                                <div><strong>48</strong><span>Speakers</span></div>
                                <div><strong>12</strong><span>Partners</span></div>
                                <div><strong>2.4k</strong><span>RSVPs</span></div>
                            </div>
                        </div>

                        <div className="lx-pv lx-pv-3">
                            <div className="lx-pv-head">
                                <div className="lx-pv-ico" style={{ background: 'linear-gradient(135deg,#34d399,#22d3ee)' }}><BsLightningChargeFill /></div>
                                <div>
                                    <div className="lx-pv-t">SNS card generated</div>
                                    <div className="lx-pv-s">Just now · 3 variants ready</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Trust row */}
                <div className="lx-trust">
                    <div className="lx-trust-row">
                        <div className="lx-trust-stat">
                            <div className="lx-trust-num">500+</div>
                            <div className="lx-trust-lbl">Events run</div>
                        </div>
                        <div className="lx-trust-sep" />
                        <div className="lx-trust-stat">
                            <div className="lx-trust-num">25k</div>
                            <div className="lx-trust-lbl">Speakers managed</div>
                        </div>
                        <div className="lx-trust-sep" />
                        <div className="lx-trust-stat">
                            <div className="lx-trust-num">99.9%</div>
                            <div className="lx-trust-lbl">Uptime</div>
                        </div>
                    </div>
                </div>
            </aside>

            {/* ═══════════ RIGHT — Form ═══════════ */}
            <main className="lx-right">
                <div className="lx-right-top">
                    <span className="lx-live"><span className="lx-live-dot" /> Secure connection</span>
                </div>

                <div className="lx-form-box animate-in">
                    {mode === 'login' ? (
                        <>
                            {brand.logo && (
                                <img src={getImageUrl(brand.logo)} alt={brand.title} className="lx-right-logo" />
                            )}
                            <h2 className="lx-title">Sign in to {brand.title}</h2>
                            <p className="lx-desc">Enter your work email and password to continue.</p>

                            {error && <Alert className="lx-alert">{error}</Alert>}

                            <Form onSubmit={handleSubmit}>
                                <Form.Group className="mb-3">
                                    <Form.Label className="lx-lbl">Work email</Form.Label>
                                    <Form.Control
                                        type="email" value={email}
                                        onChange={e => setEmail(e.target.value)}
                                        placeholder="you@company.com" required
                                        className="lx-field" autoComplete="email"
                                    />
                                </Form.Group>

                                <Form.Group className="mb-4">
                                    <div className="d-flex justify-content-between align-items-center mb-2">
                                        <Form.Label className="lx-lbl mb-0">Password</Form.Label>
                                        <button type="button" className="lx-sm-link"
                                            onClick={() => { setMode('forgot'); setError(''); setForgotSent(false); setForgotEmail(email); }}>
                                            Forgot password?
                                        </button>
                                    </div>
                                    <div className="lx-field-wrap">
                                        <Form.Control
                                            type={showPwd ? 'text' : 'password'} value={password}
                                            onChange={e => setPassword(e.target.value)}
                                            placeholder="Enter your password" required
                                            className="lx-field" autoComplete="current-password"
                                        />
                                        <button type="button" className="lx-field-eye"
                                            onClick={() => setShowPwd(s => !s)} aria-label="Toggle password">
                                            {showPwd ? <BsEyeSlash /> : <BsEye />}
                                        </button>
                                    </div>
                                </Form.Group>

                                <button type="submit" className="lx-btn" disabled={loading}>
                                    {loading ? <Spinner size="sm" /> : <>Sign in <BsArrowRight className="lx-btn-arrow" /></>}
                                </button>
                            </Form>

                            <div className="lx-note">
                                <BsShieldCheck /> Invite-only access · Your data is encrypted end-to-end
                            </div>

                            <div style={{ textAlign: 'center', marginTop: 18, fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>
                                New here? <button type="button" className="lx-sm-link"
                                    onClick={() => { setMode('signup'); setError(''); }}
                                    style={{ color: '#a78bfa', fontWeight: 500 }}>
                                    Create a free workspace
                                </button>
                            </div>
                        </>
                    ) : mode === 'signup' ? (
                        <Form onSubmit={handleSignup}>
                            <h2 className="lx-title">Create your workspace</h2>
                            <p className="lx-desc">7-day free trial · No credit card required.</p>

                            {error && <Alert className="lx-alert">{error}</Alert>}

                            <Form.Group className="mb-3">
                                <Form.Label className="lx-lbl">Organization name</Form.Label>
                                <Form.Control
                                    value={signupForm.org_name}
                                    onChange={e => setSignupField('org_name', e.target.value)}
                                    placeholder="e.g. Acme Events" required autoFocus
                                    className="lx-field"
                                />
                            </Form.Group>

                            <Form.Group className="mb-3">
                                <Form.Label className="lx-lbl">Your name</Form.Label>
                                <Form.Control
                                    value={signupForm.name}
                                    onChange={e => setSignupField('name', e.target.value)}
                                    placeholder="Jane Doe" required
                                    className="lx-field" autoComplete="name"
                                />
                            </Form.Group>

                            <Form.Group className="mb-3">
                                <Form.Label className="lx-lbl">Work email</Form.Label>
                                <Form.Control
                                    type="email"
                                    value={signupForm.email}
                                    onChange={e => setSignupField('email', e.target.value)}
                                    placeholder="jane@acme.com" required
                                    className="lx-field" autoComplete="email"
                                />
                            </Form.Group>

                            <Form.Group className="mb-4">
                                <Form.Label className="lx-lbl">Password</Form.Label>
                                <div className="lx-field-wrap">
                                    <Form.Control
                                        type={showPwd ? 'text' : 'password'}
                                        value={signupForm.password}
                                        onChange={e => setSignupField('password', e.target.value)}
                                        placeholder="At least 6 characters" required minLength={6}
                                        className="lx-field" autoComplete="new-password"
                                    />
                                    <button type="button" className="lx-field-eye"
                                        onClick={() => setShowPwd(s => !s)} aria-label="Toggle password">
                                        {showPwd ? <BsEyeSlash /> : <BsEye />}
                                    </button>
                                </div>
                            </Form.Group>

                            <button type="submit" className="lx-btn" disabled={signupLoading}>
                                {signupLoading ? <Spinner size="sm" /> : <>Start free trial <BsArrowRight className="lx-btn-arrow" /></>}
                            </button>

                            <div className="lx-note">
                                <BsShieldCheck /> Your data is encrypted end-to-end · Cancel anytime
                            </div>

                            <div style={{ textAlign: 'center', marginTop: 14, fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>
                                Already have an account? <button type="button" className="lx-sm-link"
                                    onClick={() => { setMode('login'); setError(''); }}
                                    style={{ color: '#a78bfa', fontWeight: 500 }}>
                                    Sign in
                                </button>
                            </div>
                        </Form>
                    ) : forgotSent ? (
                        <div className="text-center">
                            <div className="lx-success"><BsCheckCircleFill /></div>
                            <h2 className="lx-title">Check your inbox</h2>
                            <p className="lx-desc">
                                If an account exists for <strong>{forgotEmail}</strong>, a secure reset link is on its way.
                            </p>
                            <button type="button" className="lx-back"
                                onClick={() => { setMode('login'); setError(''); setForgotSent(false); }}>
                                <BsArrowLeft /> Back to sign in
                            </button>
                        </div>
                    ) : (
                        <Form onSubmit={handleForgot}>
                            <h2 className="lx-title">Reset your password</h2>
                            <p className="lx-desc">We'll email you a secure link to set a new password.</p>

                            {error && <Alert className="lx-alert">{error}</Alert>}

                            <Form.Group className="mb-4">
                                <Form.Label className="lx-lbl">Work email</Form.Label>
                                <Form.Control
                                    type="email" value={forgotEmail}
                                    onChange={e => setForgotEmail(e.target.value)}
                                    placeholder="you@company.com" required
                                    className="lx-field"
                                />
                            </Form.Group>

                            <button type="submit" className="lx-btn mb-3" disabled={forgotLoading}>
                                {forgotLoading ? <Spinner size="sm" /> : <>Send reset link <BsArrowRight className="lx-btn-arrow" /></>}
                            </button>

                            <div className="text-center">
                                <button type="button" className="lx-back" onClick={() => { setMode('login'); setError(''); }}>
                                    <BsArrowLeft /> Back to sign in
                                </button>
                            </div>
                        </Form>
                    )}
                </div>

                <div className="lx-right-foot">
                    © {new Date().getFullYear()} {brand.title} · <span>Privacy</span> · <span>Terms</span> · <span>Support</span>
                </div>
            </main>
        </div>
    );
}
