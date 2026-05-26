import { Fragment, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Form, Modal, Alert, Row, Col } from 'react-bootstrap';
import {
    BsArrowLeft, BsPlus, BsTrash, BsArrowUp, BsArrowDown, BsEye, BsLink45Deg,
    BsCheck2, BsGear, BsTypeBold, BsTextParagraph, BsEnvelope, BsTelephone,
    BsHash, BsCalendarDate, BsChevronDown, BsListUl, BsUiChecks, BsPencilSquare,
    BsPerson, BsGeoAlt, BsClock, BsGripVertical, BsSendFill, BsPaperclip, BsCodeSlash,
    BsDownload, BsFiletypeHtml, BsFileEarmarkZip, BsTrophy
} from 'react-icons/bs';
import { exportFormHtml, exportFormZip } from '../utils/formExport';
import { getImageUrl } from '../utils/imageUrl';
import FormThemeCustomizer, { THEME_PRESETS } from '../components/FormThemeCustomizer';

// Special "selection id" used when the submit button row is focused in the
// builder. Field rows use numeric ids; this sentinel keeps the selection logic
// branch-free while still letting the Properties pane render a different form.
const SUBMIT_ID = '__submit__';
import {
    getForm, updateForm, getEvents, getAwardCategories,
    addFormField, updateFormField, deleteFormField, reorderFormFields,
    uploadFormHeaderImage,
} from '../services/api';

// Zoho Creator-style form builder:
//
//   Left   — Field Palette  (click OR drag a type onto the canvas)
//   Center — Building Space (live list of fields; drag rows to reorder,
//            drag palette items between rows to insert at a specific index)
//   Right  — Field Properties (edits the selected field; debounced autosave)
//
// Drag-and-drop uses HTML5 DnD with two distinct mime types so the canvas can
// tell "new field from palette" from "existing field being reordered":
//
//   application/x-palette-type  → value is the field type to insert
//   application/x-field-id      → value is the field id being moved

const PALETTE_MIME = 'application/x-palette-type';
const FIELD_MIME = 'application/x-field-id';

const FIELD_TYPES = [
    { value: 'name',     label: 'Name',         icon: BsPerson,         needsOptions: false, needsPlaceholder: true,  defaultLabel: 'Full name',       defaultPlaceholder: 'First and last name' },
    { value: 'email',    label: 'Email',        icon: BsEnvelope,       needsOptions: false, needsPlaceholder: true,  defaultLabel: 'Email address',   defaultPlaceholder: 'you@example.com' },
    { value: 'phone',    label: 'Phone',        icon: BsTelephone,      needsOptions: false, needsPlaceholder: true,  defaultLabel: 'Phone number',    defaultPlaceholder: '+91 ...' },
    { value: 'address',  label: 'Address',      icon: BsGeoAlt,         needsOptions: false, needsPlaceholder: true,  defaultLabel: 'Address',         defaultPlaceholder: 'Street, city, state, ZIP' },
    { value: 'text',     label: 'Single line',  icon: BsTypeBold,       needsOptions: false, needsPlaceholder: true,  defaultLabel: 'Short answer',    defaultPlaceholder: '' },
    { value: 'textarea', label: 'Multi line',   icon: BsTextParagraph,  needsOptions: false, needsPlaceholder: true,  defaultLabel: 'Long answer',     defaultPlaceholder: '' },
    { value: 'number',   label: 'Number',       icon: BsHash,           needsOptions: false, needsPlaceholder: true,  defaultLabel: 'Number',          defaultPlaceholder: '' },
    { value: 'date',     label: 'Date',         icon: BsCalendarDate,   needsOptions: false, needsPlaceholder: false, defaultLabel: 'Date',            defaultPlaceholder: '' },
    { value: 'time',     label: 'Time',         icon: BsClock,          needsOptions: false, needsPlaceholder: false, defaultLabel: 'Time',            defaultPlaceholder: '' },
    { value: 'dropdown', label: 'Drop down',    icon: BsChevronDown,    needsOptions: true,  needsPlaceholder: false, defaultLabel: 'Select one',      defaultPlaceholder: '' },
    { value: 'radio',    label: 'Radio',        icon: BsListUl,         needsOptions: true,  needsPlaceholder: false, defaultLabel: 'Choose one',      defaultPlaceholder: '' },
    { value: 'checkbox', label: 'Multi select', icon: BsUiChecks,       needsOptions: true,  needsPlaceholder: false, defaultLabel: 'Select all that apply', defaultPlaceholder: '' },
    { value: 'consent',  label: 'Checkbox',     icon: BsUiChecks,       needsOptions: false, needsPlaceholder: true,  defaultLabel: 'Terms & Conditions', defaultPlaceholder: 'I have read and accept the terms' },
    { value: 'file',     label: 'File upload',  icon: BsPaperclip,      needsOptions: false, needsPlaceholder: false, defaultLabel: 'Upload a file',   defaultPlaceholder: '' },
    { value: 'award_category', label: 'Award category', icon: BsTrophy,  needsOptions: false, needsPlaceholder: false, defaultLabel: 'Award category',  defaultPlaceholder: '' },
];
const TYPE_BY_VALUE = Object.fromEntries(FIELD_TYPES.map(t => [t.value, t]));

