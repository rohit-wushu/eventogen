import { useCallback, useEffect, useRef, useState } from 'react';
import {
    BsLinkedin,
    BsCheckCircleFill, BsExclamationTriangleFill, BsPlugFill, BsTrash,
    BsChevronDown, BsChevronUp,
} from 'react-icons/bs';
import {
    listSocialAccounts, startSocialConnect, disconnectSocialAccount,
    listSocialPlatforms,
} from '../services/api';
import AsyncButton from '../components/AsyncButton';

// Per-tenant social account manager. Admins + managers see their tenant's
// connected accounts here. Only LinkedIn is wired up today — Facebook,
// Instagram, and X will be added in later phases.
//
// LinkedIn OAuth flow:
//   1. POST /social/connect/linkedin/start → returns { authUrl }
//   2. We open `authUrl` in a popup window
//   3. LinkedIn redirects back to /api/social/callback/linkedin which posts
//      a `social_connect_result` message to window.opener
//   4. We listen for that postMessage and refetch accounts

const PLATFORMS = [
    {
        key: 'linkedin', label: 'LinkedIn', Icon: BsLinkedin, tone: '#0A66C2',
        blurb: 'Post to your personal feed.',
        envHint: 'LINKEDIN_CLIENT_ID + LINKEDIN_CLIENT_SECRET',
        setup: [
            ['Register a LinkedIn app at', 'https://www.linkedin.com/developers/apps'],
            ['Request products: Sign In with LinkedIn using OpenID Connect + Share on LinkedIn'],
            ['Add OAuth 2.0 redirect URL: ', '/api/social/callback/linkedin'],
            ['Copy Client ID + Secret → backend/.env as LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET'],
            ['Restart the backend.'],
        ],
    },
];

