import { useState, useEffect } from 'react';
import { Form, Button, Alert, Spinner, Card, Tabs, Tab } from 'react-bootstrap';
import { getSettings, updateLogo, updateFavicon, updateSetting } from '../services/api';
import { BsCloudUpload, BsCheckCircle, BsPalette, BsSearch, BsEnvelope } from 'react-icons/bs';
import SmtpSettingsPage from './SmtpSettingsPage';

export default function AdminSettingsPage() {
    const [logo, setLogo] = useState('');
    const [logoWidth, setLogoWidth] = useState(36);
    const [file, setFile] = useState(null);
    const [preview, setPreview] = useState(null);
    const [loading, setLoading] = useState(false);
    const [savingSize, setSavingSize] = useState(false);
    const [fetching, setFetching] = useState(true);
    const [message, setMessage] = useState({ type: '', text: '' });
    const [siteTitle, setSiteTitle] = useState('');
    const [metaDescription, setMetaDescription] = useState('');
    const [savingSeo, setSavingSeo] = useState(false);
    const [favicon, setFavicon] = useState('');
    const [faviconFile, setFaviconFile] = useState(null);
    const [faviconPreview, setFaviconPreview] = useState(null);
    const [savingFavicon, setSavingFavicon] = useState(false);

    useEffect(() => {
        getSettings().then(r => {
            if (r.data.portal_logo) {
                setLogo(r.data.portal_logo);
                setPreview(r.data.portal_logo);
            }
            if (r.data.portal_logo_width) {
                setLogoWidth(parseInt(r.data.portal_logo_width, 10));
            }
            if (r.data.site_title) setSiteTitle(r.data.site_title);
            if (r.data.meta_description) setMetaDescription(r.data.meta_description);
            if (r.data.favicon) {
                setFavicon(r.data.favicon);
                setFaviconPreview(r.data.favicon);
            }
        }).finally(() => setFetching(false));
    }, []);

    const handleFileChange = (e) => {
        const f = e.target.files[0];
        if (f) {
            setFile(f);
            setPreview(URL.createObjectURL(f));
        }
    };

    const handleUpload = async (e) => {
        e.preventDefault();
        if (!file) return;

        setLoading(true);
        setMessage({ type: '', text: '' });

        const formData = new FormData();
        formData.append('logo', file);

        try {
            const r = await updateLogo(formData);
            setMessage({ type: 'success', text: 'Portal logo updated successfully!' });
            // Force a refresh of the logo across the app
            setTimeout(() => window.location.reload(), 1500);
        } catch (err) {
            setMessage({ type: 'danger', text: err.response?.data?.error || 'Failed to update logo' });
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateSize = async () => {
        setSavingSize(true);
        setMessage({ type: '', text: '' });
        try {
            await updateSetting('portal_logo_width', logoWidth);
            setMessage({ type: 'success', text: 'Logo size updated successfully!' });
            setTimeout(() => window.location.reload(), 1500);
        } catch (err) {
            setMessage({ type: 'danger', text: 'Failed to update logo size' });
        } finally {
            setSavingSize(false);
        }
    };

    const handleSaveSeo = async () => {
        setSavingSeo(true);
        setMessage({ type: '', text: '' });
        try {
            await Promise.all([
                updateSetting('site_title', siteTitle),
                updateSetting('meta_description', metaDescription)
            ]);
            document.title = siteTitle || 'EventHub - Event Management System';
            const metaTag = document.querySelector('meta[name="description"]');
            if (metaTag) {
                metaTag.setAttribute('content', metaDescription);
            } else if (metaDescription) {
                const newMeta = document.createElement('meta');
                newMeta.name = 'description';
                newMeta.content = metaDescription;
                document.head.appendChild(newMeta);
            }
            setMessage({ type: 'success', text: 'Site title & meta description updated!' });
        } catch (err) {
            setMessage({ type: 'danger', text: 'Failed to update site info' });
        } finally {
            setSavingSeo(false);
        }
    };

    const handleFaviconChange = (e) => {
        const f = e.target.files[0];
        if (f) {
            setFaviconFile(f);
            setFaviconPreview(URL.createObjectURL(f));
        }
    };

    const handleFaviconUpload = async (e) => {
        e.preventDefault();
        if (!faviconFile) return;
        setSavingFavicon(true);
        setMessage({ type: '', text: '' });
        try {
            const formData = new FormData();
            formData.append('favicon', faviconFile);
            const r = await updateFavicon(formData);
            // Update favicon in browser
            let link = document.querySelector("link[rel~='icon']");
            if (!link) {
                link = document.createElement('link');
                link.rel = 'icon';
                document.head.appendChild(link);
            }
            link.href = r.data.faviconUrl;
            setMessage({ type: 'success', text: 'Favicon updated successfully!' });
            setFaviconFile(null);
        } catch (err) {
            setMessage({ type: 'danger', text: err.response?.data?.error || 'Failed to update favicon' });
        } finally {
            setSavingFavicon(false);
        }
    };

    if (fetching) return <div className="p-5 text-center"><Spinner animation="border" variant="primary" /></div>;

    return (
        <div className="animate-in max-w-2xl mx-auto">
            <div className="page-header">
                <h4>Admin Settings</h4>
                <p className="text-white small">Customize your portal branding and configuration.</p>
            </div>

            <Tabs defaultActiveKey="branding" id="admin-settings-tabs" className="admin-settings-tabs mb-3">
                <Tab eventKey="branding" title={<span className="d-inline-flex align-items-center gap-2"><BsPalette /> Branding</span>}>
            <Card className="premium-card p-4">
                <Card.Body>
                    <h5 className="mb-4 text-white">Portal Branding</h5>
                    
                    {message.text && (
                        <Alert variant={message.type} className="mb-4 d-flex align-items-center gap-2">
                            {message.type === 'success' && <BsCheckCircle />}
                            {message.text}
                        </Alert>
                    )}

                    <Form onSubmit={handleUpload}>
                        <Form.Group className="mb-4">
                            <Form.Label className="text-white-50 small mb-3">Portal Logo</Form.Label>
                            <div className="d-flex align-items-center gap-4">
                                <div 
                                    className="logo-preview-box"
                                    style={{
                                        width: 150,
                                        height: 150,
                                        borderRadius: 12,
                                        background: 'rgba(255,255,255,0.05)',
                                        border: '2px dashed rgba(255,255,255,0.1)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        overflow: 'hidden',
                                        position: 'relative'
                                    }}
                                >
                                    {preview ? (
                                        <img 
                                            src={preview.startsWith('blob:') ? preview : (preview.startsWith('http') ? preview : preview)} 
                                            alt="Logo Preview" 
                                            style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }} 
                                        />
                                    ) : (
                                        <div className="text-muted text-center p-2 small">
                                            <BsCloudUpload size={24} className="mb-2" />
                                            <div>No Logo</div>
                                        </div>
                                    )}
                                    <input 
                                        type="file" 
                                        accept="image/*" 
                                        onChange={handleFileChange}
                                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
                                    />
                                </div>
                                <div className="flex-grow-1">
                                    <div className="text-white-50 small mb-2">
                                        Upload a professional logo for your event portal. Recommended size: 200x200px.
                                    </div>
                                    <Button 
                                        type="submit" 
                                        className="btn-accent px-4" 
                                        disabled={!file || loading}
                                    >
                                        {loading ? <Spinner size="sm" /> : 'Save New Logo'}
                                    </Button>
                                </div>
                            </div>
                        </Form.Group>
                    </Form>

                    <hr className="my-5" style={{ opacity: 0.1, borderColor: '#fff' }} />

                    <div className="mb-4">
                        <h5 className="text-white mb-2">Logo Appearance</h5>
                        <p className="text-white-50 small">Control how your logo is displayed in the sidebar.</p>
                    </div>

                    {/* Live Logo Preview */}
                    {logo && (
                        <div className="mb-4 text-center p-3" style={{ background: 'var(--bg-card)', borderRadius: 12, border: '1px solid var(--border-subtle)' }}>
                            <div className="small mb-2" style={{ color: 'var(--text-muted)', fontSize: '0.7rem', textTransform: 'uppercase', fontWeight: 600 }}>Live Preview</div>
                            <img src={logo.startsWith('blob:') ? logo : logo} alt="Logo Preview" style={{ width: logoWidth, height: 'auto', objectFit: 'contain', transition: 'width 0.15s ease' }} />
                        </div>
                    )}

                    <Form.Group className="mb-4">
                        <Form.Label className="text-white-50 small mb-3">Logo Width (px)</Form.Label>
                        <div className="d-flex align-items-center gap-4">
                            <div className="flex-grow-1">
                                <Form.Range
                                    min={20}
                                    max={200}
                                    value={logoWidth}
                                    onChange={(e) => setLogoWidth(Number(e.target.value))}
                                    className="custom-range"
                                />
                                <div className="d-flex justify-content-between text-white-50" style={{ fontSize: '0.7rem' }}>
                                    <span>20px</span>
                                    <span>{logoWidth}px</span>
                                    <span>200px</span>
                                </div>
                            </div>
                            <Button
                                className="btn-accent px-4"
                                onClick={handleUpdateSize}
                                disabled={savingSize}
                            >
                                {savingSize ? <Spinner size="sm" /> : 'Save Size'}
                            </Button>
                        </div>
                    </Form.Group>
                </Card.Body>
            </Card>

            <Card className="premium-card p-4 mt-4">
                <Card.Body>
                    <h5 className="mb-4 text-white">Favicon</h5>
                    <Form onSubmit={handleFaviconUpload}>
                        <Form.Group className="mb-3">
                            <Form.Label className="text-white-50 small mb-3">Browser Tab Icon</Form.Label>
                            <div className="d-flex align-items-center gap-4">
                                <div
                                    style={{
                                        width: 64, height: 64, borderRadius: 10,
                                        background: 'rgba(255,255,255,0.05)',
                                        border: '2px dashed rgba(255,255,255,0.1)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        overflow: 'hidden', position: 'relative'
                                    }}
                                >
                                    {faviconPreview ? (
                                        <img src={faviconPreview.startsWith('blob:') ? faviconPreview : faviconPreview} alt="Favicon" style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }} />
                                    ) : (
                                        <div className="text-muted text-center small">
                                            <BsCloudUpload size={18} />
                                        </div>
                                    )}
                                    <input type="file" accept="image/*,.ico" onChange={handleFaviconChange} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} />
                                </div>
                                <div className="flex-grow-1">
                                    <div className="text-white-50 small mb-2">
                                        Upload a favicon (.ico, .png, .svg). Recommended: 32x32px or 64x64px.
                                    </div>
                                    <Button type="submit" className="btn-accent px-4" disabled={!faviconFile || savingFavicon}>
                                        {savingFavicon ? <Spinner size="sm" /> : 'Save Favicon'}
                                    </Button>
                                </div>
                            </div>
                        </Form.Group>
                    </Form>
                </Card.Body>
            </Card>
                </Tab>

                <Tab eventKey="seo" title={<span className="d-inline-flex align-items-center gap-2"><BsSearch /> SEO</span>}>
            <Card className="premium-card p-4">
                <Card.Body>
                    <h5 className="mb-2 text-white">Site Title & Meta Description</h5>
                    <p className="text-white-50 small mb-4">Set the browser tab title and meta description for SEO.</p>

                    <Form.Group className="mb-3">
                        <Form.Label className="text-white-50 small">Site Title</Form.Label>
                        <Form.Control
                            type="text"
                            placeholder="e.g. EventHub - Event Management System"
                            value={siteTitle}
                            onChange={(e) => setSiteTitle(e.target.value)}
                            className="form-control-dark"
                        />
                    </Form.Group>

                    <Form.Group className="mb-4">
                        <Form.Label className="text-white-50 small">Meta Description</Form.Label>
                        <Form.Control
                            as="textarea"
                            rows={3}
                            placeholder="A brief description of your portal for search engines..."
                            value={metaDescription}
                            onChange={(e) => setMetaDescription(e.target.value)}
                            className="form-control-dark"
                        />
                        <Form.Text className="text-white-50" style={{ fontSize: '0.7rem' }}>
                            Recommended: 150-160 characters. Current: {metaDescription.length}
                        </Form.Text>
                    </Form.Group>

                    <Button
                        className="btn-accent px-4"
                        onClick={handleSaveSeo}
                        disabled={savingSeo}
                    >
                        {savingSeo ? <Spinner size="sm" /> : 'Save'}
                    </Button>
                </Card.Body>
            </Card>
                </Tab>

                <Tab eventKey="smtp" title={<span className="d-inline-flex align-items-center gap-2"><BsEnvelope /> Email / SMTP</span>}>
                    <SmtpSettingsPage />
                </Tab>
            </Tabs>

            <style>{`
                .admin-settings-tabs .nav-link {
                    color: var(--text-secondary);
                    background: transparent;
                    border: none;
                    border-bottom: 2px solid transparent;
                    padding: 10px 18px;
                    font-weight: 600;
                    font-size: 0.9rem;
                    transition: color 0.15s, border-color 0.15s;
                }
                .admin-settings-tabs .nav-link:hover { color: var(--text-primary); }
                .admin-settings-tabs .nav-link.active {
                    color: var(--text-primary) !important;
                    background: transparent !important;
                    border-bottom-color: var(--accent) !important;
                }
                .admin-settings-tabs.nav-tabs { border-bottom: 1px solid var(--border-subtle); }
                .premium-card {
                    background: var(--bg-card);
                    border: 1px solid var(--border-subtle);
                    border-radius: var(--radius-lg);
                }
                .logo-preview-box:hover {
                    border-color: var(--accent) !important;
                    background: rgba(139, 92, 246, 0.05) !important;
                }
                .custom-range::-webkit-slider-runnable-track {
                    background: rgba(255,255,255,0.1);
                    height: 6px;
                    border-radius: 3px;
                }
                .custom-range::-webkit-slider-thumb {
                    background: var(--accent);
                    margin-top: -5px;
                }
            `}</style>
        </div>
    );
}
