import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import TenantSettingsPage from './pages/TenantSettingsPage';
import BillingPage from './pages/BillingPage';
import DashboardPage from './pages/DashboardPage';
import EventsPage from './pages/EventsPage';
import SpeakersPage from './pages/SpeakersPage';
import PartnersPage from './pages/PartnersPage';
import PartnerCategoriesPage from './pages/PartnerCategoriesPage';
import AwardsPage from './pages/AwardsPage';
import AwardCategoriesPage from './pages/AwardCategoriesPage';
import AgendasPage from './pages/AgendasPage';
import UsersPage from './pages/UsersPage';
import SpeakerFormPage from './pages/SpeakerFormPage';
import SNSGeneratorPage from './pages/SNSGeneratorPage';
import SnsSharePage from './pages/SnsSharePage';
import EventSNSTemplatePage from './pages/EventSNSTemplatePage';
import AttendeesPage from './pages/AttendeesPage';
import SpeakerTravelPage from './pages/SpeakerTravelPage';
import AcceptInvitePage from './pages/AcceptInvitePage';
import AdminSettingsPage from './pages/AdminSettingsPage';
import SocialAccountsPage from './pages/SocialAccountsPage';
import PaymentSettingsPage from './pages/PaymentSettingsPage';
import MediaLibraryPage from './pages/MediaLibraryPage';
import EventDetailPage from './pages/EventDetailPage';
import EventQRPage from './pages/EventQRPage';
import CheckInScannerPage from './pages/CheckInScannerPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import SpeakerViewPage from './pages/SpeakerViewPage';
import PartnerViewPage from './pages/PartnerViewPage';
import FormsPage from './pages/FormsPage';
import FormBuilderPage from './pages/FormBuilderPage';
import FormSubmissionsPage from './pages/FormSubmissionsPage';
import PublicFormPage from './pages/PublicFormPage';
import PartnerShowcasePage from './pages/PartnerShowcasePage';
import PaymentRetryPage from './pages/PaymentRetryPage';
import BulkCertificatePage from './pages/BulkCertificatePage';
import AttendeeEmailTemplatePage from './pages/AttendeeEmailTemplatePage';
import CertificateEmailTemplatePage from './pages/CertificateEmailTemplatePage';
import CertificateSendHistoryPage from './pages/CertificateSendHistoryPage';
import RecycleBinPage from './pages/RecycleBinPage';
import {
    PlatformDashboardPage, PlatformOrganizationsPage,
    PlatformInvoicesPage, PlatformPlansPage, PlatformAnnouncementsPage,
    PlatformProfilePage, PlatformBrandingPage,
} from './pages/PlatformConsolePage';
import 'bootstrap/dist/css/bootstrap.min.css';

function ProtectedRoute({ children, roles, superAdminOnly, requireFeature, requireSection }) {
    const { user, loading } = useAuth();
    if (loading) return null;
    if (!user) return <Navigate to="/login" replace />;
    const home = user.is_super_admin ? '/platform' : '/dashboard';
    if (superAdminOnly && !user.is_super_admin) return <Navigate to={home} replace />;
    // Super admins shouldn't see tenant-scoped pages — even if they URL-type
    // their way there — because their tenant_id is NULL, all queries come
    // back empty. Bounce them to the Platform Console. The outer layout route
    // itself isn't marked superAdminOnly, so we only redirect routes that
    // scope by role (i.e. real tenant pages).
    if (roles && user.is_super_admin) return <Navigate to={home} replace />;
    if (roles && !roles.includes(user.role)) return <Navigate to={home} replace />;
    // Per-tenant feature flag — when super admin has switched the feature off
    // for this org, deep links bounce home instead of rendering a page that'll
    // 403 on every request anyway.
    if (requireFeature && user[requireFeature] === false) return <Navigate to={home} replace />;
    // Per-employee section gate. permissions=null = full default access; an
    // array of section keys narrows the employee to just those sections.
    // Admins/managers always pass.
    if (requireSection && user.role === 'employee' && Array.isArray(user.permissions) && !user.permissions.includes(requireSection)) {
        return <Navigate to={home} replace />;
    }
    return children;
}