export default function FormBuilderPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const [form, setForm] = useState(null);
    const [events, setEvents] = useState([]);
    const [awardCats, setAwardCats] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedId, setSelectedId] = useState(null);
    const [showSettings, setShowSettings] = useState(false);
    const [settings, setSettings] = useState({
        title: '', description: '', event_id: '', thank_you_message: '', redirect_url: '', submit_label: '',
        notify_email: '', max_submissions: '', close_at: '', is_active: true,
        payment_enabled: false, payment_mode: 'fixed', payment_amount: '', payment_currency: 'INR',
        payment_description: '',
        payment_tiers: [{ label: 'Early Bird', amount: '', valid_until: '' }, { label: 'Regular', amount: '', valid_until: '' }],
        header_image_url: '', background_color: '',
        captcha_enabled: false,
        theme: 'classic',
        theme_config: {},
    });
    const [showEmbed, setShowEmbed] = useState(false);
    const [embedCopied, setEmbedCopied] = useState(false);
    const [headerUploading, setHeaderUploading] = useState(false);
    const [headerUploadError, setHeaderUploadError] = useState('');
    const [showExport, setShowExport] = useState(false);
    const [exportApiBase, setExportApiBase] = useState('');
    const [exporting, setExporting] = useState(false);
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState('');
    const [savingSettings, setSavingSettings] = useState(false);
    const [copied, setCopied] = useState(false);
    const [saveStatus, setSaveStatus] = useState(''); // '' | 'saving' | 'saved'

    // Builder mode toggles between "build" (palette + canvas + field props)
    // and "customize" (palette + live preview iframe + theme/colour/font
    // customizer). Customize lives inline so operators see every tweak
    // applied in the preview without losing canvas context.
    const [builderMode, setBuilderMode] = useState('build');
    // Iframe re-mount key — bumped after every theme autosave so the
    // preview reloads with the latest CSS variables.
    const [previewBust, setPreviewBust] = useState(0);

    // Drag state — which index the drop indicator should render above.
    // `null` = no drag in progress. `form.fields.length` = indicator at bottom.
    const [dropIndex, setDropIndex] = useState(null);

    const saveTimer = useRef(null);
    const pendingDraft = useRef(null);
    // Separate autosave channel for form-level props (currently only
    // submit_label) so editing the submit button doesn't interfere with the
    // field-property autosave.
    const submitSaveTimer = useRef(null);
    const pendingSubmitLabel = useRef(null);
    const formRef = useRef(null); // always points at the latest form object
    // Theme autosave — debounced like submit-label so dragging a color
    // slider doesn't fire one PUT per intermediate value.
    const themeSaveTimer = useRef(null);

    const load = async (keepSelected = false) => {
        try {
            setLoading(true);
            const [{ data }, evRes] = await Promise.all([
                getForm(id),
                getEvents().catch(() => ({ data: [] })),
            ]);
            setForm(data);
            setSettings({
                title: data.title || '',
                description: data.description || '',
                event_id: data.event_id || '',
                thank_you_message: data.thank_you_message || '',
                redirect_url: data.redirect_url || '',
                submit_label: data.submit_label || '',
                notify_email: data.notify_email || '',
                max_submissions: data.max_submissions || '',
                // MySQL DATETIME → YYYY-MM-DDTHH:MM for <input type="datetime-local">.
                close_at: data.close_at ? new Date(data.close_at).toISOString().slice(0, 16) : '',
                is_active: !!data.is_active,
                payment_enabled: !!data.payment_enabled,
                payment_mode: data.payment_mode || 'fixed',
                payment_amount: data.payment_amount || '',
                payment_currency: data.payment_currency || 'INR',
                payment_description: data.payment_description || '',
                payment_tiers: Array.isArray(data.payment_tiers) && data.payment_tiers.length > 0
                    // Normalize loaded tiers — older rows may not have valid_until at all.
                    ? data.payment_tiers.map(t => ({ ...t, valid_until: t.valid_until || '' }))
                    : [{ label: 'Early Bird', amount: '', valid_until: '' }, { label: 'Regular', amount: '', valid_until: '' }],
                header_image_url: data.header_image_url || '',
                background_color: data.background_color || '',
                captcha_enabled: !!data.captcha_enabled,
                theme: data.theme || 'classic',
                theme_config: data.theme_config && typeof data.theme_config === 'object' ? data.theme_config : {},
            });
            setEvents(Array.isArray(evRes.data) ? evRes.data : []);
            if (!keepSelected) {
                setSelectedId(prev => {
                    if (prev && data.fields.some(f => f.id === prev)) return prev;
                    return data.fields[0]?.id || null;
                });
            }
        } catch (err) { setError(err.response?.data?.error || 'Failed to load form'); }
        finally { setLoading(false); }
    };

    useEffect(() => { load(); return () => { flushNow(); flushSubmitLabel(); }; /* eslint-disable-next-line */ }, [id]);

    // Keep `formRef` in sync so autosave callbacks always see the latest form
    // (they run after state updates due to setTimeout, so closure-captured
    // `form` would be stale).
    useEffect(() => { formRef.current = form; }, [form]);

    // Pull the linked event's award categories so the award_category field
    // preview can show the real options the public visitor will see.
    useEffect(() => {
        if (!form?.event_id) { setAwardCats([]); return; }
        const hasAwardField = form.fields?.some(ff => ff.field_type === 'award_category');
        if (!hasAwardField) return;
        getAwardCategories(form.event_id)
            .then(r => setAwardCats(Array.isArray(r.data) ? r.data : []))
            .catch(() => setAwardCats([]));
    }, [form?.event_id, form?.fields]);

    const selected = form?.fields.find(f => f.id === selectedId) || null;
    const submitSelected = selectedId === SUBMIT_ID;

    const flushNow = async () => {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        const draft = pendingDraft.current;
        pendingDraft.current = null;
        if (!draft) return;
        try {
            setSaveStatus('saving');
            await updateFormField(id, draft.id, {
                field_type: draft.field_type,
                label: draft.label,
                placeholder: draft.placeholder || null,
                help_text: draft.help_text || null,
                required: !!draft.required,
                options: Array.isArray(draft.options) ? draft.options : [],
                width: draft.width === 'half' ? 'half' : 'full',
                condition: draft.condition && draft.condition.field_id ? draft.condition : null,
            });
            setSaveStatus('saved');
            setTimeout(() => setSaveStatus(s => s === 'saved' ? '' : s), 1200);
        } catch (err) {
            setSaveStatus('');
            setError(err.response?.data?.error || 'Autosave failed');
        }
    };

    const patchSelected = (patch) => {
        if (!selected) return;
        const nextField = { ...selected, ...patch };
        setForm(f => ({
            ...f,
            fields: f.fields.map(x => x.id === selected.id ? nextField : x),
        }));
        pendingDraft.current = nextField;
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(flushNow, 600);
    };

    // Debounced autosave for the submit-button label. Mirrors `patchSelected`
    // but writes to the form-level API instead of a field.
    const flushSubmitLabel = async () => {
        clearTimeout(submitSaveTimer.current);
        submitSaveTimer.current = null;
        const newLabel = pendingSubmitLabel.current;
        pendingSubmitLabel.current = null;
        if (newLabel === null || newLabel === undefined) return;
        const f = formRef.current;
        if (!f) return;
        try {
            setSaveStatus('saving');
            await updateForm(id, {
                title: f.title,
                description: f.description || null,
                event_id: f.event_id || null,
                thank_you_message: f.thank_you_message || null,
                redirect_url: f.redirect_url || null,
                submit_label: (newLabel || '').trim() || null,
                notify_email: f.notify_email || null,
                max_submissions: f.max_submissions || null,
                close_at: f.close_at || null,
                is_active: f.is_active,
                // Preserve payment config — otherwise autosave wipes it.
                payment_enabled: !!f.payment_enabled,
                payment_mode: f.payment_mode || null,
                payment_amount: f.payment_amount || null,
                payment_currency: f.payment_currency || null,
                payment_tiers: f.payment_tiers || null,
                payment_description: f.payment_description || null,
                // Carry through the form-level branding fields too so this
                // autosave doesn't blow them away. They're not edited here,
                // but the PUT endpoint replaces every field every time.
                header_image_url: settings.header_image_url || null,
                background_color: settings.background_color || null,
                captcha_enabled: !!settings.captcha_enabled,
                theme: settings.theme || 'classic',
                theme_config: settings.theme_config || {},
            });
            setSaveStatus('saved');
            setTimeout(() => setSaveStatus(s => s === 'saved' ? '' : s), 1200);
        } catch (err) {
            setSaveStatus('');
            setError(err.response?.data?.error || 'Autosave failed');
        }
    };

    // Persist the active theme + override config. Re-uses the full form
    // payload because the PUT endpoint replaces every field on every call;
    // sending only theme/theme_config would null out everything else.
    const flushTheme = async () => {
        clearTimeout(themeSaveTimer.current);
        themeSaveTimer.current = null;
        const f = formRef.current;
        if (!f) return;
        try {
            setSaveStatus('saving');
            await updateForm(id, {
                title: f.title,
                description: f.description || null,
                event_id: f.event_id || null,
                thank_you_message: f.thank_you_message || null,
                redirect_url: f.redirect_url || null,
                submit_label: f.submit_label || null,
                notify_email: f.notify_email || null,
                max_submissions: f.max_submissions || null,
                close_at: f.close_at || null,
                is_active: f.is_active,
                payment_enabled: !!f.payment_enabled,
                payment_mode: f.payment_mode || null,
                payment_amount: f.payment_amount || null,
                payment_currency: f.payment_currency || null,
                payment_tiers: f.payment_tiers || null,
                payment_description: f.payment_description || null,
                header_image_url: settings.header_image_url || null,
                background_color: settings.background_color || null,
                captcha_enabled: !!settings.captcha_enabled,
                theme: settings.theme || 'classic',
                theme_config: settings.theme_config || {},
            });
            setSaveStatus('saved');
            setTimeout(() => setSaveStatus(s => s === 'saved' ? '' : s), 1200);
            // Bust the preview iframe so it picks up the new theme.
            setPreviewBust(b => b + 1);
        } catch (err) {
            setSaveStatus('');
            setError(err.response?.data?.error || 'Theme save failed');
        }
    };

    // Apply a preset key — replaces theme_config with the preset's full
    // defaults so the customizer's color rows show the new values right
    // away (instead of inheriting whatever the previous theme had).
    const pickThemePreset = (key) => {
        const preset = THEME_PRESETS[key];
        if (!preset) return;
        setSettings(s => ({ ...s, theme: key, theme_config: { ...preset.config } }));
        clearTimeout(themeSaveTimer.current);
        themeSaveTimer.current = setTimeout(flushTheme, 400);
    };

    // Tweak a single config key (e.g. primary color) on top of the active
    // preset. Debounced so dragging a color picker doesn't fire one PUT
    // per intermediate value.
    const patchThemeConfig = (patch) => {
        setSettings(s => ({ ...s, theme_config: { ...(s.theme_config || {}), ...patch } }));
        clearTimeout(themeSaveTimer.current);
        themeSaveTimer.current = setTimeout(flushTheme, 600);
    };

    const patchSubmitLabel = (newLabel) => {
        setForm(f => ({ ...f, submit_label: newLabel }));
        pendingSubmitLabel.current = newLabel;
        clearTimeout(submitSaveTimer.current);
        submitSaveTimer.current = setTimeout(flushSubmitLabel, 600);
    };

    // Create a new field. Optionally insert it at `atIndex`; if omitted it's
    // appended at the end.
    const addFieldAt = async (type, atIndex) => {
        try {
            await flushNow();
            setError('');
            const typeInfo = TYPE_BY_VALUE[type];
            if (!typeInfo) return;
            const { data } = await addFormField(id, {
                field_type: type,
                label: typeInfo.defaultLabel || 'Untitled field',
                placeholder: typeInfo.defaultPlaceholder || '',
                required: false,
                options: typeInfo.needsOptions ? ['Option 1', 'Option 2'] : [],
            });
            // If a specific index was requested, send a reorder to place it there.
            if (typeof atIndex === 'number' && form?.fields) {
                const currentIds = form.fields.map(f => f.id);
                const nextOrder = [...currentIds];
                nextOrder.splice(atIndex, 0, data.id);
                try { await reorderFormFields(id, nextOrder); } catch { /* non-fatal */ }
            }
            await load(true);
            setSelectedId(data.id);
        } catch (err) { setError(err.response?.data?.error || 'Failed to add field'); }
    };

    const moveFieldTo = async (fieldId, toIndex) => {
        if (!form) return;
        const currentIds = form.fields.map(f => f.id);
        const fromIndex = currentIds.indexOf(fieldId);
        if (fromIndex === -1) return;
        const next = [...currentIds];
        next.splice(fromIndex, 1);
        // If we removed an item before the target index, target shifts down by 1.
        const adjusted = fromIndex < toIndex ? toIndex - 1 : toIndex;
        next.splice(adjusted, 0, fieldId);
        // Optimistic local reorder so the UI feels instant.
        const idToField = Object.fromEntries(form.fields.map(f => [f.id, f]));
        setForm(f => ({ ...f, fields: next.map(i => idToField[i]) }));
        try { await reorderFormFields(id, next); }
        catch (err) { alert(err.response?.data?.error || 'Reorder failed'); await load(true); }
    };

    const selectField = async (fieldId) => {
        if (fieldId !== selectedId) {
            await flushNow();
            await flushSubmitLabel();
        }
        setSelectedId(fieldId);
    };

    const removeField = async (fid) => {
        if (!window.confirm('Remove this field?')) return;
        try {
            await flushNow();
            await deleteFormField(id, fid);
            await load(false);
        } catch (err) { alert(err.response?.data?.error || 'Failed to remove field'); }
    };

    const moveFieldByArrow = async (idx, dir) => {
        const target = idx + dir;
        if (target < 0 || target >= form.fields.length) return;
        await moveFieldTo(form.fields[idx].id, target);
    };

    // ── Drag handlers ────────────────────────────────────────────
    const onPaletteDragStart = (e, type) => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData(PALETTE_MIME, type);
        e.dataTransfer.setData('text/plain', type); // broad fallback
    };
    const onRowDragStart = (e, fieldId) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(FIELD_MIME, String(fieldId));
    };
    // Compute insert index based on where within the row the cursor is.
    const onRowDragOver = (e, idx) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        setDropIndex(before ? idx : idx + 1);
    };
    // Drop in empty area below all rows.
    const onCanvasDragOver = (e) => {
        e.preventDefault();
        // If the dragover isn't on a row, we'll default to end-of-list.
        // Individual row handlers set a more specific index.
    };
    const onCanvasDragEnd = () => setDropIndex(null);
    const onCanvasDrop = async (e) => {
        e.preventDefault();
        const targetIndex = dropIndex ?? form.fields.length;
        setDropIndex(null);

        const paletteType = e.dataTransfer.getData(PALETTE_MIME);
        const fieldId = e.dataTransfer.getData(FIELD_MIME);
        if (paletteType) {
            await addFieldAt(paletteType, targetIndex);
        } else if (fieldId) {
            await moveFieldTo(Number(fieldId), targetIndex);
        } else {
            // Fallback: treat text/plain as a palette type if it matches a known field.
            const plain = e.dataTransfer.getData('text/plain');
            if (TYPE_BY_VALUE[plain]) await addFieldAt(plain, targetIndex);
        }
    };

    // Upload a local file as the form's header image. Backend stores under
    // /uploads, persists the URL on the row, and returns it. We mirror the URL
    // into local settings state so the preview updates immediately and the
    // next saveSettings doesn't accidentally clear it.
    const handleHeaderImageUpload = async (file) => {
        if (!file) return;
        if (!file.type?.startsWith('image/')) {
            setHeaderUploadError('Please choose an image file.');
            return;
        }
        if (file.size > 20 * 1024 * 1024) {
            setHeaderUploadError('File is too large (max 20 MB).');
            return;
        }
        setHeaderUploadError('');
        setHeaderUploading(true);
        try {
            const { data } = await uploadFormHeaderImage(id, file);
            const url = data?.url;
            if (url) setSettings(s => ({ ...s, header_image_url: url }));
        } catch (err) {
            setHeaderUploadError(err?.response?.data?.error || 'Upload failed');
        } finally {
            setHeaderUploading(false);
        }
    };

    const saveSettings = async () => {
        try {
            setError('');
            const title = (settings.title || '').trim();
            if (!title) { setError('Form title is required'); return; }
            const notifyEmail = (settings.notify_email || '').trim();
            if (notifyEmail) {
                const tokens = notifyEmail.split(/[,;\s]+/).map(t => t.trim()).filter(Boolean);
                const bad = tokens.filter(t => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t));
                if (bad.length) { setError(`Invalid email address: ${bad.join(', ')}`); return; }
            }
            const redirectUrl = (settings.redirect_url || '').trim();
            if (redirectUrl) {
                try {
                    const u = new URL(redirectUrl);
                    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad scheme');
                } catch { setError('Redirect URL must start with http:// or https://'); return; }
            }
            // Validate payment config client-side for clearer errors.
            let payment_payload = { payment_enabled: false };
            if (settings.payment_enabled) {
                if (settings.payment_mode === 'fixed') {
                    const amt = Number(settings.payment_amount);
                    if (!(amt > 0)) { setError('Payment amount must be greater than 0'); return; }
                    payment_payload = {
                        payment_enabled: true,
                        payment_mode: 'fixed',
                        payment_amount: amt,
                        payment_currency: settings.payment_currency || 'INR',
                        payment_description: settings.payment_description || null,
                    };
                } else if (settings.payment_mode === 'award_category') {
                    // Amount is resolved at submit time from the picked category —
                    // no tier list or fixed amount needed here.
                    payment_payload = {
                        payment_enabled: true,
                        payment_mode: 'award_category',
                        payment_currency: settings.payment_currency || 'INR',
                        payment_description: settings.payment_description || null,
                    };
                } else {
                    const tiers = (settings.payment_tiers || [])
                        .map(t => ({
                            label: String(t.label || '').trim(),
                            amount: Number(t.amount),
                            // Empty string from <input type="datetime-local"> → null so
                            // the backend treats the tier as always-active.
                            valid_until: t.valid_until ? t.valid_until : null,
                        }))
                        .filter(t => t.label && t.amount > 0);
                    if (tiers.length === 0) { setError('Add at least one pricing tier with a label and amount'); return; }
                    payment_payload = {
                        payment_enabled: true,
                        payment_mode: 'tiered',
                        payment_tiers: tiers,
                        payment_currency: settings.payment_currency || 'INR',
                        payment_description: settings.payment_description || null,
                    };
                }
            }
            setSavingSettings(true);
            await updateForm(id, {
                title,
                description: settings.description || null,
                event_id: settings.event_id || null,
                thank_you_message: settings.thank_you_message || null,
                redirect_url: redirectUrl || null,
                submit_label: (settings.submit_label || '').trim() || null,
                notify_email: notifyEmail || null,
                max_submissions: settings.max_submissions ? Math.max(1, parseInt(settings.max_submissions, 10)) : null,
                // <input type="datetime-local"> gives "YYYY-MM-DDTHH:MM" in local time; send as-is — MySQL parses it.
                close_at: settings.close_at || null,
                is_active: settings.is_active,
                header_image_url: (settings.header_image_url || '').trim() || null,
                background_color: (settings.background_color || '').trim() || null,
                captcha_enabled: !!settings.captcha_enabled,
                theme: settings.theme || 'classic',
                theme_config: settings.theme_config || {},
                ...payment_payload,
            });
            setShowSettings(false);
            await load(true);
        } catch (err) { setError(err.response?.data?.error || 'Failed to save settings'); }
        finally { setSavingSettings(false); }
    };

    // Inline title editing — click the form title in the header to edit it,
    // Enter / blur to save, Escape to cancel.
    const startEditTitle = () => { setTitleDraft(form?.title || ''); setEditingTitle(true); };
    const cancelEditTitle = () => { setEditingTitle(false); setTitleDraft(''); };
    const commitTitle = async () => {
        const trimmed = (titleDraft || '').trim();
        if (!trimmed) { cancelEditTitle(); return; }
        if (trimmed === form.title) { cancelEditTitle(); return; }
        try {
            await updateForm(id, {
                title: trimmed,
                description: form.description || null,
                event_id: form.event_id || null,
                thank_you_message: form.thank_you_message || null,
                redirect_url: form.redirect_url || null,
                submit_label: form.submit_label || null,
                notify_email: form.notify_email || null,
                max_submissions: form.max_submissions || null,
                close_at: form.close_at || null,
                is_active: form.is_active,
                payment_enabled: !!form.payment_enabled,
                payment_mode: form.payment_mode || null,
                payment_amount: form.payment_amount || null,
                payment_currency: form.payment_currency || null,
                payment_tiers: form.payment_tiers || null,
                payment_description: form.payment_description || null,
            });
            await load(true);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to update title');
        } finally {
            setEditingTitle(false);
        }
    };

    const copyPublicLink = async () => {
        const url = `${window.location.origin}/f/${id}`;
        try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); }
        catch { alert(url); }
    };

    if (loading) return <div style={{ padding: 40, color: 'var(--text-muted)' }}>Loading form…</div>;
    if (!form) return <div style={{ padding: 40, color: 'var(--text-muted)' }}>Form not found.</div>;

    return (
        <div className="animate-in fb-page">
            <style>{`
                .fb-page { display: flex; flex-direction: column; gap: 12px; }
                .fb-top {
                    display: flex; justify-content: space-between; align-items: center;
                    flex-wrap: wrap; gap: 10px;
                }
                .fb-title h4 {
                    margin: 0; display: inline-flex; align-items: center;
                    color: var(--text-primary);
                }
                .fb-title h4:hover { color: var(--accent); }
                .fb-title-input {
                    font-size: 1.25rem; font-weight: 700;
                    background: transparent;
                    border: 1px solid var(--accent);
                    border-radius: 8px;
                    color: var(--text-primary);
                    padding: 2px 10px;
                    outline: none;
                    min-width: 260px; font-family: inherit;
                }
                .fb-title p { margin: 0; font-size: 0.78rem; opacity: 0.7; color: var(--text-secondary); }
                .fb-save-chip {
                    display: inline-flex; align-items: center; gap: 6px;
                    font-size: 0.72rem; color: var(--text-muted);
                    padding: 4px 10px; border-radius: 999px;
                    background: rgba(255,255,255,0.04);
                    border: 1px solid var(--border-subtle);
                }
                .fb-save-chip.saving { color: #f59e0b; border-color: rgba(245,158,11,0.35); }
                .fb-save-chip.saved  { color: #10b981; border-color: rgba(16,185,129,0.35); }

                /* Build / Customize segmented toggle. Sits inline with the
                   other top-bar buttons so the modes feel like peers, not
                   a navigation route. */
                .fb-mode-toggle {
                    display: inline-flex;
                    background: rgba(255,255,255,0.04);
                    border: 1px solid var(--border-subtle);
                    border-radius: 999px;
                    padding: 3px;
                    gap: 2px;
                }
                .fb-mode-btn {
                    background: transparent; border: none;
                    color: var(--text-muted); font-weight: 600; font-size: 0.78rem;
                    padding: 5px 14px; border-radius: 999px;
                    cursor: pointer; transition: background 0.15s, color 0.15s;
                }
                .fb-mode-btn:hover { color: var(--text-primary); }
                .fb-mode-btn.active { background: var(--accent); color: #fff; }

                /* Live preview iframe — fills the canvas pane in customize
                   mode. White background so the form's own bg renders
                   cleanly against the dark builder. */
                .fb-preview-pane { padding: 12px; display: flex; flex-direction: column; }
                .fb-preview-iframe {
                    flex: 1; width: 100%;
                    border: 1px solid var(--border-subtle);
                    border-radius: 12px;
                    background: #fff;
                    min-height: 60vh;
                }

                .fb-layout {
                    display: grid;
                    grid-template-columns: 230px 1fr 320px;
                    gap: 14px;
                    min-height: calc(100vh - 230px);
                }
                .fb-pane {
                    background: var(--bg-card);
                    border: 1px solid var(--border-subtle);
                    border-radius: 14px;
                    padding: 16px;
                    overflow-y: auto;
                }
                .fb-pane-title {
                    font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em;
                    color: var(--text-muted); font-weight: 700;
                    margin: 0 0 12px;
                }

                /* ── Palette ── */
                .fb-palette-grid {
                    display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
                }
                .fb-palette-item {
                    display: flex; flex-direction: column; align-items: center;
                    gap: 6px; padding: 14px 8px; border-radius: 10px;
                    background: rgba(255,255,255,0.02);
                    border: 1px dashed var(--border-subtle);
                    color: var(--text-secondary);
                    cursor: grab; transition: all 0.15s;
                    font-family: inherit; font-size: 0.72rem;
                    text-align: center;
                    user-select: none;
                }
                .fb-palette-item:hover {
                    background: rgba(139,92,246,0.08);
                    border-color: var(--accent);
                    color: var(--text-primary);
                    transform: translateY(-1px);
                }
                .fb-palette-item:active { cursor: grabbing; }
                .fb-palette-item svg { font-size: 20px; color: var(--accent); }
                .fb-palette-hint {
                    font-size: 0.7rem; color: var(--text-muted);
                    margin: 14px 0 0; line-height: 1.4;
                    padding-top: 10px; border-top: 1px dashed var(--border-subtle);
                }

                /* The "Submit Button" palette tile is visually distinct — it
                   doesn't add a new item, it selects the always-present
                   submit-button row in the canvas. */
                .fb-palette-submit {
                    display: flex; align-items: center; justify-content: center;
                    gap: 8px; padding: 14px 12px; border-radius: 10px;
                    width: 100%;
                    background: linear-gradient(135deg, var(--accent), var(--accent-pink, #ec4899));
                    border: 1px solid transparent;
                    color: #fff; font-weight: 700; font-size: 0.82rem;
                    cursor: pointer; transition: transform 0.15s, box-shadow 0.15s;
                    font-family: inherit;
                    box-shadow: 0 8px 20px -8px var(--accent);
                }
                .fb-palette-submit:hover { transform: translateY(-1px); box-shadow: 0 12px 26px -8px var(--accent); }
                .fb-palette-submit svg { font-size: 16px; }

                /* Submit button preview row at the bottom of the canvas. */
                .fb-submit-row {
                    display: flex; align-items: center; justify-content: center;
                    gap: 10px; padding: 14px 16px; margin-top: 14px;
                    background: linear-gradient(135deg, var(--accent), var(--accent-pink, #ec4899));
                    border: 2px solid transparent;
                    color: #fff; font-weight: 700; font-size: 0.95rem;
                    border-radius: 12px;
                    cursor: pointer; transition: all 0.15s;
                    box-shadow: 0 10px 24px -10px var(--accent);
                }
                .fb-submit-row:hover { transform: translateY(-1px); }
                .fb-submit-row.active {
                    border-color: #fff;
                    box-shadow: 0 10px 24px -10px var(--accent), 0 0 0 3px rgba(139,92,246,0.3);
                }

                /* ── Canvas ── */
                .fb-canvas-empty {
                    border: 2px dashed var(--border-subtle);
                    border-radius: 14px;
                    padding: 60px 20px;
                    text-align: center;
                    color: var(--text-muted);
                    background: rgba(255,255,255,0.02);
                }
                .fb-canvas-empty.drop-hover {
                    border-color: var(--accent);
                    background: rgba(139,92,246,0.08);
                }
                .fb-canvas-empty .fb-empty-ico {
                    width: 56px; height: 56px;
                    margin: 0 auto 14px;
                    border-radius: 14px;
                    background: rgba(139,92,246,0.12);
                    color: var(--accent);
                    display: grid; place-items: center;
                    font-size: 24px;
                }
                /* Canvas is a 2-col grid so half-width fields literally pair up
                   side-by-side, matching what the public form will render. The
                   drop indicator spans the full grid width so it's easy to see
                   during drag-to-reorder. */
                .fb-field-grid {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 10px;
                }
                .fb-row.is-full { grid-column: 1 / -1; }
                .fb-row.is-half { grid-column: span 1; }
                .fb-drop-indicator {
                    height: 2px; background: var(--accent);
                    border-radius: 1px;
                    box-shadow: 0 0 0 3px rgba(139,92,246,0.15);
                    margin: 4px 0;
                    grid-column: 1 / -1;
                }
                @media (max-width: 900px) {
                    .fb-field-grid { grid-template-columns: 1fr; }
                    .fb-row.is-half { grid-column: 1 / -1; }
                }
                .fb-row {
                    display: flex; flex-direction: column; gap: 10px;
                    padding: 14px 14px;
                    min-width: 0;
                    background: rgba(255,255,255,0.02);
                    border: 1px solid var(--border-subtle);
                    border-radius: 10px;
                    transition: all 0.15s;
                    user-select: none;
                }
                .fb-row:hover { border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
                .fb-row.active {
                    border-color: var(--accent);
                    background: rgba(139,92,246,0.06);
                    box-shadow: 0 0 0 2px rgba(139,92,246,0.15);
                }
                .fb-row-header {
                    display: flex; align-items: center; gap: 10px;
                    cursor: pointer;
                }
                .fb-row-handle {
                    color: var(--text-muted); cursor: grab;
                    opacity: 0.6; padding: 4px;
                }
                .fb-row-handle:active { cursor: grabbing; }
                .fb-row-ico {
                    width: 28px; height: 28px; border-radius: 7px;
                    background: rgba(139,92,246,0.12);
                    color: var(--accent);
                    display: grid; place-items: center; flex-shrink: 0;
                }
                .fb-row-main { flex: 1; min-width: 0; }
                .fb-row-label { font-weight: 600; color: var(--text-primary); font-size: 0.9rem; }
                .fb-req-star { color: #ef4444; margin-left: 4px; }
                .fb-type-badge {
                    font-size: 0.62rem; font-weight: 700;
                    padding: 2px 8px; border-radius: 999px;
                    background: rgba(139,92,246,0.12);
                    color: var(--accent);
                    letter-spacing: 0.04em; text-transform: uppercase;
                    flex-shrink: 0;
                }
                .fb-cond-badge {
                    display: inline-block; margin-left: 8px;
                    font-size: 0.6rem; font-weight: 700;
                    padding: 1px 7px; border-radius: 999px;
                    background: rgba(245,158,11,0.15);
                    color: #f59e0b;
                    letter-spacing: 0.04em; text-transform: uppercase;
                }
                .fb-row-actions { display: flex; gap: 4px; opacity: 0; transition: opacity 0.15s; }
                .fb-row:hover .fb-row-actions,
                .fb-row.active .fb-row-actions { opacity: 1; }

                /* Live field preview (the actual input rendered disabled). */
                .fb-row-preview { padding-left: 40px; pointer-events: none; }
                .fb-preview-input {
                    width: 100%; padding: 8px 12px;
                    background: rgba(0,0,0,0.25);
                    border: 1px solid var(--border-subtle);
                    border-radius: 8px;
                    color: var(--text-secondary); font-size: 0.88rem;
                    font-family: inherit; outline: none;
                }
                .fb-preview-input::placeholder { color: var(--text-muted); opacity: 0.7; }
                textarea.fb-preview-input { min-height: 56px; resize: none; }
                .fb-preview-choices { display: flex; flex-direction: column; gap: 6px; }
                .fb-preview-choice {
                    display: flex; align-items: center; gap: 8px;
                    color: var(--text-secondary); font-size: 0.85rem;
                    padding: 4px 0;
                }
                .fb-preview-choice input { accent-color: var(--accent); }
                .fb-preview-empty-options {
                    font-style: italic; color: var(--text-muted); font-size: 0.78rem;
                }
                .fb-preview-file {
                    display: flex; align-items: center;
                    padding: 10px 14px;
                    background: rgba(0,0,0,0.25);
                    border: 1px dashed var(--border-subtle);
                    border-radius: 8px;
                    color: var(--text-muted); font-size: 0.85rem;
                }

                /* ── Properties ── */
                .fb-props-empty {
                    padding: 30px 10px; text-align: center;
                    color: var(--text-muted); font-size: 0.85rem;
                }
                .fb-prop-group { margin-bottom: 16px; }
                .fb-prop-group label { display: block; font-size: 0.75rem; color: var(--text-secondary); font-weight: 600; margin-bottom: 6px; }
                .fb-prop-group input, .fb-prop-group textarea, .fb-prop-group select {
                    width: 100%; padding: 8px 12px;
                    background: rgba(0,0,0,0.25);
                    border: 1px solid var(--border-subtle);
                    border-radius: 8px;
                    color: var(--text-primary); font-size: 0.88rem;
                    font-family: inherit; outline: none;
                    transition: border-color 0.15s;
                }
                .fb-prop-group input:focus,
                .fb-prop-group textarea:focus,
                .fb-prop-group select:focus { border-color: var(--accent); }

                .fb-option-row { display: flex; gap: 6px; margin-bottom: 6px; }
                .fb-option-row input { flex: 1; }
                .fb-option-remove {
                    width: 34px; height: 34px; flex-shrink: 0;
                    background: transparent; border: 1px solid var(--border-subtle);
                    border-radius: 8px; color: #ef4444; cursor: pointer;
                    display: grid; place-items: center;
                }
                .fb-option-add {
                    margin-top: 4px;
                    background: transparent; border: 1px dashed var(--border-subtle);
                    color: var(--accent); border-radius: 8px;
                    padding: 6px 12px; font-size: 0.78rem; font-weight: 600;
                    cursor: pointer;
                }

                .fb-required-toggle {
                    display: flex; align-items: center; justify-content: space-between;
                    padding: 10px 12px; border-radius: 8px;
                    background: rgba(0,0,0,0.2);
                    border: 1px solid var(--border-subtle);
                }
                /* Custom pill toggle for Required / Conditional. Built as a
                   plain <button> so we don't fight Bootstrap's form-switch
                   styling. The inner <span> is the thumb that slides right
                   when .on is added to the parent. */
                .fb-switch {
                    flex-shrink: 0;
                    width: 44px; height: 24px;
                    padding: 2px;
                    border: none;
                    border-radius: 999px;
                    background: rgba(148,163,184,0.35);
                    cursor: pointer;
                    transition: background-color 0.2s;
                    position: relative;
                    display: inline-block;
                }
                .fb-switch span {
                    display: block;
                    width: 20px; height: 20px;
                    border-radius: 50%;
                    background: #fff;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.25);
                    transition: transform 0.2s;
                    transform: translateX(0);
                }
                .fb-switch.on { background: var(--accent); }
                .fb-switch.on span { transform: translateX(20px); }
                .fb-switch:focus-visible {
                    outline: none;
                    box-shadow: 0 0 0 3px rgba(139,92,246,0.35);
                }
                .fb-switch:disabled {
                    opacity: 0.4; cursor: not-allowed;
                }

                /* Width toggle (Full / Half) in the Properties panel. */
                .fb-width-toggle { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
                .fb-width-btn {
                    display: flex; flex-direction: column; align-items: center; gap: 6px;
                    padding: 10px 8px; border-radius: 10px;
                    background: rgba(0,0,0,0.25);
                    border: 1px solid var(--border-subtle);
                    color: var(--text-secondary); font-size: 0.75rem; font-weight: 600;
                    cursor: pointer; transition: all 0.15s; font-family: inherit;
                }
                .fb-width-btn:hover { border-color: color-mix(in srgb, var(--accent) 45%, transparent); }
                .fb-width-btn.active {
                    border-color: var(--accent); color: var(--accent);
                    background: rgba(139,92,246,0.08);
                }
                .fb-width-viz { display: flex; gap: 4px; width: 60px; }
                .fb-width-viz span {
                    height: 10px; border-radius: 3px;
                    background: currentColor; opacity: 0.55;
                }
                .fb-width-viz-full span { flex: 1; }
                .fb-width-viz-half span { flex: 1; max-width: 50%; }

                /* ── Responsive: stack all three panes on narrow screens ── */
                @media (max-width: 1100px) {
                    .fb-layout { grid-template-columns: 1fr; min-height: 0; }
                    .fb-pane { overflow: visible; }
                    .fb-palette-grid { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); }
                }
            `}</style>

            <Button variant="link" className="mb-0 p-0 text-decoration-none text-white align-self-start" onClick={() => navigate('/forms')}>
                <BsArrowLeft /> All Forms
            </Button>

            <div className="fb-top">
                <div className="fb-title">
                    {editingTitle ? (
                        <input
                            type="text"
                            className="fb-title-input"
                            value={titleDraft}
                            onChange={e => setTitleDraft(e.target.value)}
                            onBlur={commitTitle}
                            onKeyDown={e => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') cancelEditTitle(); }}
                            autoFocus
                        />
                    ) : (
                        <h4 onClick={startEditTitle} title="Click to rename" style={{ cursor: 'text' }}>
                            {form.title} <BsPencilSquare size={13} style={{ opacity: 0.5, marginLeft: 6 }} />
                        </h4>
                    )}
                    <p>{form.fields.length} field{form.fields.length === 1 ? '' : 's'} · {form.is_active ? 'Accepting responses' : 'Closed'}</p>
                </div>
                <div className="d-flex gap-2 align-items-center">
                    {/* Build / Customize segmented toggle. Switching to
                        Customize shows the theme/colour/font customizer in
                        the right pane and the live-preview iframe in the
                        centre. */}
                    <div className="fb-mode-toggle">
                        <button
                            type="button"
                            className={`fb-mode-btn ${builderMode === 'build' ? 'active' : ''}`}
                            onClick={() => setBuilderMode('build')}
                        >Build</button>
                        <button
                            type="button"
                            className={`fb-mode-btn ${builderMode === 'customize' ? 'active' : ''}`}
                            onClick={() => { setBuilderMode('customize'); setSelectedId(null); }}
                        >Customize</button>
                    </div>
                    {saveStatus && <span className={`fb-save-chip ${saveStatus}`}>{saveStatus === 'saving' ? 'Saving…' : 'Saved'}</span>}
                    <Button variant="outline-light" size="sm" className="d-flex align-items-center gap-2" onClick={copyPublicLink}>
                        {copied ? <><BsCheck2 /> Copied</> : <><BsLink45Deg /> Copy link</>}
                    </Button>
                    <Button variant="outline-light" size="sm" className="d-flex align-items-center gap-2"
                        onClick={() => window.open(`/f/${id}`, '_blank', 'noopener')}>
                        <BsEye /> Preview
                    </Button>
                    <Button variant="outline-light" size="sm" className="d-flex align-items-center gap-2" onClick={() => setShowEmbed(true)}>
                        <BsCodeSlash /> Embed
                    </Button>
                    <Button variant="outline-light" size="sm" className="d-flex align-items-center gap-2"
                        onClick={() => {
                            // Derive the backend's absolute URL so the exported form knows where to post.
                            // In dev, the API helper uses "/api" (relative); strip any trailing "/api" since
                            // the exported JS appends it itself.
                            const detected = (import.meta.env.VITE_API_URL || '').trim().replace(/\/api\/?$/, '')
                                || window.location.origin;
                            setExportApiBase(detected);
                            setShowExport(true);
                        }}>
                        <BsDownload /> Export
                    </Button>
                    <Button variant="outline-light" size="sm" className="d-flex align-items-center gap-2" onClick={() => setShowSettings(true)}>
                        <BsGear /> Settings
                    </Button>
                </div>
            </div>

            {error && <Alert variant="danger" className="py-2" style={{ fontSize: '0.85rem', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>{error}</Alert>}

            <div className="fb-layout">
                {/* ── LEFT: FIELD PALETTE ─────────────────────── */}
                <div className="fb-pane">
                    <div className="fb-pane-title">Basic fields</div>
                    <div className="fb-palette-grid">
                        {FIELD_TYPES.map(t => {
                            const Icon = t.icon;
                            return (
                                <div
                                    key={t.value}
                                    role="button"
                                    tabIndex={0}
                                    className="fb-palette-item"
                                    draggable
                                    onDragStart={e => onPaletteDragStart(e, t.value)}
                                    onClick={() => addFieldAt(t.value)}
                                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); addFieldAt(t.value); } }}
                                    title={`Add or drag "${t.label}" into the form`}
                                >
                                    <Icon />
                                    <span>{t.label}</span>
                                </div>
                            );
                        })}
                    </div>

                    <div className="fb-pane-title" style={{ marginTop: 20 }}>Actions</div>
                    <button
                        type="button"
                        className="fb-palette-submit"
                        onClick={() => selectField(SUBMIT_ID)}
                        title="Select the submit button to edit its label"
                    >
                        <BsSendFill />
                        <span>Submit Button</span>
                    </button>

                    <p className="fb-palette-hint">
                        Click a field to add it, drag it between existing fields to insert at any position, or click Submit Button to edit its label.
                    </p>
                </div>

                {/* ── CENTER: BUILDING SPACE — or live preview iframe in
                    customize mode. The iframe re-mounts whenever theme
                    autosave finishes (previewBust bumps), so changes show
                    up without manual reload. */}
                {builderMode === 'customize' ? (
                    <div className="fb-pane fb-preview-pane">
                        <div className="fb-pane-title d-flex align-items-center justify-content-between">
                            <span>Live preview</span>
                            <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>Updates as you change theme</span>
                        </div>
                        <iframe
                            key={previewBust}
                            title="Form preview"
                            src={`/f/${id}?preview=1&t=${previewBust}`}
                            className="fb-preview-iframe"
                        />
                    </div>
                ) : (
                <div
                    className="fb-pane"
                    onDragOver={onCanvasDragOver}
                    onDrop={onCanvasDrop}
                    onDragLeave={onCanvasDragEnd}
                >
                    <div className="fb-pane-title d-flex align-items-center justify-content-between">
                        <span>Form fields</span>
                        <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>Click to edit · drag to reorder</span>
                    </div>

                    {form.fields.length === 0 ? (
                        <div
                            className={`fb-canvas-empty ${dropIndex !== null ? 'drop-hover' : ''}`}
                            onDragOver={e => { e.preventDefault(); setDropIndex(0); }}
                            onDragLeave={() => setDropIndex(null)}
                        >
                            <div className="fb-empty-ico"><BsPencilSquare /></div>
                            <p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>No fields yet</p>
                            <p style={{ fontSize: '0.82rem' }}>Drag a field type from the left, or click any tile to add one.</p>
                        </div>
                    ) : (
                        <div className="fb-field-grid">
                            {form.fields.map((f, i) => {
                                const Icon = TYPE_BY_VALUE[f.field_type]?.icon || BsPerson;
                                const typeLabel = TYPE_BY_VALUE[f.field_type]?.label || f.field_type;
                                const isHalf = f.width === 'half';
                                return (
                                    <Fragment key={f.id}>
                                        {dropIndex === i && <div className="fb-drop-indicator" />}
                                        <div
                                            className={`fb-row ${isHalf ? 'is-half' : 'is-full'} ${selectedId === f.id ? 'active' : ''}`}
                                            draggable
                                            onDragStart={e => onRowDragStart(e, f.id)}
                                            onDragOver={e => onRowDragOver(e, i)}
                                            onDragEnd={onCanvasDragEnd}
                                            onClick={() => selectField(f.id)}
                                        >
                                            <div className="fb-row-header">
                                                <span className="fb-row-handle" title="Drag to reorder"><BsGripVertical size={16} /></span>
                                                <div className="fb-row-ico"><Icon size={14} /></div>
                                                <div className="fb-row-main">
                                                    <span className="fb-row-label">
                                                        {f.label || <em style={{ color: 'var(--text-muted)' }}>Untitled</em>}
                                                        {f.required && <span className="fb-req-star">*</span>}
                                                    </span>
                                                    {f.condition?.field_id && (
                                                        <span className="fb-cond-badge" title="This field only appears when its condition is met">
                                                            Conditional
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="fb-type-badge">{typeLabel}</span>
                                                <div className="fb-row-actions" onClick={e => e.stopPropagation()}>
                                                    <button className="btn-action" title="Move up" disabled={i === 0} onClick={() => moveFieldByArrow(i, -1)}><BsArrowUp size={13} /></button>
                                                    <button className="btn-action" title="Move down" disabled={i === form.fields.length - 1} onClick={() => moveFieldByArrow(i, 1)}><BsArrowDown size={13} /></button>
                                                    <button className="btn-action danger" title="Remove" onClick={() => removeField(f.id)}><BsTrash size={13} /></button>
                                                </div>
                                            </div>
                                            <div className="fb-row-preview">{renderFieldPreview(f, awardCats)}</div>
                                        </div>
                                    </Fragment>
                                );
                            })}
                            {dropIndex === form.fields.length && <div className="fb-drop-indicator" />}
                        </div>
                    )}

                    {/* The submit button lives outside the reorderable field
                        grid — it always sits at the very bottom of the form. */}
                    <div
                        className={`fb-submit-row ${submitSelected ? 'active' : ''}`}
                        onClick={() => selectField(SUBMIT_ID)}
                    >
                        <BsSendFill size={16} />
                        <span>{form.submit_label || 'Submit'}</span>
                    </div>
                </div>
                )}

                {/* ── RIGHT: FIELD PROPERTIES — or theme customizer when
                    Customize mode is active. */}
                <div className="fb-pane">
                    {builderMode === 'customize' ? (
                        <>
                            <div className="fb-pane-title">Customize design</div>
                            <FormThemeCustomizer
                                theme={settings.theme || 'classic'}
                                themeConfig={settings.theme_config || {}}
                                onPickPreset={pickThemePreset}
                                onPatchConfig={patchThemeConfig}
                            />
                        </>
                    ) : (
                        <>
                            <div className="fb-pane-title">
                                {submitSelected ? 'Submit button' : 'Field properties'}
                            </div>
                            {submitSelected ? (
                                <SubmitProperties
                                    label={form.submit_label || ''}
                                    onChange={patchSubmitLabel}
                                />
                            ) : !selected ? (
                                <div className="fb-props-empty">
                                    Select a field in the centre to edit its label, placeholder, options and validation.
                                </div>
                            ) : (
                                <>
                                    {selected.field_type === 'award_category' && !form.event_id && (
                                        <Alert variant="warning" className="py-2 mb-3" style={{ fontSize: '0.8rem', borderRadius: 10, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#fbbf24' }}>
                                            This form isn't linked to an event. Award-category fields pull options
                                            from the linked event's award categories — open <strong>Settings</strong> and
                                            choose a Linked event, otherwise the public form will show no options.
                                        </Alert>
                                    )}
                                    <PropertiesPanel
                                        field={selected}
                                        onChange={patchSelected}
                                        allFields={form.fields}
                                    />
                                </>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Settings modal */}
            <Modal show={showSettings} onHide={() => setShowSettings(false)} centered size="lg" contentClassName="premium-modal">
                <Modal.Header closeButton closeVariant="white">
                    <Modal.Title>Form Settings</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {error && <Alert variant="danger" className="py-2" style={{ fontSize: '0.85rem', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>{error}</Alert>}
                    <Form.Group className="mb-3">
                        <Form.Label>Title *</Form.Label>
                        <Form.Control
                            className="form-control-dark"
                            value={settings.title}
                            onChange={e => setSettings(s => ({ ...s, title: e.target.value }))}
                        />
                    </Form.Group>
                    <Form.Group className="mb-3">
                        <Form.Label>Description</Form.Label>
                        <Form.Control
                            as="textarea" rows={2}
                            className="form-control-dark"
                            value={settings.description}
                            onChange={e => setSettings(s => ({ ...s, description: e.target.value }))}
                        />
                    </Form.Group>

                    <Form.Group className="mb-3">
                        <Form.Label>Header image</Form.Label>
                        <div className="d-flex gap-2 align-items-center">
                            <Form.Control
                                type="url"
                                className="form-control-dark flex-grow-1"
                                value={settings.header_image_url}
                                onChange={e => setSettings(s => ({ ...s, header_image_url: e.target.value }))}
                                placeholder="Paste image URL or upload →"
                                disabled={headerUploading}
                            />
                            <label
                                className="btn btn-outline-light btn-sm mb-0"
                                style={{ border: '1px solid var(--border-subtle)', borderRadius: 10, cursor: headerUploading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}
                            >
                                {headerUploading ? 'Uploading…' : 'Upload'}
                                <input
                                    type="file"
                                    hidden
                                    accept="image/*"
                                    disabled={headerUploading}
                                    onChange={e => {
                                        const f = e.target.files?.[0];
                                        e.target.value = '';
                                        if (f) handleHeaderImageUpload(f);
                                    }}
                                />
                            </label>
                            {settings.header_image_url && !headerUploading && (
                                <Button
                                    variant="link"
                                    size="sm"
                                    className="text-decoration-none"
                                    style={{ color: 'var(--text-muted)' }}
                                    onClick={() => setSettings(s => ({ ...s, header_image_url: '' }))}
                                >
                                    Clear
                                </Button>
                            )}
                        </div>
                        <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                            Optional banner shown at the top of the public form. Paste a public URL or upload from your computer (max 20 MB).
                        </Form.Text>
                        {headerUploadError && (
                            <div className="text-danger small mt-1" style={{ fontSize: '0.75rem' }}>{headerUploadError}</div>
                        )}
                        {settings.header_image_url && (
                            <div className="mt-2">
                                <img
                                    src={getImageUrl(settings.header_image_url)}
                                    alt="Header preview"
                                    style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 8, display: 'block' }}
                                    onError={e => { e.currentTarget.style.display = 'none'; }}
                                />
                            </div>
                        )}
                    </Form.Group>

                    <Form.Group className="mb-3">
                        <Form.Label>Background color</Form.Label>
                        <div className="d-flex align-items-center gap-2">
                            <Form.Control
                                type="color"
                                className="form-control-color"
                                style={{ width: 56, padding: 4, border: '1px solid var(--border-subtle)', borderRadius: 8 }}
                                value={settings.background_color || '#ffffff'}
                                onChange={e => setSettings(s => ({ ...s, background_color: e.target.value }))}
                            />
                            <Form.Control
                                className="form-control-dark"
                                value={settings.background_color}
                                onChange={e => setSettings(s => ({ ...s, background_color: e.target.value }))}
                                placeholder="#ffffff"
                                style={{ maxWidth: 160 }}
                            />
                            {settings.background_color && (
                                <Button
                                    variant="link"
                                    size="sm"
                                    className="text-decoration-none"
                                    style={{ color: 'var(--text-muted)' }}
                                    onClick={() => setSettings(s => ({ ...s, background_color: '' }))}
                                >
                                    Clear
                                </Button>
                            )}
                        </div>
                        <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                            Applied to the public form's background. Leave blank for the default.
                        </Form.Text>
                    </Form.Group>

                    <Form.Group className="mb-3">
                        <Form.Label>Linked event</Form.Label>
                        <Form.Select
                            className="form-select-dark"
                            value={settings.event_id}
                            onChange={e => setSettings(s => ({ ...s, event_id: e.target.value }))}
                        >
                            <option value="">— Standalone —</option>
                            {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                        </Form.Select>
                    </Form.Group>
                    <Form.Group className="mb-3">
                        <Form.Label>Submit button text</Form.Label>
                        <Form.Control
                            className="form-control-dark"
                            value={settings.submit_label}
                            onChange={e => setSettings(s => ({ ...s, submit_label: e.target.value }))}
                            placeholder="Submit"
                            maxLength={100}
                        />
                        <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                            Shown as the primary button at the bottom of the form. Defaults to "Submit".
                        </Form.Text>
                    </Form.Group>

                    <Form.Group className="mb-3">
                        <Form.Label>Send new responses to <span className="text-muted">(email)</span></Form.Label>
                        <Form.Control
                            as="textarea" rows={2}
                            className="form-control-dark"
                            value={settings.notify_email}
                            onChange={e => setSettings(s => ({ ...s, notify_email: e.target.value }))}
                            placeholder="queries@example.com, manager@example.com"
                        />
                        <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                            Every time someone submits this form, a notification email with their answers is sent to these addresses. Separate multiple recipients with a comma. Leave blank to disable.
                        </Form.Text>
                    </Form.Group>

                    <div className="d-flex gap-3">
                        <Form.Group className="mb-3 flex-fill">
                            <Form.Label>Max responses <span className="text-muted">(optional)</span></Form.Label>
                            <Form.Control
                                type="number" min={1}
                                className="form-control-dark"
                                value={settings.max_submissions}
                                onChange={e => setSettings(s => ({ ...s, max_submissions: e.target.value }))}
                                placeholder="No cap"
                            />
                            <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                                Form closes automatically once this many responses arrive.
                            </Form.Text>
                        </Form.Group>
                        <Form.Group className="mb-3 flex-fill">
                            <Form.Label>Close at <span className="text-muted">(optional)</span></Form.Label>
                            <Form.Control
                                type="datetime-local"
                                className="form-control-dark"
                                value={settings.close_at}
                                onChange={e => setSettings(s => ({ ...s, close_at: e.target.value }))}
                            />
                            <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                                Stops accepting responses after this date/time.
                            </Form.Text>
                        </Form.Group>
                    </div>
                    <Form.Group className="mb-3">
                        <Form.Label>Thank-you message <span className="text-muted">(shown after submit)</span></Form.Label>
                        <Form.Control
                            as="textarea" rows={2}
                            className="form-control-dark"
                            value={settings.thank_you_message}
                            onChange={e => setSettings(s => ({ ...s, thank_you_message: e.target.value }))}
                            placeholder="Thanks! We'll be in touch."
                        />
                    </Form.Group>
                    <Form.Group className="mb-3">
                        <Form.Label>Redirect URL <span className="text-muted">(optional)</span></Form.Label>
                        <Form.Control
                            type="url"
                            className="form-control-dark"
                            value={settings.redirect_url}
                            onChange={e => setSettings(s => ({ ...s, redirect_url: e.target.value }))}
                            placeholder="https://example.com/thank-you"
                        />
                        <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                            If set, the visitor is sent here a moment after submitting. Must start with http:// or https://.
                            Leave blank to just show the thank-you message.
                        </Form.Text>
                    </Form.Group>
                    <Form.Check
                        type="switch"
                        id="form-active-switch"
                        label={settings.is_active ? 'Accepting responses' : 'Closed — not accepting responses'}
                        checked={settings.is_active}
                        onChange={e => setSettings(s => ({ ...s, is_active: e.target.checked }))}
                    />

                    <Form.Check
                        type="switch"
                        id="form-captcha-switch"
                        className="mt-2"
                        label={settings.captcha_enabled ? 'Math captcha — visitors must solve a small sum to submit' : 'No captcha (faster, less spam-resistant)'}
                        checked={!!settings.captcha_enabled}
                        onChange={e => setSettings(s => ({ ...s, captcha_enabled: e.target.checked }))}
                    />

                    <hr style={{ borderColor: 'rgba(255,255,255,0.08)', margin: '20px 0' }} />

                    <div className="mb-2" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>💳 Accept payment</div>
                    <p className="text-muted" style={{ fontSize: '0.8rem', marginTop: 0 }}>
                        Requires Razorpay keys to be configured under <a href="/payment-settings" style={{ color: 'var(--accent)' }}>Payment Settings</a>.
                    </p>
                    <Form.Check
                        type="switch"
                        id="form-payment-switch"
                        className="mb-3"
                        label={settings.payment_enabled ? 'Charging visitors on submit' : 'Free — no payment required'}
                        checked={settings.payment_enabled}
                        onChange={e => setSettings(s => ({ ...s, payment_enabled: e.target.checked }))}
                    />

                    {settings.payment_enabled && (
                        <>
                            <div className="d-flex gap-2 mb-3 flex-wrap">
                                <Button
                                    variant={settings.payment_mode === 'fixed' ? 'primary' : 'outline-light'}
                                    size="sm"
                                    onClick={() => setSettings(s => ({ ...s, payment_mode: 'fixed' }))}
                                    className={settings.payment_mode === 'fixed' ? 'btn-accent' : ''}
                                    style={{ flex: 1, minWidth: 130 }}
                                >Fixed price</Button>
                                <Button
                                    variant={settings.payment_mode === 'tiered' ? 'primary' : 'outline-light'}
                                    size="sm"
                                    onClick={() => setSettings(s => ({ ...s, payment_mode: 'tiered' }))}
                                    className={settings.payment_mode === 'tiered' ? 'btn-accent' : ''}
                                    style={{ flex: 1, minWidth: 130 }}
                                >Tiered (Early Bird / VIP…)</Button>
                                {form?.fields?.some(ff => ff.field_type === 'award_category') && (
                                    <Button
                                        variant={settings.payment_mode === 'award_category' ? 'primary' : 'outline-light'}
                                        size="sm"
                                        onClick={() => setSettings(s => ({ ...s, payment_mode: 'award_category' }))}
                                        className={settings.payment_mode === 'award_category' ? 'btn-accent' : ''}
                                        style={{ flex: 1, minWidth: 180 }}
                                    >Per award category</Button>
                                )}
                            </div>

                            {settings.payment_mode === 'award_category' && (
                                <Alert variant="info" className="py-2 mb-3" style={{ fontSize: '0.8rem', borderRadius: 10, background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)', color: '#93c5fd' }}>
                                    The nomination fee is read from the category the visitor picks on the Award
                                    category field. Set fees on the <a href="/award-categories" style={{ color: 'var(--accent)' }}>Award Categories</a> page —
                                    the deepest selected level's amount wins.
                                </Alert>
                            )}

                            <div className="d-flex gap-3">
                                {settings.payment_mode === 'fixed' && (
                                    <Form.Group className="mb-3 flex-fill">
                                        <Form.Label>Amount</Form.Label>
                                        <Form.Control
                                            type="number" min={1} step="0.01"
                                            className="form-control-dark"
                                            value={settings.payment_amount}
                                            onChange={e => setSettings(s => ({ ...s, payment_amount: e.target.value }))}
                                            placeholder="500"
                                        />
                                    </Form.Group>
                                )}
                                <Form.Group className="mb-3" style={{ width: 120 }}>
                                    <Form.Label>Currency</Form.Label>
                                    <Form.Select
                                        className="form-select-dark"
                                        value={settings.payment_currency}
                                        onChange={e => setSettings(s => ({ ...s, payment_currency: e.target.value }))}
                                    >
                                        <option value="INR">INR ₹</option>
                                        <option value="USD">USD $</option>
                                        <option value="EUR">EUR €</option>
                                        <option value="GBP">GBP £</option>
                                    </Form.Select>
                                </Form.Group>
                            </div>

                            {settings.payment_mode === 'tiered' && (
                                <Form.Group className="mb-3">
                                    <Form.Label>Pricing tiers</Form.Label>
                                    <div className="d-flex gap-2 mb-1" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        <div style={{ flex: 2 }}>Label</div>
                                        <div style={{ flex: 1 }}>Amount</div>
                                        <div style={{ flex: 1.5 }}>Valid until</div>
                                        <div style={{ width: 38 }} />
                                    </div>
                                    {settings.payment_tiers.map((t, i) => (
                                        <div key={i} className="d-flex gap-2 mb-2">
                                            <Form.Control
                                                className="form-control-dark"
                                                value={t.label}
                                                onChange={e => setSettings(s => {
                                                    const next = [...s.payment_tiers];
                                                    next[i] = { ...next[i], label: e.target.value };
                                                    return { ...s, payment_tiers: next };
                                                })}
                                                placeholder="Early Bird"
                                                style={{ flex: 2 }}
                                            />
                                            <Form.Control
                                                type="number" min={1} step="0.01"
                                                className="form-control-dark"
                                                value={t.amount}
                                                onChange={e => setSettings(s => {
                                                    const next = [...s.payment_tiers];
                                                    next[i] = { ...next[i], amount: e.target.value };
                                                    return { ...s, payment_tiers: next };
                                                })}
                                                placeholder="500"
                                                style={{ flex: 1 }}
                                            />
                                            <Form.Control
                                                type="datetime-local"
                                                className="form-control-dark"
                                                value={t.valid_until || ''}
                                                onChange={e => setSettings(s => {
                                                    const next = [...s.payment_tiers];
                                                    next[i] = { ...next[i], valid_until: e.target.value };
                                                    return { ...s, payment_tiers: next };
                                                })}
                                                style={{ flex: 1.5 }}
                                            />
                                            <Button
                                                variant="outline-light" size="sm"
                                                onClick={() => setSettings(s => ({
                                                    ...s,
                                                    payment_tiers: s.payment_tiers.filter((_, idx) => idx !== i),
                                                }))}
                                                disabled={settings.payment_tiers.length <= 1}
                                                title="Remove tier"
                                            ><BsTrash /></Button>
                                        </div>
                                    ))}
                                    <Button
                                        variant="outline-light" size="sm"
                                        onClick={() => setSettings(s => ({
                                            ...s,
                                            payment_tiers: [...s.payment_tiers, { label: '', amount: '', valid_until: '' }],
                                        }))}
                                    ><BsPlus /> Add tier</Button>
                                    <Form.Text className="text-muted d-block mt-2" style={{ fontSize: '0.75rem' }}>
                                        Each tier is active until its <strong>Valid until</strong> date passes; after that the next tier takes over automatically.
                                        Leave the date blank on the last tier so it stays active indefinitely. Amounts in {settings.payment_currency}.
                                    </Form.Text>
                                </Form.Group>
                            )}

                            <Form.Group className="mb-3">
                                <Form.Label>Payment description <span className="text-muted">(optional)</span></Form.Label>
                                <Form.Control
                                    as="textarea" rows={2}
                                    className="form-control-dark"
                                    value={settings.payment_description}
                                    onChange={e => setSettings(s => ({ ...s, payment_description: e.target.value }))}
                                    placeholder="Shown next to the Pay button. e.g. 'Covers lunch, sessions and certificate.'"
                                />
                            </Form.Group>
                        </>
                    )}
                </Modal.Body>
                <Modal.Footer style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <Button variant="link" onClick={() => setShowSettings(false)} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Cancel</Button>
                    <Button className="btn-accent" onClick={saveSettings} disabled={savingSettings}>
                        {savingSettings ? 'Saving…' : 'Save settings'}
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* Embed snippet modal — lets admins paste the form into any external site. */}
            <Modal show={showEmbed} onHide={() => setShowEmbed(false)} centered contentClassName="premium-modal">
                <Modal.Header closeButton closeVariant="white">
                    <Modal.Title>Embed this form</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        Paste this snippet into any webpage's HTML to embed the form inline.
                        Visitors submit without leaving the host page.
                    </p>
                    {(() => {
                        const url = `${window.location.origin}/f/${id}`;
                        const snippet = `<iframe src="${url}" width="100%" height="720" style="border:0;border-radius:12px" loading="lazy" title="${form.title?.replace(/"/g, '&quot;') || 'Form'}"></iframe>`;
                        const copy = async () => {
                            try { await navigator.clipboard.writeText(snippet); setEmbedCopied(true); setTimeout(() => setEmbedCopied(false), 1800); }
                            catch { /* ignore */ }
                        };
                        return (
                            <>
                                <textarea
                                    readOnly value={snippet} rows={4}
                                    className="form-control-dark"
                                    style={{ fontFamily: 'monospace', fontSize: '0.8rem', width: '100%', resize: 'vertical' }}
                                    onClick={e => e.currentTarget.select()}
                                />
                                <div className="d-flex justify-content-between align-items-center mt-3">
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                        Or share the direct URL: <code>{url}</code>
                                    </span>
                                    <Button className="btn-accent d-flex align-items-center gap-2" onClick={copy}>
                                        {embedCopied ? <><BsCheck2 /> Copied</> : <><BsLink45Deg /> Copy snippet</>}
                                    </Button>
                                </div>
                            </>
                        );
                    })()}
                </Modal.Body>
            </Modal>

            {/* Export modal — download the form as a standalone HTML page,
                or as a ZIP with HTML/CSS/JS split out. Admin can edit the
                backend URL to point the exported page at any environment. */}
            <Modal show={showExport} onHide={() => setShowExport(false)} centered contentClassName="premium-modal">
                <Modal.Header closeButton closeVariant="white">
                    <Modal.Title>Export form</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        Download this form as a ready-to-host page. Submissions are sent back to this backend,
                        so responses still show up in this dashboard.
                    </p>
                    <Form.Group className="mb-3">
                        <Form.Label>Backend URL</Form.Label>
                        <Form.Control
                            className="form-control-dark"
                            value={exportApiBase}
                            onChange={e => setExportApiBase(e.target.value)}
                            placeholder="https://api.example.com"
                        />
                        <Form.Text className="text-muted" style={{ fontSize: '0.75rem' }}>
                            The exported page will POST submissions and file uploads to this URL. You can
                            also edit it later inside the exported <code>script.js</code>.
                        </Form.Text>
                    </Form.Group>
                    <div className="d-flex gap-2 flex-wrap">
                        <Button
                            className="btn-accent d-flex align-items-center gap-2 flex-fill"
                            disabled={exporting}
                            onClick={async () => {
                                try { setExporting(true); exportFormHtml(form, exportApiBase); setShowExport(false); }
                                finally { setExporting(false); }
                            }}
                        >
                            <BsFiletypeHtml /> Download .html
                        </Button>
                        <Button
                            variant="outline-light"
                            className="d-flex align-items-center gap-2 flex-fill"
                            disabled={exporting}
                            onClick={async () => {
                                try { setExporting(true); await exportFormZip(form, exportApiBase); setShowExport(false); }
                                finally { setExporting(false); }
                            }}
                        >
                            <BsFileEarmarkZip /> Download .zip (HTML + CSS + JS)
                        </Button>
                    </div>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 14, marginBottom: 0 }}>
                        <strong>Single HTML</strong> is self-contained — drop into any CMS or static host.
                        <strong> ZIP</strong> gives you separate files if you want to tweak styles or extend the script.
                    </p>
                </Modal.Body>
            </Modal>
        </div>
    );
}

// ── Live preview of a field (rendered inside each canvas row) ──
// Inputs are wrapped in a container with `pointer-events: none` so clicks
// still reach the row's onClick for selection. We still pass `readOnly` /
// `disabled` defensively so keyboard tabs into them don't let users type.
function renderFieldPreview(f, awardCats) {
    const placeholder = f.placeholder || '';
    switch (f.field_type) {
        case 'textarea':
        case 'address':
            return <textarea className="fb-preview-input" rows={2} placeholder={placeholder} readOnly tabIndex={-1} />;
        case 'email':
            return <input type="email" className="fb-preview-input" placeholder={placeholder || 'email@example.com'} readOnly tabIndex={-1} />;
        case 'phone':
            return <input type="tel" className="fb-preview-input" placeholder={placeholder || '+91 ...'} readOnly tabIndex={-1} />;
        case 'number':
            return <input type="number" className="fb-preview-input" placeholder={placeholder} readOnly tabIndex={-1} />;
        case 'date':
            return <input type="date" className="fb-preview-input" disabled tabIndex={-1} />;
        case 'time':
            return <input type="time" className="fb-preview-input" disabled tabIndex={-1} />;
        case 'dropdown':
            return (
                <select className="fb-preview-input" disabled tabIndex={-1}>
                    <option>{placeholder || '— Select —'}</option>
                    {(f.options || []).map((o, i) => <option key={i}>{o}</option>)}
                </select>
            );
        case 'radio':
            return (
                <div className="fb-preview-choices">
                    {(f.options || []).length === 0
                        ? <span className="fb-preview-empty-options">Add options in the properties panel →</span>
                        : (f.options || []).map((o, i) => (
                            <label key={i} className="fb-preview-choice">
                                <input type="radio" name={`prev-${f.id}`} disabled tabIndex={-1} /> {o}
                            </label>
                        ))}
                </div>
            );
        case 'checkbox':
            return (
                <div className="fb-preview-choices">
                    {(f.options || []).length === 0
                        ? <span className="fb-preview-empty-options">Add options in the properties panel →</span>
                        : (f.options || []).map((o, i) => (
                            <label key={i} className="fb-preview-choice">
                                <input type="checkbox" disabled tabIndex={-1} /> {o}
                            </label>
                        ))}
                </div>
            );
        case 'consent':
            return (
                <label className="fb-preview-choice">
                    <input type="checkbox" disabled tabIndex={-1} /> {f.placeholder || 'I agree'}
                </label>
            );
        case 'file':
            return (
                <div className="fb-preview-file">
                    <BsPaperclip /> <span style={{ marginLeft: 8 }}>Click to choose a file</span>
                </div>
            );
        case 'award_category':
            // Rendered as a separate component so it can hold local state for
            // the cascading-preview behaviour. Also uses `pointer-events: auto`
            // + click-stopPropagation so admins can actually open the dropdowns
            // inside the builder canvas without accidentally triggering the
            // row-select / drag-start handlers on the parent .fb-row.
            return <AwardCategoryPreview f={f} awardCats={awardCats} />;
        case 'name':
        case 'text':
        default:
            return <input type="text" className="fb-preview-input" placeholder={placeholder} readOnly tabIndex={-1} />;
    }
}

// Award category preview: real cascading selects the admin can exercise inside
// the builder. Local state only — doesn't persist anywhere. The parent .fb-row
// has pointer-events: none applied via .fb-row-preview, so we re-enable it on
// this wrapper and stop click propagation so opening the dropdown doesn't also
// drag or re-select the row.
function AwardCategoryPreview({ f, awardCats }) {
    const [sel, setSel] = useState({ sector: '', cat: '', sub: '' });
    const all = awardCats || [];
    const sectors = all.filter(c => c.parent_id == null);
    const cats = sel.sector ? all.filter(c => String(c.parent_id) === sel.sector) : [];
    const subs = sel.cat ? all.filter(c => String(c.parent_id) === sel.cat) : [];

    // Walk up from the deepest selection to show the fee that would apply.
    const leafId = sel.sub || sel.cat || sel.sector;
    let previewAmount = null;
    if (leafId) {
        const byId = new Map(all.map(c => [Number(c.id), c]));
        let cursor = Number(leafId);
        for (let i = 0; i < 4 && cursor; i++) {
            const row = byId.get(cursor);
            if (!row) break;
            if (row.amount != null) { previewAmount = Number(row.amount); break; }
            cursor = row.parent_id ? Number(row.parent_id) : null;
        }
    }
    const stop = (e) => e.stopPropagation();

    // Category stays disabled until a sector is chosen. Subcategory is hidden
    // entirely when the picked category has no children — otherwise the admin
    // sees a confusing "— No subcategories —" placeholder.
    const catPlaceholder = !sel.sector
        ? '— Pick a sector first —'
        : cats.length === 0
            ? '— No categories in this sector —'
            : '— Category —';
    const showSub = sel.cat && subs.length > 0;
    const cols = showSub ? '1fr 1fr 1fr' : '1fr 1fr';

    return (
        <div onClick={stop} onMouseDown={stop} style={{ pointerEvents: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 8 }}>
                <select
                    className="fb-preview-input"
                    value={sel.sector}
                    onChange={e => setSel({ sector: e.target.value, cat: '', sub: '' })}
                    onClick={stop}
                >
                    <option value="">
                        {sectors.length === 0 ? '— No sectors configured —' : '— Sector —'}
                    </option>
                    {sectors.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                </select>
                <select
                    className="fb-preview-input"
                    value={sel.cat}
                    onChange={e => setSel(s => ({ ...s, cat: e.target.value, sub: '' }))}
                    onClick={stop}
                    disabled={!sel.sector || cats.length === 0}
                >
                    <option value="">{catPlaceholder}</option>
                    {cats.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                </select>
                {showSub && (
                    <select
                        className="fb-preview-input"
                        value={sel.sub}
                        onChange={e => setSel(s => ({ ...s, sub: e.target.value }))}
                        onClick={stop}
                    >
                        <option value="">— Subcategory —</option>
                        {subs.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
                    </select>
                )}
            </div>
            {previewAmount != null && (
                <div style={{ marginTop: 6, fontSize: '0.75rem', color: 'var(--accent)' }}>
                    Nomination fee: ₹{previewAmount.toFixed(2)}
                </div>
            )}
        </div>
    );
}

// ── Submit-button properties (right pane, when Submit Button row is selected) ──
function SubmitProperties({ label, onChange }) {
    return (
        <>
            <div className="fb-prop-group">
                <label>Button text</label>
                <input
                    type="text"
                    value={label}
                    onChange={e => onChange(e.target.value)}
                    placeholder="Submit"
                    maxLength={100}
                />
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>
                    Shown as the primary button at the bottom of the public form. Leave blank to use the default "Submit".
                </div>
            </div>
            <div className="fb-prop-group">
                <div className="fb-required-toggle" style={{ opacity: 0.7 }}>
                    <div>
                        <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.88rem' }}>Always present</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Every form has exactly one submit button.</div>
                    </div>
                </div>
            </div>
        </>
    );
}

// ── Properties panel (right pane) ───────────────────────────────
function PropertiesPanel({ field, onChange, allFields = [] }) {
    const typeInfo = TYPE_BY_VALUE[field.field_type];
    const setOption = (idx, val) => {
        const next = [...(field.options || [])];
        next[idx] = val;
        onChange({ options: next });
    };
    const addOption = () => onChange({ options: [...(field.options || []), `Option ${(field.options?.length || 0) + 1}`] });
    const removeOption = (idx) => onChange({ options: (field.options || []).filter((_, i) => i !== idx) });

    // ── Conditional logic ──
    // Show this field only when a chosen earlier field matches a value (or is
    // filled / empty). We only allow the controller to be a field that comes
    // BEFORE this one in the canvas, otherwise the rule can't ever evaluate
    // when the user reaches this field.
    const selfIdx = allFields.findIndex(x => x.id === field.id);
    const eligibleControllers = (selfIdx > 0 ? allFields.slice(0, selfIdx) : []).filter(f => {
        // Only field types whose value is meaningful for matching.
        return ['dropdown', 'radio', 'checkbox', 'consent', 'text', 'email', 'phone', 'number', 'textarea', 'name', 'address'].includes(f.field_type);
    });
    const cond = field.condition || null;
    const hasCondition = !!(cond && cond.field_id);
    const controllerField = hasCondition ? allFields.find(f => f.id === cond.field_id) : null;
    const controllerHasOptions = controllerField && Array.isArray(controllerField.options) && controllerField.options.length > 0;
    const controllerIsConsent = controllerField?.field_type === 'consent';
    const opChoices = [
        { value: 'equals',     label: 'is equal to' },
        { value: 'not_equals', label: 'is not equal to' },
        { value: 'is_filled',  label: 'is filled' },
        { value: 'is_empty',   label: 'is empty' },
    ];
    const enableCondition = () => {
        const first = eligibleControllers[0];
        if (!first) return;
        const initialOp = (first.options && first.options.length > 0) ? 'equals' : 'is_filled';
        onChange({ condition: { field_id: first.id, op: initialOp, value: '' } });
    };
    const updateCondition = (patch) => {
        const next = { ...(cond || {}), ...patch };
        // Reset value when op no longer needs one.
        if (next.op === 'is_filled' || next.op === 'is_empty') next.value = '';
        onChange({ condition: next });
    };
    const clearCondition = () => onChange({ condition: null });

    return (
        <>
            <div className="fb-prop-group">
                <label>Field type</label>
                <select value={field.field_type} onChange={e => onChange({ field_type: e.target.value })}>
                    {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
            </div>

            <div className="fb-prop-group">
                <label>Label</label>
                <input
                    type="text"
                    value={field.label || ''}
                    onChange={e => onChange({ label: e.target.value })}
                    placeholder="Question text"
                />
            </div>

            {typeInfo?.needsPlaceholder && (
                <div className="fb-prop-group">
                    <label>Placeholder</label>
                    <input
                        type="text"
                        value={field.placeholder || ''}
                        onChange={e => onChange({ placeholder: e.target.value })}
                        placeholder="Hint shown inside the empty input"
                    />
                </div>
            )}

            <div className="fb-prop-group">
                <label>Help text <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
                <textarea
                    rows={2}
                    value={field.help_text || ''}
                    onChange={e => onChange({ help_text: e.target.value })}
                    placeholder="Shown under the label, e.g. 'Your ticket will be emailed here.'"
                />
            </div>

            {typeInfo?.needsOptions && (
                <div className="fb-prop-group">
                    <label>Options</label>
                    {(field.options || []).map((opt, i) => (
                        <div key={i} className="fb-option-row">
                            <input type="text" value={opt} onChange={e => setOption(i, e.target.value)} placeholder={`Option ${i + 1}`} />
                            <button type="button" className="fb-option-remove" onClick={() => removeOption(i)} title="Remove option">
                                <BsTrash size={13} />
                            </button>
                        </div>
                    ))}
                    <button type="button" className="fb-option-add" onClick={addOption}>
                        <BsPlus /> Add option
                    </button>
                </div>
            )}

            <div className="fb-prop-group">
                <label>Field width</label>
                <div className="fb-width-toggle">
                    <button
                        type="button"
                        className={`fb-width-btn ${(field.width || 'full') === 'full' ? 'active' : ''}`}
                        onClick={() => onChange({ width: 'full' })}
                    >
                        <span className="fb-width-viz fb-width-viz-full"><span /></span>
                        Full width
                    </button>
                    <button
                        type="button"
                        className={`fb-width-btn ${field.width === 'half' ? 'active' : ''}`}
                        onClick={() => onChange({ width: 'half' })}
                    >
                        <span className="fb-width-viz fb-width-viz-half"><span /></span>
                        Half width
                    </button>
                </div>
            </div>

            <div className="fb-prop-group">
                <div className="fb-required-toggle">
                    <div>
                        <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.88rem' }}>Required</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Respondents must fill this in</div>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={!!field.required}
                        className={`fb-switch ${field.required ? 'on' : ''}`}
                        onClick={() => onChange({ required: !field.required })}
                    ><span /></button>
                </div>
            </div>

            {/* ── Conditional visibility ─────────────────────────── */}
            <div className="fb-prop-group">
                <div className="fb-required-toggle">
                    <div>
                        <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.88rem' }}>Conditional</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>Only show this field when another field matches</div>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={hasCondition}
                        disabled={!hasCondition && eligibleControllers.length === 0}
                        className={`fb-switch ${hasCondition ? 'on' : ''}`}
                        onClick={() => hasCondition ? clearCondition() : enableCondition()}
                    ><span /></button>
                </div>
                {!hasCondition && eligibleControllers.length === 0 && (
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>
                        Add at least one other field above this one to enable conditions.
                    </div>
                )}
                {hasCondition && (
                    <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                        <div>
                            <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>When this field</label>
                            <select
                                value={cond.field_id || ''}
                                onChange={e => updateCondition({ field_id: Number(e.target.value), value: '' })}
                            >
                                {eligibleControllers.map(f => (
                                    <option key={f.id} value={f.id}>{f.label || `Field ${f.id}`}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>Operator</label>
                            <select
                                value={cond.op || 'equals'}
                                onChange={e => updateCondition({ op: e.target.value })}
                            >
                                {opChoices.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                        </div>
                        {(cond.op === 'equals' || cond.op === 'not_equals') && (
                            <div>
                                <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'none', letterSpacing: 0 }}>Value</label>
                                {controllerIsConsent ? (
                                    <select
                                        value={String(cond.value ?? 'true')}
                                        onChange={e => updateCondition({ value: e.target.value })}
                                    >
                                        <option value="true">checked</option>
                                        <option value="false">unchecked</option>
                                    </select>
                                ) : controllerHasOptions ? (
                                    <select
                                        value={cond.value || ''}
                                        onChange={e => updateCondition({ value: e.target.value })}
                                    >
                                        <option value="">— Choose —</option>
                                        {controllerField.options.map(o => <option key={o} value={o}>{o}</option>)}
                                    </select>
                                ) : (
                                    <input
                                        type="text"
                                        value={cond.value || ''}
                                        onChange={e => updateCondition({ value: e.target.value })}
                                        placeholder="Match this value exactly"
                                    />
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    );
}
