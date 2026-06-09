import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';

// The emoji picker bundles its full sprite/data (~100 KB gzipped). Lazy-
// load it so it never enters the initial page payload; only the user who
// clicks the 😀 button pays the download cost.
const EmojiPicker = lazy(() => import('emoji-picker-react'));
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
    BsArrowLeft, BsLinkedin, BsInstagram, BsFacebook, BsTwitterX,
    BsFileEarmarkText, BsEye, BsSend, BsStars, BsEmojiSmile,
    BsHash, BsLink45Deg, BsBraces, BsXLg, BsAt, BsPersonPlus,
    BsHandThumbsUp, BsChatLeft, BsShare, BsSendFill,
    BsChevronUp, BsChevronDown, BsCalendar3, BsClock, BsCheck2,
} from 'react-icons/bs';
import { getSpeaker, getEvent, listSocialAccounts, createSocialPost } from '../services/api';
import { getImageUrl } from '../utils/imageUrl';
import { toAbsoluteUrl } from '../utils/shareSns';

// Each platform has its own char limit + preview chrome. Keeping the spec
// in one place so the composer footer and the preview header agree.
const PLATFORMS = {
    linkedin: { label: 'LinkedIn',    Icon: BsLinkedin,  tone: '#0A66C2', charLimit: 3000 },
    instagram:{ label: 'Instagram',   Icon: BsInstagram, tone: '#E1306C', charLimit: 2200 },
    facebook: { label: 'Facebook',    Icon: BsFacebook,  tone: '#1877F2', charLimit: 63206 },
    twitter:  { label: 'X',           Icon: BsTwitterX,  tone: '#000000', charLimit: 280 },
};

// Connected accounts are loaded per-tenant from GET /social/accounts at
// component mount. Tenants who haven't connected anything yet see the
// "Connect an account →" link that jumps to /social-accounts.

// Self-dismissing toast — small enough to inline so this file doesn't have
// to import a toast lib just for the "coming soon" stubs.
function toast(text, ms = 3000) {
    if (typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:28px', 'transform:translateX(-50%) translateY(8px)',
        'background:var(--bg-secondary)', 'color:var(--text-primary)', 'padding:11px 18px', 'border-radius:10px',
        'font-size:13px', 'font-weight:500',
        'border:1px solid var(--border-subtle)',
        'box-shadow:0 12px 32px rgba(0,0,0,0.25)',
        'z-index:99999', 'opacity:0', 'transition:opacity 0.18s, transform 0.18s',
        'max-width:min(90vw,440px)', 'text-align:center'
    ].join(';');
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateX(-50%) translateY(0)'; });
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(8px)';
        setTimeout(() => el.remove(), 200);
    }, ms);
}

// Build the default caption + hashtag block from speaker data so the editor
// opens with something useful rather than a blank field.
function defaultCaption(speaker, eventTitle) {
    if (!speaker) return '';
    const salutation = speaker.salutation ? `${speaker.salutation}. ` : '';
    const role = [speaker.designation, speaker.company].filter(Boolean).join(' at ');
    const lead = `We are excited to welcome ${salutation}${speaker.name}${role ? `, ${role}` : ''}, as a distinguished speaker at ${eventTitle || 'our event'}.`;
    const body = `Join industry leaders and innovators as we shape the future together.`;
    const eventHash = (eventTitle || '').replace(/[^a-z0-9]+/gi, '');
    const hashtags = [eventHash && `#${eventHash}`, '#SpeakerAnnouncement', '#Leadership']
        .filter(Boolean).join(' ');
    return `${lead}\n\n${body}\n\n${hashtags}`;
}

