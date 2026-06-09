import axios from 'axios';

const API_BASE =
    import.meta.env.VITE_API_URL?.trim() ||
    (import.meta.env.DEV ? '/api' : 'https://ap.eletsonline.com/api');

const api = axios.create({
    baseURL: API_BASE
});

// Attach token to every request
api.interceptors.request.use(config => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
}, error => {
    return Promise.reject(error);
});

api.interceptors.response.use(response => {
    return response;
}, error => {
    return Promise.reject(error);
});

// Social (declared up front; full block lives below)
export const listSocialPlatforms = () => api.get('/social/platforms');

// Auth
export const checkEmail = (email) => api.post('/auth/check-email', { email });
export const loginUser = (email, password) => api.post('/auth/login', { email, password });
export const signupTenant = (data) => api.post('/auth/signup', data);

// Tenant
export const getMyTenant = () => api.get('/tenants/me');
export const updateMyTenant = (data) => api.put('/tenants/me', data);
export const uploadTenantLogo = (file) => {
    const fd = new FormData();
    fd.append('logo', file);
    return api.post('/tenants/me/logo', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
};

// Billing
export const getPlans = () => api.get('/billing/plans');
export const getMySubscription = () => api.get('/billing/subscription');
export const checkoutPlan = (plan_code) => api.post('/billing/checkout', { plan_code });
export const verifyPayment = (data) => api.post('/billing/verify-payment', data);
export const getBillingConfig = () => api.get('/billing/config');
export const cancelSubscription = () => api.post('/billing/cancel');
export const getInvoices = () => api.get('/billing/invoices');
export const getInvoice = (id) => api.get(`/billing/invoices/${id}`);

// Platform (super admin) — cross-tenant views and actions
export const getPlatformStats = () => api.get('/platform/stats');
export const getPlatformTenants = () => api.get('/platform/tenants');
export const getPlatformTenant = (id) => api.get(`/platform/tenants/${id}`);
export const updatePlatformTenant = (id, data) => api.put(`/platform/tenants/${id}`, data);
export const deletePlatformTenant = (id, confirm) => api.delete(`/platform/tenants/${id}`, { data: { confirm } });
export const extendTenantTrial = (id, days) => api.post(`/platform/tenants/${id}/extend-trial`, { days });
export const suspendTenant = (id) => api.post(`/platform/tenants/${id}/suspend`);
export const activateTenant = (id) => api.post(`/platform/tenants/${id}/activate`);
export const changeTenantPlan = (id, plan_code) => api.post(`/platform/tenants/${id}/change-plan`, { plan_code });
export const updateTenantFeatures = (id, features) => api.put(`/platform/tenants/${id}/features`, features);
export const resetPlatformUserPassword = (userId, new_password) => api.post(`/platform/users/${userId}/reset-password`, { new_password });
export const getPlatformInvoices = () => api.get('/platform/invoices');
export const getPlatformPlans = () => api.get('/platform/plans');
export const createPlatformPlan = (data) => api.post('/platform/plans', data);
export const updatePlatformPlan = (id, data) => api.put(`/platform/plans/${id}`, data);
export const deletePlatformPlan = (id) => api.delete(`/platform/plans/${id}`);

// Recycle Bin — soft-deleted speakers/partners/awards/agendas/attendees.
// Items live for 30 days, can be restored or permanently purged early.
export const getRecycleBin = () => api.get('/recycle-bin');
export const restoreRecycleBinItem = (type, id) => api.post(`/recycle-bin/${type}/${id}/restore`);
export const purgeRecycleBinItem = (type, id) => api.delete(`/recycle-bin/${type}/${id}`);
export const emptyRecycleBin = () => api.post('/recycle-bin/empty');

// Per-employee section permissions. permissions=null restores default full
// access; pass an array of section keys (e.g. ['speakers','agendas']) to
// restrict the user to those sections only.
export const updateUserPermissions = (userId, permissions) =>
    api.put(`/users/${userId}/permissions`, { permissions });

export const getPlatformAnalytics = () => api.get('/platform/analytics');
export const getPlatformAnnouncements = () => api.get('/platform/announcements');
export const createPlatformAnnouncement = (data) => api.post('/platform/announcements', data);
export const updatePlatformAnnouncement = (id, data) => api.put(`/platform/announcements/${id}`, data);
export const deletePlatformAnnouncement = (id) => api.delete(`/platform/announcements/${id}`);
export const uploadAnnouncementPoster = (file) => {
    const fd = new FormData();
    fd.append('poster', file);
    return api.post('/platform/announcements/poster', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
};

export const getActiveAnnouncements = () => api.get('/announcements/active');
export const googleLogin = (credential) => api.post('/auth/google', { credential });
export const registerUser = (data) => api.post('/auth/register', data);
export const getCurrentUser = () => api.get('/auth/me');
export const forgotPassword = (email) => api.post('/auth/forgot-password', { email });
export const resetPassword = (token, password) => api.post('/auth/reset-password', { token, password });
export const changePassword = (data) => api.put('/auth/change-password', data);
export const inviteUser = (data) => api.post('/auth/invite', data);
export const validateInvite = (token) => api.get(`/auth/validate-invite/${token}`);
export const acceptInvite = (data) => api.post('/auth/accept-invite', data);
export const acceptExistingInvite = () => api.post('/auth/accept-invite-existing');
export const declineInvite = () => api.post('/auth/decline-invite');
export const deleteInvitation = (email, inviteId) => {
    const params = {};
    if (email) params.email = email;
    else if (inviteId) params.id = inviteId;
    return api.delete('/auth/invitation', { params });
};

// Events
export const getEvents = () => api.get('/events');
export const getEvent = (id) => api.get(`/events/${id}`);
export const getEventQrConfig = (id) => api.get(`/events/${id}/qr-config`);
export const saveEventQrConfig = (id, qr_config) => api.put(`/events/${id}/qr-config`, { qr_config });
export const createEvent = (data) => api.post('/events', data, { headers: { 'Content-Type': 'multipart/form-data' } });
export const updateEvent = (data) => {
    let id;
    if (data instanceof FormData) {
        id = data.get('id');
    } else {
        id = data.id;
    }
    return api.put(`/events/${id}`, data, { headers: { 'Content-Type': 'multipart/form-data' } });
};
export const updateEventTemplate = (id, template) => api.put(`/events/${id}/template`, { template });
// "I am attending" master template — separate column on events so the two
// card types can have independent layouts.
export const updateEventAttendingTemplate = (id, template) => api.put(`/events/${id}/attending-template`, { template });
export const bulkApplyAttendingTemplate = (id) => api.post(`/events/${id}/bulk-apply-attending-template`);
export const updateAgendaExportSettings = (id, settings) => api.put(`/events/${id}/agenda-export-settings`, { settings });
export const uploadAgendaExportImage = (id, file) => {
    const fd = new FormData();
    fd.append('image', file);
    return api.post(`/events/${id}/agenda-export-upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
};
export const bulkApplySNSTemplate = (id) => api.post(`/events/${id}/bulk-apply-sns-template`);
export const updateEventSeo = (id, data) => api.put(`/events/${id}/seo`, data);
export const deleteEvent = (id) => api.delete(`/events/${id}`);

// Forms (builder + submissions)
export const getForms = () => api.get('/forms');
export const createForm = (data) => api.post('/forms', data);
export const getForm = (id) => api.get(`/forms/${id}`);
export const updateForm = (id, data) => api.put(`/forms/${id}`, data);
export const uploadFormHeaderImage = (id, file) => {
    const fd = new FormData();
    fd.append('image', file);
    return api.post(`/forms/${id}/header-image`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
};
export const deleteForm = (id) => api.delete(`/forms/${id}`);
export const addFormField = (formId, data) => api.post(`/forms/${formId}/fields`, data);
export const updateFormField = (formId, fieldId, data) => api.put(`/forms/${formId}/fields/${fieldId}`, data);
export const deleteFormField = (formId, fieldId) => api.delete(`/forms/${formId}/fields/${fieldId}`);
export const reorderFormFields = (formId, order) => api.put(`/forms/${formId}/fields/reorder`, { order });
export const getFormSubmissions = (id) => api.get(`/forms/${id}/submissions`);
export const deleteFormSubmission = (id, subId) => api.delete(`/forms/${id}/submissions/${subId}`);
export const duplicateForm = (id) => api.post(`/forms/${id}/duplicate`);
// Bulk-certificate templates — admin/manager design + generate flow.
// Templates are scoped per (tenant, event) and store text-element layout
// in elements_json on the server.
export const getCertificateTemplates = (eventId) =>
    api.get('/certificate-templates', { params: eventId ? { event_id: eventId } : {} });
export const getCertificateTemplate = (id) => api.get(`/certificate-templates/${id}`);
export const createCertificateTemplate = (data) => api.post('/certificate-templates', data);
export const updateCertificateTemplate = (id, data) => api.put(`/certificate-templates/${id}`, data);
export const deleteCertificateTemplate = (id) => api.delete(`/certificate-templates/${id}`);
export const uploadCertificateBackground = (file) => {
    const fd = new FormData();
    fd.append('image', file);
    return api.post('/certificate-templates/upload-bg', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
    });
};

// Public (unauthenticated) — used by the /f/:id fill page
export const getPublicForm = (id) => api.get(`/forms/public/${id}`);
export const submitPublicForm = (id, data, extra = {}) =>
    api.post(`/forms/public/${id}/submit`, { data, ...extra });

// SMTP / email settings (per organization)
export const getSmtpSettings = () => api.get('/smtp/settings');
export const updateSmtpSettings = (data) => api.put('/smtp/settings', data);
export const testSmtpSettings = (sendTest = false) => api.post('/smtp/settings/test', { send_test: !!sendTest });

// Razorpay / payments
export const getPaymentSettings = () => api.get('/payments/settings');
export const updatePaymentSettings = (data) => api.put('/payments/settings', data);
export const testPaymentSettings = () => api.post('/payments/settings/test');
export const createFormPaymentOrder = (form_id, { tier_label = null, award_category_id = null, data = null } = {}) =>
    api.post('/payments/public/order', { form_id, tier_label, award_category_id, data });
export const verifyFormPayment = (payload) => api.post('/payments/public/verify', payload);
export const updateFormPaymentStatus = (razorpay_order_id, status, reason = null) =>
    api.post('/payments/public/payment-status', { razorpay_order_id, status, reason });
// Retry-link flow (admin shares /pay/:token with a visitor whose attempt failed/cancelled).
export const getPaymentRetryInfo = (token) => api.get(`/payments/public/retry/${token}`);
export const createPaymentRetryOrder = (token) => api.post(`/payments/public/retry/${token}/order`);
export const verifyPaymentRetry = (token, payload) => api.post(`/payments/public/retry/${token}/verify`, payload);
export const uploadPublicFormFile = (id, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/forms/public/${id}/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
};

// Speakers
export const getSpeakers = (eventId) => api.get('/speakers' + (eventId ? `?event_id=${eventId}` : ''));
export const getSpeaker = (id) => api.get(`/speakers/${id}`);
export const createSpeaker = (data) => api.post('/speakers', data);
export const updateSpeaker = (data) => {
    let id;
    if (data instanceof FormData) {
        id = data.get('id');
    } else {
        id = data.id;
    }
    return api.put(`/speakers/${id}`, data);
};
export const deleteSpeaker = (id) => api.delete(`/speakers/${id}`);
export const reorderSpeakers = (updates) => api.put('/speakers/reorder', { updates });
// Toggle whether a speaker is included in the public /api/public/speakers JSON.
// Pass `hidden: true|false` to set explicitly, or omit to flip the current state.
export const setSpeakerVisibility = (id, hidden) =>
    api.put(`/speakers/${id}/visibility`, hidden === undefined ? {} : { hidden });
export const createQuickSpeaker = (formData) => api.post('/speakers/quick', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
export const getMediaLibrary = (eventId) => api.get('/speakers/media/library' + (eventId ? `?event_id=${eventId}` : ''));
export const bulkDeleteSpeakers = (ids) => api.post('/speakers/delete-bulk', { ids });
export const exportSpeakers = (eventId) => api.get(`/speakers/export?t=${Date.now()}${eventId ? `&event_id=${eventId}` : ''}`, { responseType: 'blob' });
export const importSpeakers = (formData, eventId) => api.post(`/speakers/import${eventId ? `?event_id=${eventId}` : ''}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
export const importSpeakersFromGSheet = (url, eventId) => api.post('/speakers/import-gsheet', { url, event_id: eventId || null });

// SNS Card Saving
export const saveSNSCard = (id, formData, designMetadata) => {
    if (designMetadata) formData.append('design_metadata', JSON.stringify(designMetadata));
    return api.post(`/speakers/${id}/save-sns`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
};
export const deleteSNSCard = (id) => api.delete(`/speakers/${id}/sns-card`);

// "I am attending" card — separate persistence so it doesn't overwrite the
// speaker-announcement card. Same FormData contract as saveSNSCard.
export const saveAttendingCard = (id, formData, designMetadata) => {
    if (designMetadata) formData.append('design_metadata', JSON.stringify(designMetadata));
    return api.post(`/speakers/${id}/save-attending-card`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });
};
export const deleteAttendingCard = (id) => api.delete(`/speakers/${id}/attending-card`);

// Cutout.pro proxies — single `image` part in, processed binary back.
// Caller decides what to do with the Blob (preview, re-crop, upload, etc.).
const postImageOp = (path) => (file) => {
    const fd = new FormData();
    fd.append('image', file);
    return api.post(path, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        responseType: 'blob',
    });
};
export const enhanceImage         = postImageOp('/image/enhance');
export const removeImageBackground = postImageOp('/image/remove-bg');

// Partners
export const getPartners = (eventId) => api.get('/partners');
export const getPartner = (id) => api.get(`/partners/${id}`);
export const createPartner = (data) => api.post('/partners', data, { headers: { 'Content-Type': 'multipart/form-data' } });
export const updatePartner = (data) => {
    let id;
    if (data instanceof FormData) {
        id = data.get('id');
    } else {
        id = data.id;
    }
    return api.put(`/partners/${id}`, data, { headers: { 'Content-Type': 'multipart/form-data' } });
};
export const deletePartner = (id) => api.delete(`/partners/${id}`);
export const reorderPartners = (updates) => api.put('/partners/reorder', { updates });

// Partner showcase (per-event template + theme overrides)
export const getPartnerShowcaseConfig = (eventId) => api.get(`/events/${eventId}/partner-showcase`);
export const savePartnerShowcaseConfig = (eventId, payload) => api.put(`/events/${eventId}/partner-showcase`, payload);
export const getPublicPartnerShowcase = (eventId) => api.get(`/public/partner-showcase?event_id=${eventId}`);

// Partner Categories
export const getPartnerCategories = (eventId) => api.get('/partner-categories' + (eventId ? `?event_id=${eventId}` : ''));
export const createPartnerCategory = (data) => api.post('/partner-categories', data);
export const updatePartnerCategory = (data) => api.put(`/partner-categories/${data.id}`, data);
export const deletePartnerCategory = (id) => api.delete(`/partner-categories/${id}`);

// Awards
export const getAwards = () => api.get('/awards');
export const getAward = (id) => api.get(`/awards/${id}`);
export const createAward = (data) => api.post('/awards', data, { headers: { 'Content-Type': 'multipart/form-data' } });
export const updateAward = (data) => {
    let id;
    if (data instanceof FormData) {
        id = data.get('id');
    } else {
        id = data.id;
    }
    return api.put(`/awards/${id}`, data, { headers: { 'Content-Type': 'multipart/form-data' } });
};
export const deleteAward = (id) => api.delete(`/awards/${id}`);

// Award Categories
export const getAwardCategories = (eventId) => api.get('/award-categories' + (eventId ? `?event_id=${eventId}` : ''));
export const createAwardCategory = (data) => api.post('/award-categories', data);
export const updateAwardCategory = (data) => api.put(`/award-categories/${data.id}`, data);
export const deleteAwardCategory = (id) => api.delete(`/award-categories/${id}`);

// Agendas
// Without an eventId, lists all agendas across the tenant (powers the dashboard);
// with an eventId, returns just that event's agendas.
export const getAgendas = (eventId) => api.get(eventId ? `/agendas/${eventId}` : '/agendas');
export const createAgenda = (data) => api.post('/agendas', data);
export const updateAgenda = (data) => api.put(`/agendas/${data.id}`, data);
export const deleteAgenda = (id) => api.delete(`/agendas/${id}`);
export const reorderAgendas = (updates) => api.put('/agendas/reorder', { updates });
export const getSpeakerAgendas = (id) => api.get(`/agendas/speaker/${id}`);

// Users
export const getUsers = () => api.get('/users');
export const updateUser = (data) => api.put(`/users/${data.id}`, data);
// `email`, `newPassword`, and `currentPassword` are optional. The backend
// requires `currentPassword` for both email and password changes — protects
// against session-hijack scenarios where someone with a live session
// shouldn't be able to silently reroute the sign-in address or change
// the password.
export const updateMyProfile = ({ name, photo, removePhoto, email, currentPassword, newPassword }) => {
    const fd = new FormData();
    if (name) fd.append('name', name);
    if (photo) fd.append('photo', photo);
    if (removePhoto) fd.append('remove_photo', 'true');
    if (email) fd.append('email', email);
    if (currentPassword) fd.append('current_password', currentPassword);
    if (newPassword) fd.append('new_password', newPassword);
    return api.put('/users/me', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
};
export const deleteUser = (id) => api.delete(`/users/${id}`);

// Attendees
export const getAttendees = (eventId, ticketType, status) => {
    let url = '/attendees?';
    if (eventId) url += `event_id=${eventId}&`;
    if (ticketType) url += `ticket_type=${ticketType}&`;
    if (status) url += `status=${status}&`;
    return api.get(url);
};
// Paginated variant — pass `page` and the backend switches to envelope mode
// returning { rows, total, page, pageSize, status_counts }. Used by
// AttendeesPage so we don't load 700+ rows at once. Filters object accepts
// { eventId, ticketType, status, q, page, pageSize }.
export const getAttendeesPaged = (filters = {}) => {
    const { eventId, ticketType, status, q, page = 1, pageSize = 50 } = filters;
    const params = { page, pageSize };
    if (eventId)    params.event_id    = eventId;
    if (ticketType) params.ticket_type = ticketType;
    if (status)     params.status      = status;
    if (q)          params.q           = q;
    return api.get('/attendees', { params });
};
export const getAttendee = (id) => api.get(`/attendees/${id}`);
export const createAttendee = (data) => api.post('/attendees', data);
export const updateAttendee = (data) => api.put(`/attendees/${data.id}`, data);
export const deleteAttendee = (id) => api.delete(`/attendees/${id}`);
export const sendAttendeeConfirmation = (id) => api.post(`/attendees/${id}/send-confirmation`);
export const previewAttendeeConfirmation = (id) => api.get(`/attendees/${id}/email-preview`);

// Send a generated certificate PNG to an attendee. `pngBlob` is whatever
// the canvas-renderer produced (BulkCertificatePage). Backend resolves the
// per-event email template and attaches the PNG.
export const sendAttendeeCertificate = (id, pngBlob, filename = 'certificate.png') => {
    const fd = new FormData();
    fd.append('certificate', pngBlob, filename);
    return api.post(`/attendees/${id}/send-certificate`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
};

// Per-event certificate email template (subject + body). Null payload =
// the operator hasn't customised yet, caller falls back to default.
export const getEventCertificateEmailTemplate    = (eventId) => api.get(`/events/${eventId}/certificate-email-template`);
export const updateEventCertificateEmailTemplate = (eventId, template) => api.put(`/events/${eventId}/certificate-email-template`, { template });

// Audit log of past "Send via Email" attempts for a single event. Optional
// `filters` may carry { from, to, status, q, limit } — backend returns
// { rows, counts, daily } so the history page renders chart + table from
// one request.
export const getCertificateSendLog = (eventId, filters = {}) =>
    api.get(`/events/${eventId}/certificate-send-log`, { params: filters });

// On-site check-in. Returns 200 in all three semantic cases —
// { status: 'success' | 'already' | 'invalid', ... } — so the scanner UI
// can branch on `data.status` without try/catch on transport errors.
export const checkinAttendee = (token, eventId) =>
    api.post('/attendees/checkin', { token, event_id: eventId });
export const attendeeQrUrl = (id) => `${API_BASE}/attendees/${id}/qr.png`;
export const getAttendeeReports = (eventId) =>
    api.get(`/attendees/reports/breakdown${eventId ? `?event_id=${eventId}` : ''}`);

// Confirmation email template — admin/manager can edit the wording, brand
// colour, which detail rows show, and send a test to themselves.
// `eventId` is optional. When omitted, all four hit the tenant-wide
// default template. When passed, they target that event's override:
// GET seeds the editor with the event override (or tenant default as a
// starting point), PUT/test/reset all scope to that event row.
export const getAttendeeEmailTemplate = (eventId) =>
    api.get('/attendees/email-template', { params: eventId ? { event_id: eventId } : {} });
export const saveAttendeeEmailTemplate = (template, eventId) =>
    api.put('/attendees/email-template', { template }, { params: eventId ? { event_id: eventId } : {} });
export const resetAttendeeEmailTemplate = (eventId) =>
    api.put('/attendees/email-template', { template: null }, { params: eventId ? { event_id: eventId } : {} });
export const testAttendeeEmailTemplate = (template, to, eventId) =>
    api.post('/attendees/email-template/test', { template, to, event_id: eventId || undefined });
// Upload a banner image used at the top of the confirmation email.
// Returns { url } that the caller drops into template.header_image_url.
export const uploadAttendeeEmailHeader = (file) => {
    const fd = new FormData();
    fd.append('image', file);
    return api.post('/attendees/email-template/header-image', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
    });
};
export const getAttendeeStats = () => api.get('/attendees/stats/summary');
export const exportAttendees = (eventId) => api.get(`/attendees/export?t=${Date.now()}${eventId ? `&event_id=${eventId}` : ''}`, { responseType: 'blob' });
export const importAttendees = (formData, eventId) => api.post(`/attendees/import${eventId ? `?event_id=${eventId}` : ''}`, formData, { headers: { 'Content-Type': 'multipart/form-data' } });

// Speaker Travel
export const getSpeakerTravel = (speakerId) => api.get(`/travel/speaker/${speakerId}`);
export const getAllTravel = (speakerId) => api.get('/travel' + (speakerId ? `?speaker_id=${speakerId}` : ''));
export const createTravel = (data) => api.post('/travel', data);
export const updateTravel = (data) => api.put(`/travel/${data.id}`, data);
export const deleteTravel = (id) => api.delete(`/travel/${id}`);
export const getTravelStats = () => api.get('/travel/stats/summary');

// OpenAI
export const generateAIText = (data) => api.post('/openai/generate-text', data);
export const generateAIBackground = (data) => api.post('/openai/generate-background', data);
export const autoGenerateSNS = (data) => api.post('/openai/auto-generate-sns', data);

// Notifications
export const getNotifications = () => api.get('/notifications');
export const getUnreadCount = () => api.get('/notifications/unread-count');
export const markNotificationRead = (id) => api.put(`/notifications/${id}/read`);
export const markAllNotificationsRead = () => api.put('/notifications/read-all');
export const deleteNotification = (id) => api.delete(`/notifications/${id}`);

// Settings
export const getSettings = () => api.get('/settings');
export const updateLogo = (formData) => api.post('/settings/logo', formData);
export const updateFavicon = (formData) => api.post('/settings/favicon', formData);
export const updateSetting = (key, value) => api.post('/settings', { key, value });

// Chat
export const getConversations = () => api.get('/chat/conversations');
// Message fetch supports cursor pagination:
//   getChatMessages(id)                      → latest 40
//   getChatMessages(id, { before, limit })   → older page
//   getChatMessages(id, { after })           → only deltas (for polling)
export const getChatMessages = (userId, params = {}) => api.get(`/chat/messages/${userId}`, { params });
export const sendChatMessage = (recipient_id, body, file, reply_to_id, speaker_id) => {
    const fd = new FormData();
    fd.append('recipient_id', recipient_id);
    if (body) fd.append('body', body);
    if (file) fd.append('attachment', file);
    if (reply_to_id) fd.append('reply_to_id', reply_to_id);
    if (speaker_id) fd.append('speaker_id', speaker_id);
    return api.post('/chat/messages', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
};
export const markChatRead = (userId) => api.put(`/chat/messages/read/${userId}`);
export const getChatUnreadCount = () => api.get('/chat/unread-count');
export const sendTyping = (recipient_id) => api.post('/chat/typing', { recipient_id });

// Pin + search. `scope` is a short string like "user:123" for a DM with
// user 123, or "group:456" for group 456 — matches the backend's shape.
export const togglePinMessage = (id) => api.post(`/chat/messages/${id}/pin`);
export const getPinnedMessages = (scope) => api.get('/chat/pins', { params: { scope } });
export const searchChatMessages = (scope, q) => api.get('/chat/search', { params: { scope, q } });
export const clearChatForMe = (scope) => api.post('/chat/clear', { scope });
export const getTyping = (userId) => api.get(`/chat/typing/${userId}`);

// Chat groups
export const getChatGroups = () => api.get('/chat/groups');
export const createChatGroup = (data) => api.post('/chat/groups', data);
export const getChatGroup = (id) => api.get(`/chat/groups/${id}`);
export const updateChatGroup = (id, data) => api.put(`/chat/groups/${id}`, data);
export const deleteChatGroup = (id) => api.delete(`/chat/groups/${id}`);
export const getGroupMessages = (id, params = {}) => api.get(`/chat/groups/${id}/messages`, { params });
export const sendGroupMessage = (id, body, file, reply_to_id, speaker_id) => {
    const fd = new FormData();
    if (body) fd.append('body', body);
    if (file) fd.append('attachment', file);
    if (reply_to_id) fd.append('reply_to_id', reply_to_id);
    if (speaker_id) fd.append('speaker_id', speaker_id);
    return api.post(`/chat/groups/${id}/messages`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
};
export const markGroupRead = (id) => api.put(`/chat/groups/${id}/read`);
export const getGroupMedia = (id) => api.get(`/chat/groups/${id}/media`);
export const updateGroupPhoto = (id, file) => {
    const fd = new FormData();
    fd.append('photo', file);
    return api.put(`/chat/groups/${id}/photo`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
};
export const addGroupMembers = (id, user_ids) => api.post(`/chat/groups/${id}/members`, { user_ids });
export const removeGroupMember = (id, userId) => api.delete(`/chat/groups/${id}/members/${userId}`);
export const deleteChatMessage = (id, scope) => api.delete(`/chat/messages/${id}?scope=${scope}`);
export const reactToMessage = (id, emoji) => api.post(`/chat/messages/${id}/react`, { emoji });
export const forwardMessage = (id, targets) => api.post(`/chat/messages/${id}/forward`, { targets });

// Social publishing (per-tenant). Phase 1: connect/disconnect + create post.
export const listSocialAccounts = () => api.get('/social/accounts');
export const startSocialConnect = (platform) => api.post(`/social/connect/${platform}/start`);
export const disconnectSocialAccount = (id) => api.delete(`/social/accounts/${id}`);
export const createSocialPost = (payload) => api.post('/social/posts', payload);
export const listSocialPosts = () => api.get('/social/posts');

export default api;
