import { Modal, Button, Spinner, Badge } from 'react-bootstrap';
import { BsCheck2, BsLightningChargeFill, BsStars, BsShieldCheck, BsArrowRight, BsCreditCard2Front, BsLock, BsInfoCircle } from 'react-icons/bs';

// Step 1 of the upgrade flow — shows the user what they're about to pay for
// before the Razorpay Checkout modal opens. The actual payment gateway is
// launched from the "Proceed to payment" button; this screen is purely for
// review so users can back out without accidentally triggering checkout.
export default function UpgradeReviewModal({
    show, onHide, plan, currentPlan, onProceed, busy, razorpayEnabled
}) {
    if (!plan) return null;

    const isDowngrade = (currentPlan?.price_inr ?? 0) > (plan.price_inr ?? 0);
    const isFree = plan.price_inr === 0;

    const planIcon = plan.code === 'enterprise' ? <BsStars /> :
                     plan.code === 'pro' ? <BsLightningChargeFill /> :
                     <BsShieldCheck />;

    return (
        <Modal show={show} onHide={onHide} centered size="lg" backdrop="static">
            <Modal.Header closeButton style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
                <Modal.Title style={{ color: 'var(--text-primary)', fontSize: 18, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {isDowngrade ? 'Confirm downgrade' : isFree ? 'Switch to free plan' : 'Review your upgrade'}
                </Modal.Title>
            </Modal.Header>

            <Modal.Body style={{ background: 'var(--bg-secondary)', padding: 24 }}>
                {/* Plan transition summary */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto 1fr',
                    gap: 12,
                    alignItems: 'center',
                    padding: 16,
                    borderRadius: 12,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-primary)',
                    marginBottom: 20
                }}>
                    <div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                            Current
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
                            {currentPlan?.plan_name || currentPlan?.name || 'Free'}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {currentPlan?.price_inr === 0 || !currentPlan?.price_inr ? 'Free' : `₹${Number(currentPlan.price_inr).toLocaleString('en-IN')}/mo`}
                        </div>
                    </div>

                    <BsArrowRight size={20} style={{ color: 'var(--accent)' }} />

                    <div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                            {isDowngrade ? 'Switching to' : 'Upgrading to'}
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            {planIcon} {plan.name}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {isFree ? 'Free' : `₹${Number(plan.price_inr).toLocaleString('en-IN')}/mo`}
                        </div>
                    </div>
                </div>

                {/* Features included */}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                    What's included
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, marginBottom: 20 }}>
                    {(plan.features || []).map((f, i) => (
                        <li key={i} style={{
                            padding: '8px 12px',
                            display: 'flex',
                            gap: 10,
                            alignItems: 'center',
                            background: 'var(--bg-primary)',
                            borderRadius: 8,
                            marginBottom: 6,
                            fontSize: 13,
                            color: 'var(--text-primary)'
                        }}>
                            <BsCheck2 style={{ color: 'var(--accent-emerald)', flexShrink: 0 }} size={16} />
                            {f}
                        </li>
                    ))}
                </ul>

                {/* Price breakdown — only for paid upgrades */}
                {!isFree && !isDowngrade && (
                    <div style={{
                        padding: 16,
                        borderRadius: 12,
                        border: '1px solid var(--border-subtle)',
                        background: 'var(--bg-primary)',
                        marginBottom: 16
                    }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                            Order summary
                        </div>
                        <div className="d-flex justify-content-between" style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 6 }}>
                            <span>{plan.name} plan — monthly</span>
                            <span>₹{Number(plan.price_inr).toLocaleString('en-IN')}</span>
                        </div>
                        <div className="d-flex justify-content-between" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                            <span>GST</span>
                            <span>Included</span>
                        </div>
                        <div style={{ height: 1, background: 'var(--border-subtle)', margin: '10px 0' }} />
                        <div className="d-flex justify-content-between" style={{ fontSize: 15, color: 'var(--text-primary)', fontWeight: 700 }}>
                            <span>Total due today</span>
                            <span style={{ color: 'var(--accent)' }}>₹{Number(plan.price_inr).toLocaleString('en-IN')}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <BsLock size={12} /> Renews automatically every 30 days. Cancel anytime.
                        </div>
                    </div>
                )}

                {/* Dev mode / Razorpay status notice */}
                {!razorpayEnabled && !isFree && (
                    <div style={{
                        padding: 10,
                        borderRadius: 8,
                        background: 'rgba(245, 158, 11, 0.08)',
                        border: '1px solid rgba(245, 158, 11, 0.25)',
                        fontSize: 12,
                        color: 'var(--accent-amber)',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        marginBottom: 12
                    }}>
                        <BsInfoCircle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                        <span>
                            <strong>Dev mode:</strong> Razorpay is not configured. Clicking "Proceed" will switch your plan instantly without charging.
                        </span>
                    </div>
                )}

                {isDowngrade && (
                    <div style={{
                        padding: 10,
                        borderRadius: 8,
                        background: 'rgba(239, 68, 68, 0.08)',
                        border: '1px solid rgba(239, 68, 68, 0.25)',
                        fontSize: 12,
                        color: '#ef4444',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8
                    }}>
                        <BsInfoCircle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                        <span>
                            Downgrading may lock out resources that exceed the new plan's limits. You can upgrade again at any time.
                        </span>
                    </div>
                )}
            </Modal.Body>

            <Modal.Footer style={{
                borderTop: '1px solid var(--border-subtle)',
                background: 'var(--bg-secondary)',
                padding: '14px 20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
            }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {!isFree && razorpayEnabled && (
                        <>
                            <BsLock size={12} /> Secured by Razorpay · SSL 256-bit
                        </>
                    )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="outline-secondary" size="sm" onClick={onHide} disabled={busy}>
                        Cancel
                    </Button>
                    <Button
                        className="btn-accent"
                        size="sm"
                        onClick={onProceed}
                        disabled={busy}
                        style={{ minWidth: 160 }}
                    >
                        {busy ? (
                            <><Spinner size="sm" className="me-2" /> Processing…</>
                        ) : isFree ? (
                            'Confirm switch'
                        ) : isDowngrade ? (
                            'Confirm downgrade'
                        ) : (
                            <><BsCreditCard2Front className="me-1" /> Proceed to payment</>
                        )}
                    </Button>
                </div>
            </Modal.Footer>
        </Modal>
    );
}
