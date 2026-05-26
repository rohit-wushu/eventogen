import { Modal, Button, Badge } from 'react-bootstrap';
import { BsCheckCircleFill, BsReceipt, BsDownload, BsStars } from 'react-icons/bs';

// Step 3 of the upgrade flow — celebratory confirmation with the invoice
// number + quick link into the receipt. Kept deliberately simple so it shows
// up reliably even if other state is still refreshing on the page behind it.
export default function PaymentSuccessModal({
    show, onHide, planName, invoiceNumber, amountInr, stub, onViewReceipt
}) {
    return (
        <Modal show={show} onHide={onHide} centered size="md">
            <Modal.Body style={{ background: 'var(--bg-secondary)', padding: 30, textAlign: 'center' }}>
                {/* Animated checkmark */}
                <div style={{
                    width: 88,
                    height: 88,
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(16, 185, 129, 0.25), transparent 70%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 18px',
                    animation: 'fadeInPop 0.4s ease-out'
                }}>
                    <BsCheckCircleFill size={56} style={{ color: 'var(--accent-emerald)' }} />
                </div>

                <h4 style={{ color: 'var(--text-primary)', margin: 0, fontWeight: 700 }}>
                    {stub ? 'Plan switched' : 'Payment successful!'}
                </h4>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '8px 0 18px' }}>
                    {stub
                        ? `Dev mode — ${planName} activated without charge.`
                        : <>You're now on the <strong style={{ color: 'var(--accent)' }}>{planName}</strong> plan.</>}
                </p>

                {invoiceNumber && (
                    <div style={{
                        padding: 14,
                        borderRadius: 10,
                        background: 'var(--bg-primary)',
                        border: '1px solid var(--border-subtle)',
                        marginBottom: 18,
                        textAlign: 'left'
                    }}>
                        <div className="d-flex justify-content-between align-items-center">
                            <div>
                                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                    Invoice
                                </div>
                                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                                    {invoiceNumber}
                                </div>
                            </div>
                            {amountInr != null && (
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                        Amount
                                    </div>
                                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--accent)' }}>
                                        {amountInr === 0 ? 'Free' : `₹${Number(amountInr).toLocaleString('en-IN')}`}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div className="d-flex gap-2 justify-content-center">
                    {onViewReceipt && invoiceNumber && (
                        <Button variant="outline-secondary" size="sm" onClick={onViewReceipt}>
                            <BsReceipt className="me-1" /> View receipt
                        </Button>
                    )}
                    <Button className="btn-accent" size="sm" onClick={onHide} style={{ minWidth: 120 }}>
                        <BsStars className="me-1" /> Start exploring
                    </Button>
                </div>
            </Modal.Body>

            <style>{`
                @keyframes fadeInPop {
                    0% { transform: scale(0.4); opacity: 0; }
                    60% { transform: scale(1.1); opacity: 1; }
                    100% { transform: scale(1); opacity: 1; }
                }
            `}</style>
        </Modal>
    );
}
