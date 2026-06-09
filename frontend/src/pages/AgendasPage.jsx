import { useState, useEffect } from 'react';
import { Button, Modal, Form, Alert, Spinner } from 'react-bootstrap';
import { useAuth } from '../context/AuthContext';
import { getAgendas, createAgenda, updateAgenda, deleteAgenda, getEvents, getSpeakers, getPartners, reorderAgendas, updateAgendaExportSettings, uploadAgendaExportImage } from '../services/api';
import { BsPlus, BsPencil, BsTrash, BsClock, BsListTask, BsGeoAlt, BsMic, BsDownload, BsFileEarmarkPdf, BsImage, BsGripVertical, BsShieldLock, BsCheckCircleFill, BsTypeBold, BsTypeItalic, BsListUl, BsArrowReturnLeft, BsCalendarEvent, BsCardText, BsPeople } from 'react-icons/bs';
import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { useRef } from 'react';
import { getImageUrl } from '../utils/imageUrl';
import AsyncButton from '../components/AsyncButton';

// "09:00" / "09:00:00" → "9:00 AM". Returns empty string for falsy input
// so callers can safely inline it without guarding.
const fmtTime12 = (t) => {
    if (!t) return '';
    const [hStr, mStr] = String(t).split(':');
    const h = parseInt(hStr, 10);
    if (Number.isNaN(h)) return '';
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hour12 = ((h + 11) % 12) + 1;
    return `${hour12}:${mStr || '00'} ${suffix}`;
};

// Description storage is HTML (written by a contenteditable editor). For
// rendering we just sanitise and pipe to dangerouslySetInnerHTML. Legacy
// descriptions stored as plain text / markdown are upgraded on the fly.

const ALLOWED_TAGS = /^(strong|b|em|i|u|br|ul|ol|li|p|div|span)$/i;

const sanitizeDescriptionHtml = (html) => {
    if (!html) return '';
    let out = String(html);
    // Remove script / style blocks wholesale.
    out = out.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    // Strip disallowed tags but keep their inner text.
    out = out.replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (match, tag) =>
        ALLOWED_TAGS.test(tag) ? match.replace(/\son\w+="[^"]*"/gi, '')
                                       .replace(/\son\w+='[^']*'/gi, '')
                                       .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[^'"]*\2/gi, '')
                               : ''
    );
    return out;
};

// Upgrade a markdown-ish plain description ("**bold**", "- item", newlines)
// to the same HTML we produce from the editor, so anything saved before
// the editor existed still renders with formatting.
const markdownishToHtml = (text) => {
    const lines = String(text).split('\n');
    const out = [];
    let inList = false;
    const boldify = (s) => s
        .replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    lines.forEach((line, idx) => {
        if (line.startsWith('- ')) {
            if (!inList) { out.push('<ul>'); inList = true; }
            out.push(`<li>${boldify(line.slice(2))}</li>`);
        } else {
            if (inList) { out.push('</ul>'); inList = false; }
            out.push(boldify(line));
            if (idx < lines.length - 1) out.push('<br>');
        }
    });
    if (inList) out.push('</ul>');
    return out.join('');
};

const descriptionToHtml = (text) => {
    if (!text) return '';
    // If the value already contains any of our allowed tags treat it as HTML.
    if (/<(strong|b|em|i|u|br|ul|ol|li|p|div|span)\b[^>]*>/i.test(text)) {
        return sanitizeDescriptionHtml(text);
    }
    return sanitizeDescriptionHtml(markdownishToHtml(text));
};

const renderDescription = (text) => {
    const html = descriptionToHtml(text);
    if (!html) return null;
    return <span className="agenda-desc-rich" dangerouslySetInnerHTML={{ __html: html }} />;
};

