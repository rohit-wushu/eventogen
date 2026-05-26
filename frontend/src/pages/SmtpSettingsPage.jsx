import { useEffect, useState } from 'react';
import { Form, Button, Alert, Card, Row, Col } from 'react-bootstrap';
import { BsEnvelope, BsCheckCircle, BsXCircle, BsShieldLock, BsSend } from 'react-icons/bs';
import { getSmtpSettings, updateSmtpSettings, testSmtpSettings } from '../services/api';

// Admin-only SMTP configuration per organization. All outgoing emails (form
// notifications, payment receipts, password resets, invites) flow through the
// credentials saved here. Password is encrypted server-side; we only ever
// receive a masked preview. Empty password field === "don't touch" (same UX
// as PaymentSettingsPage).

const PRESETS = [
    { label: 'Gmail / Google Workspace',     host: 'smtp.gmail.com',        port: 587, secure: false, hint: 'Requires an App Password (2FA enabled).' },
    { label: 'Microsoft 365 / Outlook',      host: 'smtp.office365.com',    port: 587, secure: false, hint: 'Modern auth app passwords or SMTP-enabled mailbox.' },
    { label: 'Zoho Mail',                    host: 'smtp.zoho.in',          port: 465, secure: true,  hint: 'Use SSL on 465 or TLS on 587.' },
    { label: 'SendGrid',                     host: 'smtp.sendgrid.net',     port: 587, secure: false, hint: 'Username is literally "apikey"; password is the API key.' },
    { label: 'Amazon SES (ap-south-1)',      host: 'email-smtp.ap-south-1.amazonaws.com', port: 587, secure: false, hint: 'Use SMTP credentials generated in the SES console.' },
    { label: 'Custom / other',               host: '',                      port: 587, secure: false, hint: '' },
];