export default function SocialAccountsPage() {
    const [accounts, setAccounts] = useState([]);
    const [configured, setConfigured] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [toastMsg, setToastMsg] = useState('');
    const [expandedSetup, setExpandedSetup] = useState(null);
    const popupRef = useRef(null);

    const fetchAll = useCallback(async () => {
        try {
            const [acctRes, platRes] = await Promise.all([
                listSocialAccounts(),
                listSocialPlatforms().catch(() => ({ data: { configured: {} } })),
            ]);
            setAccounts(acctRes.data || []);
            setConfigured(platRes.data?.configured || {});
        } catch (err) {
            setError(err?.response?.data?.error || 'Could not load accounts.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    // Listen for the OAuth popup's postMessage. We only trust messages
    // whose `type` matches our protocol — other extensions / iframes might
    // be sending postMessages too.
    useEffect(() => {
        const onMessage = (e) => {
            if (e?.data?.type !== 'social_connect_result') return;
            if (e.data.status === 'ok') {
                setToastMsg(e.data.message || 'Account connected.');
                fetchAll();
            } else {
                setError(e.data.message || 'Connection failed.');
            }
            try { popupRef.current?.close(); } catch { /* ignore */ }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [fetchAll]);

    const handleConnect = async (platform) => {
        setError(''); setToastMsg('');
        try {
            const { data } = await startSocialConnect(platform);
            if (!data.authUrl) {
                setError('Server did not return an auth URL.');
                return;
            }
            // We open SYNCHRONOUSLY in response to the user click so popup
            // blockers don't intervene.
            const popup = window.open(data.authUrl, 'social_oauth',
                'width=620,height=720,menubar=no,toolbar=no');
            popupRef.current = popup;
            if (!popup) {
                setError('Popup blocked. Allow popups for this site and try again.');
            }
        } catch (err) {
            setError(err?.response?.data?.error || `Failed to start ${platform} connect.`);
        }
    };

    const handleDisconnect = async (acct) => {
        if (!window.confirm(`Disconnect ${acct.account_name} (${acct.platform})?`)) return;
        await disconnectSocialAccount(acct.id);
        setToastMsg('Account disconnected.');
        fetchAll();
    };

    const callbackBaseHint = window.location.origin.replace(':5173', ':5001').replace(':5174', ':5001');

    const byPlatform = PLATFORMS.reduce((acc, p) => {
        acc[p.key] = accounts.filter(a => a.platform === p.key);
        return acc;
    }, {});

    return (
        <div style={pageStyle}>
            <div style={{ marginBottom: 22 }}>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
                    Social Accounts
                </h2>
                <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 13.5 }}>
                    Connect your organization's social profiles to publish SNS posts directly from Eventogen.
                    Each tenant manages its own accounts — yours are not visible to other tenants.
                </p>
            </div>

            {error && (
                <div style={errorBoxStyle}>
                    <BsExclamationTriangleFill /> {error}
                </div>
            )}
            {toastMsg && (
                <div style={successBoxStyle}>
                    <BsCheckCircleFill /> {toastMsg}
                </div>
            )}

            {loading ? (
                <div style={{ color: 'var(--text-secondary)' }}>Loading accounts…</div>
            ) : (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
                    gap: 14,
                }}>
                    {PLATFORMS.map(p => {
                        const list = byPlatform[p.key];
                        const Icon = p.Icon;
                        const isConfigured = !!configured[p.key];
                        const isExpanded = expandedSetup === p.key;
                        return (
                            <div key={p.key} style={cardStyle}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                                    <div style={{
                                        width: 40, height: 40, borderRadius: 10,
                                        background: p.tone, color: '#fff',
                                        display: 'grid', placeItems: 'center', flexShrink: 0,
                                    }}>
                                        <Icon size={20} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                                            {p.label}
                                        </div>
                                        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                                            {p.blurb}
                                        </div>
                                    </div>
                                    {!isConfigured && (
                                        <span style={notConfiguredBadgeStyle} title="Server credentials not set">
                                            Not configured
                                        </span>
                                    )}
                                </div>

                                {!isConfigured && (
                                    <div style={hintBoxStyle}>
                                        Platform admin needs to set <code style={inlineCodeStyle}>{p.envHint}</code> in <code style={inlineCodeStyle}>backend/.env</code>.
                                    </div>
                                )}

                                {list.length === 0 ? (
                                    <AsyncButton
                                        onClick={() => handleConnect(p.key)}
                                        className="btn"
                                        style={{ ...connectBtnStyle(p.tone), opacity: isConfigured ? 1 : 0.5, cursor: isConfigured ? 'pointer' : 'not-allowed' }}
                                        loadingText="Connecting…"
                                        disabled={!isConfigured}
                                    >
                                        <BsPlugFill style={{ marginRight: 6 }} /> Connect
                                    </AsyncButton>
                                ) : (
                                    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {list.map(a => (
                                            <div key={a.id} style={acctRowStyle}>
                                                <div style={{ minWidth: 0, flex: 1 }}>
                                                    <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {a.account_name}
                                                    </div>
                                                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                                                        {a.account_handle || a.account_kind}
                                                        {a.token_expires_soon && (
                                                            <span style={{ color: '#f59e0b', marginLeft: 6, fontWeight: 600 }}>
                                                                · expires soon
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => handleDisconnect(a)}
                                                    style={disconnectBtnStyle}
                                                    title="Disconnect"
                                                ><BsTrash size={13} /></button>
                                            </div>
                                        ))}
                                        <AsyncButton
                                            onClick={() => handleConnect(p.key)}
                                            className="btn"
                                            style={{ ...connectBtnStyle(p.tone), marginTop: 4, padding: '6px 12px', fontSize: 12, opacity: isConfigured ? 1 : 0.5, cursor: isConfigured ? 'pointer' : 'not-allowed' }}
                                            loadingText="Connecting…"
                                            disabled={!isConfigured}
                                        >
                                            + Connect another
                                        </AsyncButton>
                                    </div>
                                )}

                                <button
                                    onClick={() => setExpandedSetup(isExpanded ? null : p.key)}
                                    style={setupToggleStyle}
                                    type="button"
                                >
                                    {isExpanded ? <BsChevronUp /> : <BsChevronDown />} Setup guide
                                </button>
                                {isExpanded && (
                                    <ol style={setupListStyle}>
                                        {p.setup.map((step, i) => (
                                            <li key={i} style={{ marginBottom: 6 }}>
                                                {step.map((part, j) => {
                                                    if (typeof part === 'string' && part.startsWith('http')) {
                                                        return <a key={j} href={part} target="_blank" rel="noopener noreferrer" style={{ color: '#8b5cf6' }}>{part}</a>;
                                                    }
                                                    if (typeof part === 'string' && part.startsWith('/api/')) {
                                                        return <code key={j} style={inlineCodeStyle}>{callbackBaseHint}{part}</code>;
                                                    }
                                                    return <span key={j}>{part}</span>;
                                                })}
                                            </li>
                                        ))}
                                    </ol>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <div style={comingSoonStyle}>
                <strong style={{ color: 'var(--text-primary)' }}>Coming later:</strong> Facebook Pages, Instagram Business Accounts, and X (Twitter).
                LinkedIn is the first launch.
            </div>
        </div>
    );
}

const pageStyle = { padding: '20px 24px 60px', maxWidth: 1100, margin: '0 auto' };
const cardStyle = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 12, padding: 16,
};
const acctRowStyle = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '10px 12px', borderRadius: 8,
    background: 'var(--bg-card)',
    border: '1px solid var(--border-subtle)',
};
const connectBtnStyle = (tone) => ({
    background: tone, color: '#fff', border: 'none',
    borderRadius: 8, padding: '9px 14px',
    fontWeight: 600, fontSize: 13.5, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
});
const disconnectBtnStyle = {
    background: 'transparent', border: '1px solid var(--border-subtle)',
    color: 'var(--text-secondary)', borderRadius: 6,
    width: 28, height: 28, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
const notConfiguredBadgeStyle = {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
    color: '#f59e0b', background: 'rgba(245,158,11,0.12)',
    border: '1px solid rgba(245,158,11,0.35)',
    padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap',
};
const errorBoxStyle = {
    padding: 12, borderRadius: 10, marginBottom: 14,
    background: 'rgba(239,68,68,0.12)', color: '#fca5a5',
    border: '1px solid rgba(239,68,68,0.35)',
    display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
};
const successBoxStyle = {
    padding: 12, borderRadius: 10, marginBottom: 14,
    background: 'rgba(16,185,129,0.12)', color: '#6ee7b7',
    border: '1px solid rgba(16,185,129,0.35)',
    display: 'flex', alignItems: 'center', gap: 8, fontSize: 13,
};
const hintBoxStyle = {
    padding: 10, borderRadius: 8, marginBottom: 10,
    background: 'rgba(245,158,11,0.08)', color: 'var(--text-secondary)',
    border: '1px solid rgba(245,158,11,0.25)',
    fontSize: 12, lineHeight: 1.5,
};
const inlineCodeStyle = {
    background: 'rgba(139,92,246,0.10)', color: '#a78bfa',
    padding: '1px 6px', borderRadius: 4, fontFamily: 'ui-monospace, monospace', fontSize: 11.5,
};
const setupToggleStyle = {
    marginTop: 12, background: 'transparent', border: 'none',
    color: 'var(--text-secondary)', cursor: 'pointer',
    fontSize: 12, padding: '4px 0',
    display: 'inline-flex', alignItems: 'center', gap: 6,
};
const setupListStyle = {
    margin: '8px 0 0 20px', padding: 0,
    color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.55,
};
const comingSoonStyle = {
    marginTop: 22, padding: 14, borderRadius: 10,
    background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
    fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.55,
};