function AppRoutes() {
    const { user } = useAuth();
    return (
        <Routes>
            <Route path="/login" element={user ? <Navigate to={user.is_super_admin ? '/platform' : '/dashboard'} replace /> : <LoginPage />} />
            <Route path="/signup" element={user ? <Navigate to={user.is_super_admin ? '/platform' : '/dashboard'} replace /> : <LoginPage />} />
            <Route path="/accept-invite/:token" element={user ? <Navigate to={user.is_super_admin ? '/platform' : '/dashboard'} replace /> : <AcceptInvitePage />} />
            <Route path="/reset-password/:token" element={<ResetPasswordPage />} />

            {/* Public form fill page — unauthenticated, no AppLayout chrome. */}
            <Route path="/f/:id" element={<PublicFormPage />} />
            {/* Public partner showcase page — operator-styled hosted view of
                an event's partners. No auth, no admin chrome. */}
            <Route path="/partners/:eventId" element={<PartnerShowcasePage />} />
            {/* Public payment-retry link shared with a visitor whose attempt failed. */}
            <Route path="/pay/:token" element={<PaymentRetryPage />} />

            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
                <Route path="/" element={<Navigate to={user?.is_super_admin ? '/platform' : '/dashboard'} replace />} />
                <Route path="/dashboard" element={user?.is_super_admin ? <Navigate to="/platform" replace /> : <DashboardPage />} />
                <Route path="/events" element={<EventsPage />} />
                <Route path="/events/sns-template/:id" element={<ProtectedRoute roles={['admin', 'manager']}><EventSNSTemplatePage cardType="speaker" /></ProtectedRoute>} />
                <Route path="/events/attending-template/:id" element={<ProtectedRoute roles={['admin', 'manager']}><EventSNSTemplatePage cardType="attending" /></ProtectedRoute>} />
                <Route path="/events/:id/web" element={<ProtectedRoute roles={['admin', 'manager']}><EventDetailPage /></ProtectedRoute>} />
                <Route path="/events/:id/qr" element={<ProtectedRoute roles={['admin', 'manager']}><EventQRPage /></ProtectedRoute>} />
                <Route path="/events/:id/checkin" element={<ProtectedRoute requireSection="attendees"><CheckInScannerPage /></ProtectedRoute>} />
                <Route path="/speakers" element={<ProtectedRoute requireSection="speakers"><SpeakersPage /></ProtectedRoute>} />
                <Route path="/speakers/add" element={<ProtectedRoute requireSection="speakers"><SpeakerFormPage /></ProtectedRoute>} />
                <Route path="/speakers/edit/:id" element={<ProtectedRoute requireSection="speakers"><SpeakerFormPage /></ProtectedRoute>} />
                <Route path="/speakers/view/:id" element={<ProtectedRoute requireSection="speakers"><SpeakerViewPage /></ProtectedRoute>} />
                <Route path="/speakers/sns/:id" element={<ProtectedRoute requireSection="speakers"><SNSGeneratorPage cardType="speaker" /></ProtectedRoute>} />
                <Route path="/speakers/attending/:id" element={<ProtectedRoute requireSection="speakers"><SNSGeneratorPage cardType="attending" /></ProtectedRoute>} />
                <Route path="/speakers/share/:id" element={<ProtectedRoute requireSection="speakers"><SnsSharePage /></ProtectedRoute>} />
                <Route path="/partners" element={<ProtectedRoute requireSection="partners"><PartnersPage /></ProtectedRoute>} />
                <Route path="/partners/view/:id" element={<ProtectedRoute requireSection="partners"><PartnerViewPage /></ProtectedRoute>} />
                <Route path="/partner-categories" element={<ProtectedRoute requireSection="partners"><PartnerCategoriesPage /></ProtectedRoute>} />
                <Route path="/awards" element={<ProtectedRoute requireSection="awards"><AwardsPage /></ProtectedRoute>} />
                <Route path="/award-categories" element={<ProtectedRoute requireSection="awards"><AwardCategoriesPage /></ProtectedRoute>} />
                <Route path="/agendas" element={<ProtectedRoute requireSection="agendas"><AgendasPage /></ProtectedRoute>} />
                <Route path="/attendees" element={<ProtectedRoute requireSection="attendees"><AttendeesPage /></ProtectedRoute>} />
                <Route path="/attendees/email-template" element={<ProtectedRoute roles={['admin', 'manager']} requireSection="attendees"><AttendeeEmailTemplatePage /></ProtectedRoute>} />
                <Route path="/forms" element={<ProtectedRoute roles={['admin', 'manager']}><FormsPage /></ProtectedRoute>} />
                <Route path="/forms/:id/edit" element={<ProtectedRoute roles={['admin', 'manager']}><FormBuilderPage /></ProtectedRoute>} />
                <Route path="/forms/:id/submissions" element={<ProtectedRoute roles={['admin', 'manager']}><FormSubmissionsPage /></ProtectedRoute>} />
                <Route path="/travel" element={<ProtectedRoute requireSection="travel"><SpeakerTravelPage /></ProtectedRoute>} />
                <Route path="/media" element={<ProtectedRoute requireSection="speakers"><MediaLibraryPage /></ProtectedRoute>} />
                <Route path="/users" element={<ProtectedRoute roles={['admin', 'manager']}><UsersPage /></ProtectedRoute>} />
                <Route path="/settings" element={<ProtectedRoute roles={['admin']}><AdminSettingsPage /></ProtectedRoute>} />
                <Route path="/payment-settings" element={<ProtectedRoute roles={['admin']}><PaymentSettingsPage /></ProtectedRoute>} />
                <Route path="/organization" element={<ProtectedRoute roles={['admin', 'manager']}><TenantSettingsPage /></ProtectedRoute>} />
                <Route path="/social-accounts" element={<ProtectedRoute roles={['admin', 'manager']}><SocialAccountsPage /></ProtectedRoute>} />
                <Route path="/billing" element={<ProtectedRoute roles={['admin', 'manager']}><BillingPage /></ProtectedRoute>} />
                <Route path="/tools/bulk-certificate" element={<ProtectedRoute roles={['admin', 'manager']} requireFeature="bulk_certificate_enabled"><BulkCertificatePage /></ProtectedRoute>} />
                <Route path="/events/:eventId/certificate-email-template" element={<ProtectedRoute roles={['admin', 'manager']} requireFeature="bulk_certificate_enabled"><CertificateEmailTemplatePage /></ProtectedRoute>} />
                <Route path="/events/:eventId/certificate-send-history" element={<ProtectedRoute roles={['admin', 'manager']} requireFeature="bulk_certificate_enabled"><CertificateSendHistoryPage /></ProtectedRoute>} />
                <Route path="/recycle-bin" element={<ProtectedRoute roles={['admin', 'manager']}><RecycleBinPage /></ProtectedRoute>} />
                <Route path="/platform" element={<Navigate to="/platform/dashboard" replace />} />
                <Route path="/platform/dashboard" element={<ProtectedRoute superAdminOnly><PlatformDashboardPage /></ProtectedRoute>} />
                <Route path="/platform/organizations" element={<ProtectedRoute superAdminOnly><PlatformOrganizationsPage /></ProtectedRoute>} />
                <Route path="/platform/invoices" element={<ProtectedRoute superAdminOnly><PlatformInvoicesPage /></ProtectedRoute>} />
                <Route path="/platform/plans" element={<ProtectedRoute superAdminOnly><PlatformPlansPage /></ProtectedRoute>} />
                <Route path="/platform/announcements" element={<ProtectedRoute superAdminOnly><PlatformAnnouncementsPage /></ProtectedRoute>} />
                <Route path="/platform/profile" element={<ProtectedRoute superAdminOnly><PlatformProfilePage /></ProtectedRoute>} />
                <Route path="/platform/branding" element={<ProtectedRoute superAdminOnly><PlatformBrandingPage /></ProtectedRoute>} />
            </Route>

            <Route path="*" element={<Navigate to={user?.is_super_admin ? '/platform' : '/dashboard'} />} />
        </Routes>
    );
}

function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <AppRoutes />
            </AuthProvider>
        </BrowserRouter>
    );
}

export default App;
