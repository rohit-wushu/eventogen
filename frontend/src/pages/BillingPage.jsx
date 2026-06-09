import { useEffect, useState } from 'react';
import { Button, Alert, Spinner, Badge, ProgressBar, Table } from 'react-bootstrap';
import { useAuth } from '../context/AuthContext';
import {
    getPlans, getMySubscription, checkoutPlan, verifyPayment, getBillingConfig,
    cancelSubscription, getMyTenant, getInvoices, getInvoice
} from '../services/api';
import {
    BsCheck2, BsLightningChargeFill, BsStars, BsShieldCheck,
    BsCreditCard2Front, BsInfoCircle, BsReceipt, BsEye
} from 'react-icons/bs';
import UpgradeReviewModal from '../components/UpgradeReviewModal';
import PaymentSuccessModal from '../components/PaymentSuccessModal';
import InvoiceReceiptModal from '../components/InvoiceReceiptModal';

// Inject Razorpay Checkout script once per session.
function loadRazorpayScript() {
    return new Promise((resolve) => {
        if (window.Razorpay) return resolve(true);
        const s = document.createElement('script');
        s.src = 'https://checkout.razorpay.com/v1/checkout.js';
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.body.appendChild(s);
    });
}

const RESOURCE_LABELS = {
    events: 'Events',
    speakers: 'Speakers',
    attendees: 'Attendees',
    users: 'Team members',
    storage: 'Storage'
};