export default function AgendasPage() {
    const { user } = useAuth();
    const [agendas, setAgendas] = useState([]);
    const [events, setEvents] = useState([]);
    const [speakers, setSpeakers] = useState([]);
    const [selectedEvent, setSelectedEvent] = useState('');
    const [selectedDay, setSelectedDay] = useState(1);
    const [maxDay, setMaxDay] = useState(1);
    const [partners, setPartners] = useState([]);
    const [showExportOptions, setShowExportOptions] = useState(false);
    const exportRef = useRef(null);
    const [show, setShow] = useState(false);
    const [editing, setEditing] = useState(null);
    const [error, setError] = useState('');
    const [form, setForm] = useState({ event_id: '', day_number: 1, title: '', description: '', speaker_ids: [], start_time: '', end_time: '' });
    const descriptionRef = useRef(null);

    // Whenever the edit modal opens, seed the contenteditable with the stored
    // description (converting plain / markdown to HTML for backwards compat).
    // We can't just bind innerHTML like a controlled input because React
    // doesn't know about contentEditable; we only sync on open + on input.
    useEffect(() => {
        if (!show || !descriptionRef.current) return;
        descriptionRef.current.innerHTML = descriptionToHtml(form.description || '');
    }, [show, editing?.id]);

    // Run a contentEditable formatting command and push the new HTML back
    // into form state. execCommand is deprecated but universally supported
    // and gives us bold / italic / list / linebreak in a few lines.
    const execFormat = (cmd, value = null) => {
        if (!descriptionRef.current) return;
        descriptionRef.current.focus();
        document.execCommand(cmd, false, value);
        syncDescriptionFromEditor();
    };

    const syncDescriptionFromEditor = () => {
        if (!descriptionRef.current) return;
        const html = sanitizeDescriptionHtml(descriptionRef.current.innerHTML);
        setForm(prev => ({ ...prev, description: html }));
    };

    // Paste handler — strip external formatting so pasting from Word / a
    // webpage doesn't drop inline colour, fonts, tables, etc. into the field.
    const handleDescriptionPaste = (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData('text/plain');
        document.execCommand('insertText', false, text);
    };
    const [exportBgColor, setExportBgColor] = useState('#ffffff');
    const [exportTextColor, setExportTextColor] = useState('#000000');
    const [exportAccentColor, setExportAccentColor] = useState('#000000');
    const [exportDayHeaderBg, setExportDayHeaderBg] = useState('linear-gradient(90deg, #8b5cf6, transparent)');
    const [exportDayHeaderText, setExportDayHeaderText] = useState('#ffffff');
    const [exportFontFamily, setExportFontFamily] = useState('Inter');
    const [exportBgImage, setExportBgImage] = useState(null);
    const [exportBgOverlay, setExportBgOverlay] = useState(0);
    const [exportBgOverlayColor, setExportBgOverlayColor] = useState('#000000');
    const [exportHeaderImage, setExportHeaderImage] = useState(null);
    const [exportHeaderImageHeight, setExportHeaderImageHeight] = useState(180);
    const [exportHeaderImageMode, setExportHeaderImageMode] = useState('above'); // 'above' | 'replace'
    const [exportFooterImage, setExportFooterImage] = useState(null);
    const [exportCompanyLogo, setExportCompanyLogo] = useState(null);
    const [exportEventLogo, setExportEventLogo] = useState(null);
    const [exportLogoSize, setExportLogoSize] = useState(60);
    const [exportShowPartners, setExportShowPartners] = useState(true);
    const [exportPartnersPosition, setExportPartnersPosition] = useState('bottom');
    const [exportPartnerSectionTitle, setExportPartnerSectionTitle] = useState('Our Partners');
    const [exportPartnerLogoSize, setExportPartnerLogoSize] = useState(50);
    const [exportPartnerCatColor, setExportPartnerCatColor] = useState('#000000');
    const [exportPartnerCatSize, setExportPartnerCatSize] = useState(16);
    const [exportPartnerCatWeight, setExportPartnerCatWeight] = useState('700');
    // Session description styling (exported PDF only — on-screen agenda
    // always shows the description). Color defaults to empty, meaning
    // "derive from the base text colour with a soft alpha".
    const [exportShowDescription, setExportShowDescription] = useState(true);
    const [exportDescriptionColor, setExportDescriptionColor] = useState('');
    const [exportDescriptionSize, setExportDescriptionSize] = useState(14);
    const [exportDescriptionWeight, setExportDescriptionWeight] = useState('400');
    const [exportDescriptionLineHeight, setExportDescriptionLineHeight] = useState(1.4);
    const [showCustomizer, setShowCustomizer] = useState(false);
    const [isLocked, setIsLocked] = useState(false);
    const [exportSettingsHydrated, setExportSettingsHydrated] = useState(false);
    const [savingDesign, setSavingDesign] = useState(false);
    const [designSavedAt, setDesignSavedAt] = useState(null);
    const [showSavedPreview, setShowSavedPreview] = useState(false);
    const [savedPreviewDataUrl, setSavedPreviewDataUrl] = useState(null);
    const [savedPreviewLoading, setSavedPreviewLoading] = useState(false);
    // `exporting` is null | 'image' | 'pdf' — guards the export handler against
    // double-clicks and drives the full-screen progress overlay + disabled buttons.
    const [exporting, setExporting] = useState(null);
    const [exportStage, setExportStage] = useState('');

    // Drag and Drop State
    const [draggedItem, setDraggedItem] = useState(null);
    const [dragOverItem, setDragOverItem] = useState(null);
    const [isReordering, setIsReordering] = useState(false);

    const canManage = ['admin', 'manager'].includes(user?.role) || (user?.role === 'employee' && !!user?.assigned_event_id);

    useEffect(() => {
        getEvents().then(r => {
            const evts = Array.isArray(r.data) ? r.data : [];
            setEvents(evts);
            if (user?.role === 'employee' && user.assigned_event_id) {
                setSelectedEvent(user.assigned_event_id);
            } else if (evts.length > 0) {
                setSelectedEvent(evts[0].id);
            }
        }).catch(() => { });
        getSpeakers().then(r => setSpeakers(Array.isArray(r.data) ? r.data : [])).catch(() => { });
        getPartners().then(r => setPartners(Array.isArray(r.data) ? r.data : [])).catch(() => { });
    }, []);

    useEffect(() => {
        if (selectedEvent) {
            getAgendas(selectedEvent).then(r => {
                const items = Array.isArray(r.data) ? r.data : [];
                setAgendas(items);
                const days = items.reduce((max, a) => Math.max(max, a.day_number), 0);
                setMaxDay(Math.max(days, 1));
            }).catch(() => { });

            // Hydrate saved export customizations from the event row (agenda_export_settings JSON column)
            setExportSettingsHydrated(false);
            setDesignSavedAt(null);
            const evt = events.find(e => e.id == selectedEvent);
            try {
                const raw = evt?.agenda_export_settings;
                if (raw) {
                    const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    // If savedAt is missing (legacy), fall back to the mere presence of settings so the
                    // "View Saved Design" control still appears.
                    setDesignSavedAt(s.savedAt || 1);
                    if (s.exportBgColor !== undefined) setExportBgColor(s.exportBgColor);
                    if (s.exportTextColor !== undefined) setExportTextColor(s.exportTextColor);
                    if (s.exportAccentColor !== undefined) setExportAccentColor(s.exportAccentColor);
                    if (s.exportDayHeaderBg !== undefined) setExportDayHeaderBg(s.exportDayHeaderBg);
                    if (s.exportDayHeaderText !== undefined) setExportDayHeaderText(s.exportDayHeaderText);
                    if (s.exportFontFamily !== undefined) setExportFontFamily(s.exportFontFamily);
                    if (s.exportBgImage !== undefined) setExportBgImage(s.exportBgImage);
                    if (s.exportBgOverlay !== undefined) setExportBgOverlay(s.exportBgOverlay);
                    if (s.exportBgOverlayColor !== undefined) setExportBgOverlayColor(s.exportBgOverlayColor);
                    if (s.exportHeaderImage !== undefined) setExportHeaderImage(s.exportHeaderImage);
                    if (s.exportHeaderImageHeight !== undefined) setExportHeaderImageHeight(s.exportHeaderImageHeight);
                    if (s.exportHeaderImageMode !== undefined) setExportHeaderImageMode(s.exportHeaderImageMode);
                    if (s.exportFooterImage !== undefined) setExportFooterImage(s.exportFooterImage);
                    if (s.exportCompanyLogo !== undefined) setExportCompanyLogo(s.exportCompanyLogo);
                    if (s.exportEventLogo !== undefined) setExportEventLogo(s.exportEventLogo);
                    if (s.exportLogoSize !== undefined) setExportLogoSize(s.exportLogoSize);
                    if (s.exportShowPartners !== undefined) setExportShowPartners(s.exportShowPartners);
                    if (s.exportPartnersPosition !== undefined) setExportPartnersPosition(s.exportPartnersPosition);
                    if (s.exportPartnerSectionTitle !== undefined) setExportPartnerSectionTitle(s.exportPartnerSectionTitle);
                    if (s.exportPartnerLogoSize !== undefined) setExportPartnerLogoSize(s.exportPartnerLogoSize);
                    if (s.exportPartnerCatColor !== undefined) setExportPartnerCatColor(s.exportPartnerCatColor);
                    if (s.exportPartnerCatSize !== undefined) setExportPartnerCatSize(s.exportPartnerCatSize);
                    if (s.exportPartnerCatWeight !== undefined) setExportPartnerCatWeight(s.exportPartnerCatWeight);
                    if (s.exportShowDescription !== undefined) setExportShowDescription(s.exportShowDescription);
                    if (s.exportDescriptionColor !== undefined) setExportDescriptionColor(s.exportDescriptionColor);
                    if (s.exportDescriptionSize !== undefined) setExportDescriptionSize(s.exportDescriptionSize);
                    if (s.exportDescriptionWeight !== undefined) setExportDescriptionWeight(s.exportDescriptionWeight);
                    if (s.exportDescriptionLineHeight !== undefined) setExportDescriptionLineHeight(s.exportDescriptionLineHeight);
                }
            } catch (e) { console.warn('Failed to parse saved export settings', e); }

            // Branding-lock behavior:
            // - Admin and Manager can always edit branding (lock is advisory for them — they "own" the brand).
            // - Only Employees are actually restricted by the lock flag.
            if (evt) {
                const brandingLockedForUser = !!evt.is_branding_locked && user?.role === 'employee';
                setIsLocked(brandingLockedForUser);
                // Only force-apply the event's branding values when the lock actually restricts this user
                // AND there are no saved customizations (so we don't overwrite what the user explicitly chose).
                if (brandingLockedForUser && !evt.agenda_export_settings) {
                    if (evt.primary_color) setExportAccentColor(evt.primary_color);
                    if (evt.secondary_color) setExportDayHeaderBg(evt.secondary_color);
                    if (evt.font_family) setExportFontFamily(evt.font_family);
                    if (evt.event_logo_url) setExportEventLogo(evt.event_logo_url);
                    if (evt.company_logo_url) setExportCompanyLogo(evt.company_logo_url);
                    setExportPartnerCatColor(evt.primary_color || '#000000');
                }
            }

            // Flag hydration complete after state setters flush, so the save-on-change effect
            // doesn't fire during the load itself.
            const t = setTimeout(() => setExportSettingsHydrated(true), 0);
            return () => clearTimeout(t);
        }
    }, [selectedEvent, events, user?.role]);

    // Auto-save export customizations to the backend (debounced) whenever any of them change
    useEffect(() => {
        if (!exportSettingsHydrated || !selectedEvent) return;
        const now = Date.now();
        const settings = {
            savedAt: now,
            exportBgColor, exportTextColor, exportAccentColor, exportDayHeaderBg, exportDayHeaderText,
            exportFontFamily, exportBgImage, exportBgOverlay, exportBgOverlayColor,
            exportHeaderImage, exportHeaderImageHeight, exportHeaderImageMode, exportFooterImage,
            exportCompanyLogo, exportEventLogo, exportLogoSize,
            exportShowPartners, exportPartnersPosition, exportPartnerSectionTitle,
            exportPartnerLogoSize, exportPartnerCatColor, exportPartnerCatSize, exportPartnerCatWeight,
            exportShowDescription, exportDescriptionColor, exportDescriptionSize, exportDescriptionWeight, exportDescriptionLineHeight,
        };
        const t = setTimeout(() => {
            updateAgendaExportSettings(selectedEvent, settings)
                .then(() => setDesignSavedAt(now))
                .catch(err => {
                    console.warn('Failed to save export settings', err?.response?.data || err?.message);
                });
        }, 600);
        return () => clearTimeout(t);
    }, [
        exportSettingsHydrated, selectedEvent,
        exportBgColor, exportTextColor, exportAccentColor, exportDayHeaderBg, exportDayHeaderText,
        exportFontFamily, exportBgImage, exportBgOverlay, exportBgOverlayColor,
        exportHeaderImage, exportHeaderImageHeight, exportHeaderImageMode, exportFooterImage,
        exportCompanyLogo, exportEventLogo, exportLogoSize,
        exportShowPartners, exportPartnersPosition, exportPartnerSectionTitle,
        exportPartnerLogoSize, exportPartnerCatColor, exportPartnerCatSize, exportPartnerCatWeight,
        exportShowDescription, exportDescriptionColor, exportDescriptionSize, exportDescriptionWeight, exportDescriptionLineHeight,
    ]);

    const filtered = agendas.filter(a => a.day_number === selectedDay);

    const openModal = (item = null) => {
        if (item) {
            setEditing(item);
            // Handle both array and potential null from JSON_ARRAYAGG (null when no speakers)
            const sids = Array.isArray(item.speakers) ? item.speakers.filter(s => s.id !== null).map(s => s.id) : [];
            setForm({ event_id: item.event_id, day_number: item.day_number, title: item.title, description: item.description || '', speaker_ids: sids, start_time: item.start_time, end_time: item.end_time });
        } else {
            setEditing(null);
            setForm({ 
                event_id: user?.role === 'employee' ? user.assigned_event_id : selectedEvent, 
                day_number: selectedDay, title: '', description: '', speaker_ids: [], start_time: '', end_time: '' 
            });
        }
        setError('');
        setShow(true);
    };

    const handleSave = async () => {
        try {
            setError('');
            const title = (form.title || '').trim();
            if (!title) { setError('Session title is required'); return; }
            if (!form.event_id) { setError('Please select an event'); return; }
            if (!form.start_time || !form.end_time) { setError('Start and end times are required'); return; }
            if (form.end_time <= form.start_time) { setError('End time must be after start time'); return; }

            // Read the description straight from the contentEditable. React
            // state can lag a keystroke behind (no browser 'input' fires for
            // composition end, IME, or when Save is clicked before onBlur
            // flushes). Using the live DOM value avoids truncated saves.
            const liveDescription = descriptionRef.current
                ? sanitizeDescriptionHtml(descriptionRef.current.innerHTML)
                : form.description;
            const payload = { ...form, title, description: liveDescription };
            if (editing) await updateAgenda({ ...payload, id: editing.id });
            else await createAgenda(payload);
            setShow(false);
            const r = await getAgendas(selectedEvent);
            const items = Array.isArray(r.data) ? r.data : [];
            setAgendas(items);
            setMaxDay(Math.max(items.reduce((max, a) => Math.max(max, a.day_number), 0), 1));
        } catch (err) { setError(err.response?.data?.error || 'Failed'); }
    };
    const handleDelete = async (id) => {
        if (window.confirm('Delete?')) {
            await deleteAgenda(id);
            const r = await getAgendas(selectedEvent);
            setAgendas(Array.isArray(r.data) ? r.data : []);
        }
    };

    // Calculate duration in minutes between "HH:MM:SS" (or "HH:MM") strings
    const getDurationMins = (start, end) => {
        if (!start || !end) return 0;
        const [h1, m1] = start.split(':').map(Number);
        const [h2, m2] = end.split(':').map(Number);
        return (h2 * 60 + m2) - (h1 * 60 + m1);
    };

    // Add minutes to "HH:MM:SS"
    const addMins = (timeStr, mins) => {
        if (!timeStr) return '';
        const [h, m, s] = timeStr.split(':').map(Number);
        const date = new Date(2000, 0, 1, h, m + mins, s || 0);
        return date.toTimeString().split(' ')[0];
    };

    const handleDragStart = (e, item) => {
        if (!canManage) {
            e.preventDefault();
            return;
        }
        setDraggedItem(item);
        e.dataTransfer.effectAllowed = 'move';
        // Need to set data for Firefox
        e.dataTransfer.setData('text/plain', item.id);
        
        // A slight delay ensures the drag image captures correctly before modifying DOM
        setTimeout(() => {
            e.target.classList.add('dragging');
        }, 0);
    };

    const handleDragOver = (e, targetItem) => {
        e.preventDefault();
        if (!draggedItem || draggedItem.id === targetItem.id) return;
        setDragOverItem(targetItem);
    };

    const handleDrop = async (e, targetItem) => {
        e.preventDefault();
        e.currentTarget.classList.remove('dragging');
        
        if (!draggedItem || draggedItem.id === targetItem.id) {
            setDraggedItem(null);
            setDragOverItem(null);
            return;
        }

        const currentDayAgendas = agendas.filter(a => a.day_number === selectedDay);
        // Map current indices based on their display order (which matches DB order)
        const oldIndex = currentDayAgendas.findIndex(i => i.id === draggedItem.id);
        const newIndex = currentDayAgendas.findIndex(i => i.id === targetItem.id);

        if (oldIndex === -1 || newIndex === -1) return;

        // Create new reordered array
        const newItemsList = [...currentDayAgendas];
        newItemsList.splice(oldIndex, 1);
        newItemsList.splice(newIndex, 0, draggedItem);

        setIsReordering(true);
        try {
            // Calculate new times based on the new order preserving durations
            // Starting from the original start time of the FIRST item of the day
            let currentStartTime = currentDayAgendas[0].start_time;
            
            const updates = newItemsList.map((item, index) => {
                const duration = getDurationMins(item.start_time, item.end_time);
                const newEndTime = addMins(currentStartTime, duration);
                
                const updateParams = {
                    id: item.id,
                    sequence: index,
                    start_time: currentStartTime,
                    end_time: newEndTime
                };
                
                // Advance start time for the next item
                currentStartTime = newEndTime;
                return updateParams;
            });

            // Optimistic UI update
            const updatedAgendasMap = new Map(agendas.map(a => [a.id, a]));
            updates.forEach(upd => {
                const existing = updatedAgendasMap.get(upd.id);
                updatedAgendasMap.set(upd.id, { ...existing, ...upd });
            });
            setAgendas(Array.from(updatedAgendasMap.values()).sort((a, b) => {
                if (a.day_number !== b.day_number) return a.day_number - b.day_number;
                return a.sequence - b.sequence;
            }));

            // Sync with backend
            await reorderAgendas(updates);
            
            // Refresh full state to ensure consistency
            const r = await getAgendas(selectedEvent);
            setAgendas(Array.isArray(r.data) ? r.data : []);
        } catch (err) {
            console.error("Reorder failed: ", err);
            setError('Failed to save the new order.');
            // Revert to original state on failure
            const r = await getAgendas(selectedEvent);
            setAgendas(Array.isArray(r.data) ? r.data : []);
        } finally {
            setDraggedItem(null);
            setDragOverItem(null);
            setIsReordering(false);
        }
    };

    const handleDragEnd = (e) => {
        e.target.classList.remove('dragging');
        setDraggedItem(null);
        setDragOverItem(null);
    };

    const uploadImageToServer = async (e, setter) => {
        const file = e.target.files[0];
        if (!file || !selectedEvent) return;
        try {
            const res = await uploadAgendaExportImage(selectedEvent, file);
            if (res.data?.url) setter(res.data.url);
        } catch (err) {
            alert(err?.response?.data?.error || 'Failed to upload image');
        } finally {
            e.target.value = ''; // allow re-upload of the same filename
        }
    };
    const handleBgUpload = (e) => uploadImageToServer(e, setExportBgImage);
    const handleLogoUpload = (e, setter) => uploadImageToServer(e, setter);

    const handleSaveDesign = async () => {
        if (!selectedEvent) return;
        setSavingDesign(true);
        const now = Date.now();
        const settings = {
            savedAt: now,
            exportBgColor, exportTextColor, exportAccentColor, exportDayHeaderBg, exportDayHeaderText,
            exportFontFamily, exportBgImage, exportBgOverlay, exportBgOverlayColor,
            exportHeaderImage, exportHeaderImageHeight, exportHeaderImageMode, exportFooterImage,
            exportCompanyLogo, exportEventLogo, exportLogoSize,
            exportShowPartners, exportPartnersPosition, exportPartnerSectionTitle,
            exportPartnerLogoSize, exportPartnerCatColor, exportPartnerCatSize, exportPartnerCatWeight,
        };
        try {
            await updateAgendaExportSettings(selectedEvent, settings);
            setDesignSavedAt(now);
        } catch (err) {
            alert(err?.response?.data?.error || 'Failed to save design');
        } finally {
            setSavingDesign(false);
        }
    };

    const handleViewSavedDesign = async () => {
        if (!exportRef.current) return;
        setShowSavedPreview(true);
        setSavedPreviewLoading(true);
        setSavedPreviewDataUrl(null);
        try {
            // Let fonts and remote images settle before rasterizing
            await document.fonts?.ready;
            const imgs = Array.from(exportRef.current.getElementsByTagName('img'));
            await Promise.all(imgs.map(img =>
                img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })
            ));
            await new Promise(r => setTimeout(r, 300));
            const dataUrl = await toPng(exportRef.current, { cacheBust: true, backgroundColor: exportBgColor, quality: 1, pixelRatio: 1.5 });
            setSavedPreviewDataUrl(dataUrl);
        } catch (err) {
            console.error('Preview render failed', err);
            alert('Failed to render preview');
            setShowSavedPreview(false);
        } finally {
            setSavedPreviewLoading(false);
        }
    };

    const handleExport = async (type) => {
        if (!exportRef.current) return;
        // Guard against double-clicks — if an export is already in flight, the
        // second call short-circuits so we don't render / save the same file twice.
        if (exporting) return;
        setExporting(type);
        setExportStage('Preparing layout…');
        try {
            // Wait for any potential layout shifts or image loads in the hidden component
            await new Promise(r => setTimeout(r, 800));
            // Higher pixelRatio for PDFs keeps banner images and logos crisp at print resolution
            const pixelRatio = type === 'pdf' ? 3 : 2;
            setExportStage(type === 'pdf' ? 'Rendering pages…' : 'Rendering image…');
            const dataUrl = await toPng(exportRef.current, { cacheBust: true, backgroundColor: exportBgColor, quality: 1, pixelRatio });
            if (type === 'image') {
                setExportStage('Saving PNG…');
                const link = document.createElement('a');
                link.download = `agenda-${selectedEvent}.png`;
                link.href = dataUrl;
                link.click();
            } else if (type === 'pdf') {
                setExportStage('Assembling PDF…');
                const img = new Image();
                img.src = dataUrl;
                await new Promise(r => img.onload = r);

                const container = exportRef.current;
                const containerRect = container.getBoundingClientRect();
                const scale = img.width / container.offsetWidth;

                // A4 width stays constant; heights are derived from actual content per-page.
                const A4_WIDTH_MM = 210;
                const A4_HEIGHT_MM = 297;
                const pxToMm = A4_WIDTH_MM / img.width;
                const maxPageHeightPx = A4_HEIGHT_MM / pxToMm;

                // Find all elements that shouldn't be split (in document order).
                // Banner images (.export-header-image at top, .export-footer-image at bottom) are
                // included so the paginator places them in output chunks, not just the title row and sessions.
                const blocks = Array.from(container.querySelectorAll('.export-header-image, .export-header, .export-day-header, .export-session-block, .export-partner-block, .export-footer-image'));
                const header = container.querySelector('.export-header');

                let pages = [];
                let currentChunk = [];
                let currentHeight = header ? (header.getBoundingClientRect().bottom - containerRect.top) * scale : 0;
                if (header) currentChunk.push({ top: 0, bottom: currentHeight });

                let seenDayHeader = false;
                blocks.forEach(el => {
                    const rect = el.getBoundingClientRect();
                    const elTop = (rect.top - containerRect.top) * scale;
                    const elBottom = (rect.bottom - containerRect.top) * scale;
                    const elHeight = elBottom - elTop;

                    // Measure from the page's top (not the previous block's bottom) so the
                    // inter-block margins/gaps are counted. Previously we added elHeight to
                    // currentHeight, which ignored the gap and let blocks overflow the page,
                    // causing sessions to be sliced across the page boundary.
                    const pageTop = currentChunk.length > 0 ? currentChunk[0].top : elTop;
                    const projectedHeight = elBottom - pageTop;

                    // Each Day X begins on a fresh page (except the very first day, which
                    // continues naturally after the event header). Without this, Day 2 can
                    // land wedged in between Day 1 sessions on the same page.
                    const isDayHeader = el.classList.contains('export-day-header');
                    const forceBreak = isDayHeader && seenDayHeader;
                    if (isDayHeader) seenDayHeader = true;

                    const shouldSplit = (forceBreak || projectedHeight > maxPageHeightPx)
                        && currentChunk.length > (header ? 1 : 0);

                    if (shouldSplit) {
                        pages.push(currentChunk);
                        currentChunk = [{ top: elTop, bottom: elBottom }];
                        currentHeight = elHeight;
                    } else {
                        currentChunk.push({ top: elTop, bottom: elBottom });
                        currentHeight = elBottom - currentChunk[0].top;
                    }
                });
                if (currentChunk.length > 0) pages.push(currentChunk);

                // Compute per-page height in mm. Non-last pages always use full A4 (297mm).
                // Last page shrinks to content, floored at A4_WIDTH_MM+1 (211mm) — jsPDF
                // auto-swaps width/height when the format's h < w and distorts the layout.
                // When the last page hits the floor and the content is shorter, we pad the
                // image from the top below so the footer lands at the true page bottom.
                const MIN_CUSTOM_HEIGHT = A4_WIDTH_MM + 1;
                const pageHeightsMm = pages.map((chunk, idx) => {
                    const top = chunk[0].top;
                    const bottom = chunk[chunk.length - 1].bottom;
                    const contentMm = (bottom - top) * pxToMm;
                    const isLast = idx === pages.length - 1;
                    if (!isLast) return A4_HEIGHT_MM;
                    return Math.max(contentMm, MIN_CUSTOM_HEIGHT);
                });

                const pdf = new jsPDF({
                    orientation: 'p',
                    unit: 'mm',
                    format: [A4_WIDTH_MM, pageHeightsMm[0]],
                    compress: false,
                });

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = img.width;

                for (let i = 0; i < pages.length; i++) {
                    if (i > 0) {
                        pdf.addPage([A4_WIDTH_MM, pageHeightsMm[i]], 'p');
                    }
                    const chunk = pages[i];
                    const top = chunk[0].top;
                    const bottom = chunk[chunk.length - 1].bottom;
                    const contentPx = bottom - top;
                    const isLast = i === pages.length - 1;

                    // For the last page: if the page floor makes the page taller than our
                    // content AND we have a footer image to anchor, top-pad the canvas so
                    // the content (ending with the footer) hugs the bottom of the page.
                    // Without this, short last pages leave whitespace under the footer.
                    const pagePx = pageHeightsMm[i] / pxToMm;
                    const topPadPx = (isLast && exportFooterImage && pagePx > contentPx + 1)
                        ? Math.max(0, pagePx - contentPx)
                        : 0;

                    canvas.height = contentPx + topPadPx;
                    if (topPadPx > 0) {
                        // Fill the pad with the export background colour so the padding
                        // isn't a visible white strip when the user picked a dark theme.
                        ctx.fillStyle = exportBgColor || '#ffffff';
                        ctx.fillRect(0, 0, canvas.width, canvas.height);
                    }
                    ctx.drawImage(img, 0, top, img.width, contentPx, 0, topPadPx, img.width, contentPx);

                    const pageDataUrl = canvas.toDataURL('image/png');
                    // Use 'NONE' compression to preserve image sharpness (banners, logos, photos).
                    pdf.addImage(pageDataUrl, 'PNG', 0, 0, A4_WIDTH_MM, (contentPx + topPadPx) * pxToMm, undefined, 'NONE');
                }

                pdf.save(`agenda-${selectedEvent}.pdf`);
            }
        } catch (err) {
            console.error('Export failed', err);
            alert(`Export failed: ${err.message || 'Unknown error'}. Check the console for details.`);
        } finally {
            setExporting(null);
            setExportStage('');
        }
    };

    const eventObj = events.find(e => e.id == selectedEvent);
    const eventTitle = eventObj?.title || 'Event';
    const formatDate = (dateStr) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}-${month}-${year}`;
    };
    const eventDate = formatDate(eventObj?.start_date);

    return (
        <div className="animate-in">
            {/* Full-screen progress overlay. Blocks pointer events so the user
                can't click export again mid-flight, and surfaces the current
                stage label so long renders (especially PDF) don't feel frozen. */}
            {exporting && (
                <div className="export-progress-overlay" role="status" aria-live="polite">
                    <div className="export-progress-card">
                        <Spinner animation="border" variant="light" />
                        <div className="export-progress-title">
                            {exporting === 'pdf' ? 'Generating PDF' : 'Generating Image'}
                        </div>
                        <div className="export-progress-stage">
                            {exportStage || 'Working on it…'}
                        </div>
                        <div className="export-progress-hint">
                            Keep this tab open — large agendas can take 15–30 seconds.
                        </div>
                    </div>
                </div>
            )}

            <div className="page-header d-flex justify-content-between align-items-center">
                <div><h4>Agendas</h4>
                    <p className='text-white small'>Schedule sessions for your events.</p></div>
                <div className="d-flex gap-3 align-items-center">
                    <Form.Select
                        style={{ width: 200 }}
                        className="form-select-dark"
                        value={selectedEvent}
                        onChange={e => { setSelectedEvent(e.target.value); setSelectedDay(1); }}
                        disabled={user?.role === 'employee' && !!user?.assigned_event_id}
                    >
                        {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                    </Form.Select>
                    {designSavedAt && (
                        <Button
                            variant="outline-success"
                            size="sm"
                            className="d-flex align-items-center gap-2"
                            style={{ borderRadius: 10, fontSize: '0.78rem', whiteSpace: 'nowrap' }}
                            onClick={handleViewSavedDesign}
                            title="Preview the last saved agenda design"
                        >
                            <BsCheckCircleFill size={13} />
                            <span>
                                Saved Design
                                {designSavedAt > 1 && (
                                    <span style={{ opacity: 0.7, marginLeft: 6, fontSize: '0.7rem' }}>
                                        · {new Date(designSavedAt).toLocaleDateString([], { day: '2-digit', month: 'short' })} {new Date(designSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                )}
                            </span>
                        </Button>
                    )}
                    <div className="dropdown">
                        <Button
                            className="btn-accent d-flex align-items-center gap-2"
                            styled={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
                            onClick={() => setShowExportOptions(!showExportOptions)}
                            disabled={!!exporting}
                        >
                            {exporting
                                ? <><Spinner animation="border" size="sm" /> Exporting…</>
                                : <><BsDownload size={16} /> Export</>}
                        </Button>
                        {showExportOptions && (
                            <div className="export-dropdown-menu">
                                <button onClick={() => { setShowCustomizer(true); setShowExportOptions(false); }} className="dropdown-item"><BsPencil size={14} className="me-2" /> Customize & Export</button>
                                <hr style={{ margin: '4px 0', opacity: 0.1 }} />
                                <button onClick={() => { handleExport('image'); setShowExportOptions(false); }} className="dropdown-item" disabled={!!exporting}><BsImage size={14} className="me-2" /> Quick Image</button>
                                <button onClick={() => { handleExport('pdf'); setShowExportOptions(false); }} className="dropdown-item" disabled={!!exporting}><BsFileEarmarkPdf size={14} className="me-2" /> Quick PDF</button>
                            </div>
                        )}
                    </div>
                    {canManage && <Button className="btn-accent d-flex align-items-center gap-2" onClick={() => openModal()}><BsPlus size={18} /> Add Session</Button>}
                </div>
            </div>

            {/* Day Tabs */}
            <div className="d-flex mb-4" style={{ gap: 8 }}>
                {Array.from({ length: maxDay + 1 }, (_, i) => i + 1).map(d => (
                    <button
                        key={d}
                        className={`day-tab ${selectedDay === d ? 'active' : ''}`}
                        onClick={() => setSelectedDay(d)}
                    >
                        Day {d}
                    </button>
                ))}
            </div>

            {/* Timeline */}
            {filtered.length === 0 ? (
                <div className="empty-state" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-subtle)' }}>
                    <div className="empty-state-icon"><BsListTask /></div>
                    <p style={{ fontWeight: 600, marginBottom: 4, color: 'var(--text-primary)' }}>No Sessions for Day {selectedDay}</p>
                    <p style={{ fontSize: '0.8rem' }}>Add agenda items to schedule this day.</p>
                </div>
            ) : (
                <div className={`agenda-list-container ${isReordering ? 'opacity-50' : ''}`} style={{ transition: 'opacity 0.2s' }}>
                    {filtered.map(a => (
                        <div 
                            key={a.id} 
                            className={`agenda-item d-flex gap-4 ${dragOverItem?.id === a.id ? 'drag-over' : ''} ${canManage ? 'draggable-item' : ''}`}
                            draggable={canManage}
                            onDragStart={(e) => handleDragStart(e, a)}
                            onDragOver={(e) => handleDragOver(e, a)}
                            onDrop={(e) => handleDrop(e, a)}
                            onDragEnd={handleDragEnd}
                            style={{ 
                                position: 'relative',
                                borderTop: dragOverItem?.id === a.id && draggedItem && agendas.indexOf(draggedItem) > agendas.indexOf(a) ? '2px solid var(--accent)' : 'var(--border-subtle)',
                                borderBottom: dragOverItem?.id === a.id && draggedItem && agendas.indexOf(draggedItem) < agendas.indexOf(a) ? '2px solid var(--accent)' : 'none',
                            }}
                        >
                            {canManage && (
                                <div className="drag-handle d-flex align-items-center justify-content-center" style={{ cursor: 'grab', color: 'var(--text-muted)', opacity: 0.5, marginLeft: '-10px' }} title="Drag to reorder">
                                    <BsGripVertical size={20} />
                                </div>
                            )}
                            <div style={{ minWidth: 170, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <BsClock style={{ color: 'var(--accent)', flexShrink: 0 }} />
                                <div className="agenda-time" style={{ fontSize: '0.9rem', whiteSpace: 'nowrap' }}>
                                    {fmtTime12(a.start_time)} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>–</span> {fmtTime12(a.end_time)}
                                </div>
                            </div>
                            <div className="flex-grow-1">
                                <h6 style={{ fontWeight: 700, marginBottom: 12, color: 'var(--text-primary)', fontSize: '1rem' }}>{a.title}</h6>
                                <div className="d-flex gap-3 flex-wrap mb-2">
                                    {Array.isArray(a.speakers) && a.speakers[0]?.id !== null && a.speakers.map(s => (
                                        <div key={s.id} className="speaker-mini-card">
                                            {s.photo_url ? (
                                                <img src={getImageUrl(s.photo_url)} alt={s.name} />
                                            ) : (
                                                <div className="speaker-mini-placeholder"><BsMic size={10} /></div>
                                            )}
                                            <div className="info">
                                                <div className="name">{s.name}</div>
                                                {s.designation && <div className="desc">{s.designation}</div>}
                                                {s.company && <div className="desc">{s.company}</div>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {a.description && <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: 0, marginTop: 10, lineHeight: 1.5 }}>{renderDescription(a.description)}</div>}
                            </div>
                            {canManage && (
                                <div className="d-flex gap-1 align-self-start">
                                    <button className="btn-action" onClick={() => openModal(a)}><BsPencil size={13} /></button>
                                    <button className="btn-action danger" onClick={() => handleDelete(a.id)}><BsTrash size={13} /></button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Hidden Export Component */}
            <div style={{ position: 'absolute', left: '-9999px', top: '-9999px' }}>
                <div id="export-target" ref={exportRef} style={{
                    width: '1000px',
                    minHeight: '1414px',
                    position: 'relative',
                    overflow: 'hidden',
                }}>
                    <div style={{
                        position: 'absolute',
                        top: 0, left: 0, right: 0, bottom: 0,
                        background: exportBgImage ? `url(${getImageUrl(exportBgImage)}) center/cover no-repeat` : exportBgColor,
                        backgroundColor: exportBgColor,
                        zIndex: 1
                    }}></div>

                    {exportBgImage && (
                        <div style={{
                            position: 'absolute',
                            top: 0, left: 0, right: 0, bottom: 0,
                            backgroundColor: exportBgOverlayColor,
                            opacity: exportBgOverlay,
                            zIndex: 2
                        }}></div>
                    )}

                    <div style={{ position: 'relative', zIndex: 3, padding: '60px', color: exportTextColor, fontFamily: `${exportFontFamily}, sans-serif`, minHeight: '1414px' }}>
                        {exportHeaderImage && (
                            <div className="export-header-image" style={{ marginBottom: '30px', marginLeft: '-60px', marginRight: '-60px', marginTop: '-60px' }}>
                                <img
                                    src={getImageUrl(exportHeaderImage)}
                                    alt="Header"
                                    crossOrigin="anonymous"
                                    style={{ width: '100%', height: 'auto', display: 'block' }}
                                />
                            </div>
                        )}
                        {!(exportHeaderImage && exportHeaderImageMode === 'replace') && (
                            <div className="export-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '40px', borderBottom: `2px solid ${exportAccentColor}`, paddingBottom: '20px', gap: '20px' }}>
                                <div style={{ flex: 1, textAlign: 'left' }}>
                                    {exportCompanyLogo && <img src={getImageUrl(exportCompanyLogo)} alt="Company Logo" style={{ maxHeight: `${exportLogoSize}px`, maxWidth: '100%', objectFit: 'contain' }} />}
                                </div>
                                <div style={{ flex: 2, textAlign: 'center' }}>
                                    <h2 style={{ fontSize: '2.5rem', fontWeight: 800, margin: 0, color: exportTextColor }}>{eventTitle}</h2>
                                    {eventDate && <p style={{ color: `${exportTextColor}aa`, fontSize: '1.2rem', marginTop: '10px', fontWeight: 600 }}>{eventDate}</p>}
                                </div>
                                <div style={{ flex: 1, textAlign: 'right' }}>
                                    {exportEventLogo && <img src={getImageUrl(exportEventLogo)} alt="Event Logo" style={{ maxHeight: `${exportLogoSize}px`, maxWidth: '100%', objectFit: 'contain' }} />}
                                </div>
                            </div>
                        )}

                        {exportShowPartners && exportPartnersPosition === 'top' && partners.filter(p => p.event_id == selectedEvent).length > 0 && (
                            <div className="export-partner-block" style={{ marginBottom: '60px', borderBottom: `1px solid ${exportTextColor}20`, paddingBottom: '40px' }}>
                                <h3 style={{ textAlign: 'center', fontSize: '1.2rem', fontWeight: 700, color: `${exportTextColor}aa`, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '40px' }}>{exportPartnerSectionTitle}</h3>

                                {Object.entries(
                                    partners.filter(p => p.event_id == selectedEvent).reduce((acc, p) => {
                                        const cat = p.category_name || 'Partners';
                                        if (!acc[cat]) acc[cat] = [];
                                        acc[cat].push(p);
                                        return acc;
                                    }, {})
                                ).map(([category, catPartners]) => (
                                    <div key={category} className="mb-4">
                                        <h4 style={{ textAlign: 'center', fontSize: `${exportPartnerCatSize}px`, fontWeight: exportPartnerCatWeight, color: exportPartnerCatColor, marginBottom: '20px', letterSpacing: '1px' }}>{category}</h4>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '40px', alignItems: 'center' }}>
                                            {catPartners.map(p => (
                                                <div key={p.id} style={{ textAlign: 'center', background: `${exportTextColor}05`, padding: '15px', borderRadius: '12px', minWidth: `${exportPartnerLogoSize + 40}px` }}>
                                                    {p.logo_url ? (
                                                        <img src={getImageUrl(p.logo_url)} alt={p.name} crossOrigin="anonymous" style={{ height: `${exportPartnerLogoSize}px`, maxWidth: '160px', objectFit: 'contain' }} />
                                                    ) : (
                                                        <div style={{ fontWeight: 700, color: exportTextColor, fontSize: '1.1rem' }}>{p.name}</div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {[...Array(maxDay)].map((_, i) => {
                            const dayNum = i + 1;
                            const daySessions = agendas.filter(a => a.day_number === dayNum);
                            if (daySessions.length === 0) return null;
                            return (
                                <div key={dayNum} className="export-day-group" style={{ marginBottom: '40px' }}>
                                    {maxDay > 1 && (
                                        // Matches the inline-pill styling from the customizer preview
                                        // so what you design is what the PDF renders — no more
                                        // full-width banner showing up only on export.
                                        <div className="export-day-header" style={{
                                            fontSize: '1rem',
                                            fontWeight: 700,
                                            padding: '8px 22px',
                                            background: exportDayHeaderBg,
                                            color: exportDayHeaderText,
                                            borderRadius: '6px',
                                            display: 'inline-block',
                                            marginBottom: '20px'
                                        }}>
                                            Day {dayNum}
                                        </div>
                                    )}
                                    {daySessions.map(session => (
                                        <div key={session.id} className="export-session-block" style={{ display: 'flex', gap: '20px', padding: '20px', background: `${exportTextColor}08`, borderRadius: '12px', border: `1px solid ${exportTextColor}15`, marginBottom: '15px' }}>
                                            <div style={{ minWidth: '180px', textAlign: 'left', whiteSpace: 'nowrap' }}>
                                                <div style={{ color: exportAccentColor, fontWeight: 700, fontSize: '0.95rem' }}>
                                                    {fmtTime12(session.start_time)} <span style={{ color: `${exportTextColor}88`, fontWeight: 500 }}>–</span> {fmtTime12(session.end_time)}
                                                </div>
                                            </div>
                                            <div style={{ flexGrow: 1 }}>
                                                <h4 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '8px', color: exportTextColor }}>{session.title}</h4>
                                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                                                    {Array.isArray(session.speakers) && session.speakers[0]?.id !== null && session.speakers.map(s => (
                                                        <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', background: `${exportAccentColor}15`, padding: '10px 16px', borderRadius: '12px', fontSize: '0.8rem' }}>
                                                            {s.photo_url ? (
                                                                <img src={getImageUrl(s.photo_url)} alt={s.name} crossOrigin="anonymous" style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }} />
                                                            ) : (
                                                                <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: exportAccentColor, color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><BsMic size={14} /></div>
                                                            )}
                                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                                <span style={{ fontWeight: 700, color: exportTextColor }}>{s.name}</span>
                                                                {s.designation && <span style={{ color: `${exportTextColor}aa`, fontSize: '0.7rem' }}>{s.designation}</span>}
                                                                {s.company && <span style={{ color: `${exportTextColor}aa`, fontSize: '0.7rem' }}>{s.company}</span>}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                                {exportShowDescription && session.description && (
                                                    <div style={{
                                                        color: exportDescriptionColor || `${exportTextColor}aa`,
                                                        fontSize: `${exportDescriptionSize}px`,
                                                        fontWeight: exportDescriptionWeight,
                                                        lineHeight: exportDescriptionLineHeight,
                                                        margin: 0
                                                    }}>
                                                        {renderDescription(session.description)}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            );
                        })}

                        {exportShowPartners && exportPartnersPosition === 'bottom' && partners.filter(p => p.event_id == selectedEvent).length > 0 && (
                            <div className="export-partner-block" style={{ marginTop: '60px', borderTop: `1px solid ${exportTextColor}20`, paddingTop: '40px' }}>
                                <h3 style={{ textAlign: 'center', fontSize: '1.2rem', fontWeight: 700, color: `${exportTextColor}aa`, textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '40px' }}>{exportPartnerSectionTitle}</h3>

                                {Object.entries(
                                    partners.filter(p => p.event_id == selectedEvent).reduce((acc, p) => {
                                        const cat = p.category_name || 'Partners';
                                        if (!acc[cat]) acc[cat] = [];
                                        acc[cat].push(p);
                                        return acc;
                                    }, {})
                                ).map(([category, catPartners]) => (
                                    <div key={category} className="export-partner-block" style={{ marginBottom: '40px' }}>
                                        <h4 style={{ textAlign: 'center', fontSize: `${exportPartnerCatSize}px`, fontWeight: exportPartnerCatWeight, color: exportPartnerCatColor, marginBottom: '20px', letterSpacing: '1px' }}>{category}</h4>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '40px', alignItems: 'center' }}>
                                            {catPartners.map(p => (
                                                <div key={p.id} style={{ textAlign: 'center', background: `${exportTextColor}05`, padding: '15px', borderRadius: '12px', minWidth: `${exportPartnerLogoSize + 40}px` }}>
                                                    {p.logo_url ? (
                                                        <img src={getImageUrl(p.logo_url)} alt={p.name} crossOrigin="anonymous" style={{ height: `${exportPartnerLogoSize}px`, maxWidth: '160px', objectFit: 'contain' }} />
                                                    ) : (
                                                        <div style={{ fontWeight: 700, color: exportTextColor, fontSize: '1.1rem' }}>{p.name}</div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {exportFooterImage && (
                            <div className="export-footer-image" style={{ marginTop: '40px', marginLeft: '-60px', marginRight: '-60px', marginBottom: '-60px' }}>
                                <img
                                    src={getImageUrl(exportFooterImage)}
                                    alt="Footer"
                                    crossOrigin="anonymous"
                                    style={{ width: '100%', height: 'auto', display: 'block' }}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <Modal show={show} onHide={() => setShow(false)} centered size="lg" contentClassName="premium-modal session-modal">
                <Modal.Header closeButton closeVariant="white" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <Modal.Title style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{
                            width: 34, height: 34, borderRadius: 10,
                            background: 'linear-gradient(135deg, var(--accent), #7c3aed)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            boxShadow: '0 6px 18px rgba(139,92,246,0.4)'
                        }}>
                            <BsListTask size={16} color="white" />
                        </span>
                        <span>{editing ? 'Edit Session' : 'Add Session'}</span>
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body style={{ padding: '20px 24px' }}>
                    {error && <Alert variant="danger" className="py-2" style={{ fontSize: '0.85rem', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}>{error}</Alert>}

                    {/* ── Section: Content ────────────────────────── */}
                    <div className="session-section">
                        <div className="session-section-header">
                            <BsCardText size={13} /> <span>Content</span>
                        </div>

                        <Form.Group className="mb-3">
                            <Form.Label>Title *</Form.Label>
                            <Form.Control className="form-control-dark" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Session title" />
                        </Form.Group>

                        <Form.Group className="mb-1">
                            <Form.Label>Description</Form.Label>
                            <div className="session-rte-toolbar">
                                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execFormat('bold')} title="Bold (Ctrl+B)">
                                    <BsTypeBold size={13} /> <span>Bold</span>
                                </button>
                                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execFormat('italic')} title="Italic (Ctrl+I)">
                                    <BsTypeItalic size={13} /> <span>Italic</span>
                                </button>
                                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execFormat('insertUnorderedList')} title="Bullet list">
                                    <BsListUl size={13} /> <span>List</span>
                                </button>
                                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => execFormat('insertLineBreak')} title="Line break">
                                    <BsArrowReturnLeft size={13} /> <span>New line</span>
                                </button>
                            </div>
                            <div
                                ref={descriptionRef}
                                className="form-control-dark session-rte-editor"
                                contentEditable
                                suppressContentEditableWarning
                                onInput={syncDescriptionFromEditor}
                                onBlur={syncDescriptionFromEditor}
                                onPaste={handleDescriptionPaste}
                                data-placeholder="Brief description. Highlight text and hit Bold / Italic or add bullet points for key takeaways."
                            />
                        </Form.Group>
                    </div>

                    {/* ── Section: Scheduling ─────────────────────── */}
                    <div className="session-section">
                        <div className="session-section-header">
                            <BsCalendarEvent size={13} /> <span>Scheduling</span>
                        </div>
                        <div className="session-grid-4">
                            <Form.Group>
                                <Form.Label>Event</Form.Label>
                                <Form.Select
                                    className="form-select-dark"
                                    value={form.event_id}
                                    onChange={e => setForm({ ...form, event_id: e.target.value })}
                                    disabled={user?.role === 'employee' && !!user?.assigned_event_id}
                                >
                                    {events.map(ev => <option key={ev.id} value={ev.id}>{ev.title}</option>)}
                                </Form.Select>
                            </Form.Group>
                            <Form.Group>
                                <Form.Label>Day</Form.Label>
                                <Form.Control type="number" min={1} className="form-control-dark" value={form.day_number} onChange={e => setForm({ ...form, day_number: parseInt(e.target.value) || 1 })} />
                            </Form.Group>
                            <Form.Group>
                                <Form.Label>Start Time *</Form.Label>
                                <Form.Control type="time" className="form-control-dark" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} />
                            </Form.Group>
                            <Form.Group>
                                <Form.Label>End Time *</Form.Label>
                                <Form.Control type="time" className="form-control-dark" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} />
                            </Form.Group>
                        </div>
                    </div>

                    {/* ── Section: Speakers ───────────────────────── */}
                    <div className="session-section">
                        <div className="session-section-header">
                            <BsPeople size={13} />
                            <span>Speakers</span>
                            <span className="session-section-count">{form.speaker_ids.length} selected</span>
                        </div>
                        <div className="speaker-selection-grid">
                            {speakers.map(s => (
                                <div
                                    key={s.id}
                                    className={`speaker-select-item ${form.speaker_ids.includes(s.id) ? 'selected' : ''}`}
                                    onClick={() => {
                                        const ids = form.speaker_ids.includes(s.id)
                                            ? form.speaker_ids.filter(id => id !== s.id)
                                            : [...form.speaker_ids, s.id];
                                        setForm({ ...form, speaker_ids: ids });
                                    }}
                                >
                                    {s.photo_url ? <img src={getImageUrl(s.photo_url)} alt={s.name} /> : <div className="placeholder"><BsMic size={14} /></div>}
                                    <div className="info">
                                        <div className="name">{s.name}</div>
                                        <div className="desc">{s.designation} @ {s.company}</div>
                                    </div>
                                    <div className="checkbox">{form.speaker_ids.includes(s.id) ? '✓' : ''}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </Modal.Body>
                <Modal.Footer style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <Button variant="link" onClick={() => setShow(false)} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>Cancel</Button>
                    <AsyncButton className="btn btn-accent" onClick={handleSave} loadingText={editing ? 'Saving…' : 'Adding…'}>
                        {editing ? 'Save Session' : 'Add Session'}
                    </AsyncButton>
                </Modal.Footer>
            </Modal>

            {/* Customization Modal */}
            <Modal show={showCustomizer} onHide={() => setShowCustomizer(false)} size="xl" scrollable centered contentClassName="premium-modal">
                <Modal.Header closeButton closeVariant="white"><Modal.Title className='text-white'>Advanced Export Designer</Modal.Title></Modal.Header>
                <Modal.Body style={{ padding: 0, height: 'calc(100vh - 180px)', overflow: 'hidden', backgroundColor: '#0c0c46' }}>
                    <div className="d-flex h-100 customizer-layout">
                        <div className="customizer-sidebar" style={{ width: '400px', flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.1)', padding: '30px', overflowY: 'auto' }}>
                            {isLocked && (
                                <div className="mb-4 p-2 d-flex align-items-center gap-2" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 8, color: '#13d999', fontSize: '0.75rem' }}>
                                    <BsShieldLock size={16} />
                                    <span>Branding is locked for this event. Some style controls are disabled.</span>
                                </div>
                            )}
                            <div className="customizer-section mb-4">
                                <h6 className="section-label">General Styling</h6>
                                <div className="row g-3">
                                    <div className="col-6">
                                        <Form.Label>Base BG</Form.Label>
                                        <div className="d-flex align-items-center gap-2">
                                            <Form.Control type="color" value={exportBgColor} onChange={e => setExportBgColor(e.target.value)} style={{ width: 44, height: 32, padding: 2 }} />
                                            <Form.Control type="text" value={exportBgColor} onChange={e => setExportBgColor(e.target.value)} className="form-control-dark font-monospace" style={{ fontSize: '0.7rem' }} />
                                        </div>
                                    </div>
                                    <div className="col-6">
                                        <Form.Label>Base Text</Form.Label>
                                        <div className="d-flex align-items-center gap-2">
                                            <Form.Control type="color" value={exportTextColor} onChange={e => setExportTextColor(e.target.value)} style={{ width: 44, height: 32, padding: 2 }} />
                                            <Form.Control type="text" value={exportTextColor} onChange={e => setExportTextColor(e.target.value)} className="form-control-dark font-monospace" style={{ fontSize: '0.7rem' }} />
                                        </div>
                                    </div>
                                    <div className="col-12">
                                        <Form.Label>Accent & Timestamps</Form.Label>
                                        <div className="d-flex align-items-center gap-2">
                                            <Form.Control type="color" value={exportAccentColor} onChange={e => setExportAccentColor(e.target.value)} style={{ width: 44, height: 32, padding: 2 }} disabled={isLocked} />
                                            <Form.Control type="text" value={exportAccentColor} onChange={e => setExportAccentColor(e.target.value)} className="form-control-dark font-monospace" style={{ fontSize: '0.7rem' }} disabled={isLocked} />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="customizer-section mb-4">
                                <h6 className="section-label">Day Header Style</h6>
                                <div className="row g-3">
                                    <div className="col-12">
                                        <Form.Label>Header Background</Form.Label>
                                        <div className="d-flex gap-2">
                                            <Form.Control type="color" value={exportDayHeaderBg.startsWith('linear-gradient') ? '#000000' : exportDayHeaderBg} onChange={e => setExportDayHeaderBg(e.target.value)} style={{ width: 44, height: 38, padding: 2 }} disabled={isLocked} />
                                            <Form.Control className="form-control-dark font-monospace flex-grow-1" value={exportDayHeaderBg} onChange={e => setExportDayHeaderBg(e.target.value)} placeholder="Color or CSS Gradient" style={{ fontSize: '0.8rem' }} disabled={isLocked} />
                                        </div>
                                    </div>
                                    <div className="col-12">
                                        <Form.Label>Header Text Color</Form.Label>
                                        <div className="d-flex align-items-center gap-2">
                                            <Form.Control type="color" value={exportDayHeaderText} onChange={e => setExportDayHeaderText(e.target.value)} style={{ width: 44, height: 32, padding: 2 }} />
                                            <Form.Control type="text" value={exportDayHeaderText} onChange={e => setExportDayHeaderText(e.target.value)} className="form-control-dark font-monospace" style={{ fontSize: '0.7rem' }} />
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="customizer-section mb-4">
                                <h6 className="section-label">Session Description</h6>
                                <div className="row g-3">
                                    <div className="col-12">
                                        <Form.Check
                                            type="switch"
                                            id="export-show-description"
                                            label={<span style={{ color: '#fff', fontSize: '0.8rem', fontWeight: 600 }}>Show descriptions in PDF</span>}
                                            checked={exportShowDescription}
                                            onChange={e => setExportShowDescription(e.target.checked)}
                                        />
                                        <div className="text-white" style={{ fontSize: '0.68rem', opacity: 0.6, marginTop: 4 }}>
                                            Hide if you only want the titles, times and speakers to appear.
                                        </div>
                                    </div>
                                    {exportShowDescription && (
                                        <>
                                            <div className="col-12">
                                                <Form.Label>Text Color</Form.Label>
                                                <div className="d-flex align-items-center gap-2">
                                                    <Form.Control type="color" value={exportDescriptionColor || exportTextColor} onChange={e => setExportDescriptionColor(e.target.value)} style={{ width: 44, height: 32, padding: 2 }} />
                                                    <Form.Control type="text" value={exportDescriptionColor} onChange={e => setExportDescriptionColor(e.target.value)} className="form-control-dark font-monospace" style={{ fontSize: '0.7rem' }} placeholder="blank = base text @ 65%" />
                                                </div>
                                                {exportDescriptionColor && (
                                                    <Button variant="link" className="p-0" style={{ fontSize: '0.68rem', color: '#a5b4fc' }} onClick={() => setExportDescriptionColor('')}>
                                                        Reset to base text
                                                    </Button>
                                                )}
                                            </div>
                                            <div className="col-6">
                                                <Form.Label>Font Size</Form.Label>
                                                <div className="d-flex align-items-center gap-2">
                                                    <Form.Range
                                                        min={8} max={48} step={1}
                                                        value={exportDescriptionSize}
                                                        onChange={e => setExportDescriptionSize(parseInt(e.target.value, 10))}
                                                        style={{ flex: 1 }}
                                                    />
                                                    <Form.Control
                                                        type="number"
                                                        min={8}
                                                        max={96}
                                                        value={exportDescriptionSize}
                                                        onChange={e => {
                                                            const v = parseInt(e.target.value, 10);
                                                            if (!Number.isNaN(v)) setExportDescriptionSize(Math.max(8, Math.min(96, v)));
                                                        }}
                                                        className="form-control-dark"
                                                        style={{ width: 68, fontSize: '0.78rem', padding: '4px 8px' }}
                                                    />
                                                    <span style={{ color: '#fff', fontSize: '0.7rem', opacity: 0.6 }}>px</span>
                                                </div>
                                            </div>
                                            <div className="col-6">
                                                <Form.Label>Weight</Form.Label>
                                                <Form.Select
                                                    className="form-select-dark"
                                                    value={exportDescriptionWeight}
                                                    onChange={e => setExportDescriptionWeight(e.target.value)}
                                                >
                                                    <option value="300">Light</option>
                                                    <option value="400">Regular</option>
                                                    <option value="500">Medium</option>
                                                    <option value="600">Semi-bold</option>
                                                    <option value="700">Bold</option>
                                                </Form.Select>
                                            </div>
                                            <div className="col-12">
                                                <Form.Label>Line Height</Form.Label>
                                                <div className="d-flex align-items-center gap-2">
                                                    <Form.Range
                                                        min={1} max={2.5} step={0.05}
                                                        value={exportDescriptionLineHeight}
                                                        onChange={e => setExportDescriptionLineHeight(parseFloat(e.target.value))}
                                                        style={{ flex: 1 }}
                                                    />
                                                    <Form.Control
                                                        type="number"
                                                        min={1}
                                                        max={3}
                                                        step={0.05}
                                                        value={exportDescriptionLineHeight}
                                                        onChange={e => {
                                                            const v = parseFloat(e.target.value);
                                                            if (!Number.isNaN(v)) setExportDescriptionLineHeight(Math.max(1, Math.min(3, v)));
                                                        }}
                                                        className="form-control-dark"
                                                        style={{ width: 76, fontSize: '0.78rem', padding: '4px 8px' }}
                                                    />
                                                    <Button
                                                        variant="link"
                                                        className="p-0"
                                                        style={{ fontSize: '0.68rem', color: '#a5b4fc', whiteSpace: 'nowrap' }}
                                                        onClick={() => setExportDescriptionLineHeight(1.4)}
                                                        title="Reset to default 1.4"
                                                    >
                                                        Reset
                                                    </Button>
                                                </div>
                                                <div className="text-white" style={{ fontSize: '0.65rem', opacity: 0.55, marginTop: 2 }}>
                                                    1.0 = tight · 1.4 = comfortable · 2.0 = airy
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>

                            <div className="customizer-section mb-4">
                                <h6 className="section-label">Header Image (Banner)</h6>
                                <div className="row g-3">
                                    <div className="col-12">
                                        <Form.Label>Upload Banner</Form.Label>
                                        <Form.Control type="file" accept="image/*" onChange={e => handleLogoUpload(e, setExportHeaderImage)} className="form-control-dark" />
                                        {exportHeaderImage && (
                                            <Button variant="link" className="p-0 text-danger" style={{ fontSize: '0.7rem' }} onClick={() => setExportHeaderImage(null)}>Remove</Button>
                                        )}
                                    </div>
                                    {exportHeaderImage && (
                                        <div className="col-12">
                                            <Form.Label>Display Mode</Form.Label>
                                            <Form.Select
                                                className="form-select-dark"
                                                value={exportHeaderImageMode}
                                                onChange={e => setExportHeaderImageMode(e.target.value)}
                                            >
                                                <option value="above">Show above title & logos</option>
                                                <option value="replace">Replace title & logos</option>
                                            </Form.Select>
                                            <div className="text-white" style={{ fontSize: '0.7rem', marginTop: 6 }}>
                                                Banner renders at its natural aspect ratio across the full width.
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="customizer-section mb-4">
                                <h6 className="section-label">Footer Image (Banner)</h6>
                                <div className="row g-3">
                                    <div className="col-12">
                                        <Form.Label>Upload Footer</Form.Label>
                                        <Form.Control type="file" accept="image/*" onChange={e => handleLogoUpload(e, setExportFooterImage)} className="form-control-dark" />
                                        {exportFooterImage && (
                                            <Button variant="link" className="p-0 text-danger" style={{ fontSize: '0.7rem' }} onClick={() => setExportFooterImage(null)}>Remove</Button>
                                        )}
                                        <div className="text-white" style={{ fontSize: '0.7rem', marginTop: 6 }}>
                                            Footer renders at the bottom of the export, edge-to-edge at its natural aspect ratio.
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="customizer-section mb-4">
                                <h6 className="section-label">Logos & Header</h6>
                                <div className="row g-3">
                                    <div className="col-12">
                                        <Form.Label>Company Logo (Left)</Form.Label>
                                        <Form.Control type="file" accept="image/*" onChange={e => handleLogoUpload(e, setExportCompanyLogo)} className="form-control-dark" disabled={isLocked} />
                                        {exportCompanyLogo && !isLocked && <Button variant="link" className="p-0 text-danger" style={{ fontSize: '0.7rem' }} onClick={() => setExportCompanyLogo(null)}>Remove</Button>}
                                    </div>
                                    <div className="col-12">
                                        <Form.Label>Event Logo (Right)</Form.Label>
                                        <Form.Control type="file" accept="image/*" onChange={e => handleLogoUpload(e, setExportEventLogo)} className="form-control-dark" disabled={isLocked} />
                                        {exportEventLogo && !isLocked && <Button variant="link" className="p-0 text-danger" style={{ fontSize: '0.7rem' }} onClick={() => setExportEventLogo(null)}>Remove</Button>}
                                    </div>
                                    <div className="col-12">
                                        <Form.Label className="d-flex justify-content-between">
                                            <span>Logo Size</span>
                                            <span className="text-accent">{exportLogoSize}px</span>
                                        </Form.Label>
                                        <Form.Range
                                            min={20} max={150} step={2}
                                            value={exportLogoSize}
                                            onChange={e => setExportLogoSize(parseInt(e.target.value))}
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="customizer-section mb-4">
                                <h6 className="section-label">Partner Options</h6>
                                <Form.Check
                                    type="switch"
                                    id="show-partners-switch"
                                    label="Show Partners on Agenda"
                                    checked={exportShowPartners}
                                    onChange={e => setExportShowPartners(e.target.checked)}
                                    className="mb-3"
                                />
                                {exportShowPartners && (
                                    <>
                                        <Form.Group className="mb-3">
                                            <Form.Label>Branding Partner Text</Form.Label>
                                            <Form.Control
                                                type="text"
                                                className="form-control-dark"
                                                value={exportPartnerSectionTitle}
                                                onChange={e => setExportPartnerSectionTitle(e.target.value)}
                                                placeholder="e.g. Our Partners"
                                            />
                                        </Form.Group>
                                        <div className="row g-2 mb-3">
                                            <div className="col-6">
                                                <Form.Label>Category Color</Form.Label>
                                                <div className="d-flex align-items-center gap-2">
                                                    <Form.Control type="color" value={exportPartnerCatColor} onChange={e => setExportPartnerCatColor(e.target.value)} style={{ width: 44, height: 32, padding: 2 }} disabled={isLocked} />
                                                    <Form.Control type="text" value={exportPartnerCatColor} onChange={e => setExportPartnerCatColor(e.target.value)} className="form-control-dark font-monospace" style={{ fontSize: '0.65rem' }} disabled={isLocked} />
                                                </div>
                                            </div>
                                            <div className="col-6">
                                                <Form.Label>Category Size</Form.Label>
                                                <Form.Select className="form-select-dark" value={exportPartnerCatSize} onChange={e => setExportPartnerCatSize(parseInt(e.target.value))}>
                                                    {[10, 12, 14, 16, 18, 20, 24, 28].map(s => <option key={s} value={s}>{s}px</option>)}
                                                </Form.Select>
                                            </div>
                                        </div>
                                        <Form.Group className="mb-3">
                                            <Form.Label className="d-flex justify-content-between">
                                                <span>Partner Logo Size</span>
                                                <span className="text-accent">{exportPartnerLogoSize}px</span>
                                            </Form.Label>
                                            <Form.Range
                                                min={20} max={120} step={2}
                                                value={exportPartnerLogoSize}
                                                onChange={e => setExportPartnerLogoSize(parseInt(e.target.value))}
                                            />
                                        </Form.Group>
                                        <Form.Group>
                                            <Form.Label>Partner Section Position</Form.Label>
                                            <Form.Select
                                                className="form-select-dark"
                                                value={exportPartnersPosition}
                                                onChange={e => setExportPartnersPosition(e.target.value)}
                                            >
                                                <option value="bottom">Bottom of Agenda</option>
                                                <option value="top">Top (After Header)</option>
                                            </Form.Select>
                                        </Form.Group>
                                    </>
                                )}
                            </div>

                            <div className="customizer-section mb-4">
                                <h6 className="section-label">Typography & Template</h6>
                                <Form.Group className="mb-3">
                                    <Form.Label>Font Family</Form.Label>
                                    <Form.Select
                                        className="form-select-dark"
                                        value={exportFontFamily}
                                        onChange={e => setExportFontFamily(e.target.value)}
                                        disabled={isLocked}
                                        style={{ fontFamily: `${exportFontFamily}, sans-serif` }}
                                    >
                                        <optgroup label="Modern Sans">
                                            <option value="Inter">Inter</option>
                                            <option value="DM Sans">DM Sans</option>
                                            <option value="Manrope">Manrope</option>
                                            <option value="Space Grotesk">Space Grotesk</option>
                                            <option value="IBM Plex Sans">IBM Plex Sans</option>
                                            <option value="Work Sans">Work Sans</option>
                                        </optgroup>
                                        <optgroup label="Geometric / Rounded">
                                            <option value="Montserrat">Montserrat</option>
                                            <option value="Poppins">Poppins</option>
                                            <option value="Nunito">Nunito</option>
                                            <option value="Rubik">Rubik</option>
                                            <option value="Raleway">Raleway</option>
                                            <option value="Josefin Sans">Josefin Sans</option>
                                        </optgroup>
                                        <optgroup label="Classic / Utility">
                                            <option value="Roboto">Roboto</option>
                                            <option value="Open Sans">Open Sans</option>
                                            <option value="Ubuntu">Ubuntu</option>
                                        </optgroup>
                                        <optgroup label="Serif">
                                            <option value="Playfair Display">Playfair Display</option>
                                            <option value="Cormorant Garamond">Cormorant Garamond</option>
                                            <option value="Lora">Lora</option>
                                            <option value="Merriweather">Merriweather</option>
                                        </optgroup>
                                        <optgroup label="Display">
                                            <option value="Bebas Neue">Bebas Neue</option>
                                            <option value="Oswald">Oswald</option>
                                        </optgroup>
                                    </Form.Select>
                                    <div className="text-white" style={{ fontSize: '0.72rem', marginTop: 8, fontFamily: `${exportFontFamily}, sans-serif`, opacity: 0.85 }}>
                                        The quick brown fox jumps over the lazy dog 0123456789
                                    </div>
                                </Form.Group>
                                <Form.Group className="mb-3">
                                    <Form.Label>Background Image</Form.Label>
                                    <Form.Control type="file" accept="image/*" onChange={handleBgUpload} className="form-control-dark" />
                                    {exportBgImage && (
                                        <div className="mt-3 p-3" style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid var(--border-subtle)' }}>
                                            <Form.Label className="d-flex justify-content-between">
                                                <span>Background Overlay</span>
                                                <span className="text-accent">{Math.round(exportBgOverlay * 100)}%</span>
                                            </Form.Label>
                                            <Form.Range
                                                min={0} max={1} step={0.01}
                                                value={exportBgOverlay}
                                                onChange={e => setExportBgOverlay(parseFloat(e.target.value))}
                                            />
                                            <div className="mt-2 d-flex align-items-center gap-2">
                                                <Form.Control
                                                    type="color"
                                                    value={exportBgOverlayColor}
                                                    onChange={e => setExportBgOverlayColor(e.target.value)}
                                                    style={{ width: 44, height: 32, padding: 2 }}
                                                />
                                                <Form.Control
                                                    type="text"
                                                    value={exportBgOverlayColor}
                                                    onChange={e => setExportBgOverlayColor(e.target.value)}
                                                    className="form-control-dark font-monospace"
                                                    style={{ fontSize: '0.7rem' }}
                                                />
                                            </div>
                                            <Button variant="link" className="p-0 text-danger mt-2" style={{ fontSize: '0.7rem' }} onClick={() => { setExportBgImage(null); setExportBgOverlay(0); }}>Remove Background</Button>
                                        </div>
                                    )}
                                </Form.Group>
                            </div>
                            <div className="pb-3"></div>
                        </div>

                        <div className="preview-area" style={{ flex: 1, padding: '40px', overflowY: 'auto', backgroundColor: '#08082e' }}>
                            <h6 className="section-label mb-3">Real-time Designer Preview</h6>
                            <div className="export-preview-container-advanced" style={{
                                height: 'auto',
                                minHeight: '500px',
                                backgroundColor: exportBgColor,
                                borderRadius: '12px',
                                overflow: 'hidden'
                            }}>
                                <div style={{
                                    position: 'relative',
                                    minHeight: '100%',
                                    background: exportBgImage ? `url(${getImageUrl(exportBgImage)}) center/cover no-repeat` : exportBgColor,
                                    color: exportTextColor,
                                    fontFamily: `${exportFontFamily}, sans-serif`,
                                }}>
                                    {exportBgImage && (
                                        <div style={{
                                            position: 'absolute',
                                            top: 0, left: 0, right: 0, bottom: 0,
                                            backgroundColor: exportBgOverlayColor,
                                            opacity: exportBgOverlay,
                                            zIndex: 1
                                        }}></div>
                                    )}
                                    <div style={{ position: 'relative', zIndex: 2, padding: '20px' }}>
                                        {exportHeaderImage && (
                                            <div style={{ marginBottom: '15px', marginLeft: '-50px', marginRight: '-50px', marginTop: '-50px' }}>
                                                <img src={getImageUrl(exportHeaderImage)} alt="Header" style={{ width: '100%', height: 'auto', display: 'block' }} />
                                            </div>
                                        )}
                                        {!(exportHeaderImage && exportHeaderImageMode === 'replace') && (
                                            <div className="export-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px', borderBottom: `1px solid ${exportAccentColor}`, paddingBottom: '10px', gap: '10px' }}>
                                                <div style={{ flex: 1, textAlign: 'left' }}>
                                                    {exportCompanyLogo && <img src={getImageUrl(exportCompanyLogo)} alt="Company" style={{ maxHeight: `${exportLogoSize / 2}px`, maxWidth: '100%', objectFit: 'contain' }} />}
                                                </div>
                                                <div style={{ flex: 2, textAlign: 'center' }}>
                                                    <h5 style={{ margin: 0, color: exportTextColor, fontFamily: exportFontFamily, fontSize: '1rem' }}>{eventTitle}</h5>
                                                    {eventDate && <div style={{ color: `${exportTextColor}aa`, fontSize: '0.65rem', marginTop: '2px' }}>{eventDate}</div>}
                                                </div>
                                                <div style={{ flex: 1, textAlign: 'right' }}>
                                                    {exportEventLogo && <img src={getImageUrl(exportEventLogo)} alt="Event" style={{ maxHeight: `${exportLogoSize / 2}px`, maxWidth: '100%', objectFit: 'contain' }} />}
                                                </div>
                                            </div>
                                        )}

                                        {exportShowPartners && exportPartnersPosition === 'top' && partners.filter(p => p.event_id == selectedEvent).length > 0 && (
                                            <div className="export-partner-block mb-4" style={{ textAlign: 'center', borderBottom: `1px solid ${exportTextColor}20`, paddingBottom: '20px' }}>
                                                <small style={{ textTransform: 'uppercase', letterSpacing: '1px', color: exportAccentColor, opacity: 0.8 }}>{exportPartnerSectionTitle}</small>
                                                {Object.entries(
                                                    partners.filter(p => p.event_id == selectedEvent).reduce((acc, p) => {
                                                        const cat = p.category_name || 'Partners';
                                                        if (!acc[cat]) acc[cat] = [];
                                                        acc[cat].push(p);
                                                        return acc;
                                                    }, {})
                                                ).map(([category, catPartners]) => (
                                                    <div key={category} className="mt-3">
                                                        <div style={{ fontSize: `${exportPartnerCatSize / 2}px`, fontWeight: exportPartnerCatWeight, color: exportPartnerCatColor, marginBottom: '5px' }}>{category}</div>
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '15px', alignItems: 'center' }}>
                                                            {catPartners.slice(0, 6).map(p => (
                                                                <div key={p.id} style={{ background: `${exportTextColor}05`, padding: '8px', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                                                                    {p.logo_url ? (
                                                                        <img src={getImageUrl(p.logo_url)} alt={p.name} style={{ height: `${exportPartnerLogoSize / 2.5}px`, maxWidth: '60px', objectFit: 'contain' }} />
                                                                    ) : (
                                                                        <span style={{ fontSize: '0.65rem', color: exportTextColor, fontWeight: 600 }}>{p.name}</span>
                                                                    )}
                                                                </div>
                                                            ))}
                                                            {catPartners.length > 6 && <span style={{ fontSize: '0.5rem', color: `${exportTextColor}88` }}>+{catPartners.length - 6}</span>}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {[...Array(maxDay)].map((_, i) => {
                                            const dayNum = i + 1;
                                            const daySessions = agendas.filter(a => a.day_number === dayNum);
                                            if (daySessions.length === 0) return null;
                                            return (
                                                <div key={dayNum} className="mb-4">
                                                    {maxDay > 1 && (
                                                        <div style={{ fontSize: '0.8rem', fontWeight: 700, padding: '4px 12px', background: exportDayHeaderBg, color: exportDayHeaderText, borderRadius: '4px', display: 'inline-block', marginBottom: '10px' }}>Day {dayNum}</div>
                                                    )}
                                                    {daySessions.map(session => (
                                                        <div key={session.id} style={{ padding: '12px', background: `${exportTextColor}15`, borderRadius: '8px', border: `1px solid ${exportTextColor}15`, marginBottom: '10px' }}>
                                                            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: exportAccentColor, whiteSpace: 'nowrap' }}>{fmtTime12(session.start_time)} – {fmtTime12(session.end_time)}</div>
                                                            <div style={{ fontSize: '0.9rem', fontWeight: 700, margin: '4px 0', color: exportTextColor }}>{session.title}</div>
                                                            {exportShowDescription && session.description && (
                                                                <div style={{
                                                                    color: exportDescriptionColor || `${exportTextColor}aa`,
                                                                    fontSize: `${Math.max(10, exportDescriptionSize - 2)}px`,
                                                                    fontWeight: exportDescriptionWeight,
                                                                    lineHeight: exportDescriptionLineHeight,
                                                                    margin: '4px 0 0'
                                                                }}>
                                                                    {renderDescription(session.description)}
                                                                </div>
                                                            )}
                                                            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '8px' }}>
                                                                {Array.isArray(session.speakers) && session.speakers[0]?.id !== null && session.speakers.map(s => (
                                                                    <div key={s.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', background: `${exportAccentColor}15`, padding: '6px 10px', borderRadius: '8px' }}>
                                                                        <div style={{ width: '24px', height: '24px', borderRadius: '50%', background: exportAccentColor, overflow: 'hidden', flexShrink: 0 }}>
                                                                            {s.photo_url && <img src={getImageUrl(s.photo_url)} alt={s.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                                                                        </div>
                                                                        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
                                                                            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: exportTextColor }}>{s.name}</span>
                                                                            {s.designation && <span style={{ fontSize: '0.6rem', color: `${exportTextColor}aa` }}>{s.designation}</span>}
                                                                            {s.company && <span style={{ fontSize: '0.6rem', color: `${exportTextColor}88` }}>{s.company}</span>}
                                                                        </div>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            );
                                        })}

                                        {exportShowPartners && exportPartnersPosition === 'bottom' && partners.filter(p => p.event_id == selectedEvent).length > 0 && (
                                            <div className="export-partner-block" style={{ marginTop: '30px', borderTop: `1px solid ${exportTextColor}20`, paddingTop: '20px', textAlign: 'center' }}>
                                                <small style={{ textTransform: 'uppercase', letterSpacing: '1px', color: exportAccentColor, opacity: 0.8 }}>{exportPartnerSectionTitle}</small>
                                                {Object.entries(
                                                    partners.filter(p => p.event_id == selectedEvent).reduce((acc, p) => {
                                                        const cat = p.category_name || 'Partners';
                                                        if (!acc[cat]) acc[cat] = [];
                                                        acc[cat].push(p);
                                                        return acc;
                                                    }, {})
                                                ).map(([category, catPartners]) => (
                                                    <div key={category} className="mt-3">
                                                        <div style={{ fontSize: `${exportPartnerCatSize / 2}px`, fontWeight: exportPartnerCatWeight, color: exportPartnerCatColor, marginBottom: '5px' }}>{category}</div>
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '15px', alignItems: 'center' }}>
                                                            {catPartners.slice(0, 6).map(p => (
                                                                <div key={p.id} style={{ background: `${exportTextColor}05`, padding: '8px', borderRadius: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                                                                    {p.logo_url ? (
                                                                        <img src={getImageUrl(p.logo_url)} alt={p.name} style={{ height: `${exportPartnerLogoSize / 2.5}px`, maxWidth: '60px', objectFit: 'contain' }} />
                                                                    ) : (
                                                                        <span style={{ fontSize: '0.65rem', color: exportTextColor, fontWeight: 600 }}>{p.name}</span>
                                                                    )}
                                                                </div>
                                                            ))}
                                                            {catPartners.length > 6 && <span style={{ fontSize: '0.5rem', color: `${exportTextColor}88` }}>+{catPartners.length - 6}</span>}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {exportFooterImage && (
                                            <div style={{ marginTop: '15px', marginLeft: '-50px', marginRight: '-50px', marginBottom: '-50px' }}>
                                                <img src={getImageUrl(exportFooterImage)} alt="Footer" style={{ width: '100%', height: 'auto', display: 'block' }} />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </Modal.Body>
                <Modal.Footer className="border-top border-secondary bg-darker d-flex justify-content-between align-items-center py-3 px-4">
                    <div className="d-flex align-items-center gap-3">
                        <Button
                            variant="success"
                            className="d-flex align-items-center gap-2 px-4"
                            onClick={handleSaveDesign}
                            disabled={savingDesign || !exportSettingsHydrated}
                        >
                            {savingDesign ? (
                                <><Spinner size="sm" animation="border" /> Saving…</>
                            ) : (
                                <><BsCheckCircleFill size={16} /> Save Design</>
                            )}
                        </Button>
                        {designSavedAt && !savingDesign && (
                            <span style={{ fontSize: '0.75rem', color: '#13d999' }}>
                                Saved {new Date(designSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        )}
                    </div>
                    <div className="d-flex gap-3">
                        <Button
                            className="btn-accent d-flex align-items-center gap-2 px-4"
                            onClick={() => handleExport('image')}
                            disabled={!!exporting}
                        >
                            {exporting === 'image'
                                ? <><Spinner animation="border" size="sm" /> Exporting…</>
                                : <><BsImage size={18} /> Export as PNG</>}
                        </Button>
                        <Button
                            className="btn-accent d-flex align-items-center gap-2 px-4"
                            onClick={() => handleExport('pdf')}
                            disabled={!!exporting}
                        >
                            {exporting === 'pdf'
                                ? <><Spinner animation="border" size="sm" /> Exporting…</>
                                : <><BsFileEarmarkPdf size={18} /> Export as PDF</>}
                        </Button>
                    </div>
                </Modal.Footer>
            </Modal>

            {/* Saved Design Preview Modal */}
            <Modal show={showSavedPreview} onHide={() => setShowSavedPreview(false)} size="lg" centered contentClassName="premium-modal">
                <Modal.Header closeButton closeVariant="white">
                    <Modal.Title className="text-white d-flex align-items-center gap-2" style={{ fontSize: '1rem' }}>
                        <BsCheckCircleFill style={{ color: '#13d999' }} />
                        Last Saved Agenda Design
                        {designSavedAt > 1 && (
                            <span style={{ fontSize: '0.72rem', fontWeight: 500, color: 'var(--text-muted)', marginLeft: 8 }}>
                                · {new Date(designSavedAt).toLocaleString([], { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                        )}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body style={{ background: '#0c0c46', padding: 20, maxHeight: '75vh', overflowY: 'auto' }}>
                    {savedPreviewLoading && (
                        <div className="text-center py-5">
                            <Spinner animation="border" variant="light" />
                            <p className="mt-3 text-white mb-0" style={{ fontSize: '0.85rem' }}>Rendering last saved design…</p>
                        </div>
                    )}
                    {!savedPreviewLoading && savedPreviewDataUrl && (
                        <img
                            src={savedPreviewDataUrl}
                            alt="Saved agenda design preview"
                            style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 8, boxShadow: '0 10px 40px rgba(0,0,0,0.4)' }}
                        />
                    )}
                    {!savedPreviewLoading && !savedPreviewDataUrl && (
                        <div className="text-center py-5 text-white">No preview available.</div>
                    )}
                </Modal.Body>
                <Modal.Footer className="border-top border-secondary d-flex justify-content-between py-3 px-4">
                    <Button variant="outline-light" onClick={() => setShowSavedPreview(false)}>Close</Button>
                    {savedPreviewDataUrl && (
                        <div className="d-flex gap-2">
                            <Button
                                variant="outline-success"
                                onClick={() => {
                                    const link = document.createElement('a');
                                    link.download = `agenda-${selectedEvent}-preview.png`;
                                    link.href = savedPreviewDataUrl;
                                    link.click();
                                }}
                                className="d-flex align-items-center gap-2"
                            >
                                <BsImage size={14} /> Download PNG
                            </Button>
                            <Button
                                variant="outline-danger"
                                onClick={() => handleExport('pdf')}
                                className="d-flex align-items-center gap-2"
                                disabled={!!exporting}
                            >
                                {exporting === 'pdf'
                                    ? <><Spinner animation="border" size="sm" /> Exporting…</>
                                    : <><BsFileEarmarkPdf size={14} /> Download PDF</>}
                            </Button>
                            <Button
                                className="btn-accent d-flex align-items-center gap-2"
                                onClick={() => { setShowSavedPreview(false); setShowCustomizer(true); }}
                            >
                                <BsPencil size={14} /> Edit Design
                            </Button>
                        </div>
                    )}
                </Modal.Footer>
            </Modal>
        </div>
    );
}

const highlightColor = 'var(--accent)';