// Tokenize a caption so the preview can render hashtags + URLs + @mentions
// as accent-coloured links. `mentions` is an array of { displayName, url }
// — when a token matches `@<DisplayName>`, it renders as a real link to the
// matching profile URL. Splits on a single regex run so order is preserved.
//
// The mentions regex captures `@` followed by a name allowing spaces (up to
// a non-letter / line break), then we trim and look up the longest exact
// displayName match against the mentions list. We also support the simpler
// `@handle` form (no spaces) which just renders as a blue chip.
function renderCaption(text, mentions = []) {
    if (!text) return null;
    // Build a lookup map { lowercasedName: url } for O(1) match.
    const byName = new Map(mentions.map(m => [m.displayName.toLowerCase(), m.url]));
    // Try the longest mention first so "@Sachin Tendulkar" beats "@Sachin".
    const sortedNames = [...mentions].sort((a, b) => b.displayName.length - a.displayName.length);

    // First pass: find each @mention in the text. We do this by scanning
    // for "@" and trying each known display name as a prefix.
    const tokens = [];
    let i = 0;
    while (i < text.length) {
        const at = text.indexOf('@', i);
        if (at < 0) { tokens.push({ kind: 'text', value: text.slice(i) }); break; }
        if (at > i) tokens.push({ kind: 'text', value: text.slice(i, at) });
        // Try longest known display name match starting at `at + 1`.
        let matched = null;
        for (const m of sortedNames) {
            const candidate = text.slice(at + 1, at + 1 + m.displayName.length);
            if (candidate.toLowerCase() === m.displayName.toLowerCase()) { matched = m; break; }
        }
        if (matched) {
            tokens.push({ kind: 'mention', value: `@${matched.displayName}`, url: matched.url });
            i = at + 1 + matched.displayName.length;
        } else {
            // Fallback: simple @handle (letters/digits/underscores)
            const m = text.slice(at).match(/^@[A-Za-z0-9_.]+/);
            if (m) {
                tokens.push({ kind: 'handle', value: m[0] });
                i = at + m[0].length;
            } else {
                tokens.push({ kind: 'text', value: '@' });
                i = at + 1;
            }
        }
    }

    // Second pass: split each text token further by whitespace / hashtags / URLs.
    const out = [];
    let key = 0;
    for (const t of tokens) {
        if (t.kind === 'mention') {
            out.push(<a key={key++} href={t.url} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa', fontWeight: 600 }}>{t.value}</a>);
            continue;
        }
        if (t.kind === 'handle') {
            out.push(<span key={key++} style={{ color: '#60a5fa', cursor: 'pointer' }}>{t.value}</span>);
            continue;
        }
        const parts = t.value.split(/(\s+|#[A-Za-z0-9_]+|https?:\/\/\S+)/g);
        for (const p of parts) {
            if (/^#[A-Za-z0-9_]+$/.test(p)) out.push(<span key={key++} style={{ color: '#60a5fa', cursor: 'pointer' }}>{p}</span>);
            else if (/^https?:\/\//.test(p)) out.push(<a key={key++} href={p} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa' }}>{p}</a>);
            else out.push(<span key={key++}>{p}</span>);
        }
    }
    return out;
}

// Format a date string ("2026-05-15" or ISO) → "15 May 2026". Falls back
// to the raw string when parsing fails so we never crash the preview.
function formatEventDate(raw) {
    if (!raw) return '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return String(raw);
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

// Replace every {{token}} in `text` with the matching value from `data`.
// Unknown tokens are left in place so a typo doesn't silently vanish — the
// operator notices the still-bracketed text in the preview and fixes it.
function substituteVariables(text, data) {
    if (!text) return text;
    return String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (full, key) => {
        const val = data[key];
        return val == null || val === '' ? full : String(val);
    });
}

// Create Post composer — replaces the small share-buttons page. UI-only
// for now: the Publish / Schedule / Save Draft / AI / Connect actions all
// surface "coming soon" toasts pending the backend integrations.
export default function SnsSharePage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const [speaker, setSpeaker] = useState(null);
    const [eventDetails, setEventDetails] = useState(null);  // full event row for date/venue substitution
    const [snsUrl, setSnsUrl] = useState(location.state?.snsUrl || '');
    const [eventTitle, setEventTitle] = useState(location.state?.eventTitle || '');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Composer state
    const [activeTab, setActiveTab] = useState('linkedin');
    const [caption, setCaption] = useState('');
    const [mediaIncluded, setMediaIncluded] = useState(true);

    // Composer toolbar popovers — only one open at a time. Stores the open
    // popover's key ('emoji' | 'link' | 'var' | 'mention') or null. The
    // textarea ref + selection range let us splice inserted text at the
    // cursor instead of dumb-appending it to the end.
    const [openPicker, setOpenPicker] = useState(null);
    const [linkUrl, setLinkUrl] = useState('');
    const textareaRef = useRef(null);

    // === Mentions + photo tags ===
    // Each mention/tag holds the display name, target platform, and full
    // profile URL so the preview can render them as real clickable links
    // (and so a future "publish" step can pass them to the platform APIs).
    // photoTags also carry x/y percentages relative to the image so the
    // markers stick to the same spot regardless of how the image is sized.
    const [mentions, setMentions] = useState([]);     // [{ id, displayName, platform, url }]
    const [photoTags, setPhotoTags] = useState([]);   // [{ id, x, y, displayName, platform, url }]
    const [mentionDraft, setMentionDraft] = useState({ displayName: '', platform: 'instagram', url: '' });
    const [tagDraft, setTagDraft] = useState(null);   // { x, y, displayName, platform, url } | null

    // Build a profile URL from a bare handle when the user gave just "@foo"
    // (instagram), "facebook.com/foo", or a full URL. Idempotent on full URLs.
    const normaliseProfileUrl = (platform, raw) => {
        const v = String(raw || '').trim();
        if (!v) return '';
        if (/^https?:\/\//i.test(v)) return v;
        const handle = v.replace(/^@/, '').replace(/^\/+/, '');
        switch (platform) {
            case 'instagram': return `https://instagram.com/${handle}`;
            case 'facebook':  return `https://facebook.com/${handle}`;
            case 'linkedin':  return `https://linkedin.com/in/${handle}`;
            case 'twitter':   return `https://twitter.com/${handle}`;
            default: return v;
        }
    };

    const addMention = () => {
        const name = mentionDraft.displayName.trim();
        const url = normaliseProfileUrl(mentionDraft.platform, mentionDraft.url);
        if (!name || !url) return;
        const id = `m_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        setMentions(prev => [...prev, { id, displayName: name, platform: mentionDraft.platform, url }]);
        insertAtCursor(`@${name} `);
        setMentionDraft({ displayName: '', platform: mentionDraft.platform, url: '' });
        setOpenPicker(null);
    };

    const removeMention = (id) => setMentions(prev => prev.filter(m => m.id !== id));

    // Photo tagging: clicking the SNS card image opens a small floating
    // form positioned where the user clicked. Coordinates are stored as
    // percentages so markers scale with the image. Saving the draft pushes
    // it onto photoTags and overlays a pin on the photo.
    const startPhotoTag = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        setTagDraft({ x, y, displayName: '', platform: 'instagram', url: '' });
    };
    const commitPhotoTag = () => {
        if (!tagDraft) return;
        const name = tagDraft.displayName.trim();
        const url = normaliseProfileUrl(tagDraft.platform, tagDraft.url);
        if (!name || !url) return;
        const id = `pt_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
        setPhotoTags(prev => [...prev, { id, x: tagDraft.x, y: tagDraft.y, displayName: name, platform: tagDraft.platform, url }]);
        setTagDraft(null);
    };
    const removePhotoTag = (id) => setPhotoTags(prev => prev.filter(t => t.id !== id));

    // Insert `text` at the textarea's caret (or replace its current selection)
    // and re-focus so the user can keep typing. Falls back to appending if the
    // ref isn't ready (e.g. very first keystroke before mount).
    const insertAtCursor = (text) => {
        const el = textareaRef.current;
        if (!el) { setCaption(c => c + text); return; }
        const start = el.selectionStart ?? caption.length;
        const end = el.selectionEnd ?? caption.length;
        const next = caption.slice(0, start) + text + caption.slice(end);
        setCaption(next);
        // After React commits, restore focus + place the caret at the end of
        // the inserted text. Defer with rAF so the new value is in the DOM.
        requestAnimationFrame(() => {
            const node = textareaRef.current;
            if (!node) return;
            node.focus();
            const pos = start + text.length;
            node.setSelectionRange(pos, pos);
        });
    };

    // Available substitution variables — expanded when the post actually
    // sends (today they're just literal text). Keeps composing flexible:
    // operators write one caption, recipient-specific data fills in later.
    const VARIABLES = [
        { token: '{{speaker.name}}',        label: 'Speaker name' },
        { token: '{{speaker.designation}}', label: 'Designation' },
        { token: '{{speaker.company}}',     label: 'Company' },
        { token: '{{event.title}}',         label: 'Event title' },
        { token: '{{event.date}}',          label: 'Event date' },
        { token: '{{event.venue}}',         label: 'Venue' },
    ];

    // Close any open toolbar popover on outside click / Esc so they behave
    // like normal UI elements.
    useEffect(() => {
        if (!openPicker) return;
        const onDown = (e) => {
            if (e.target.closest?.('[data-sns-popover]') || e.target.closest?.('[data-sns-popover-trigger]')) return;
            setOpenPicker(null);
        };
        const onKey = (e) => { if (e.key === 'Escape') setOpenPicker(null); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [openPicker]);

    // Settings sidebar state
    const [settingsTab, setSettingsTab] = useState('post');
    // Real connected accounts for this tenant (one row per account).
    // selectedAccountIds is a Set of social_accounts.id rows the user has
    // ticked in the Post-To list.
    const [socialAccounts, setSocialAccounts] = useState([]);
    const [accountsLoading, setAccountsLoading] = useState(true);
    const [selectedAccountIds, setSelectedAccountIds] = useState(() => new Set());

    useEffect(() => {
        listSocialAccounts()
            .then(({ data }) => {
                setSocialAccounts(data || []);
                // Default to selecting the first account (if any) so a single-
                // account tenant doesn't have to tick before publishing.
                if (data && data.length > 0) setSelectedAccountIds(new Set([data[0].id]));
            })
            .catch(err => console.warn('Could not load social accounts:', err))
            .finally(() => setAccountsLoading(false));
    }, []);
    const [when, setWhen] = useState('now'); // 'now' | 'schedule' | 'draft'
    const [scheduleDate, setScheduleDate] = useState(() => {
        const d = new Date(); d.setDate(d.getDate() + 1);
        return d.toISOString().slice(0, 10);
    });
    const [scheduleTime, setScheduleTime] = useState('10:00');
    const [advancedOpen, setAdvancedOpen] = useState(true);
    const [addFirstComment, setAddFirstComment] = useState(false);
    const [addUtm, setAddUtm] = useState(false);

    // Load speaker, then seed the caption once.
    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                // getSpeaker returns the axios response — the actual speaker
                // row is in `.data`. Without unwrapping, every speaker.* field
                // is undefined and variable substitution silently no-ops.
                const res = await getSpeaker(id);
                const s = res?.data ?? res;
                if (!alive) return;
                setSpeaker(s);
                if (!snsUrl && s?.sns_card_url) setSnsUrl(s.sns_card_url);
                const titleForCaption = eventTitle || s?.event_title || '';
                if (!eventTitle && s?.event_title) setEventTitle(s.event_title);
                setCaption(prev => prev || defaultCaption(s, titleForCaption));

                // Fetch the event row separately to get date + venue (the
                // speaker payload doesn't carry them). Variable substitution
                // for {{event.date}}/{{event.venue}} depends on this. Failure
                // here isn't fatal — the tokens just stay unsubstituted.
                if (s?.event_id) {
                    try {
                        const { data: ev } = await getEvent(s.event_id);
                        if (alive) setEventDetails(ev);
                    } catch (_) { /* token-pass-through is fine */ }
                }
            } catch (err) {
                if (!alive) return;
                setError(err?.response?.data?.error || 'Could not load speaker.');
            } finally {
                if (alive) setLoading(false);
            }
        })();
        return () => { alive = false; };
    }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

    const activePlatform = PLATFORMS[activeTab];
    const charCount = caption.length;
    const overLimit = charCount > activePlatform.charLimit;

    // Build the {{token}} → value map. Memoised so the substitution doesn't
    // rebuild it on every keystroke. Tokens with no value fall through and
    // stay literal in the preview (intentional — operator notices the typo).
    const variableMap = useMemo(() => ({
        'speaker.name':        speaker?.name || '',
        'speaker.designation': speaker?.designation || '',
        'speaker.company':     speaker?.company || '',
        'event.title':         eventTitle || eventDetails?.title || '',
        'event.date':          formatEventDate(eventDetails?.start_date || eventDetails?.date),
        'event.venue':         eventDetails?.location || eventDetails?.venue || '',
    }), [speaker, eventTitle, eventDetails]);

    // Caption with variables resolved — only for the preview / outgoing post.
    // The composer textarea keeps the literal {{tokens}} so the user can
    // still edit them.
    const resolvedCaption = useMemo(() => substituteVariables(caption, variableMap), [caption, variableMap]);

    const absoluteUrl = toAbsoluteUrl(snsUrl);

    const selectedCount = selectedAccountIds.size;

    const toggleAccount = (id) => {
        setSelectedAccountIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    // === Action handlers ===
    const handleSaveDraft = async () => {
        if (selectedCount === 0) { toast('Select at least one account.'); return; }
        try {
            await createSocialPost({
                account_ids: [...selectedAccountIds],
                caption: resolvedCaption,
                image_url: mediaIncluded ? snsUrl : null,
                mentions, photo_tags: photoTags,
                speaker_id: speaker?.id,
                when: 'draft',
            });
            toast('Draft saved.');
        } catch (err) {
            toast(err?.response?.data?.error || 'Could not save draft.');
        }
    };
    const handlePreview = () => toast('Preview is already live in the middle column.');
    const handlePublish = async () => {
        if (selectedCount === 0) { toast('Select at least one account under "Post To".'); return; }
        try {
            const payload = {
                account_ids: [...selectedAccountIds],
                caption: resolvedCaption,
                image_url: mediaIncluded ? snsUrl : null,
                mentions, photo_tags: photoTags,
                speaker_id: speaker?.id,
                when,
                scheduled_for: when === 'schedule' ? `${scheduleDate}T${scheduleTime}:00` : null,
            };
            const { data } = await createSocialPost(payload);
            // Backend returns per-account results. Sum up successes / failures
            // so the toast reflects partial-success.
            const posted = data.posts.filter(p => p.status === 'posted').length;
            const scheduled = data.posts.filter(p => p.status === 'scheduled').length;
            const drafted = data.posts.filter(p => p.status === 'draft').length;
            const failed = data.posts.filter(p => p.status === 'failed');
            const parts = [];
            if (posted) parts.push(`${posted} posted`);
            if (scheduled) parts.push(`${scheduled} scheduled`);
            if (drafted) parts.push(`${drafted} drafted`);
            if (failed.length) parts.push(`${failed.length} failed`);
            toast(parts.join(' · '));
            if (failed.length) console.error('Failed publishes:', failed);
        } catch (err) {
            toast(err?.response?.data?.error || 'Publish failed.');
        }
    };
    const handleAiGenerate = () => {
        toast('AI Generate Caption — wiring to LLM soon.');
        // Cosmetic touch so the user sees something change.
        setCaption(prev => prev + '\n\n#AIGenerated');
    };
    const handleConnectAccount = () => {
        navigate('/social-accounts');
    };

    if (error) {
        return (
            <div style={{ maxWidth: 720, margin: '40px auto', padding: 24 }}>
                <button onClick={() => navigate(-1)} style={backBtnStyle}><BsArrowLeft /> Back</button>
                <div style={{ marginTop: 16, padding: 14, borderRadius: 10, background: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.35)' }}>
                    {error}
                </div>
            </div>
        );
    }

    return (
        <div style={pageStyle}>
            <style>{`
                @keyframes sns-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
                .sns-cp-tab { padding: 12px 4px; display: inline-flex; align-items: center;
                              justify-content: center; gap: 6px;
                              border: none; background: transparent; color: var(--text-secondary);
                              border-bottom: 2px solid transparent; cursor: pointer; font-size: 13px;
                              font-weight: 600; white-space: nowrap;
                              flex: 1 1 0; min-width: 0; }
                .sns-cp-tab:hover { color: var(--text-primary); }
                .sns-cp-tab.active { color: var(--text-primary); border-bottom-color: #8b5cf6; }
                .sns-cp-tab.active::after {
                    content: ''; position: absolute; left: 4px; right: 4px; bottom: -2px;
                    height: 2px; background: #8b5cf6; box-shadow: 0 0 12px rgba(139,92,246,0.45);
                }
                .sns-cp-tab { position: relative; }
                .sns-cp-icon-btn { background: transparent; border: none; color: var(--text-secondary);
                                    width: 32px; height: 32px; border-radius: 8px; cursor: pointer;
                                    display: grid; place-items: center; transition: background 0.12s, color 0.12s; }
                .sns-cp-icon-btn:hover { background: var(--bg-card-hover); color: var(--text-primary); }
                .sns-cp-acct { display: flex; align-items: center; gap: 10px; padding: 12px 12px;
                                background: var(--bg-card); border: 1px solid var(--border-subtle);
                                border-radius: 10px; cursor: pointer; transition: border-color 0.12s; }
                .sns-cp-acct.active { border-color: #8b5cf6; background: rgba(139,92,246,0.10); }
                .sns-cp-acct:hover { border-color: rgba(139,92,246,0.45); }
                .sns-cp-toggle { width: 36px; height: 20px; border-radius: 999px; background: var(--border-subtle);
                                  position: relative; cursor: pointer; transition: background 0.18s; flex-shrink: 0; }
                .sns-cp-toggle.on { background: #8b5cf6; }
                .sns-cp-toggle::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
                                        background: #fff; border-radius: 50%; transition: transform 0.18s;
                                        box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
                .sns-cp-toggle.on::after { transform: translateX(16px); }
                [data-sns-popover] button[style*="background: transparent"]:hover { background: rgba(139,92,246,0.18) !important; }
                @media (max-width: 1180px) {
                    .sns-cp-grid { grid-template-columns: 1fr 1fr !important; }
                    .sns-cp-grid > .sns-cp-preview { display: none !important; }
                }
                @media (max-width: 820px) {
                    .sns-cp-grid { grid-template-columns: 1fr !important; }
                    .sns-cp-grid > .sns-cp-settings { position: static !important; }
                }
            `}</style>

            {/* TOP BAR */}
            <div style={topBarStyle}>
                <button onClick={() => navigate(-1)} style={{ ...backBtnStyle, marginBottom: 0 }} title="Back">
                    <BsArrowLeft />
                </button>
                <div style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: 14 }}>SNS</div>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>Create Post</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                        Campaign: Speaker Announcement{speaker ? ` – ${speaker.name}` : ''}
                    </div>
                </div>
                <button onClick={handleSaveDraft} style={topActionStyle}><BsFileEarmarkText /> Save Draft</button>
                <button onClick={handlePreview} style={topActionStyle}><BsEye /> Preview</button>
                <button onClick={handlePublish} style={{ ...topActionStyle, background: '#8b5cf6', borderColor: '#8b5cf6', color: '#fff' }}>
                    <BsSend /> Publish
                </button>
            </div>

            {/* MAIN GRID */}
            <div className="sns-cp-grid" style={gridStyle}>
                {/* === COMPOSER === */}
                <div style={cardStyle}>
                    {/* Platform tabs */}
                    <div style={{
                        display: 'flex', gap: 4,
                        borderBottom: '1px solid var(--border-subtle)',
                        padding: '0 12px',
                    }}>
                        {Object.entries(PLATFORMS).map(([k, p]) => {
                            const I = p.Icon;
                            return (
                                <button key={k} className={`sns-cp-tab ${activeTab === k ? 'active' : ''}`} onClick={() => setActiveTab(k)}>
                                    <I size={14} style={{ color: activeTab === k ? p.tone : undefined, flexShrink: 0 }} /> {p.label}
                                </button>
                            );
                        })}
                    </div>

                    {/* Post content */}
                    <div style={{ padding: 20 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>Post Content</div>
                            <button onClick={handleAiGenerate} style={aiBtnStyle}>
                                <BsStars /> AI Generate Caption
                            </button>
                        </div>

                        <div style={{
                            background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
                            borderRadius: 12, overflow: 'hidden',
                        }}>
                            <textarea
                                ref={textareaRef}
                                value={caption}
                                onChange={e => setCaption(e.target.value)}
                                placeholder="Write your post…"
                                style={{
                                    width: '100%', minHeight: 220, resize: 'vertical',
                                    background: 'transparent', border: 'none', outline: 'none',
                                    color: 'var(--text-primary)', fontSize: 14, lineHeight: 1.65,
                                    padding: '14px 16px', fontFamily: 'inherit',
                                }}
                            />
                            <div style={{ display: 'flex', alignItems: 'center', padding: '6px 8px', borderTop: '1px solid var(--border-subtle)', position: 'relative' }}>
                                {/* Emoji */}
                                <div style={{ position: 'relative' }}>
                                    <button
                                        data-sns-popover-trigger
                                        className="sns-cp-icon-btn"
                                        title="Emoji"
                                        onClick={() => setOpenPicker(p => p === 'emoji' ? null : 'emoji')}
                                        style={{ background: openPicker === 'emoji' ? 'var(--bg-card-hover)' : undefined }}
                                    ><BsEmojiSmile /></button>
                                    {openPicker === 'emoji' && (
                                        <div data-sns-popover style={{ ...popoverStyle, width: 'auto', padding: 0, overflow: 'hidden' }}>
                                            <Suspense fallback={
                                                <div style={{ padding: 24, fontSize: 12, color: 'var(--text-secondary)', minWidth: 320, textAlign: 'center' }}>
                                                    Loading emoji picker…
                                                </div>
                                            }>
                                                <EmojiPicker
                                                    onEmojiClick={(d) => { insertAtCursor(d.emoji); setOpenPicker(null); }}
                                                    theme="dark"
                                                    width={340}
                                                    height={400}
                                                    searchPlaceholder="Search emoji…"
                                                    skinTonesDisabled
                                                    previewConfig={{ showPreview: false }}
                                                    autoFocusSearch
                                                    lazyLoadEmojis
                                                />
                                            </Suspense>
                                        </div>
                                    )}
                                </div>

                                {/* Hashtag — straight insert, no popover needed */}
                                <button
                                    className="sns-cp-icon-btn"
                                    title="Insert hashtag"
                                    onClick={() => insertAtCursor('#')}
                                ><BsHash /></button>

                                {/* Mention — pick a person's social profile and
                                    insert @DisplayName tied to the actual URL. */}
                                <div style={{ position: 'relative' }}>
                                    <button
                                        data-sns-popover-trigger
                                        className="sns-cp-icon-btn"
                                        title="Mention a profile (Facebook / Instagram / LinkedIn / X)"
                                        onClick={() => setOpenPicker(p => p === 'mention' ? null : 'mention')}
                                        style={{ background: openPicker === 'mention' ? 'var(--bg-card-hover)' : undefined }}
                                    ><BsAt /></button>
                                    {openPicker === 'mention' && (
                                        <div data-sns-popover style={{ ...popoverStyle, padding: 12, width: 320 }}>
                                            <div style={{ ...popoverHeaderStyle, padding: 0, marginBottom: 10 }}>Mention a profile</div>
                                            <input
                                                autoFocus
                                                value={mentionDraft.displayName}
                                                onChange={e => setMentionDraft(d => ({ ...d, displayName: e.target.value }))}
                                                placeholder="Display name (e.g. Sachin Tendulkar)"
                                                style={{ ...linkInputStyle, marginBottom: 8 }}
                                            />
                                            <select
                                                value={mentionDraft.platform}
                                                onChange={e => setMentionDraft(d => ({ ...d, platform: e.target.value }))}
                                                style={{ ...linkInputStyle, marginBottom: 8, cursor: 'pointer' }}
                                            >
                                                <option value="instagram">Instagram</option>
                                                <option value="facebook">Facebook</option>
                                                <option value="linkedin">LinkedIn</option>
                                                <option value="twitter">X (Twitter)</option>
                                            </select>
                                            <input
                                                value={mentionDraft.url}
                                                onChange={e => setMentionDraft(d => ({ ...d, url: e.target.value }))}
                                                onKeyDown={e => { if (e.key === 'Enter') addMention(); }}
                                                placeholder="@handle or full profile URL"
                                                style={linkInputStyle}
                                            />
                                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>
                                                Just the handle is fine — we'll build the URL for you.
                                            </div>
                                            <div style={{ display: 'flex', gap: 6, marginTop: 10, justifyContent: 'flex-end' }}>
                                                <button type="button" onClick={() => setOpenPicker(null)} style={ghostBtnStyle}>Cancel</button>
                                                <button
                                                    type="button"
                                                    onClick={addMention}
                                                    disabled={!mentionDraft.displayName.trim() || !mentionDraft.url.trim()}
                                                    style={{
                                                        ...primaryBtnStyle, cursor: 'pointer',
                                                        opacity: mentionDraft.displayName.trim() && mentionDraft.url.trim() ? 1 : 0.5,
                                                    }}
                                                >Add mention</button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Link */}
                                <div style={{ position: 'relative' }}>
                                    <button
                                        data-sns-popover-trigger
                                        className="sns-cp-icon-btn"
                                        title="Insert link"
                                        onClick={() => { setLinkUrl(''); setOpenPicker(p => p === 'link' ? null : 'link'); }}
                                        style={{ background: openPicker === 'link' ? 'var(--bg-card-hover)' : undefined }}
                                    ><BsLink45Deg /></button>
                                    {openPicker === 'link' && (
                                        <div data-sns-popover style={{ ...popoverStyle, padding: 12, width: 320 }}>
                                            <div style={{ ...popoverHeaderStyle, padding: 0, marginBottom: 8 }}>Insert link</div>
                                            <input
                                                autoFocus
                                                type="url"
                                                value={linkUrl}
                                                onChange={e => setLinkUrl(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter' && linkUrl.trim()) {
                                                        const u = linkUrl.trim();
                                                        const url = /^https?:\/\//i.test(u) ? u : `https://${u}`;
                                                        insertAtCursor(url);
                                                        setOpenPicker(null);
                                                    }
                                                }}
                                                placeholder="https://example.com"
                                                style={linkInputStyle}
                                            />
                                            <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
                                                <button type="button" onClick={() => setOpenPicker(null)} style={ghostBtnStyle}>Cancel</button>
                                                <button
                                                    type="button"
                                                    disabled={!linkUrl.trim()}
                                                    onClick={() => {
                                                        const u = linkUrl.trim();
                                                        const url = /^https?:\/\//i.test(u) ? u : `https://${u}`;
                                                        insertAtCursor(url);
                                                        setOpenPicker(null);
                                                    }}
                                                    style={{
                                                        ...primaryBtnStyle,
                                                        opacity: linkUrl.trim() ? 1 : 0.5,
                                                        cursor: linkUrl.trim() ? 'pointer' : 'not-allowed',
                                                    }}
                                                >Insert</button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Variables */}
                                <div style={{ position: 'relative' }}>
                                    <button
                                        data-sns-popover-trigger
                                        className="sns-cp-icon-btn"
                                        title="Insert variable"
                                        onClick={() => setOpenPicker(p => p === 'var' ? null : 'var')}
                                        style={{ background: openPicker === 'var' ? 'var(--bg-card-hover)' : undefined }}
                                    ><BsBraces /></button>
                                    {openPicker === 'var' && (
                                        <div data-sns-popover style={{ ...popoverStyle, padding: 6, width: 240 }}>
                                            <div style={popoverHeaderStyle}>Insert variable</div>
                                            {VARIABLES.map(v => (
                                                <button
                                                    key={v.token}
                                                    type="button"
                                                    onClick={() => { insertAtCursor(v.token); setOpenPicker(null); }}
                                                    style={varRowStyle}
                                                >
                                                    <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{v.label}</span>
                                                    <code style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'ui-monospace, monospace' }}>{v.token}</code>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div style={{ marginLeft: 'auto', fontSize: 12, color: overLimit ? '#ef4444' : '#94a3b8', paddingRight: 8 }}>
                                    {charCount}/{activePlatform.charLimit}
                                </div>
                            </div>
                        </div>

                        {/* Media */}
                        <div style={{ marginTop: 22 }}>
                            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', marginBottom: 10 }}>Media</div>
                            {mediaIncluded && snsUrl ? (
                                <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
                                    {/* Click anywhere on the image to start a
                                        photo tag. Cursor is a crosshair so it's
                                        clear the image is interactive. */}
                                    <img
                                        src={getImageUrl(snsUrl)}
                                        alt="SNS card"
                                        onClick={startPhotoTag}
                                        style={{ width: '100%', display: 'block', cursor: 'crosshair' }}
                                        title="Click anywhere to tag a profile here"
                                    />
                                    {/* Saved tags — round numbered pins. Hover
                                        shows the name + platform tooltip. */}
                                    {photoTags.map((t, i) => (
                                        <a
                                            key={t.id}
                                            href={t.url}
                                            target="_blank" rel="noopener noreferrer"
                                            title={`${t.displayName} · ${t.platform}`}
                                            style={photoTagPin(t.x, t.y)}
                                            onClick={e => e.stopPropagation()}
                                        >{i + 1}</a>
                                    ))}
                                    {/* In-progress tag form — appears at the
                                        click position until the user confirms or
                                        cancels. */}
                                    {tagDraft && (
                                        <div style={{
                                            position: 'absolute',
                                            left: `${Math.min(tagDraft.x, 60)}%`,
                                            top: `${Math.min(tagDraft.y, 80)}%`,
                                            background: 'var(--bg-secondary)',
                                            border: '1px solid var(--border-subtle)',
                                            borderRadius: 10, padding: 10, width: 240,
                                            boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
                                            zIndex: 5,
                                        }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 8 }}>
                                                Tag profile at this spot
                                            </div>
                                            <input
                                                autoFocus
                                                value={tagDraft.displayName}
                                                onChange={e => setTagDraft(d => ({ ...d, displayName: e.target.value }))}
                                                placeholder="Display name"
                                                style={{ ...linkInputStyle, marginBottom: 6 }}
                                            />
                                            <select
                                                value={tagDraft.platform}
                                                onChange={e => setTagDraft(d => ({ ...d, platform: e.target.value }))}
                                                style={{ ...linkInputStyle, marginBottom: 6, cursor: 'pointer' }}
                                            >
                                                <option value="instagram">Instagram</option>
                                                <option value="facebook">Facebook</option>
                                                <option value="linkedin">LinkedIn</option>
                                                <option value="twitter">X (Twitter)</option>
                                            </select>
                                            <input
                                                value={tagDraft.url}
                                                onChange={e => setTagDraft(d => ({ ...d, url: e.target.value }))}
                                                onKeyDown={e => { if (e.key === 'Enter') commitPhotoTag(); if (e.key === 'Escape') setTagDraft(null); }}
                                                placeholder="@handle or profile URL"
                                                style={linkInputStyle}
                                            />
                                            <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
                                                <button type="button" onClick={() => setTagDraft(null)} style={ghostBtnStyle}>Cancel</button>
                                                <button
                                                    type="button"
                                                    onClick={commitPhotoTag}
                                                    disabled={!tagDraft.displayName.trim() || !tagDraft.url.trim()}
                                                    style={{
                                                        ...primaryBtnStyle, cursor: 'pointer',
                                                        opacity: tagDraft.displayName.trim() && tagDraft.url.trim() ? 1 : 0.5,
                                                    }}
                                                >Tag</button>
                                            </div>
                                        </div>
                                    )}
                                    <button
                                        onClick={() => setMediaIncluded(false)}
                                        title="Remove image"
                                        style={{
                                            position: 'absolute', top: 10, right: 10,
                                            width: 30, height: 30, borderRadius: '50%',
                                            background: 'rgba(0,0,0,0.55)', border: 'none', color: '#fff',
                                            display: 'grid', placeItems: 'center', cursor: 'pointer',
                                        }}
                                    >
                                        <BsXLg size={14} />
                                    </button>
                                </div>
                            ) : (
                                <div style={{
                                    padding: 24, borderRadius: 12, border: '1px dashed var(--border-subtle)',
                                    color: 'var(--text-secondary)', textAlign: 'center', fontSize: 13,
                                }}>
                                    No image attached.{' '}
                                    {snsUrl && <button onClick={() => setMediaIncluded(true)} style={{ background: 'none', border: 'none', color: '#8b5cf6', cursor: 'pointer', fontWeight: 600 }}>Restore</button>}
                                </div>
                            )}

                            {/* Mentions + photo tags summary list — gives the
                                operator a single place to review and remove
                                everything they've attached to this post. */}
                            {(mentions.length > 0 || photoTags.length > 0) && (
                                <div style={{ marginTop: 12 }}>
                                    {mentions.length > 0 && (
                                        <div style={{ marginBottom: photoTags.length ? 10 : 0 }}>
                                            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 6 }}>
                                                Mentions in caption
                                            </div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                                {mentions.map(m => (
                                                    <span key={m.id} style={mentionChipStyle}>
                                                        <PlatformBadge platform={m.platform} />
                                                        <a href={m.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>
                                                            @{m.displayName}
                                                        </a>
                                                        <button onClick={() => removeMention(m.id)} style={chipRemoveStyle} title="Remove mention">×</button>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    {photoTags.length > 0 && (
                                        <div>
                                            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: 6 }}>
                                                Photo tags
                                            </div>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                                {photoTags.map((t, i) => (
                                                    <span key={t.id} style={mentionChipStyle}>
                                                        <span style={{ ...miniPinStyle }}>{i + 1}</span>
                                                        <PlatformBadge platform={t.platform} />
                                                        <a href={t.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>
                                                            {t.displayName}
                                                        </a>
                                                        <button onClick={() => removePhotoTag(t.id)} style={chipRemoveStyle} title="Remove tag">×</button>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                        </div>

                    </div>
                </div>

                {/* === LIVE PREVIEW === */}
                <div className="sns-cp-preview" style={cardStyle}>
                    <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>Preview</div>
                    </div>
                    <div style={{ padding: 20 }}>
                        <div style={{ background: 'var(--bg-card)', borderRadius: 12, padding: 16, border: '1px solid var(--border-subtle)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                                <div style={{ width: 40, height: 40, borderRadius: 8, background: activePlatform.tone, display: 'grid', placeItems: 'center', color: '#fff', flexShrink: 0 }}>
                                    <activePlatform.Icon size={18} />
                                </div>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
                                        {eventTitle || 'Your page'}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                                        2,345 followers · 1h · 🌐
                                    </div>
                                </div>
                            </div>

                            <div style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                {loading ? 'Loading…' : renderCaption(resolvedCaption, mentions)}
                            </div>

                            {mediaIncluded && snsUrl && (
                                <div style={{ position: 'relative', marginTop: 14, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border-subtle)' }}>
                                    <img src={getImageUrl(snsUrl)} alt="card" style={{ width: '100%', display: 'block' }} />
                                    {photoTags.map((t, i) => (
                                        <a
                                            key={t.id}
                                            href={t.url}
                                            target="_blank" rel="noopener noreferrer"
                                            title={`${t.displayName} · ${t.platform}`}
                                            style={photoTagPin(t.x, t.y)}
                                        >{i + 1}</a>
                                    ))}
                                </div>
                            )}

                            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 18, color: 'var(--text-secondary)', fontSize: 13 }}>
                                <span style={previewAct}><BsHandThumbsUp /> Like</span>
                                <span style={previewAct}><BsChatLeft /> Comment</span>
                                <span style={previewAct}><BsShare /> Share</span>
                                <span style={previewAct}><BsSendFill /> Send</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* === SETTINGS SIDEBAR === */}
                <div className="sns-cp-settings" style={{ ...cardStyle, position: 'sticky', top: 16, alignSelf: 'start' }}>
                    {/* Tabs */}
                    <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', padding: '0 20px', gap: 24 }}>
                        <button className={`sns-cp-tab ${settingsTab === 'post' ? 'active' : ''}`} onClick={() => setSettingsTab('post')}>Post Settings</button>
                        <button className={`sns-cp-tab ${settingsTab === 'ai' ? 'active' : ''}`} onClick={() => setSettingsTab('ai')}>AI Assistant</button>
                    </div>

                    {settingsTab === 'ai' ? (
                        <div style={{ padding: 20, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                            <p style={{ marginTop: 0 }}>
                                AI assistant suggests captions, hashtags, and best-time-to-post. Coming once we wire an LLM (mock for now).
                            </p>
                            <button onClick={handleAiGenerate} style={{ ...aiBtnStyle, width: '100%', justifyContent: 'center', padding: '10px 14px' }}>
                                <BsStars /> Generate a caption
                            </button>
                        </div>
                    ) : (
                        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
                            <div>
                                <div style={settingLabel}>Post To</div>
                                {accountsLoading ? (
                                    <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Loading accounts…</div>
                                ) : socialAccounts.length === 0 ? (
                                    <div style={{
                                        padding: 12, borderRadius: 10,
                                        background: 'var(--bg-card)',
                                        border: '1px dashed var(--border-subtle)',
                                        fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55,
                                    }}>
                                        No social accounts connected yet for this organization.
                                        <button onClick={handleConnectAccount} style={{
                                            display: 'block', marginTop: 8, fontSize: 12,
                                            color: '#8b5cf6', background: 'none', border: 'none',
                                            cursor: 'pointer', padding: 0, fontWeight: 600,
                                        }}>
                                            Connect an account →
                                        </button>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        {socialAccounts.map(a => {
                                            const p = PLATFORMS[a.platform] || PLATFORMS.linkedin;
                                            const I = p.Icon;
                                            const checked = selectedAccountIds.has(a.id);
                                            return (
                                                <div
                                                    key={a.id}
                                                    className={`sns-cp-acct ${checked ? 'active' : ''}`}
                                                    onClick={() => toggleAccount(a.id)}
                                                >
                                                    <div style={{ width: 30, height: 30, borderRadius: 8, background: p.tone, display: 'grid', placeItems: 'center', color: '#fff', flexShrink: 0 }}>
                                                        <I size={15} />
                                                    </div>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {a.account_name}
                                                        </div>
                                                        <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                                                            {p.label}{a.account_handle ? ` · ${a.account_handle}` : ''}
                                                            {a.token_expires_soon && (
                                                                <span style={{ color: '#f59e0b', marginLeft: 4, fontWeight: 600 }}>· expires soon</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div style={{
                                                        width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                                                        background: checked ? '#8b5cf6' : 'transparent',
                                                        border: `1px solid ${checked ? '#8b5cf6' : 'var(--border-subtle)'}`,
                                                        display: 'grid', placeItems: 'center', color: '#fff'
                                                    }}>
                                                        {checked && <BsCheck2 size={13} />}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                        <button onClick={handleConnectAccount} style={{
                                            marginTop: 4, fontSize: 12,
                                            color: '#8b5cf6', background: 'none', border: 'none',
                                            cursor: 'pointer', padding: 0, fontWeight: 600,
                                            textAlign: 'left',
                                        }}>
                                            + Connect another account
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div>
                                <div style={settingLabel}>When to post</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <RadioRow label="Post Now" checked={when === 'now'} onClick={() => setWhen('now')} />
                                    <RadioRow label="Schedule" checked={when === 'schedule'} onClick={() => setWhen('schedule')} />
                                    {when === 'schedule' && (
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '4px 0 4px 26px' }}>
                                            <label style={inputWrapStyle}>
                                                <BsCalendar3 size={12} />
                                                <input type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} style={inputStyle} />
                                            </label>
                                            <label style={inputWrapStyle}>
                                                <BsClock size={12} />
                                                <input type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} style={inputStyle} />
                                            </label>
                                        </div>
                                    )}
                                    <RadioRow label="Save as Draft" checked={when === 'draft'} onClick={() => setWhen('draft')} />
                                </div>
                            </div>

                            <div>
                                <button
                                    onClick={() => setAdvancedOpen(o => !o)}
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        width: '100%', background: 'none', border: 'none', cursor: 'pointer',
                                        color: 'var(--text-primary)', padding: '6px 0', fontWeight: 600, fontSize: 13,
                                    }}
                                >
                                    <span>Advanced Options</span>
                                    {advancedOpen ? <BsChevronUp size={12} /> : <BsChevronDown size={12} />}
                                </button>
                                {advancedOpen && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 8 }}>
                                        <ToggleRow label="Add First Comment" on={addFirstComment} onClick={() => setAddFirstComment(v => !v)} />
                                        <ToggleRow label="Add UTM Parameters" on={addUtm} onClick={() => setAddUtm(v => !v)} />
                                    </div>
                                )}
                            </div>

                            <button onClick={handlePublish} style={publishBtnStyle}>
                                <BsSend /> {when === 'schedule' ? 'Schedule Post' : when === 'draft' ? 'Save as Draft' : 'Publish Post'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// === Small presentational helpers ===
function RadioRow({ label, checked, onClick }) {
    return (
        <div onClick={onClick} style={{
            display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none',
        }}>
            <div style={{
                width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                border: `1px solid ${checked ? '#8b5cf6' : 'var(--border-subtle)'}`,
                background: 'transparent', display: 'grid', placeItems: 'center',
            }}>
                {checked && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#8b5cf6' }} />}
            </div>
            <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{label}</span>
        </div>
    );
}

function ToggleRow({ label, on, onClick }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>{label}</span>
            <div className={`sns-cp-toggle ${on ? 'on' : ''}`} onClick={onClick} role="switch" aria-checked={on} />
        </div>
    );
}

// Small coloured square showing which platform a mention/tag targets.
// Map keys match the values stored on each mention/tag entry.
function PlatformBadge({ platform }) {
    const PLAT = {
        instagram: { I: BsInstagram, tone: '#E1306C' },
        facebook:  { I: BsFacebook,  tone: '#1877F2' },
        linkedin:  { I: BsLinkedin,  tone: '#0A66C2' },
        twitter:   { I: BsTwitterX,  tone: '#000000' },
    };
    const p = PLAT[platform] || PLAT.instagram;
    const Icon = p.I;
    return (
        <span style={{
            width: 20, height: 20, borderRadius: 5,
            background: p.tone, color: '#fff',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
        }}>
            <Icon size={11} />
        </span>
    );
}

// === Styles ===
// Full-bleed dark page so the cards stand out against the same navy-black
// background as the screenshot, regardless of the AppLayout's own bg.
// AppLayout wraps each route in a div.content-area with Bootstrap .p-4
// (1.5rem = 24px on all sides); negative margins bleed past that so the
// dark background reaches the sidebar / header edges.
const pageStyle = {
    minHeight: 'calc(100vh - 48px)',
    background: 'var(--bg-primary)',
    margin: '-1.5rem',
    padding: '20px 24px 48px',
    color: 'var(--text-primary)',
};
const topBarStyle = {
    display: 'flex', alignItems: 'center', gap: 14,
    padding: '14px 18px', marginBottom: 14,
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 12,
};
const gridStyle = {
    display: 'grid', gridTemplateColumns: 'minmax(420px, 1.1fr) minmax(360px, 1fr) 320px',
    gap: 14, alignItems: 'start',
};
const cardStyle = {
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 12, overflow: 'hidden',
};
const backBtnStyle = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: 'transparent', border: 'none', color: 'var(--text-secondary)',
    cursor: 'pointer', padding: '6px 8px', fontSize: 14, marginBottom: 18,
    borderRadius: 6,
};
const topActionStyle = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: 'var(--bg-card)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 10, padding: '9px 14px',
    fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const aiBtnStyle = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    background: 'rgba(139,92,246,0.14)', color: '#a78bfa',
    border: '1px solid rgba(139,92,246,0.45)',
    borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
// Composer toolbar popovers (emoji / link / variable) — positioned above
// the trigger button so the textarea below isn't covered. `bottom: 100%`
// + a small gap keeps them visually attached to the toolbar.
const popoverStyle = {
    position: 'absolute', bottom: 'calc(100% + 6px)', left: 0,
    background: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)',
    borderRadius: 10, boxShadow: '0 16px 40px rgba(0,0,0,0.45)',
    zIndex: 50, width: 320,
};
const popoverHeaderStyle = {
    fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
    color: 'var(--text-secondary)', padding: '8px 10px', borderBottom: '1px solid var(--border-subtle)',
};
const linkInputStyle = {
    width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
    borderRadius: 8, padding: '8px 10px', color: 'var(--text-primary)', fontSize: 13, outline: 'none',
};
const primaryBtnStyle = {
    background: '#8b5cf6', color: '#fff', border: 'none',
    borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600,
};
const ghostBtnStyle = {
    background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)',
    borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
};
const varRowStyle = {
    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 10px', borderRadius: 6, background: 'transparent', border: 'none',
    cursor: 'pointer', textAlign: 'left',
};
// Mention / photo-tag chip shown in the summary list under the Media block.
const mentionChipStyle = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '4px 8px 4px 6px', borderRadius: 999,
    background: 'var(--bg-card)',
    border: '1px solid var(--border-subtle)',
    fontSize: 12,
};
const chipRemoveStyle = {
    background: 'transparent', border: 'none', color: 'var(--text-secondary)',
    cursor: 'pointer', padding: 0, marginLeft: 2,
    fontSize: 14, lineHeight: 1, width: 16, height: 16,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};
// Tiny pin badge mirroring the on-photo numbered pin so the summary list
// shows which marker on the photo corresponds to each entry.
const miniPinStyle = {
    width: 18, height: 18, borderRadius: '50%',
    background: '#8b5cf6', color: '#fff',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 10, fontWeight: 700, flexShrink: 0,
};
// Numbered round pin overlaid on the image at the tagged x/y percentages.
// Positioned via `left/top` (percent) and centred with translate(-50%, -50%).
const photoTagPin = (xPct, yPct) => ({
    position: 'absolute',
    left: `${xPct}%`, top: `${yPct}%`,
    transform: 'translate(-50%, -50%)',
    width: 26, height: 26, borderRadius: '50%',
    background: '#8b5cf6', color: '#fff',
    fontSize: 12, fontWeight: 700,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 4px 14px rgba(0,0,0,0.55), 0 0 0 3px rgba(139,92,246,0.35)',
    cursor: 'pointer', textDecoration: 'none', zIndex: 3,
});
const publishBtnStyle = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    background: '#8b5cf6', color: '#fff', border: 'none',
    borderRadius: 10, padding: '12px 14px', fontSize: 14, fontWeight: 700,
    cursor: 'pointer', width: '100%',
};
const settingLabel = { fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 };
const inputWrapStyle = {
    display: 'flex', alignItems: 'center', gap: 6,
    background: 'var(--bg-card)', border: '1px solid var(--border-subtle)',
    borderRadius: 8, padding: '7px 10px', color: 'var(--text-secondary)', fontSize: 12,
};
const inputStyle = {
    background: 'transparent', border: 'none', outline: 'none',
    color: 'var(--text-primary)', fontSize: 13, width: '100%', fontFamily: 'inherit',
};
const previewAct = { display: 'inline-flex', alignItems: 'center', gap: 5 };