// MB → human (KB / MB / GB). Storage usage comes back in MB.
const fmtStorage = (mb) => {
    if (mb == null) return '0 MB';
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
    if (mb >= 1)    return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`;
    return `${Math.round(mb * 1024)} KB`;
};

export default function BillingPage() {
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const [loading, setLoading] = useState(true);
    const [sub, setSub] = useState(null);
    const [usage, setUsage] = useState({});
    const [plans, setPlans] = useState([]);
    const [tenant, setTenant] = useState(null);
    const [billingCfg, setBillingCfg] = useState({ razorpay_enabled: false });
    const [invoices, setInvoices] = useState([]);
    const [msg, setMsg] = useState({ type: '', text: '' });

    // Flow state: review → pay → success → receipt
    const [reviewPlan, setReviewPlan] = useState(null);
    const [reviewBusy, setReviewBusy] = useState(false);
    const [successData, setSuccessData] = useState(null);
    const [receiptInvoice, setReceiptInvoice] = useState(null);

    const load = async () => {
        setLoading(true);
        // Fetch each endpoint independently so one failure (e.g. stale backend
        // without /invoices) doesn't blank out the whole page.
        const results = await Promise.allSettled([
            getPlans(), getMySubscription(), getMyTenant(), getBillingConfig(), getInvoices()
        ]);
        const [planRes, subRes, tenantRes, cfgRes, invRes] = results;

        if (planRes.status === 'fulfilled') setPlans(planRes.value.data);
        if (subRes.status === 'fulfilled') {
            setSub(subRes.value.data.subscription);
            setUsage(subRes.value.data.usage || {});
        } else {
            setMsg({ type: 'danger', text: subRes.reason?.response?.data?.error || 'Failed to load subscription' });
        }
        if (tenantRes.status === 'fulfilled') setTenant(tenantRes.value.data);
        if (cfgRes.status === 'fulfilled') setBillingCfg(cfgRes.value.data);
        if (invRes.status === 'fulfilled') setInvoices(invRes.value.data || []);

        setLoading(false);
    };

    useEffect(() => { load(); }, []);

    // Step 1: user clicks a plan card → open the review modal (no payment yet).
    const startUpgrade = (plan) => {
        if (!isAdmin) return;
        setMsg({ type: '', text: '' });
        setReviewPlan(plan);
    };

    // Step 2: user confirms on review modal → actually hit /checkout and, for
    // paid plans, launch Razorpay Checkout from the modal handler below.
    const confirmUpgrade = async () => {
        if (!reviewPlan) return;
        const plan_code = reviewPlan.code;
        const planSnapshot = reviewPlan;
        setReviewBusy(true); setMsg({ type: '', text: '' });

        let res;
        try {
            res = await checkoutPlan(plan_code);
        } catch (err) {
            setMsg({ type: 'danger', text: err.response?.data?.error || err.message || 'Upgrade failed' });
            setReviewBusy(false);
            return;
        }

        // Dev-stub path — success immediately, no payment gateway needed.
        if (res.data.stub) {
            setReviewBusy(false);
            setReviewPlan(null);
            setSuccessData({
                planName: planSnapshot.name,
                invoiceNumber: res.data.invoice_number,
                amountInr: planSnapshot.price_inr,
                stub: true
            });
            load();
            return;
        }

        // Free downgrade — no payment needed either.
        if (res.data.free) {
            setReviewBusy(false);
            setReviewPlan(null);
            setSuccessData({
                planName: planSnapshot.name,
                amountInr: 0,
                stub: false
            });
            load();
            return;
        }

        // Paid flow: load Razorpay script + open Checkout modal.
        const ok = await loadRazorpayScript();
        if (!ok) {
            setMsg({ type: 'danger', text: 'Failed to load Razorpay. Check your connection and try again.' });
            setReviewBusy(false);
            return;
        }

        const rzp = new window.Razorpay({
            key: res.data.key_id,
            order_id: res.data.order_id,
            amount: res.data.amount,
            currency: res.data.currency,
            name: tenant?.name || 'Event Hive',
            description: `${res.data.plan.name} plan`,
            prefill: { name: user.name, email: user.email },
            theme: { color: tenant?.primary_color || '#8b5cf6' },
            handler: async (rzpRes) => {
                try {
                    const verify = await verifyPayment({
                        razorpay_order_id: rzpRes.razorpay_order_id,
                        razorpay_payment_id: rzpRes.razorpay_payment_id,
                        razorpay_signature: rzpRes.razorpay_signature,
                        plan_code
                    });
                    setReviewPlan(null);
                    setSuccessData({
                        planName: planSnapshot.name,
                        invoiceNumber: verify.data.invoice_number,
                        amountInr: planSnapshot.price_inr,
                        stub: false
                    });
                    load();
                } catch (err) {
                    setMsg({ type: 'danger', text: err.response?.data?.error || 'Payment verification failed' });
                } finally {
                    setReviewBusy(false);
                }
            },
            modal: {
                ondismiss: () => {
                    setReviewBusy(false);
                    setMsg({ type: 'warning', text: 'Payment cancelled. You can retry anytime.' });
                }
            }
        });
        rzp.on('payment.failed', (r) => {
            setReviewBusy(false);
            setMsg({ type: 'danger', text: r?.error?.description || 'Payment failed' });
        });
        rzp.open();
    };

    const handleCancel = async () => {
        if (!isAdmin) return;
        if (!window.confirm('Cancel your subscription? You will lose access to paid features at the end of the current period.')) return;
        setMsg({ type: '', text: '' });
        try {
            await cancelSubscription();
            setMsg({ type: 'success', text: 'Subscription cancelled' });
            load();
        } catch (err) {
            setMsg({ type: 'danger', text: err.response?.data?.error || 'Cancel failed' });
        }
    };

    const openReceipt = async (invoiceId) => {
        try {
            const res = await getInvoice(invoiceId);
            setReceiptInvoice(res.data);
        } catch (err) {
            setMsg({ type: 'danger', text: 'Could not load invoice' });
        }
    };

    const openLatestReceipt = async () => {
        if (!successData?.invoiceNumber) return;
        const inv = invoices.find(i => i.invoice_number === successData.invoiceNumber);
        if (inv) return openReceipt(inv.id);
        // Fall back to fetching the most recent invoice — successData may have
        // landed before load() refreshed the list.
        try {
            const latest = await getInvoices();
            const match = (latest.data || []).find(i => i.invoice_number === successData.invoiceNumber);
            if (match) openReceipt(match.id);
        } catch {}
    };

    if (loading) return <div className="p-5 text-center"><Spinner animation="border" /></div>;
    if (!sub) return <Alert variant="danger">No subscription found.</Alert>;

    const fmtInr = (p) => p === 0 ? 'Free' : `₹${p.toLocaleString('en-IN')}`;

    return (
        <div className="animate-in" style={{ maxWidth: 1000, padding: 8 }}>
            <div className="d-flex align-items-center gap-2 mb-3">
                <BsCreditCard2Front size={22} style={{ color: 'var(--accent)' }} />
                <h4 className="m-0" style={{ color: 'var(--text-primary)' }}>Billing &amp; Plan</h4>
                <Badge bg={sub.status === 'trial' ? 'warning' : sub.status === 'active' ? 'success' : 'secondary'} text="dark" className="ms-2">
                    {sub.status}
                </Badge>
            </div>

            {msg.text && <Alert variant={msg.type} className="py-2" style={{ fontSize: 13 }}>{msg.text}</Alert>}

            {!billingCfg.razorpay_enabled && (
                <Alert variant="info" className="py-2 d-flex align-items-start gap-2" style={{ fontSize: 12 }}>
                    <BsInfoCircle size={16} style={{ marginTop: 2, flexShrink: 0 }} />
                    <div>
                        <strong>Dev mode</strong> — Razorpay isn't configured. Upgrades switch plans instantly without charging.
                        <br />
                        <span style={{ opacity: 0.85 }}>
                            To turn on real payments: grab test keys from{' '}
                            <a href="https://dashboard.razorpay.com/app/keys" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                                dashboard.razorpay.com → Settings → API Keys
                            </a>
                            , paste into <code>backend/.env</code> (<code>RAZORPAY_KEY_ID</code>, <code>RAZORPAY_KEY_SECRET</code>), then restart the server.
                        </span>
                    </div>
                </Alert>
            )}

            {billingCfg.razorpay_enabled && billingCfg.test_mode && (
                <Alert variant="warning" className="py-2 d-flex align-items-start gap-2" style={{ fontSize: 12 }}>
                    <BsInfoCircle size={16} style={{ marginTop: 2, flexShrink: 0 }} />
                    <div>
                        <strong>Test mode</strong> — payments use Razorpay sandbox (no real money moves). Use these test credentials in the checkout modal:
                        <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 6, fontFamily: 'monospace', fontSize: 11 }}>
                            <div>💳 Card: <strong>4111 1111 1111 1111</strong></div>
                            <div>📅 Expiry: <strong>any future date</strong></div>
                            <div>🔒 CVV: <strong>any 3 digits</strong></div>
                            <div>📱 OTP: <strong>1111</strong></div>
                        </div>
                    </div>
                </Alert>
            )}

            {/* Current plan + usage */}
            <div className="premium-card p-4 mb-4">
                <div className="d-flex justify-content-between align-items-start flex-wrap gap-3 mb-3">
                    <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            Current plan
                        </div>
                        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)' }}>
                            {sub.plan_name}{' '}
                            <span style={{ fontSize: 16, color: 'var(--text-muted)', fontWeight: 500 }}>
                                · {fmtInr(sub.price_inr)}{sub.price_inr > 0 ? `/${sub.billing_cycle === 'yearly' ? 'yr' : 'mo'}` : ''}
                            </span>
                        </div>
                        {sub.status === 'trial' && sub.trial_ends_at && (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                                Trial ends {new Date(sub.trial_ends_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </div>
                        )}
                    </div>
                    {isAdmin && sub.status === 'active' && sub.plan_code !== 'free' && (
                        <Button variant="outline-danger" size="sm" onClick={handleCancel}>
                            Cancel plan
                        </Button>
                    )}
                </div>

                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                    Usage this period
                </div>
                {Object.entries(RESOURCE_LABELS).map(([key, label]) => {
                    const u = usage[key];
                    if (!u) return null;
                    const pct = u.unlimited ? 0 : Math.min(100, (u.used / u.limit) * 100);
                    const isStorage = u.unit === 'MB';
                    const usedLabel  = isStorage ? fmtStorage(u.used)  : u.used;
                    const limitLabel = u.unlimited ? '∞' : (isStorage ? fmtStorage(u.limit) : u.limit);
                    return (
                        <div key={key} style={{ marginBottom: 10 }}>
                            <div className="d-flex justify-content-between" style={{ fontSize: 12, marginBottom: 3 }}>
                                <span style={{ color: 'var(--text-primary)' }}>{label}</span>
                                <span style={{ color: 'var(--text-muted)' }}>
                                    {usedLabel} / {limitLabel}
                                </span>
                            </div>
                            <ProgressBar
                                now={u.unlimited ? 100 : pct}
                                variant={u.unlimited ? 'success' : pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : 'info'}
                                style={{ height: 6 }}
                            />
                        </div>
                    );
                })}
            </div>

            {/* Plan cards */}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                Available plans
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
                {plans.map(p => {
                    const isCurrent = sub.plan_code === p.code;
                    return (
                        <div key={p.id} className="premium-card p-4" style={{
                            border: isCurrent ? '2px solid var(--accent)' : '1px solid var(--border-subtle)',
                            position: 'relative'
                        }}>
                            {isCurrent && (
                                <Badge bg="success" style={{ position: 'absolute', top: 12, right: 12 }}>Current</Badge>
                            )}
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                {p.code === 'enterprise' ? <><BsStars className="me-1" /> Enterprise</> :
                                 p.code === 'pro' ? <><BsLightningChargeFill className="me-1" /> Pro</> :
                                 <><BsShieldCheck className="me-1" /> Free</>}
                            </div>
                            <div style={{ fontSize: 30, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>
                                {fmtInr(p.price_inr)}
                                {p.price_inr > 0 && (
                                    <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>
                                        {' '}/ {p.billing_cycle === 'yearly' ? 'year' : 'month'}
                                    </span>
                                )}
                            </div>
                            <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0 12px', fontSize: 13, color: 'var(--text-primary)' }}>
                                {(p.features || []).map((f, i) => (
                                    <li key={i} style={{ padding: '4px 0', display: 'flex', gap: 6, alignItems: 'start' }}>
                                        <BsCheck2 style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} /> {f}
                                    </li>
                                ))}
                            </ul>
                            {isCurrent ? (
                                <Button variant="outline-light" className="w-100" disabled>Current plan</Button>
                            ) : (
                                <Button
                                    className={p.code === 'free' ? 'w-100' : 'btn-accent w-100'}
                                    variant={p.code === 'free' ? 'outline-light' : undefined}
                                    onClick={() => startUpgrade(p)}
                                    disabled={!isAdmin}
                                >
                                    {p.price_inr === 0 ? 'Downgrade' : 'Upgrade'}
                                </Button>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Invoice history */}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '28px 0 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <BsReceipt /> Payment history
            </div>
            <div className="premium-card p-0" style={{ overflow: 'hidden' }}>
                {invoices.length === 0 ? (
                    <div style={{ padding: 28, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                        No invoices yet. Upgrade to a paid plan to see your payment history here.
                    </div>
                ) : (
                    <Table hover responsive className="mb-0" style={{ color: 'var(--text-primary)' }}>
                        <thead>
                            <tr style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
                                <th style={{ border: 'none', padding: '12px 16px' }}>Invoice</th>
                                <th style={{ border: 'none', padding: '12px 16px' }}>Date</th>
                                <th style={{ border: 'none', padding: '12px 16px' }}>Plan</th>
                                <th style={{ border: 'none', padding: '12px 16px' }}>Status</th>
                                <th style={{ border: 'none', padding: '12px 16px', textAlign: 'right' }}>Amount</th>
                                <th style={{ border: 'none', padding: '12px 16px', textAlign: 'right' }}></th>
                            </tr>
                        </thead>
                        <tbody>
                            {invoices.map(inv => (
                                <tr key={inv.id} style={{ fontSize: 13 }}>
                                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 12 }}>
                                        {inv.invoice_number}
                                    </td>
                                    <td style={{ padding: '12px 16px', color: 'var(--text-muted)' }}>
                                        {new Date(inv.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                    </td>
                                    <td style={{ padding: '12px 16px' }}>{inv.plan_name}</td>
                                    <td style={{ padding: '12px 16px' }}>
                                        <Badge bg={inv.status === 'paid' ? 'success' : inv.status === 'stub' ? 'warning' : 'secondary'} text={inv.status === 'stub' ? 'dark' : undefined}>
                                            {inv.status}
                                        </Badge>
                                    </td>
                                    <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600 }}>
                                        ₹{Number(inv.amount_inr).toLocaleString('en-IN')}
                                    </td>
                                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                                        <Button size="sm" variant="outline-light" onClick={() => openReceipt(inv.id)}>
                                            <BsEye className="me-1" /> View
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </Table>
                )}
            </div>

            {!isAdmin && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 16, textAlign: 'center' }}>
                    Only the workspace admin can change the plan.
                </div>
            )}

            {/* Flow modals */}
            <UpgradeReviewModal
                show={!!reviewPlan}
                onHide={() => !reviewBusy && setReviewPlan(null)}
                plan={reviewPlan}
                currentPlan={sub}
                onProceed={confirmUpgrade}
                busy={reviewBusy}
                razorpayEnabled={billingCfg.razorpay_enabled}
            />

            <PaymentSuccessModal
                show={!!successData}
                onHide={() => setSuccessData(null)}
                planName={successData?.planName}
                invoiceNumber={successData?.invoiceNumber}
                amountInr={successData?.amountInr}
                stub={successData?.stub}
                onViewReceipt={successData?.invoiceNumber ? openLatestReceipt : null}
            />

            <InvoiceReceiptModal
                show={!!receiptInvoice}
                onHide={() => setReceiptInvoice(null)}
                invoice={receiptInvoice}
                tenant={tenant}
            />
        </div>
    );
}
