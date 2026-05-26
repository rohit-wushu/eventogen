import { Modal, Button, Badge } from 'react-bootstrap';
import { BsReceipt, BsPrinter, BsDownload } from 'react-icons/bs';

// Full receipt view. Opened from the invoice history row and from the success
// modal. Uses window.print() for a zero-dependency PDF-ish export: users can
// pick "Save as PDF" from the native print dialog.
export default function InvoiceReceiptModal({ show, onHide, invoice, tenant }) {
    if (!invoice) return null;

    const amount = Number(invoice.amount_inr || 0);
    const statusTone = {
        paid: 'success',
        stub: 'warning',
        failed: 'danger',
        refunded: 'secondary'
    }[invoice.status] || 'secondary';

    const created = invoice.created_at ? new Date(invoice.created_at) : null;

    const handlePrint = () => {
        const printRoot = document.getElementById('invoice-print-root');
        if (!printRoot) return window.print();

        const w = window.open('', '_blank', 'width=800,height=900');
        w.document.write(`<!DOCTYPE html><html><head><title>${invoice.invoice_number}</title>
            <style>
                body { font-family: -apple-system, Segoe UI, Roboto, Arial; color: #111; padding: 40px; }
                h1 { font-size: 22px; margin: 0 0 4px; }
                .muted { color: #666; font-size: 12px; }
                table { width: 100%; border-collapse: collapse; margin-top: 24px; }
                th, td { text-align: left; padding: 10px; border-bottom: 1px solid #eee; font-size: 13px; }
                .total { font-size: 16px; font-weight: 700; }
                .row { display: flex; justify-content: space-between; margin-bottom: 16px; }
                .stamp { display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 11px;
                         text-transform: uppercase; letter-spacing: 0.08em; background: #10b981; color: white; }
                .stamp.stub { background: #f59e0b; }
            </style></head><body>${printRoot.innerHTML}</body></html>`);
        w.document.close();
        setTimeout(() => w.print(), 250);
    };

    return (
        <Modal show={show} onHide={onHide} centered size="lg">
            <Modal.Header closeButton style={{ borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
                <Modal.Title style={{ color: 'var(--text-primary)', fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <BsReceipt /> Receipt
                </Modal.Title>
            </Modal.Header>

            <Modal.Body style={{ background: 'var(--bg-secondary)', padding: 24, maxHeight: '70vh', overflowY: 'auto' }}>
                <div id="invoice-print-root" style={{
                    background: 'white',
                    color: '#111',
                    padding: 32,
                    borderRadius: 8
                }}>
                    <div className="row" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                        <div>
                            <h1 style={{ fontSize: 22, margin: 0 }}>INVOICE</h1>
                            <div className="muted" style={{ color: '#666', fontSize: 12 }}>
                                {invoice.invoice_number}
                            </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <span className={`stamp ${invoice.status === 'stub' ? 'stub' : ''}`} style={{
                                display: 'inline-block', padding: '4px 10px', borderRadius: 4, fontSize: 11,
                                textTransform: 'uppercase', letterSpacing: '0.08em',
                                background: invoice.status === 'stub' ? '#f59e0b' : '#10b981', color: 'white'
                            }}>
                                {invoice.status}
                            </span>
                            <div className="muted" style={{ color: '#666', fontSize: 12, marginTop: 6 }}>
                                {created ? created.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : ''}
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
                        <div>
                            <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                                From
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>Event Hive</div>
                            <div style={{ fontSize: 12, color: '#666' }}>Billing support</div>
                        </div>
                        <div>
                            <div style={{ fontSize: 10, color: '#666', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                                Billed to
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 600 }}>
                                {invoice.tenant_name || tenant?.name || '—'}
                            </div>
                            <div style={{ fontSize: 12, color: '#666' }}>{invoice.billing_name}</div>
                            <div style={{ fontSize: 12, color: '#666' }}>{invoice.billing_email}</div>
                        </div>
                    </div>

                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 24 }}>
                        <thead>
                            <tr>
                                <th style={{ textAlign: 'left', padding: 10, borderBottom: '2px solid #eee', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#666' }}>Description</th>
                                <th style={{ textAlign: 'right', padding: 10, borderBottom: '2px solid #eee', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#666' }}>Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td style={{ padding: 12, borderBottom: '1px solid #eee', fontSize: 13 }}>
                                    <div style={{ fontWeight: 600 }}>{invoice.plan_name} plan</div>
                                    <div style={{ fontSize: 11, color: '#666', marginTop: 3 }}>
                                        {invoice.period_start && invoice.period_end ? (
                                            `${new Date(invoice.period_start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} – ${new Date(invoice.period_end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`
                                        ) : 'Monthly subscription'}
                                    </div>
                                </td>
                                <td style={{ padding: 12, borderBottom: '1px solid #eee', fontSize: 13, textAlign: 'right' }}>
                                    ₹{amount.toLocaleString('en-IN')}
                                </td>
                            </tr>
                            <tr>
                                <td style={{ padding: 10, fontSize: 12, color: '#666' }}>GST</td>
                                <td style={{ padding: 10, fontSize: 12, color: '#666', textAlign: 'right' }}>Included</td>
                            </tr>
                            <tr>
                                <td style={{ padding: 12, fontSize: 15, fontWeight: 700, borderTop: '2px solid #111' }}>Total {invoice.currency}</td>
                                <td style={{ padding: 12, fontSize: 15, fontWeight: 700, borderTop: '2px solid #111', textAlign: 'right' }}>
                                    ₹{amount.toLocaleString('en-IN')}
                                </td>
                            </tr>
                        </tbody>
                    </table>

                    {invoice.razorpay_payment_id && (
                        <div style={{ marginTop: 24, fontSize: 11, color: '#666' }}>
                            Payment ID: <span style={{ fontFamily: 'monospace' }}>{invoice.razorpay_payment_id}</span><br />
                            Order ID: <span style={{ fontFamily: 'monospace' }}>{invoice.razorpay_order_id}</span>
                        </div>
                    )}

                    <div style={{ marginTop: 24, fontSize: 11, color: '#999', textAlign: 'center' }}>
                        This is a computer-generated invoice and does not require a signature.
                    </div>
                </div>
            </Modal.Body>

            <Modal.Footer style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)', padding: '12px 20px' }}>
                <Button variant="outline-secondary" size="sm" onClick={onHide}>Close</Button>
                <Button className="btn-accent" size="sm" onClick={handlePrint}>
                    <BsPrinter className="me-1" /> Print / Save as PDF
                </Button>
            </Modal.Footer>
        </Modal>
    );
}
