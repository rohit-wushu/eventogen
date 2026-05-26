import { useEffect, useState } from 'react';
import { Form, Button, Alert, Card } from 'react-bootstrap';
import { BsCreditCard2Front, BsCheckCircle, BsXCircle, BsShieldLock } from 'react-icons/bs';
import { getPaymentSettings, updatePaymentSettings, testPaymentSettings } from '../services/api';

// Admin-only Razorpay configuration. Secrets are encrypted server-side; we
// only ever receive a masked preview here so even an over-the-shoulder glance
// can't reveal the key. Leaving the secret blank in the form means "keep the
// stored one" — matches Stripe/most dashboards' UX.

export default function PaymentSettingsPage() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [msg, setMsg] = useState({ type: '', text: '' });
    const [settings, setSettings] = useState({
        key_id: '',
        key_secret: '',
        key_secret_masked: '',
        is_active: true,
        configured: false,
    });

    useEffect(() => {
        getPaymentSettings()
            .then(r => setSettings(s => ({
                ...s,
                key_id: r.data.key_id || '',
                key_secret_masked: r.data.key_secret_masked || '',
                is_active: !!r.data.is_active,
                configured: !!r.data.configured,
            })))
            .catch(err => setMsg({ type: 'danger', text: err.response?.data?.error || 'Failed to load payment settings' }))
            .finally(() => setLoading(false));
    }, []);

    const save = async (e) => {
        e?.preventDefault?.();
        setMsg({ type: '', text: '' });
        try {
            setSaving(true);
            await updatePaymentSettings({
                key_id: settings.key_id.trim(),
                // Empty = keep previous secret server-side. Any non-empty value replaces it.
                key_secret: settings.key_secret.trim(),
                is_active: settings.is_active,
            });
            setMsg({ type: 'success', text: 'Razorpay settings saved.' });
            // Reload to pick up the new masked preview.
            const r = await getPaymentSettings();
            setSettings(s => ({
                ...s,
                key_secret: '',
                key_secret_masked: r.data.key_secret_masked || '',
                is_active: !!r.data.is_active,
                configured: !!r.data.configured,
            }));
        } catch (err) {
            setMsg({ type: 'danger', text: err.response?.data?.error || 'Save failed' });
        } finally { setSaving(false); }
    };

    const runTest = async () => {
        setMsg({ type: '', text: '' });
        try {
            setTesting(true);
            await testPaymentSettings();
            setMsg({ type: 'success', text: '✅ Credentials work — Razorpay accepted the request.' });
        } catch (err) {
            setMsg({ type: 'danger', text: `❌ ${err.response?.data?.error || 'Test failed'}` });
        } finally { setTesting(false); }
    };

    if (loading) return <div style={{ padding: 40, color: 'var(--text-muted)' }}>Loading…</div>;

    return (
        <div className="animate-in payment-settings-page" style={{ maxWidth: 720 }}>
            <style>{`
                /* Bootstrap's default form-switch renders almost invisibly on
                   light cards — override so the OFF state has a clear gray
                   pill + visible thumb, and the ON state uses the accent. */
                .payment-settings-page .form-check.form-switch .form-check-input {
                    width: 2.5em;
                    height: 1.3em;
                    background-color: #cbd5e1;
                    border-color: #94a3b8;
                    box-shadow: none;
                    cursor: pointer;
                    background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='-4 -4 8 8'%3e%3ccircle r='3' fill='%23ffffff'/%3e%3c/svg%3e");
                }
                .payment-settings-page .form-check.form-switch .form-check-input:checked {
                    background-color: var(--accent, #8b5cf6);
                    border-color: var(--accent, #8b5cf6);
                }
                .payment-settings-page .form-check.form-switch .form-check-input:focus {
                    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, #8b5cf6) 25%, transparent);
                }
                .payment-settings-page .form-check-label { cursor: pointer; }
            `}</style>
            <div className="page-header">
                <h4 className="d-flex align-items-center gap-2"><BsCreditCard2Front /> Payment Settings</h4>
                <p className="text-white small">Configure Razorpay so your forms can collect payments. Only admins can see or change these keys.</p>
            </div>

            {msg.text && <Alert variant={msg.type} className="py-2" style={{ fontSize: '0.9rem', borderRadius: 10 }}>{msg.text}</Alert>}

            <Card className="premium-modal">
                <Card.Body>
                    <div className="d-flex align-items-center gap-2 mb-3" style={{ fontSize: '0.85rem' }}>
                        {settings.configured ? (
                            <span style={{ color: '#10b981' }}><BsCheckCircle /> Razorpay is configured</span>
                        ) : (
                            <span style={{ color: '#f59e0b' }}><BsXCircle /> Razorpay is not yet configured</span>
                        )}
                    </div>

                    <Form onSubmit={save}>
                        <Form.Group className="mb-3">
                            <Form.Label>Key ID</Form.Label>
                            <Form.Control
                                className="form-control-dark"
                                value={settings.key_id}
                                onChange={e => setSettings(s => ({ ...s, key_id: e.target.value }))}
                                placeholder="rzp_test_XXXXXXXXXXXX or rzp_live_XXXXXXXXXXXX"
                                autoComplete="off"
                            />
                            <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                                Find this in your Razorpay Dashboard → Settings → API Keys.
                            </Form.Text>
                        </Form.Group>

                        <Form.Group className="mb-3">
                            <Form.Label>
                                Key Secret
                                {settings.key_secret_masked && (
                                    <span className="text-muted" style={{ fontSize: '0.8rem', marginLeft: 8 }}>
                                        <BsShieldLock /> stored: <code>{settings.key_secret_masked}</code>
                                    </span>
                                )}
                            </Form.Label>
                            <Form.Control
                                type="password"
                                className="form-control-dark"
                                value={settings.key_secret}
                                onChange={e => setSettings(s => ({ ...s, key_secret: e.target.value }))}
                                placeholder={settings.configured ? 'Leave blank to keep current secret' : 'Paste secret here'}
                                autoComplete="new-password"
                            />
                            <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                                Stored encrypted — admins see only the last 4 characters on the page.
                            </Form.Text>
                        </Form.Group>

                        <Form.Check
                            type="switch"
                            id="rzp-active-switch"
                            className="mb-3"
                            label={settings.is_active ? 'Active — forms can collect payments' : 'Disabled — new charges are blocked'}
                            checked={settings.is_active}
                            onChange={e => setSettings(s => ({ ...s, is_active: e.target.checked }))}
                        />

                        <div className="d-flex gap-2 flex-wrap">
                            <Button type="submit" className="btn-accent" disabled={saving}>
                                {saving ? 'Saving…' : 'Save settings'}
                            </Button>
                            <Button variant="outline-light" onClick={runTest} disabled={testing || !settings.configured}>
                                {testing ? 'Testing…' : 'Test credentials'}
                            </Button>
                        </div>
                    </Form>
                </Card.Body>
            </Card>

            <Card className="premium-modal mt-3">
                <Card.Body>
                    <h6 style={{ color: 'var(--text-primary)' }}>How it works</h6>
                    <ul style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.7, marginBottom: 0 }}>
                        <li>Add Razorpay keys here once — they're reused by every paid form in your organisation.</li>
                        <li>Open a form's builder → Settings → Accept payment. Pick Fixed or Tiered pricing.</li>
                        <li>Visitors hit <strong>Pay &amp; Submit</strong> on the public form; Razorpay's checkout opens in a popup.</li>
                        <li>Successful payments are stored with the submission. Failed / abandoned payments don't create a submission.</li>
                        <li>Test keys (<code>rzp_test_</code>) charge nothing — use card <code>4111 1111 1111 1111</code> with any future date and CVV to simulate success.</li>
                    </ul>
                </Card.Body>
            </Card>
        </div>
    );
}
