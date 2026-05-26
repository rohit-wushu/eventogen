import { useEffect, useRef, useState } from 'react';
import { Form, Button, Alert, Spinner, Badge } from 'react-bootstrap';
import { useAuth } from '../context/AuthContext';
import { getMyTenant, updateMyTenant, uploadTenantLogo } from '../services/api';
import { getImageUrl } from '../utils/imageUrl';
import { BsBuilding, BsCloudUpload, BsCheck2, BsShieldLock } from 'react-icons/bs';

export default function TenantSettingsPage() {
    const { user } = useAuth();
    const canEdit = user?.role === 'admin';
    const [tenant, setTenant] = useState(null);
    const [name, setName] = useState('');
    const [primaryColor, setPrimaryColor] = useState('#8b5cf6');
    const [saving, setSaving] = useState(false);
    const [uploadBusy, setUploadBusy] = useState(false);
    const [msg, setMsg] = useState({ type: '', text: '' });
    const logoInputRef = useRef(null);

    const load = () => {
        getMyTenant().then(r => {
            setTenant(r.data);
            setName(r.data.name || '');
            setPrimaryColor(r.data.primary_color || '#8b5cf6');
        }).catch(() => setMsg({ type: 'danger', text: 'Failed to load org settings' }));
    };

    useEffect(load, []);

    const handleSave = async () => {
        setSaving(true); setMsg({ type: '', text: '' });
        try {
            await updateMyTenant({ name, primary_color: primaryColor });
            setMsg({ type: 'success', text: 'Saved' });
            load();
        } catch (err) {
            setMsg({ type: 'danger', text: err.response?.data?.error || 'Save failed' });
        } finally {
            setSaving(false);
        }
    };

    const handleLogo = async (e) => {
        const f = e.target.files?.[0]; e.target.value = '';
        if (!f) return;
        setUploadBusy(true);
        try {
            await uploadTenantLogo(f);
            load();
            setMsg({ type: 'success', text: 'Logo updated' });
        } catch (err) {
            setMsg({ type: 'danger', text: err.response?.data?.error || 'Upload failed' });
        } finally {
            setUploadBusy(false);
        }
    };

    if (!tenant) return <div className="p-5 text-center"><Spinner animation="border" /></div>;

    return (
        <div className="animate-in" style={{ maxWidth: 720, padding: 8 }}>
            <div className="d-flex align-items-center gap-2 mb-3">
                <BsBuilding size={22} style={{ color: 'var(--accent)' }} />
                <h4 className="m-0" style={{ color: 'var(--text-primary)' }}>Organization Settings</h4>
                <Badge bg={tenant.status === 'trial' ? 'warning' : 'success'} className="ms-2" text="dark">
                    {tenant.status === 'trial'
                        ? `Trial · ${tenant.trial_days_left} day${tenant.trial_days_left === 1 ? '' : 's'} left`
                        : tenant.status}
                </Badge>
            </div>

            <div className="premium-card p-4">
                {msg.text && <Alert variant={msg.type} className="py-2" style={{ fontSize: 13 }}>{msg.text}</Alert>}

                {!canEdit && (
                    <Alert variant="warning" className="py-2" style={{ fontSize: 13 }}>
                        <BsShieldLock className="me-1" /> Only the workspace admin can edit these settings.
                    </Alert>
                )}

                <Form.Group className="mb-3">
                    <Form.Label className="small muted-label">Workspace URL slug</Form.Label>
                    <Form.Control value={tenant.slug} disabled className="form-control-dark" />
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        Your unique identifier — chosen at signup and not editable.
                    </div>
                </Form.Group>

                <Form.Group className="mb-3">
                    <Form.Label className="small muted-label">Organization name</Form.Label>
                    <Form.Control
                        className="form-control-dark"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        disabled={!canEdit}
                    />
                </Form.Group>

                <Form.Group className="mb-3">
                    <Form.Label className="small muted-label">Primary color</Form.Label>
                    <div className="d-flex align-items-center gap-3">
                        <input type="color" value={primaryColor}
                            onChange={e => setPrimaryColor(e.target.value)}
                            disabled={!canEdit}
                            style={{ width: 52, height: 38, border: '1px solid var(--border-subtle)', borderRadius: 6, cursor: canEdit ? 'pointer' : 'not-allowed', padding: 3 }} />
                        <Form.Control
                            value={primaryColor}
                            onChange={e => setPrimaryColor(e.target.value)}
                            disabled={!canEdit}
                            className="form-control-dark"
                            style={{ flex: 1 }}
                        />
                    </div>
                </Form.Group>

                <Form.Group className="mb-3">
                    <Form.Label className="small muted-label">Logo</Form.Label>
                    <div className="d-flex align-items-center gap-3">
                        <div style={{
                            width: 72, height: 72, borderRadius: 12,
                            background: tenant.logo_url ? `center/contain no-repeat url(${getImageUrl(tenant.logo_url)})` : 'rgba(139,92,246,0.1)',
                            border: '1px solid var(--border-subtle)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'var(--text-muted)', fontSize: 11
                        }}>
                            {!tenant.logo_url && 'No logo'}
                        </div>
                        <input ref={logoInputRef} type="file" accept="image/*" hidden onChange={handleLogo} />
                        <Button variant="outline-light" size="sm"
                            onClick={() => logoInputRef.current?.click()}
                            disabled={!canEdit || uploadBusy}>
                            <BsCloudUpload className="me-1" />
                            {uploadBusy ? 'Uploading…' : (tenant.logo_url ? 'Replace' : 'Upload')}
                        </Button>
                    </div>
                </Form.Group>

                <div className="d-flex justify-content-end">
                    <Button className="btn-accent" onClick={handleSave} disabled={!canEdit || saving}>
                        <BsCheck2 className="me-1" /> {saving ? 'Saving…' : 'Save changes'}
                    </Button>
                </div>
            </div>
        </div>
    );
}
