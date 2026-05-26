import { useState, useEffect, useRef } from 'react';
import { Form, Button, Alert, Image, Spinner, Modal } from 'react-bootstrap';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { createSpeaker, getSpeaker, updateSpeaker, getEvents } from '../services/api';
import { BsArrowLeft, BsCloudUpload, BsShare, BsCrop } from 'react-icons/bs';
import Cropper from 'react-cropper';
import 'cropperjs/dist/cropper.css';

export default function SpeakerFormPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    const isEdit = !!id;

    const [form, setForm] = useState({
        name: '',
        salutation: '',
        other_salutation: '',
        bio: '',
        designation: '',
        company: '',
        location: '',
        email: '',
        office_no: '',
        role: '',
        event_id: '',
        photo_url: '',
        topic: '',
        panel: '',
        mobile_no: '',
        category: '',
        spokesperson_name: '',
        linkedin_url: ''
    });
    const [file, setFile] = useState(null);
    const [preview, setPreview] = useState(null);
    const [cropSrc, setCropSrc] = useState(null);
    const [cropOrigName, setCropOrigName] = useState('photo.png');
    const [photoUrlInput, setPhotoUrlInput] = useState('');
    const [urlLoading, setUrlLoading] = useState(false);
    const [urlError, setUrlError] = useState('');
    const [dragActive, setDragActive] = useState(false);
    const cropperRef = useRef(null);
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        getEvents().then(r => {
            const evts = Array.isArray(r.data) ? r.data : [];
            setEvents(evts);
            if (!isEdit && user?.role === 'employee' && user.assigned_event_id) {
                setForm(prev => ({ ...prev, event_id: user.assigned_event_id }));
            }
        }).catch(() => { });
        if (isEdit) {
            // We need a specific getSpeaker(id) function or filter from list. 
            // For now, let's assume getSpeakers() returns list and we filter, 
            // OR we add getSpeaker(id) to api.js. Let's add getSpeaker(id) to api.js first or use filter if not available.
            // Actually, let's implement getSpeaker(id) in api.js context efficiently.
            // For now, fetching list and finding.
            import('../services/api').then(api => {
                api.getSpeakers().then(r => {
                    const s = r.data.find(sp => sp.id === parseInt(id));
                    if (s) {
                        setForm({
                            name: s.name,
                            salutation: ['Smt', 'Shri', 'Mr', 'Mrs', 'Ms', 'Dr', 'Prof'].includes(s.salutation) ? s.salutation : (s.salutation ? 'Other' : ''),
                            other_salutation: !['Smt', 'Shri', 'Mr', 'Mrs', 'Ms', 'Dr', 'Prof'].includes(s.salutation) ? s.salutation || '' : '',
                            bio: s.bio || '',
                            designation: s.designation || '',
                            company: s.company || '',
                            location: s.location || '',
                            email: s.email || '',
                            office_no: s.office_no || '',
                            role: s.role || '',
                            event_id: s.event_id || '',
                            photo_url: s.photo_url || '',
                            topic: s.topic || '',
                            panel: s.panel || '',
                            mobile_no: s.mobile_no || '',
                            category: s.category || '',
                            spokesperson_name: s.spokesperson_name || '',
                            linkedin_url: s.linkedin_url || ''
                        });
                        if (s.photo_url) setPreview(s.photo_url);
                    }
                });
            });
        }
    }, [id, isEdit]);

    // Shared entry point — used by the file picker, drag-and-drop, and URL fetch.
    // Loads the file as a data URL and opens the crop modal.
    const loadFileForCrop = (f) => {
        if (!f || !f.type?.startsWith('image/')) {
            setUrlError('Only image files are supported.');
            return;
        }
        setCropOrigName(f.name || 'photo.png');
        const reader = new FileReader();
        reader.onload = () => setCropSrc(reader.result);
        reader.readAsDataURL(f);
    };

    const handleFileChange = (e) => {
        const f = e.target.files[0];
        e.target.value = '';
        if (!f) return;
        loadFileForCrop(f);
    };

    const handlePhotoDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
        const f = e.dataTransfer.files?.[0];
        if (f) loadFileForCrop(f);
    };

    const handlePhotoDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!dragActive) setDragActive(true);
    };

    const handlePhotoDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        setDragActive(false);
    };

    // Fetch a remote image URL, turn it into a File, and pipe it through the
    // cropper. CORS-restricted hosts will fail — we surface that to the user.
    const handleFetchPhotoUrl = async () => {
        const url = photoUrlInput.trim();
        if (!url) return;
        setUrlError('');
        setUrlLoading(true);
        try {
            const res = await fetch(url, { mode: 'cors' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            if (!blob.type.startsWith('image/')) throw new Error('URL did not return an image');
            const nameFromUrl = (url.split('/').pop() || 'photo').split('?')[0] || 'photo';
            const f = new File([blob], nameFromUrl, { type: blob.type });
            loadFileForCrop(f);
            setPhotoUrlInput('');
        } catch (err) {
            setUrlError(`Couldn't fetch that URL — ${err.message}. Try downloading the image and uploading it manually.`);
        } finally {
            setUrlLoading(false);
        }
    };

    const handleCropConfirm = () => {
        const cropper = cropperRef.current?.cropper;
        if (!cropper) return;
        const canvas = cropper.getCroppedCanvas({
            width: 400,
            height: 400,
            imageSmoothingQuality: 'high',
            fillColor: '#fff'
        });
        canvas.toBlob((blob) => {
            if (!blob) return;
            const baseName = (cropOrigName.replace(/\.[^.]+$/, '') || 'photo') + '.png';
            const croppedFile = new File([blob], baseName, { type: 'image/png' });
            setFile(croppedFile);
            setPreview(URL.createObjectURL(blob));
            setCropSrc(null);
        }, 'image/png', 0.92);
    };

    const handleCropCancel = () => setCropSrc(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!isEdit && !file) {
            setError('Photo is required.');
            return;
        }
        setLoading(true);
        setError('');
        try {
            const formData = new FormData();
            const finalSalutation = form.salutation === 'Other' ? form.other_salutation : form.salutation;
            
            Object.keys(form).forEach(key => {
                if (key === 'salutation') {
                    formData.append('salutation', finalSalutation);
                } else if (key !== 'other_salutation') {
                    formData.append(key, form[key]);
                }
            });

            if (file) formData.append('photo', file);

            if (isEdit) {
                formData.append('id', id);
                await updateSpeaker(formData);
            } else {
                await createSpeaker(formData);
            }
            navigate('/speakers');
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to save speaker');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="animate-in max-w-2xl mx-auto p-4">
            <Button variant="link" className="mb-3 p-0 text-decoration-none text-white" onClick={() => navigate('/speakers')}>
                <BsArrowLeft /> Back to Speakers
            </Button>

            <div className="premium-card p-4">
                <h4 className="mb-4 text-white">{isEdit ? 'Edit Speaker' : 'Add New Speaker'}</h4>

                {error && <Alert variant="danger">{error}</Alert>}

                <Form onSubmit={handleSubmit}>
                    <div className="mb-4 text-center">
                        <div
                            className="mx-auto mb-2"
                            onDragOver={handlePhotoDragOver}
                            onDragEnter={handlePhotoDragOver}
                            onDragLeave={handlePhotoDragLeave}
                            onDrop={handlePhotoDrop}
                            style={{
                                width: 120,
                                height: 120,
                                borderRadius: '50%',
                                background: 'var(--bg-body)',
                                border: dragActive ? '2px solid var(--accent)' : '2px dashed var(--border-subtle)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                overflow: 'hidden',
                                position: 'relative',
                                transition: 'border-color 0.15s, box-shadow 0.15s',
                                boxShadow: dragActive ? '0 0 0 4px var(--accent-glow)' : 'none'
                            }}
                        >
                            {preview ? (
                                <img src={preview} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            ) : (
                                <BsCloudUpload size={24} className="text-muted" />
                            )}
                            <input type="file" onChange={handleFileChange} accept="image/*" style={{ position: 'absolute', width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }} />
                        </div>
                        <Form.Label className="text-white small d-block">
                            Click, drag &amp; drop, or paste a URL {!isEdit && <span className="text-danger">*</span>}
                        </Form.Label>
                        <div className="d-flex gap-2 justify-content-center mt-2" style={{ maxWidth: 420, marginInline: 'auto' }}>
                            <Form.Control
                                size="sm"
                                type="url"
                                className="form-control-dark"
                                placeholder="https://example.com/photo.jpg"
                                value={photoUrlInput}
                                onChange={e => { setPhotoUrlInput(e.target.value); if (urlError) setUrlError(''); }}
                                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleFetchPhotoUrl(); } }}
                                disabled={urlLoading}
                            />
                            <Button
                                size="sm"
                                variant="outline-light"
                                onClick={handleFetchPhotoUrl}
                                disabled={urlLoading || !photoUrlInput.trim()}
                            >
                                {urlLoading ? <Spinner size="sm" /> : 'Load'}
                            </Button>
                        </div>
                        {urlError && (
                            <div className="text-danger small mt-2" style={{ maxWidth: 420, marginInline: 'auto' }}>
                                {urlError}
                            </div>
                        )}
                    </div>

                    <div className="d-flex gap-3">
                        <Form.Group className="mb-3" style={{ width: '120px' }}>
                            <Form.Label>Salutation</Form.Label>
                            <Form.Select 
                                className="form-select-dark" 
                                value={form.salutation} 
                                onChange={e => setForm({ ...form, salutation: e.target.value })}
                            >
                                <option value="">None</option>
                                <option value="Mr">Mr.</option>
                                <option value="Mrs">Mrs.</option>
                                <option value="Ms">Ms.</option>
                                <option value="Smt">Smt.</option>
                                <option value="Shri">Shri</option>
                                <option value="Dr">Dr.</option>
                                <option value="Prof">Prof.</option>
                                <option value="Other">Other</option>
                            </Form.Select>
                        </Form.Group>
                        {form.salutation === 'Other' && (
                            <Form.Group className="mb-3 flex-fill animate-in">
                                <Form.Label>Title</Form.Label>
                                <Form.Control 
                                    className="form-control-dark" 
                                    placeholder="Enter Title"
                                    value={form.other_salutation} 
                                    onChange={e => setForm({ ...form, other_salutation: e.target.value })} 
                                />
                            </Form.Group>
                        )}
                        <Form.Group className="mb-3 flex-fill">
                            <Form.Label>Name <span className="text-danger">*</span></Form.Label>
                            <Form.Control className="form-control-dark" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
                        </Form.Group>
                    </div>

                    <div className="d-flex gap-3">
                        <Form.Group className="mb-3 flex-fill">
                            <Form.Label>Designation <span className="text-danger">*</span></Form.Label>
                            <Form.Control className="form-control-dark" value={form.designation} onChange={e => setForm({ ...form, designation: e.target.value })} required />
                        </Form.Group>
                        <Form.Group className="mb-3 flex-fill">
                            <Form.Label>Company <span className="text-danger">*</span></Form.Label>
                            <Form.Control className="form-control-dark" value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} required />
                        </Form.Group>
                        <Form.Group className="mb-3 flex-fill">
                            <Form.Label>Location</Form.Label>
                            <Form.Control className="form-control-dark" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="e.g. New Delhi, India" />
                        </Form.Group>
                    </div>

                    <div className="d-flex gap-3">
                        <Form.Group className="mb-3 flex-fill">
                            <Form.Label>Email</Form.Label>
                            <Form.Control type="email" className="form-control-dark" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                        </Form.Group>
                        <Form.Group className="mb-3 flex-fill">
                            <Form.Label>Office No</Form.Label>
                            <Form.Control className="form-control-dark" value={form.office_no} onChange={e => setForm({ ...form, office_no: e.target.value })} />
                        </Form.Group>
                        <Form.Group className="mb-3 flex-fill">
                            <Form.Label>Mobile No</Form.Label>
                            <Form.Control className="form-control-dark" value={form.mobile_no} onChange={e => setForm({ ...form, mobile_no: e.target.value })} />
                        </Form.Group>
                    </div>

                    <div className="d-flex gap-3">
                        <Form.Group className="mb-3 flex-fill">
                            <Form.Label>Speaker Category</Form.Label>
                            <Form.Select className="form-select-dark" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                                <option value="">Select Category</option>
                                <option value="IAS">IAS</option>
                                <option value="Non IAS">Non IAS</option>
                            </Form.Select>
                        </Form.Group>
                        <Form.Group className="mb-3 flex-fill">
                            <Form.Label>Spokesperson Name <span className="text-danger">*</span></Form.Label>
                            <Form.Control className="form-control-dark" value={form.spokesperson_name} onChange={e => setForm({ ...form, spokesperson_name: e.target.value })} required />
                        </Form.Group>
                    </div>

                    <div className="d-flex gap-3">
                        <Form.Group className="mb-3 flex-fill">
                            <Form.Label>Topic</Form.Label>
                            <Form.Control className="form-control-dark" value={form.topic} onChange={e => setForm({ ...form, topic: e.target.value })} />
                        </Form.Group>
                        <Form.Group className="mb-3 flex-fill">
                            <Form.Label>Panel</Form.Label>
                            <Form.Control className="form-control-dark" value={form.panel} onChange={e => setForm({ ...form, panel: e.target.value })} />
                        </Form.Group>
                    </div>

                    <Form.Group className="mb-3">
                        <Form.Label>LinkedIn ID / URL</Form.Label>
                        <Form.Control className="form-control-dark" value={form.linkedin_url} onChange={e => setForm({ ...form, linkedin_url: e.target.value })} placeholder="e.g. linkedin.com/in/username" />
                    </Form.Group>

                    <div className="d-flex gap-3">
                        <Form.Group className="mb-3 flex-fill">
                            <Form.Label>Role <span className="text-danger">*</span></Form.Label>
                            <Form.Select className="form-select-dark" value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} required>
                                <option value="">Select Role</option>
                                <option value="Keynote">Keynote</option>
                                <option value="Chief Guest">Chief Guest</option>
                                <option value="VIP">VIP</option>
                                <option value="Govt">Govt</option>
                                <option value="Partner Speaker">Partner Speaker</option>
                                <option value="Panelist">Panelist</option>
                            </Form.Select>
                        </Form.Group>
                        <Form.Group className="mb-3 flex-fill">
                            <Form.Label>Event <span className="text-danger">*</span></Form.Label>
                            <Form.Select 
                                className="form-select-dark" 
                                value={form.event_id} 
                                onChange={e => setForm({ ...form, event_id: e.target.value })}
                                disabled={user?.role === 'employee' && !!user?.assigned_event_id}
                                required
                            >
                                <option value="">Select Event</option>
                                {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                            </Form.Select>
                        </Form.Group>
                    </div>

                    <Form.Group className="mb-4">
                        <Form.Label>Bio</Form.Label>
                        <Form.Control as="textarea" rows={4} className="form-control-dark" value={form.bio} onChange={e => setForm({ ...form, bio: e.target.value })} />
                    </Form.Group>

                    <div className="d-flex gap-2 justify-content-end">
                        {isEdit && (
                            <Button variant="outline-light" size="sm" onClick={() => navigate(`/speakers/sns/${id}`)} title="Create Social Card">
                                <BsShare className="me-2" /> Generate SNS Card
                            </Button>
                        )}
                        <Button type="submit" size="sm" className="btn-accent" disabled={loading}>
                            {loading ? <Spinner size="sm" /> : 'Save Speaker'}
                        </Button>
                    </div>
                </Form>
            </div>

            <Modal show={!!cropSrc} onHide={handleCropCancel} centered size="lg" contentClassName="bg-dark text-white">
                <Modal.Header closeButton closeVariant="white">
                    <Modal.Title className="d-flex align-items-center gap-2">
                        <BsCrop /> Crop photo to 400 × 400
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <div style={{ fontSize: '0.8rem', opacity: 0.7, marginBottom: 10 }}>
                        Drag the crop box or corners to frame the face. The output is locked to a 400 × 400 square.
                    </div>
                    {cropSrc && (
                        <Cropper
                            ref={cropperRef}
                            src={cropSrc}
                            style={{ height: 400, width: '100%' }}
                            aspectRatio={1}
                            viewMode={1}
                            dragMode="move"
                            autoCropArea={1}
                            background={false}
                            responsive
                            checkOrientation={false}
                            guides={true}
                        />
                    )}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={handleCropCancel}>Cancel</Button>
                    <Button variant="primary" onClick={handleCropConfirm}>Use this crop</Button>
                </Modal.Footer>
            </Modal>

            <style>{`
                .form-control-dark, .form-select-dark {
                    background-color: #111 !important;
                    color: #fff !important;
                    border: 1px solid rgba(255, 255, 255, 0.1) !important;
                }
                .form-control-dark:focus, .form-select-dark:focus {
                    background-color: #000 !important;
                    color: #fff !important;
                    box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.25) !important;
                    border-color: rgba(139, 92, 246, 0.5) !important;
                }
                .form-control-dark::placeholder {
                    color: rgba(255, 255, 255, 0.4) !important;
                }
                .form-select-dark option {
                    background-color: #111 !important;
                    color: #fff !important;
                }
            `}</style>
        </div>
    );
}
