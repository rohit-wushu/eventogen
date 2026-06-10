import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './chartSetup';
import App from './App.jsx'
import { GoogleOAuthProvider } from '@react-oauth/google';
import { bootBranding } from './hooks/useBranding';

// Apply platform branding (title, favicon, meta description) before paint.
// Fire-and-forget — the LoginPage / Dashboard also re-applies on mount via
// useBranding, but doing it here makes the tab title flicker-free.
bootBranding();

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
            <App />
        </GoogleOAuthProvider>
    </StrictMode>,
)