export default function SmtpSettingsPage() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [sendingTest, setSendingTest] = useState(false);
    const [msg, setMsg] = useState({ type: '', text: '' });
    const [settings, setSettings] = useState({
        host: '',
        port: 587,
        secure: false,
        username: '',
        password: '',
        password_masked: '',
        from_name: '',
        from_email: '',
        is_active: true,
        configured: false,
    });

    const reload = async () => {
        const r = await getSmtpSettings();
        setSettings(s => ({
            ...s,
            host: r.data.host || '',
            port: r.data.port || 587,
            secure: !!r.data.secure,
            username: r.data.username || '',
            password: '',
            password_masked: r.data.password_masked || '',
            from_name: r.data.from_name || '',
            from_email: r.data.from_email || '',
            is_active: !!r.data.is_active,
            configured: !!r.data.configured,
        }));
    };

    useEffect(() => {
        reload()
            .catch(err => setMsg({ type: 'danger', text: err.response?.data?.error || 'Failed to load SMTP settings' }))
            .finally(() => setLoading(false));
    }, []);

    const applyPreset = (preset) => {
        setSettings(s => ({ ...s, host: preset.host, port: preset.port, secure: preset.secure }));
    };

    const save = async (e) => {
        e?.preventDefault?.();
        setMsg({ type: '', text: '' });
        try {
            setSaving(true);
            await updateSmtpSettings({
                host: settings.host.trim(),
                port: settings.port,
                secure: settings.secure,
                username: settings.username.trim(),
                password: settings.password.trim(),
                from_name: settings.from_name.trim(),
                from_email: settings.from_email.trim(),
                is_active: settings.is_active,
            });
            await reload();
            setMsg({ type: 'success', text: 'SMTP settings saved. All outgoing emails now use this account.' });
        } catch (err) {
            setMsg({ type: 'danger', text: err.response?.data?.error || 'Save failed' });
        } finally { setSaving(false); }
    };

    const runTest = async (sendTest) => {
        setMsg({ type: '', text: '' });
        const setBusy = sendTest ? setSendingTest : setTesting;
        try {
            setBusy(true);
            const { data } = await testSmtpSettings(sendTest);
            if (sendTest && data.sent) {
                setMsg({ type: 'success', text: `✅ Test email sent to ${data.to}. Check the inbox.` });
            } else {
                setMsg({ type: 'success', text: '✅ Credentials verified — the server accepted the login.' });
            }
        } catch (err) {
            setMsg({ type: 'danger', text: `❌ ${err.response?.data?.error || 'Test failed'}` });
        } finally { setBusy(false); }
    };

    if (loading) return <Card className="premium-card p-4 mt-4"><Card.Body><div style={{ color: 'var(--text-muted)' }}>Loading SMTP settings…</div></Card.Body></Card>;

    return (
        <div className="smtp-settings-page">
            <style>{`
                .smtp-settings-page .form-check.form-switch .form-check-input {
                    width: 2.5em; height: 1.3em;
                    background-color: #cbd5e1; border-color: #94a3b8;
                    box-shadow: none; cursor: pointer;
                    background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='-4 -4 8 8'%3e%3ccircle r='3' fill='%23ffffff'/%3e%3c/svg%3e");
                }
                .smtp-settings-page .form-check.form-switch .form-check-input:checked {
                    background-color: var(--accent, #8b5cf6);
                    border-color: var(--accent, #8b5cf6);
                }
                .smtp-settings-page .form-check.form-switch .form-check-input:focus {
                    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, #8b5cf6) 25%, transparent);
                }
                .smtp-settings-page .form-check-label { cursor: pointer; }
                .smtp-preset-row { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
                .smtp-preset {
                    padding: 8px 14px; border-radius: 999px;
                    background: transparent;
                    border: 1px solid var(--border-subtle);
                    color: var(--text-secondary);
                    font-size: 0.78rem; font-weight: 600;
                    cursor: pointer; transition: all 0.15s;
                }
                .smtp-preset:hover { color: var(--text-primary); border-color: var(--accent); }
            `}</style>

            {msg.text && <Alert variant={msg.type} className="py-2 mb-3" style={{ fontSize: '0.9rem', borderRadius: 10 }}>{msg.text}</Alert>}

            <Card className="premium-card p-4">
                <Card.Body>
                    <h5 className="mb-2 text-white d-flex align-items-center gap-2"><BsEnvelope /> Email / SMTP</h5>
                    <p className="text-white-50 small mb-4">
                        Form notifications, payment receipts, invites, and password resets are sent from this mailbox. Admins only.
                    </p>
                    <div className="d-flex align-items-center gap-2 mb-3" style={{ fontSize: '0.85rem' }}>
                        {settings.configured && settings.is_active ? (
                            <span style={{ color: '#10b981' }}><BsCheckCircle /> SMTP is configured and active</span>
                        ) : settings.configured ? (
                            <span style={{ color: '#f59e0b' }}><BsXCircle /> SMTP is configured but disabled</span>
                        ) : (
                            <span style={{ color: '#f59e0b' }}><BsXCircle /> SMTP is not yet configured</span>
                        )}
                    </div>

                    <div className="smtp-preset-row">
                        {PRESETS.map(p => (
                            <button key={p.label} type="button" className="smtp-preset" onClick={() => applyPreset(p)}>
                                {p.label}
                            </button>
                        ))}
                    </div>

                    <Form onSubmit={save}>
                        <Row>
                            <Col md={8}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Host</Form.Label>
                                    <Form.Control
                                        className="form-control-dark"
                                        value={settings.host}
                                        onChange={e => setSettings(s => ({ ...s, host: e.target.value }))}
                                        placeholder="smtp.gmail.com"
                                        autoComplete="off"
                                    />
                                </Form.Group>
                            </Col>
                            <Col md={4}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Port</Form.Label>
                                    <Form.Control
                                        type="number"
                                        className="form-control-dark"
                                        value={settings.port}
                                        onChange={e => setSettings(s => ({ ...s, port: Number(e.target.value) || 587 }))}
                                        placeholder="587"
                                    />
                                </Form.Group>
                            </Col>
                        </Row>

                        <Form.Check
                            type="switch"
                            id="smtp-secure-switch"
                            className="mb-3"
                            label={settings.secure ? 'Use SSL (typically port 465)' : 'Use STARTTLS (typically port 587)'}
                            checked={settings.secure}
                            onChange={e => setSettings(s => ({ ...s, secure: e.target.checked }))}
                        />

                        <Row>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Username</Form.Label>
                                    <Form.Control
                                        className="form-control-dark"
                                        value={settings.username}
                                        onChange={e => setSettings(s => ({ ...s, username: e.target.value }))}
                                        placeholder="you@company.com or apikey"
                                        autoComplete="off"
                                    />
                                </Form.Group>
                            </Col>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>
                                        Password / API key
                                        {settings.password_masked && (
                                            <span className="text-muted" style={{ fontSize: '0.8rem', marginLeft: 8 }}>
                                                <BsShieldLock /> stored: <code>{settings.password_masked}</code>
                                            </span>
                                        )}
                                    </Form.Label>
                                    <Form.Control
                                        type="password"
                                        className="form-control-dark"
                                        value={settings.password}
                                        onChange={e => setSettings(s => ({ ...s, password: e.target.value }))}
                                        placeholder={settings.configured ? 'Leave blank to keep current' : 'Paste password or API key'}
                                        autoComplete="new-password"
                                    />
                                </Form.Group>
                            </Col>
                        </Row>

                        <Row>
                            <Col md={5}>
                                <Form.Group className="mb-3">
                                    <Form.Label>From name</Form.Label>
                                    <Form.Control
                                        className="form-control-dark"
                                        value={settings.from_name}
                                        onChange={e => setSettings(s => ({ ...s, from_name: e.target.value }))}
                                        placeholder="e.g. Acme Events"
                                    />
                                </Form.Group>
                            </Col>
                            <Col md={7}>
                                <Form.Group className="mb-3">
                                    <Form.Label>From email</Form.Label>
                                    <Form.Control
                                        type="email"
                                        className="form-control-dark"
                                        value={settings.from_email}
                                        onChange={e => setSettings(s => ({ ...s, from_email: e.target.value }))}
                                        placeholder="no-reply@company.com (defaults to username)"
                                    />
                                    <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                                        Most providers require this to match the authenticated mailbox or a verified sender.
                                    </Form.Text>
                                </Form.Group>
                            </Col>
                        </Row>

                        <Form.Check
                            type="switch"
                            id="smtp-active-switch"
                            className="mb-3"
                            label={settings.is_active ? 'Active — emails are sent' : 'Disabled — emails are suppressed for this org'}
                            checked={settings.is_active}
                            onChange={e => setSettings(s => ({ ...s, is_active: e.target.checked }))}
                        />

                        <div className="d-flex gap-2 flex-wrap">
                            <Button type="submit" className="btn-accent" disabled={saving}>
                                {saving ? 'Saving…' : 'Save settings'}
                            </Button>
                            <Button variant="outline-light" onClick={() => runTest(false)} disabled={testing || !settings.configured || !settings.is_active}>
                                {testing ? 'Testing…' : 'Test connection'}
                            </Button>
                            <Button variant="outline-light" onClick={() => runTest(true)} disabled={sendingTest || !settings.configured || !settings.is_active} className="d-flex align-items-center gap-2">
                                <BsSend /> {sendingTest ? 'Sending…' : 'Send test email to me'}
                            </Button>
                        </div>
                    </Form>
                </Card.Body>
            </Card>

            <Card className="premium-card p-4 mt-4">
                <Card.Body>
                    <h6 style={{ color: 'var(--text-primary)' }}>How it works</h6>
                    <ul style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.7, marginBottom: 0 }}>
                        <li>Every email for <strong>your organization</strong> — form notifications, payment receipts, invites, password resets — is delivered from the mailbox configured here.</li>
                        <li>Credentials are AES-encrypted in the database and never returned to the browser after save; the preview only shows the last 4 characters.</li>
                        <li>If SMTP is disabled or unconfigured, emails fall back to the system's default SMTP (set in the server's <code>.env</code>). If that's missing too, outgoing mail is skipped silently and logged.</li>
                        <li><strong>Gmail</strong>: enable 2-factor authentication, then create an <em>App Password</em> at <code>myaccount.google.com/apppasswords</code>. Use that 16-character password here, not your real account password.</li>
                        <li>Always hit <strong>Send test email to me</strong> before going live — it sends a probe to your admin address using these exact creds.</li>
                    </ul>
                </Card.Body>
            </Card>
        </div>
    );
}
