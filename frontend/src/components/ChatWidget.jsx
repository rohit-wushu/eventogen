import { useState, useEffect, useRef, useCallback, useMemo, lazy, Suspense, memo } from 'react';
import { BsChatDots, BsX, BsArrowLeft, BsSendFill, BsSearch, BsPlus, BsPeopleFill, BsPaperclip, BsImage, BsFileEarmark, BsDownload, BsFileEarmarkPdf, BsFileEarmarkMusic, BsFileEarmarkPlay, BsThreeDotsVertical, BsReply, BsTrash, BsClipboard, BsEmojiSmile, BsPersonBadge, BsCheckCircleFill, BsInfoCircle, BsLink45Deg, BsImages, BsPencilSquare, BsCheck2, BsShare, BsCrop, BsPinAngleFill, BsPinAngle, BsPin, BsStars, BsScissors } from 'react-icons/bs';

// react-cropper + cropperjs is ~120 KB — code-split it so it only loads
// when the user actually opens the crop UI, not on every chat open.
const Cropper = lazy(() => import('./CropperLazy'));
import { useAuth } from '../context/AuthContext';
import { getImageUrl } from '../utils/imageUrl';
import {
    getConversations, getChatMessages, sendChatMessage,
    markChatRead, getChatUnreadCount, sendTyping, getTyping,
    getChatGroups, createChatGroup, getGroupMessages, sendGroupMessage, markGroupRead,
    getChatGroup, updateChatGroup, getGroupMedia, updateGroupPhoto, addGroupMembers, removeGroupMember,
    deleteChatMessage, reactToMessage, forwardMessage,
    getUsers, getEvents, createQuickSpeaker, updateMyProfile,
    togglePinMessage, getPinnedMessages, searchChatMessages, clearChatForMe
} from '../services/api';
import { usePhotoOps } from '../hooks/usePhotoOps';
import { useNavigate } from 'react-router-dom';

const initials = (name = '') => name.split(/\s+/).map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

const formatTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const diffDays = Math.floor((now - d) / 86400000);
    if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
    return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
};

const AVATAR_COLORS = ['#8b5cf6', '#0ea5e9', '#ec4899', '#10b981', '#f59e0b', '#ef4444'];

// Wraps matching substrings in a <mark> so the search term pops inside
// each result row. Case-insensitive. Regex-escapes the query so users
// searching for "?" or "(event)" don't blow up the matcher.
const highlightMatch = (text, query) => {
    if (!text || !query) return text;
    const q = String(query).trim();
    if (!q) return text;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = String(text).split(new RegExp(`(${escaped})`, 'ig'));
    return parts.map((p, i) => (
        p.toLowerCase() === q.toLowerCase()
            ? <mark key={i} style={{ background: 'rgba(251, 191, 36, 0.35)', color: '#fff', padding: '0 2px', borderRadius: 3 }}>{p}</mark>
            : <span key={i}>{p}</span>
    ));
};
const colorFor = (id) => AVATAR_COLORS[id % AVATAR_COLORS.length];

const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const renderWithMentions = (text, mentionNames = [], currentUserName = '') => {
    if (!text) return null;
    if (mentionNames.length === 0) return text;
    // Sort longest first to avoid partial shadowing (e.g. "Alex Smith" vs "Alex")
    const names = [...mentionNames].sort((a, b) => b.length - a.length);
    const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp('@(' + names.map(escape).join('|') + ')(?=\\b|$|\\s)', 'g');
    const out = [];
    let last = 0, m, key = 0;
    while ((m = pattern.exec(text)) !== null) {
        if (m.index > last) out.push(text.slice(last, m.index));
        const self = m[1] === currentUserName;
        out.push(
            <span key={key++} style={{
                color: self ? '#22d3ee' : '#34d399',
                fontWeight: 700
            }}>@{m[1]}</span>
        );
        last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
};

const AttachmentIcon = ({ type }) => {
    const size = 22;
    if (type === 'pdf') return <BsFileEarmarkPdf size={size} />;
    if (type === 'audio') return <BsFileEarmarkMusic size={size} />;
    if (type === 'video') return <BsFileEarmarkPlay size={size} />;
    return <BsFileEarmark size={size} />;
};

// memoized: attachment row only depends on the message's attachment_* fields,
// which never change after the message is persisted. Skipping the re-render
// when the parent re-renders for unrelated reasons (typing flip, poll, etc.).
const MessageAttachment = memo(function MessageAttachment({ m }) {
    if (!m.attachment_url) return null;
    const url = getImageUrl(m.attachment_url);
    if (m.attachment_type === 'image') {
        return (
            <a href={url} target="_blank" rel="noreferrer" style={{ display: 'block' }}>
                <img src={url} alt={m.attachment_name}
                    style={{ maxWidth: 220, maxHeight: 220, borderRadius: 10, display: 'block', marginBottom: m.body ? 6 : 0 }} />
            </a>
        );
    }
    return (
        <a href={url} target="_blank" rel="noreferrer" download={m.attachment_name}
            style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 10,
                background: 'rgba(0,0,0,0.25)', color: '#fff',
                textDecoration: 'none', marginBottom: m.body ? 6 : 0,
                maxWidth: 240
            }}>
            <AttachmentIcon type={m.attachment_type} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                    fontSize: 12, fontWeight: 600,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                }}>{m.attachment_name}</div>
                <div style={{ fontSize: 10, opacity: 0.7 }}>{formatSize(m.attachment_size)}</div>
            </div>
            <BsDownload size={14} style={{ opacity: 0.8 }} />
        </a>
    );
});

// Renders a structured event report card produced by the @report
// command. The backend stores the payload JSON-encoded in messages.body
// and flags it with message_type = 'bot_report'.
// memoized: payload is frozen at the moment the bot row is created, so the
// rendered card never needs to update — skip re-renders cheaply.
const BotReportCard = memo(function BotReportCard({ m }) {
    let payload = null;
    try { payload = JSON.parse(m.body); } catch (_) { /* malformed */ }
    if (!payload) {
        return (
            <div style={{
                margin: '8px auto', maxWidth: '90%',
                padding: '10px 14px', borderRadius: 12,
                background: '#2d2d47', color: 'rgba(255,255,255,0.7)',
                fontSize: 12, fontStyle: 'italic', textAlign: 'center'
            }}>
                Report card unavailable
            </div>
        );
    }

    const isError = payload.kind === 'error';
    const accent = isError ? '#f59e0b' : '#8b5cf6';

    return (
        <div style={{
            margin: '10px auto', maxWidth: '92%',
            background: 'linear-gradient(135deg, #1f1f33, #262640)',
            border: `1px solid ${accent}55`,
            borderRadius: 14, overflow: 'hidden',
            boxShadow: '0 4px 14px rgba(0,0,0,0.25)'
        }}>
            <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 14px',
                background: `linear-gradient(90deg, ${accent}22, transparent)`,
                borderBottom: `1px solid ${accent}33`
            }}>
                <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: accent, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, fontWeight: 700
                }}>
                    {isError ? '!' : '📊'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{payload.title}</div>
                    {payload.subtitle && (
                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>{payload.subtitle}</div>
                    )}
                </div>
            </div>

            {isError ? (
                <div style={{ padding: '12px 14px', fontSize: 13, color: 'rgba(255,255,255,0.8)' }}>
                    {payload.message}
                </div>
            ) : (
                <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {(payload.sections || []).map((sec) => (
                        <div key={sec.key} style={{
                            background: 'rgba(0,0,0,0.18)',
                            borderRadius: 10, padding: '8px 10px'
                        }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                fontSize: 12, fontWeight: 700, color: '#fff', marginBottom: 6
                            }}>
                                <span>{sec.icon}</span>
                                <span>{sec.label}</span>
                                {typeof sec.count === 'number' && (
                                    <span style={{
                                        background: accent, color: '#fff',
                                        fontSize: 10, padding: '1px 7px', borderRadius: 10
                                    }}>{sec.count}</span>
                                )}
                            </div>
                            {sec.items && sec.items.length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {sec.items.map((it, i) => (
                                        <div key={i} style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', lineHeight: 1.35 }}>
                                            <span>• {it.primary}</span>
                                            {it.secondary && (
                                                <span style={{ color: 'rgba(255,255,255,0.5)' }}> — {it.secondary}</span>
                                            )}
                                        </div>
                                    ))}
                                    {sec.more > 0 && (
                                        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>
                                            …and {sec.more} more
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>
                                    None
                                </div>
                            )}
                            {sec.footer && (
                                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 6 }}>
                                    {sec.footer}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {payload.footer && (
                <div style={{
                    padding: '6px 14px', fontSize: 10,
                    color: 'rgba(255,255,255,0.45)',
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    textAlign: 'right'
                }}>
                    {payload.footer}
                </div>
            )}
        </div>
    );
});

// Renders a single chat message bubble with its menu, react picker, and
// reactions row. Extracted from the parent so we can memo it — without
// this, every unrelated state change in ChatWidget (typing flip, poll,
// react picker open elsewhere) would re-render every message in the
// thread. With memo + stable callbacks, only the row whose own props
// actually changed renders again.
const MessageRow = memo(function MessageRow({
    m, prev, userId, userName, isGroup, groupMemberNames,
    highlighted, menuOpen, reactPickerOpen,
    onToggleMenu, onReply, onCopy, onReact,
    onTogglePin, onForward, onDelete,
    onOpenReactPicker, onCloseReactPicker, onOpenSpeakerPage
}) {
    const mine = m.sender_id === userId;
    const showTime = !prev || (new Date(m.created_at) - new Date(prev.created_at) > 5 * 60 * 1000);
    const showSender = isGroup && !mine && (!prev || prev.sender_id !== m.sender_id || showTime);
    const isTombstone = !!m.deleted_for_everyone;
    const reactions = m.reactions || [];
    const reactionGroups = reactions.reduce((a, r) => {
        a[r.emoji] = (a[r.emoji] || 0) + 1; return a;
    }, {});

    return (
        <div id={`chat-msg-${m.id}`} style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
            {showTime && (
                <div style={{ fontSize: 10, opacity: 0.4, margin: '6px 0 2px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span>{formatTime(m.created_at)}</span>
                    {m.is_pinned === 1 && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#fbbf24', opacity: 0.9 }}>
                            <BsPinAngleFill size={9} /> Pinned
                        </span>
                    )}
                </div>
            )}
            {showSender && (
                <div style={{ fontSize: 10, color: colorFor(m.sender_id), fontWeight: 600, marginBottom: 2, paddingLeft: 4 }}>
                    {m.sender_name || 'User'}
                </div>
            )}
            <div className={`chat-msg-row${highlighted ? ' chat-msg-highlight' : ''}`} style={{ position: 'relative', maxWidth: '82%', display: 'flex', alignItems: 'flex-start', gap: 4, flexDirection: mine ? 'row-reverse' : 'row' }}>
                <div style={{
                    padding: m.attachment_url && !m.body && !m.reply_to_id ? 4 : '8px 12px',
                    borderRadius: 14,
                    background: isTombstone
                        ? '#23233a'
                        : (mine ? 'linear-gradient(135deg, #8b5cf6, #6366f1)' : '#2d2d47'),
                    color: isTombstone ? 'rgba(255,255,255,0.55)' : '#fff',
                    fontStyle: isTombstone ? 'italic' : 'normal',
                    fontSize: 13, lineHeight: 1.4,
                    wordBreak: 'break-word', whiteSpace: 'pre-wrap',
                    borderBottomRightRadius: mine ? 4 : 14,
                    borderBottomLeftRadius: mine ? 14 : 4,
                    overflow: 'hidden', flex: 'none'
                }}>
                    {isTombstone ? (
                        <span>🚫 This message was deleted</span>
                    ) : (
                        <>
                            {m.reply_to_id && (m.reply_body || m.reply_attachment_type) && (
                                <div style={{
                                    borderLeft: '3px solid rgba(255,255,255,0.4)',
                                    background: 'rgba(0,0,0,0.18)',
                                    padding: '4px 8px', borderRadius: 6,
                                    marginBottom: 6, fontSize: 11, opacity: 0.85,
                                    maxWidth: '100%'
                                }}>
                                    <div style={{ fontWeight: 600, marginBottom: 2 }}>
                                        {m.reply_sender_id === userId ? 'You' : (m.reply_sender_name || 'User')}
                                    </div>
                                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {m.reply_body || (m.reply_attachment_type === 'image' ? '📷 Photo' : '📎 Attachment')}
                                    </div>
                                </div>
                            )}
                            {m.speaker_id && m.speaker_name && (
                                <SpeakerCard m={m} onOpen={onOpenSpeakerPage} />
                            )}
                            <MessageAttachment m={m} />
                            {m.body && !m.speaker_id && (
                                <div style={{ padding: m.attachment_url ? '0 8px 4px' : 0 }}>
                                    {renderWithMentions(m.body, groupMemberNames, userName)}
                                </div>
                            )}
                        </>
                    )}
                </div>
                {!isTombstone && !String(m.id).startsWith('tmp-') && (
                    <button
                        data-chat-popover
                        className={`chat-msg-menu${menuOpen ? ' open' : ''}`}
                        onClick={() => onToggleMenu(m.id)}
                        style={{
                            alignSelf: 'center',
                            border: 'none', background: '#3a3a55',
                            color: '#fff', width: 22, height: 22, borderRadius: '50%',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', flexShrink: 0
                        }}>
                        <BsThreeDotsVertical size={12} />
                    </button>
                )}
                {menuOpen && (
                    <MessageActionMenu
                        mine={mine} mine_align={mine}
                        isPinned={m.is_pinned === 1}
                        onReply={() => onReply(m)}
                        onCopy={m.body ? () => onCopy(m) : null}
                        onReact={() => onOpenReactPicker(m.id)}
                        onPin={!isTombstone ? () => onTogglePin(m) : null}
                        onForward={() => onForward(m)}
                        onDelete={() => onDelete(m)}
                    />
                )}
                {reactPickerOpen && (
                    <EmojiPicker
                        mine={mine}
                        onPick={(emo) => onReact(m, emo)}
                        onClose={onCloseReactPicker}
                    />
                )}
            </div>
            {Object.keys(reactionGroups).length > 0 && (
                <div style={{
                    display: 'flex', gap: 4, marginTop: 2,
                    flexDirection: mine ? 'row-reverse' : 'row'
                }}>
                    {Object.entries(reactionGroups).map(([emo, cnt]) => {
                        const minePressed = reactions.some(r => r.user_id === userId && r.emoji === emo);
                        return (
                            <button key={emo}
                                onClick={() => onReact(m, emo)}
                                title={reactions.filter(r => r.emoji === emo).map(r => r.user_name || 'User').join(', ')}
                                style={{
                                    border: minePressed ? '1px solid #8b5cf6' : '1px solid rgba(255,255,255,0.1)',
                                    background: minePressed ? 'rgba(139,92,246,0.35)' : '#2d2d47',
                                    color: '#fff', padding: '2px 6px',
                                    fontSize: 11, borderRadius: 10, cursor: 'pointer'
                                }}>{emo} {cnt > 1 ? cnt : ''}</button>
                        );
                    })}
                </div>
            )}
        </div>
    );
});

export default function ChatWidget() {
    const { user, setUser } = useAuth();
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState('direct'); // 'direct' | 'groups'
    const [activeChat, setActiveChat] = useState(null); // { type: 'user'|'group', id, name, role? }
    const [conversations, setConversations] = useState([]);
    const [groups, setGroups] = useState([]);
    const [messages, setMessages] = useState([]);
    const [draft, setDraft] = useState('');
    const [search, setSearch] = useState('');
    const [unread, setUnread] = useState(0);
    const [peerTyping, setPeerTyping] = useState(false);
    const [showCreate, setShowCreate] = useState(false);

    const scrollRef = useRef(null);
    const inputRef = useRef(null);
    const fileInputRef = useRef(null);
    const imageInputRef = useRef(null);
    const lastTypingSentRef = useRef(0);

    const [pendingFile, setPendingFile] = useState(null);
    const [pendingPreview, setPendingPreview] = useState('');
    const [replyTo, setReplyTo] = useState(null);
    const [menuOpenId, setMenuOpenId] = useState(null);
    const [reactPickerId, setReactPickerId] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [forwardMsg, setForwardMsg] = useState(null);
    const [showSpeaker, setShowSpeaker] = useState(false);
    const [showGroupInfo, setShowGroupInfo] = useState(false);
    const [showMyProfile, setShowMyProfile] = useState(false);

    // Pin + search state.
    // `pinnedMessages` = lightweight pinned-message list for the current chat.
    // `searchOpen` toggles the search overlay inside the chat header.
    // `searchResults` is populated by the debounced search-as-you-type.
    // `highlightMsgId` briefly flashes a message when the user jumps to it
    //   from a pin or a search hit.
    const [pinnedMessages, setPinnedMessages] = useState([]);
    const [showAllPins, setShowAllPins] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [highlightMsgId, setHighlightMsgId] = useState(null);
    const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
    const [clearConfirm, setClearConfirm] = useState(false);
    const [clearing, setClearing] = useState(false);

    // Infinite-scroll state. We now page messages instead of hauling every
    // message in the thread up front — huge speed win on long histories.
    const MESSAGE_PAGE_SIZE = 40;
    const [hasMoreMessages, setHasMoreMessages] = useState(true);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const skipAutoScrollRef = useRef(false); // true while prepending older pages
    // Tracks whether the user is parked near the bottom of the thread.
    // Updated on every scroll; consulted by the auto-scroll effect so new
    // arrivals don't yank a user back down while they're reading history.
    const isNearBottomRef = useRef(true);
    const lastChatIdRef = useRef(null);
    const NEAR_BOTTOM_PX = 80;

    const [groupMembers, setGroupMembers] = useState([]);
    const [mentionQuery, setMentionQuery] = useState(null);
    const [mentionStart, setMentionStart] = useState(0);
    const [mentionIdx, setMentionIdx] = useState(0);
    const navigate = useNavigate();

    const isManagerish = user?.role === 'admin' || user?.role === 'manager';

    const loadConversations = async () => {
        try { const r = await getConversations(); setConversations(Array.isArray(r.data) ? r.data : []); }
        catch (e) { console.warn('loadConversations failed:', e?.response?.data?.error || e?.message); }
    };
    const loadGroups = async () => {
        try { const r = await getChatGroups(); setGroups(Array.isArray(r.data) ? r.data : []); }
        catch (e) { console.warn('loadGroups failed:', e?.response?.data?.error || e?.message); }
    };
    const loadUnread = async () => {
        try { const r = await getChatUnreadCount(); setUnread(r.data?.count || 0); }
        catch (e) { console.warn('loadUnread failed:', e?.response?.data?.error || e?.message); }
    };

    // Fetch a chat's most recent page. Also the entry point when the user
    // first opens a conversation. `hasMoreMessages` reflects whether there's
    // older history the scroll-up loader can still reach back for.
    const loadInitial = async (chat) => {
        try {
            const fetcher = chat.type === 'user'
                ? () => getChatMessages(chat.id, { limit: MESSAGE_PAGE_SIZE })
                : () => getGroupMessages(chat.id, { limit: MESSAGE_PAGE_SIZE });
            const r = await fetcher();
            const data = Array.isArray(r.data) ? r.data : [];
            setMessages(data);
            setHasMoreMessages(data.length === MESSAGE_PAGE_SIZE);
            if (chat.type === 'user') await markChatRead(chat.id);
            else                       await markGroupRead(chat.id);
            loadUnread();
            loadConversations();
            loadGroups();
        } catch {}
    };

    // Prepend the next older page when the user scrolls near the top. We
    // snapshot scrollHeight before the prepend and restore scrollTop after
    // so the visible message the user was reading stays anchored.
    const loadOlder = async () => {
        if (loadingOlder || !hasMoreMessages || messages.length === 0 || !activeChat) return;
        setLoadingOlder(true);
        skipAutoScrollRef.current = true;
        const oldestId = messages[0].id;
        const container = scrollRef.current;
        const prevHeight = container ? container.scrollHeight : 0;
        try {
            const fetcher = activeChat.type === 'user'
                ? () => getChatMessages(activeChat.id, { before: oldestId, limit: MESSAGE_PAGE_SIZE })
                : () => getGroupMessages(activeChat.id, { before: oldestId, limit: MESSAGE_PAGE_SIZE });
            const r = await fetcher();
            const page = Array.isArray(r.data) ? r.data : [];
            if (page.length === 0) {
                setHasMoreMessages(false);
            } else {
                setMessages(prev => [...page, ...prev]);
                setHasMoreMessages(page.length === MESSAGE_PAGE_SIZE);
                // Restore scroll position after React paints the prepend.
                requestAnimationFrame(() => {
                    if (container) {
                        container.scrollTop = container.scrollHeight - prevHeight;
                    }
                });
            }
        } catch { /* noop */ }
        finally { setLoadingOlder(false); }
    };

    // Incremental poll — fetches only messages newer than what we already
    // have. Falls back to a full initial load when the chat is empty. Keeps
    // any older pages the user scrolled back through intact.
    const pollNewMessages = async () => {
        if (!activeChat) return;
        if (messages.length === 0) { return loadInitial(activeChat); }
        const latestId = messages[messages.length - 1].id;
        try {
            const fetcher = activeChat.type === 'user'
                ? () => getChatMessages(activeChat.id, { after: latestId })
                : () => getGroupMessages(activeChat.id, { after: latestId });
            const r = await fetcher();
            const page = Array.isArray(r.data) ? r.data : [];
            if (page.length > 0) {
                setMessages(prev => {
                    // Defensive dedupe in case a sender hit retry.
                    const knownIds = new Set(prev.map(x => x.id));
                    const fresh = page.filter(x => !knownIds.has(x.id));
                    return fresh.length ? [...prev, ...fresh] : prev;
                });
                if (activeChat.type === 'user') markChatRead(activeChat.id).catch(() => {});
                else                             markGroupRead(activeChat.id).catch(() => {});
            }
            loadUnread();
        } catch {}
    };

    useEffect(() => {
        if (!user) return;
        loadUnread();
        const iv = setInterval(() => {
            // Skip the poll when the tab is hidden — backgrounded chats
            // don't need fresh data and the user gets the latest on focus.
            if (typeof document !== 'undefined' && document.hidden) return;
            loadUnread();
            if (open) { loadConversations(); loadGroups(); }
            // Polling is now additive — only fetches messages newer than
            // what's already in state, so older pages loaded via infinite
            // scroll stay intact and the poll itself is cheap.
            if (activeChat) pollNewMessages();
        }, 5000);
        // Catch up immediately when the user returns to the tab.
        const onVisible = () => {
            if (document.hidden) return;
            loadUnread();
            if (open) { loadConversations(); loadGroups(); }
            if (activeChat) pollNewMessages();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearInterval(iv);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [user, open, activeChat?.type, activeChat?.id]);

    useEffect(() => {
        if (open && !activeChat) { loadConversations(); loadGroups(); }
    }, [open]);

    // Load group members when entering a group chat (used for @mentions)
    useEffect(() => {
        if (activeChat?.type === 'group') {
            getChatGroup(activeChat.id).then(r => setGroupMembers(r.data?.members || [])).catch(() => setGroupMembers([]));
        } else {
            setGroupMembers([]);
        }
    }, [activeChat?.type, activeChat?.id]);

    // Scope string shared by pin + search. Backends treats "user:<id>" as a
    // DM and "group:<id>" as a group; keeping it derived avoids two call-
    // sites drifting out of sync.
    const currentScope = activeChat
        ? `${activeChat.type}:${activeChat.id}`
        : null;

    // Fetch pinned messages whenever we enter a chat or after messages refresh.
    // We also key off `messages.length` so a newly-sent message's pin action
    // refreshes the strip — no manual invalidate needed.
    useEffect(() => {
        if (!currentScope) { setPinnedMessages([]); setShowAllPins(false); return; }
        let cancelled = false;
        getPinnedMessages(currentScope)
            .then(r => { if (!cancelled) setPinnedMessages(Array.isArray(r.data) ? r.data : []); })
            .catch(() => { if (!cancelled) setPinnedMessages([]); });
        return () => { cancelled = true; };
    }, [currentScope, messages.length]);

    // Reset the search UI when switching chats — nothing more confusing than
    // carrying a stale search term from one conversation into another.
    useEffect(() => {
        setSearchOpen(false);
        setSearchQuery('');
        setSearchResults([]);
        setHeaderMenuOpen(false);
        setClearConfirm(false);
    }, [currentScope]);

    // Debounced search. 250ms feels instantaneous while avoiding a query
    // per keystroke on slower backends.
    useEffect(() => {
        if (!searchOpen || !currentScope) return;
        const q = searchQuery.trim();
        if (q.length < 2) { setSearchResults([]); setSearching(false); return; }
        setSearching(true);
        const t = setTimeout(async () => {
            try {
                const r = await searchChatMessages(currentScope, q);
                setSearchResults(Array.isArray(r.data) ? r.data : []);
            } catch {
                setSearchResults([]);
            } finally {
                setSearching(false);
            }
        }, 250);
        return () => clearTimeout(t);
    }, [searchQuery, searchOpen, currentScope]);

    // Jump to a message by ID: scroll it into view + flash a highlight.
    // Used by both pinned-strip clicks and search-result clicks.
    const jumpToMessage = (id) => {
        setSearchOpen(false);
        setHighlightMsgId(id);
        setTimeout(() => {
            const el = document.getElementById(`chat-msg-${id}`);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
        setTimeout(() => setHighlightMsgId(null), 2400);
    };

    // Toggle pin + reflect locally so the UI feels instant. The next poll
    // will reconcile in case another participant toggled it concurrently.
    const handleTogglePin = useCallback(async (m) => {
        setMenuOpenId(null);
        try {
            const res = await togglePinMessage(m.id);
            const isPinned = !!res.data?.is_pinned;
            setMessages(prev => prev.map(x => x.id === m.id ? { ...x, is_pinned: isPinned ? 1 : 0, pinned_at: isPinned ? new Date().toISOString() : null } : x));
            // Reload pinned list to pick up ordering + removal
            if (currentScope) {
                getPinnedMessages(currentScope)
                    .then(r => setPinnedMessages(Array.isArray(r.data) ? r.data : []))
                    .catch(() => {});
            }
        } catch (err) {
            console.error('Pin toggle failed', err);
        }
    }, [currentScope]);

    // Typing poll (DM only). Pauses while the tab is hidden so a
    // backgrounded chat doesn't keep firing requests every 1.5s.
    useEffect(() => {
        if (!activeChat || activeChat.type !== 'user') { setPeerTyping(false); return; }
        let cancelled = false;
        const tick = async () => {
            if (typeof document !== 'undefined' && document.hidden) return;
            try { const r = await getTyping(activeChat.id); if (!cancelled) setPeerTyping(!!r.data?.typing); }
            catch (e) { console.warn('typing poll failed:', e?.message); }
        };
        tick();
        const iv = setInterval(tick, 1500);
        return () => { cancelled = true; clearInterval(iv); };
    }, [activeChat?.type, activeChat?.id]);

    useEffect(() => {
        // Skip the jump-to-bottom whenever we just prepended older history —
        // otherwise scrolling up would snap right back to the latest message.
        // loadOlder sets the flag, we clear it here after honouring it once.
        if (skipAutoScrollRef.current) {
            skipAutoScrollRef.current = false;
            return;
        }
        if (!scrollRef.current) return;
        // Always scroll on chat switch (entering a new conversation). For
        // in-place updates (new message via poll, typing flip), only scroll
        // if the user was already near the bottom — otherwise stay put so
        // they can read older messages without being yanked down.
        const chatSwitched = lastChatIdRef.current !== activeChat?.id;
        lastChatIdRef.current = activeChat?.id;
        if (chatSwitched || isNearBottomRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            isNearBottomRef.current = true;
        }
    }, [messages, activeChat?.id, peerTyping]);

    // Pulse the browser tab title when there are unread messages.
    useEffect(() => {
        const clean = (t) => t.replace(/^\(\d+\+?\)\s*/, '').replace(/^💬\s*New message.*?·\s*/, '');
        const original = clean(document.title);
        if (unread <= 0) {
            document.title = original;
            return;
        }
        const badge = `(${unread > 99 ? '99+' : unread})`;
        const alt = `💬 New message${unread > 1 ? 's' : ''} · ${original}`;
        let toggle = false;
        document.title = `${badge} ${original}`;
        const iv = setInterval(() => {
            toggle = !toggle;
            document.title = toggle ? alt : `${badge} ${original}`;
        }, 1000);
        return () => {
            clearInterval(iv);
            document.title = original;
        };
    }, [unread]);

    // Close action menu / emoji picker when clicking outside
    useEffect(() => {
        if (!menuOpenId && !reactPickerId) return;
        const onDocClick = (e) => {
            if (!e.target.closest?.('[data-chat-popover]')) {
                setMenuOpenId(null);
                setReactPickerId(null);
            }
        };
        document.addEventListener('mousedown', onDocClick);
        return () => document.removeEventListener('mousedown', onDocClick);
    }, [menuOpenId, reactPickerId]);

    const openChat = (chat) => {
        setActiveChat(chat);
        setMessages([]);
        setHasMoreMessages(true);
        setLoadingOlder(false);
        loadInitial(chat);
        setTimeout(() => inputRef.current?.focus(), 100);
    };

    const pickFile = (accept) => {
        const ref = accept === 'image/*' ? imageInputRef : fileInputRef;
        ref.current?.click();
    };

    const handleFilePicked = (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        if (f.size > 25 * 1024 * 1024) {
            alert('File exceeds 25 MB limit');
            return;
        }
        setPendingFile(f);
        setPendingPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : '');
    };

    const clearPending = () => {
        if (pendingPreview) URL.revokeObjectURL(pendingPreview);
        setPendingFile(null);
        setPendingPreview('');
    };

    const send = async () => {
        const text = draft.trim();
        if ((!text && !pendingFile) || !activeChat) return;
        const fileToSend = pendingFile;
        const replyId = replyTo?.id;
        const replySnap = replyTo;
        setDraft('');
        clearPending();
        setReplyTo(null);
        const optimistic = {
            id: `tmp-${Date.now()}`,
            sender_id: user.id,
            sender_name: user.name,
            body: text || null,
            created_at: new Date().toISOString(),
            reply_to_id: replyId || null,
            reply_body: replySnap?.body || null,
            reply_attachment_type: replySnap?.attachment_type || null,
            reply_sender_id: replySnap?.sender_id || null,
            reply_sender_name: replySnap?.sender_name || null,
            reactions: [],
            ...(fileToSend ? {
                attachment_url: fileToSend.type.startsWith('image/') ? URL.createObjectURL(fileToSend) : null,
                attachment_name: fileToSend.name,
                attachment_type: fileToSend.type.startsWith('image/') ? 'image' : 'file',
                attachment_size: fileToSend.size,
                _localAttachment: true
            } : {}),
            ...(activeChat.type === 'user'
                ? { recipient_id: activeChat.id }
                : { group_id: activeChat.id })
        };
        // Sending your own message always pulls the view to the bottom,
        // even if you were scrolled up reading older history.
        isNearBottomRef.current = true;
        setMessages(prev => [...prev, optimistic]);
        try {
            const r = activeChat.type === 'user'
                ? await sendChatMessage(activeChat.id, text, fileToSend, replyId)
                : await sendGroupMessage(activeChat.id, text, fileToSend, replyId);
            setMessages(prev => prev.map(m => m.id === optimistic.id ? r.data : m));
            loadConversations(); loadGroups();
        } catch (e) {
            // Surface the server error so failures aren't silent. The
            // draft is restored below so the user can retry.
            console.warn('send failed:', e?.response?.data?.error || e?.message);
            setMessages(prev => prev.filter(m => m.id !== optimistic.id));
            setDraft(text);
            setReplyTo(replySnap || null);
            if (fileToSend) {
                setPendingFile(fileToSend);
                if (fileToSend.type.startsWith('image/')) setPendingPreview(URL.createObjectURL(fileToSend));
            }
        }
    };

    // Stable derived value: pass-down list of member names for mention
    // rendering inside MessageRow. Recomputes only when membership shifts.
    const isGroupChat = activeChat?.type === 'group';
    const groupMemberNames = useMemo(
        () => isGroupChat ? groupMembers.map(x => x.name) : [],
        [isGroupChat, groupMembers]
    );

    // Memoized handlers passed down to <MessageRow /> — keeping their
    // identity stable is what allows React.memo on the row to actually
    // skip re-renders when an unrelated piece of parent state changes.
    const handleToggleMenu = useCallback((id) => {
        setMenuOpenId(prev => prev === id ? null : id);
    }, []);
    const handleReplyClick = useCallback((m) => {
        setReplyTo(m);
        setMenuOpenId(null);
        setTimeout(() => inputRef.current?.focus(), 50);
    }, []);
    const handleForwardClick = useCallback((m) => {
        setForwardMsg(m);
        setMenuOpenId(null);
    }, []);
    const handleDeleteClick = useCallback((m) => {
        setDeleteTarget(m);
        setMenuOpenId(null);
    }, []);
    const handleOpenReactPicker = useCallback((id) => {
        setReactPickerId(id);
    }, []);
    const handleCloseReactPicker = useCallback(() => {
        setReactPickerId(null);
    }, []);
    const handleOpenSpeakerPage = useCallback(() => {
        setOpen(false);
        navigate('/speakers');
    }, [navigate]);

    const handleCopy = useCallback((m) => {
        const txt = m.body || m.attachment_name || '';
        if (!txt) return;
        navigator.clipboard?.writeText(txt).catch(() => {});
        setMenuOpenId(null);
    }, []);

    const handleReact = useCallback(async (m, emoji) => {
        setReactPickerId(null);
        setMenuOpenId(null);
        // Optimistic toggle
        setMessages(prev => prev.map(x => {
            if (x.id !== m.id) return x;
            const reactions = x.reactions || [];
            const mine = reactions.find(r => r.user_id === user.id);
            let next;
            if (mine && mine.emoji === emoji) {
                next = reactions.filter(r => r.user_id !== user.id);
            } else {
                next = [...reactions.filter(r => r.user_id !== user.id), { user_id: user.id, user_name: user.name, emoji }];
            }
            return { ...x, reactions: next };
        }));
        try { await reactToMessage(m.id, emoji); }
        catch (e) { console.warn('react failed:', e?.response?.data?.error || e?.message); }
    }, [user.id, user.name]);

    const handleShareSpeaker = async ({ name, designation, company, event_id, photo }) => {
        if (!activeChat) return;
        const fd = new FormData();
        fd.append('name', name);
        fd.append('designation', designation);
        fd.append('company', company);
        fd.append('event_id', event_id);
        fd.append('photo', photo);
        const r = await createQuickSpeaker(fd);
        const speaker = r.data;
        const body = `${name} — ${designation} at ${company}`;
        if (activeChat.type === 'user') {
            await sendChatMessage(activeChat.id, body, null, null, speaker.id);
        } else {
            await sendGroupMessage(activeChat.id, body, null, null, speaker.id);
        }
        setShowSpeaker(false);
        // Additive fetch so we don't yank older pages the user may have paged into.
        pollNewMessages();
    };

    const handleDelete = async (scope) => {
        if (!deleteTarget) return;
        const id = deleteTarget.id;
        setDeleteTarget(null);
        try {
            await deleteChatMessage(id, scope);
            if (scope === 'me') {
                setMessages(prev => prev.filter(m => m.id !== id));
            } else {
                setMessages(prev => prev.map(m => m.id === id ? {
                    ...m, deleted_for_everyone: 1, body: null,
                    attachment_url: null, attachment_name: null, attachment_type: null
                } : m));
            }
            loadConversations(); loadGroups();
        } catch {}
    };

    const onKeyDown = (e) => {
        if (mentionQuery !== null && mentionCandidates.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => Math.min(i + 1, mentionCandidates.length - 1)); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(i => Math.max(i - 1, 0)); return; }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                insertMention(mentionCandidates[mentionIdx]);
                return;
            }
            if (e.key === 'Escape') { e.preventDefault(); setMentionQuery(null); return; }
        }
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    };

    const handleDraftChange = (e) => {
        const val = typeof e === 'string' ? e : e.target.value;
        const cursor = typeof e === 'string' ? val.length : (e.target.selectionStart ?? val.length);
        setDraft(val);

        // Detect @mention query for group chats
        if (activeChat?.type === 'group') {
            let i = cursor - 1;
            while (i >= 0 && val[i] !== '@' && !/\s/.test(val[i])) i--;
            if (i >= 0 && val[i] === '@' && (i === 0 || /\s/.test(val[i - 1]))) {
                const q = val.slice(i + 1, cursor);
                setMentionQuery(q);
                setMentionStart(i);
                setMentionIdx(0);
                return;
            }
        }
        setMentionQuery(null);

        if (activeChat?.type !== 'user' || !val.trim()) return;
        const now = Date.now();
        if (now - lastTypingSentRef.current > 2000) {
            lastTypingSentRef.current = now;
            sendTyping(activeChat.id).catch(() => {});
        }
    };

    // Bot commands surfaced in the @-mention dropdown alongside member names,
    // so typing `@` in a group shows `@report` as the first option.
    const BOT_COMMANDS = [
        { id: '__bot_report', kind: 'bot', name: 'report', label: 'Event Report', hint: 'Speakers, partners, attendees & today\'s activity' }
    ];

    const mentionCandidates = mentionQuery !== null
        ? (() => {
            const q = mentionQuery.toLowerCase();
            const bots = BOT_COMMANDS.filter(b => !q || b.name.toLowerCase().startsWith(q) || b.label.toLowerCase().includes(q));
            const people = groupMembers
                .filter(m => m.id !== user.id && (!q || m.name?.toLowerCase().includes(q)))
                .slice(0, 6);
            return [...bots, ...people];
        })()
        : [];

    const insertMention = (mem) => {
        const before = draft.slice(0, mentionStart);
        const afterPos = (inputRef.current?.selectionStart ?? draft.length);
        const after = draft.slice(afterPos);
        const inserted = `@${mem.name} `;
        const next = before + inserted + after;
        setDraft(next);
        setMentionQuery(null);
        const newCursor = (before + inserted).length;
        setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.setSelectionRange(newCursor, newCursor);
        }, 0);
    };

    if (!user) return null;

    const filteredDms = search.trim()
        ? conversations.filter(c => c.name?.toLowerCase().includes(search.toLowerCase()))
        : conversations;
    const filteredGroups = search.trim()
        ? groups.filter(g => g.name?.toLowerCase().includes(search.toLowerCase()))
        : groups;

    const groupUnreadTotal = groups.reduce((s, g) => s + (g.unread_count || 0), 0);
    const dmUnreadTotal = conversations.reduce((s, c) => s + (c.unread_count || 0), 0);

    return (
        <>
            <style>{`
                @keyframes chatTypingBounce {
                    0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
                    40% { transform: translateY(-4px); opacity: 1; }
                }
                .chat-typing-dot {
                    width: 6px; height: 6px; border-radius: 50%;
                    background: rgba(255,255,255,0.8);
                    animation: chatTypingBounce 1.2s infinite ease-in-out;
                }
                [data-chat-scope], [data-chat-scope] * {
                    color: #fff !important;
                    color-scheme: dark;
                }
                [data-chat-scope] input, [data-chat-scope] textarea, [data-chat-scope] select {
                    color: #fff !important;
                    background: #262640 !important;
                    background-color: #262640 !important;
                    background-image: none !important;
                    border: 1px solid rgba(255,255,255,0.12) !important;
                    -webkit-text-fill-color: #fff !important;
                }
                /* In light theme, the global [data-theme="light"] input:focus rule
                   forces background to #fff with higher specificity than the
                   [data-chat-scope] rule above. Re-pin it on focus with extra
                   specificity (html body) so chat-scope inputs stay dark. */
                html body [data-chat-scope] input,
                html body [data-chat-scope] input:focus,
                html body [data-chat-scope] input:hover,
                html body [data-chat-scope] textarea,
                html body [data-chat-scope] textarea:focus,
                html body [data-chat-scope] textarea:hover,
                html body [data-chat-scope] select,
                html body [data-chat-scope] select:focus {
                    background: #262640 !important;
                    background-color: #262640 !important;
                    background-image: none !important;
                    color: #fff !important;
                    -webkit-text-fill-color: #fff !important;
                    caret-color: #fff !important;
                    color-scheme: dark !important;
                    border: 1px solid rgba(255,255,255,0.12) !important;
                }
                [data-chat-scope] input::placeholder, [data-chat-scope] textarea::placeholder {
                    color: rgba(255,255,255,0.45) !important;
                    -webkit-text-fill-color: rgba(255,255,255,0.45) !important;
                }
                [data-chat-scope] input:-webkit-autofill,
                [data-chat-scope] input:-webkit-autofill:hover,
                [data-chat-scope] input:-webkit-autofill:focus,
                [data-chat-scope] textarea:-webkit-autofill {
                    -webkit-box-shadow: 0 0 0 100px #262640 inset !important;
                    box-shadow: 0 0 0 100px #262640 inset !important;
                    -webkit-text-fill-color: #fff !important;
                    caret-color: #fff !important;
                    transition: background-color 99999s 0s, color 99999s 0s;
                }
                [data-chat-scope] input, [data-chat-scope] textarea {
                    caret-color: #fff !important;
                }
                [data-chat-scope] option {
                    background: #1a1a2e !important;
                    color: #fff !important;
                }
                [data-chat-scope] a { color: #a78bfa !important; }
                html body [data-chat-scope] textarea.chat-composer-input,
                html body [data-chat-scope] .chat-composer-input {
                    background: #262640 !important;
                    background-color: #262640 !important;
                    color: #fff !important;
                    -webkit-text-fill-color: #fff !important;
                    color-scheme: dark !important;
                }
                [data-chat-scope] .chat-msg-menu {
                    opacity: 0;
                    transition: opacity 120ms ease;
                }
                [data-chat-scope] .chat-msg-row:hover .chat-msg-menu,
                [data-chat-scope] .chat-msg-menu:focus,
                [data-chat-scope] .chat-msg-menu:hover,
                [data-chat-scope] .chat-msg-menu.open {
                    opacity: 1;
                }

                /* Infinite-scroll loader spinner */
                @keyframes chatSpin {
                    from { transform: rotate(0deg); }
                    to   { transform: rotate(360deg); }
                }

                /* Jump-to-message highlight flash */
                [data-chat-scope] .chat-msg-highlight > div:first-child {
                    animation: chatMsgFlash 2.2s ease;
                    box-shadow: 0 0 0 2px #fbbf24, 0 0 14px rgba(251, 191, 36, 0.5);
                }
                @keyframes chatMsgFlash {
                    0%, 60%  { box-shadow: 0 0 0 2px #fbbf24, 0 0 18px rgba(251, 191, 36, 0.65); }
                    100%     { box-shadow: 0 0 0 0 transparent; }
                }

                /* Pinned strip */
                [data-chat-scope] .chat-pinned-strip {
                    background: rgba(251, 191, 36, 0.08);
                    border-bottom: 1px solid rgba(251, 191, 36, 0.22);
                    padding: 8px 12px;
                }
                [data-chat-scope] .chat-pinned-header {
                    display: flex; align-items: center; gap: 6px;
                    font-size: 10px; font-weight: 700;
                    letter-spacing: 0.08em; text-transform: uppercase;
                    color: #fbbf24; margin-bottom: 4px;
                }
                [data-chat-scope] .chat-pinned-toggle {
                    margin-left: auto; background: transparent;
                    border: none; color: #a78bfa; cursor: pointer;
                    font-size: 10px; font-weight: 600; padding: 0;
                    text-transform: none; letter-spacing: 0;
                }
                [data-chat-scope] .chat-pinned-toggle:hover { text-decoration: underline; }
                [data-chat-scope] .chat-pinned-item {
                    display: block; width: 100%; text-align: left;
                    background: rgba(0, 0, 0, 0.2); border: 1px solid rgba(255, 255, 255, 0.06);
                    border-radius: 8px; padding: 6px 10px; margin-top: 4px;
                    color: #e2e8f0; font-size: 12px; line-height: 1.35;
                    cursor: pointer; transition: all 0.12s ease;
                }
                [data-chat-scope] .chat-pinned-item:hover {
                    background: rgba(139, 92, 246, 0.18);
                    border-color: rgba(139, 92, 246, 0.45);
                }
                [data-chat-scope] .chat-pinned-sender {
                    font-weight: 700; color: #c4b5fd; margin-right: 6px;
                }
                [data-chat-scope] .chat-pinned-body { color: #cbd5e1; }

                /* Search panel */
                [data-chat-scope] .chat-search-panel {
                    padding: 10px 12px;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                    background: rgba(0, 0, 0, 0.2);
                }
                /* Force the search input to stay dark with visible text.
                   Without this, browser autofill heuristics and competing
                   [data-chat-scope] input rules occasionally render it as
                   a white box with invisible text. Extra specificity +
                   explicit autofill overrides settle it definitively. */
                html body [data-chat-scope] input.chat-search-input,
                html body [data-chat-scope] input.chat-search-input:focus {
                    background: #1b1b32 !important;
                    background-color: #1b1b32 !important;
                    background-image: none !important;
                    color: #fff !important;
                    -webkit-text-fill-color: #fff !important;
                    caret-color: #fff !important;
                    border: 1px solid rgba(255, 255, 255, 0.12) !important;
                    color-scheme: dark !important;
                }
                html body [data-chat-scope] input.chat-search-input:-webkit-autofill {
                    -webkit-box-shadow: 0 0 0 100px #1b1b32 inset !important;
                    box-shadow: 0 0 0 100px #1b1b32 inset !important;
                    -webkit-text-fill-color: #fff !important;
                }
                [data-chat-scope] .chat-search-results {
                    margin-top: 8px; max-height: 260px; overflow-y: auto;
                    display: flex; flex-direction: column; gap: 4px;
                }
                [data-chat-scope] .chat-search-hint {
                    font-size: 11px; color: rgba(255, 255, 255, 0.45);
                    padding: 8px 4px; text-align: center;
                }
                [data-chat-scope] .chat-search-result {
                    display: block; width: 100%; text-align: left;
                    background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.06);
                    border-radius: 8px; padding: 8px 10px; color: #e2e8f0;
                    cursor: pointer; transition: all 0.12s ease;
                }
                [data-chat-scope] .chat-search-result:hover {
                    background: rgba(139, 92, 246, 0.14);
                    border-color: rgba(139, 92, 246, 0.42);
                }
                [data-chat-scope] .chat-search-result-meta {
                    display: flex; justify-content: space-between;
                    font-size: 10px; margin-bottom: 2px;
                }
                [data-chat-scope] .chat-search-result-sender {
                    font-weight: 700; color: #c4b5fd;
                }
                [data-chat-scope] .chat-search-result-time {
                    color: rgba(255, 255, 255, 0.4);
                }
                [data-chat-scope] .chat-search-result-body {
                    font-size: 12.5px; line-height: 1.4; color: #e2e8f0;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                /* Launcher icon does a 3D coin flip every few seconds — it
                   rests flat for most of the cycle, then spins a full 360°
                   on the Y axis. perspective() in the transform gives the
                   real 3D foreshortening as it turns edge-on. */
                @keyframes chatFabFlip {
                    0%, 72% { transform: perspective(500px) rotateY(0deg); }
                    100%    { transform: perspective(500px) rotateY(360deg); }
                }
                [data-chat-scope] .chat-fab-icon {
                    animation: chatFabFlip 3.2s ease-in-out infinite;
                    transform-style: preserve-3d;
                    backface-visibility: visible;
                }
                @media (prefers-reduced-motion: reduce) {
                    [data-chat-scope] .chat-fab-icon { animation: none; }
                }
            `}</style>

            <button
                data-chat-scope
                onClick={() => setOpen(o => !o)}
                title="Team Chat"
                style={{
                    position: 'fixed', right: 20, bottom: 20, zIndex: 1050,
                    width: 56, height: 56, borderRadius: '50%',
                    background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                    border: 'none', color: '#fff',
                    boxShadow: '0 10px 30px rgba(139,92,246,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer'
                }}
            >
                {open ? <BsX size={28} /> : <BsChatDots size={22} className="chat-fab-icon" />}
                {!open && unread > 0 && (
                    <span style={{
                        position: 'absolute', top: -4, right: -4,
                        background: '#ef4444', color: '#fff',
                        borderRadius: 10, minWidth: 20, height: 20,
                        fontSize: 11, fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '0 6px', border: '2px solid #0f0f1e'
                    }}>{unread > 99 ? '99+' : unread}</span>
                )}
            </button>

            {open && (
                <div data-chat-scope style={{
                    position: 'fixed', right: 20, bottom: 90, zIndex: 1049,
                    width: 380, height: 560, maxHeight: 'calc(100vh - 120px)',
                    background: '#1a1a2e',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 16,
                    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                    display: 'flex', flexDirection: 'column',
                    overflow: 'hidden', color: '#fff',
                    colorScheme: 'dark'
                }}>
                    {deleteTarget && (
                        <DeleteDialog
                            mine={deleteTarget.sender_id === user.id}
                            onClose={() => setDeleteTarget(null)}
                            onDelete={handleDelete}
                        />
                    )}
                    {showSpeaker && (
                        <ShareSpeakerModal
                            onClose={() => setShowSpeaker(false)}
                            onSubmit={handleShareSpeaker}
                            initialEventId={activeChat?.type === 'group' ? activeChat?.event_id : null}
                            initialEventTitle={activeChat?.type === 'group' ? activeChat?.event_title : null}
                            lockEvent={activeChat?.type === 'group' && !!activeChat?.event_id}
                        />
                    )}
                    {forwardMsg && (
                        <ForwardModal
                            message={forwardMsg}
                            conversations={conversations}
                            groups={groups}
                            currentUser={user}
                            onClose={() => setForwardMsg(null)}
                            onDone={() => { setForwardMsg(null); loadConversations(); loadGroups(); }}
                        />
                    )}
                    {showMyProfile && (
                        <MyProfileModal
                            user={user}
                            onClose={() => setShowMyProfile(false)}
                            onSaved={(u) => {
                                setUser(prev => ({ ...prev, ...u }));
                                setShowMyProfile(false);
                            }}
                        />
                    )}
                    {showGroupInfo && activeChat?.type === 'group' && (
                        <GroupInfoPanel
                            groupId={activeChat.id}
                            currentUser={user}
                            onClose={() => setShowGroupInfo(false)}
                            onUpdated={(patch) => {
                                setActiveChat(prev => prev ? { ...prev, ...patch } : prev);
                                loadGroups();
                            }}
                        />
                    )}
                    {/* Header */}
                    <div style={{
                        padding: '14px 16px',
                        borderBottom: '1px solid rgba(255,255,255,0.08)',
                        display: 'flex', alignItems: 'center', gap: 10,
                        background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(99,102,241,0.1))'
                    }}>
                        {activeChat && (
                            <button onClick={() => setActiveChat(null)}
                                style={{ background: 'none', border: 'none', color: '#fff', padding: 0, display: 'flex' }}>
                                <BsArrowLeft size={18} />
                            </button>
                        )}
                        {activeChat ? (
                            <div
                                onClick={() => { if (activeChat.type === 'group') setShowGroupInfo(true); }}
                                style={{
                                    flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 10,
                                    cursor: activeChat.type === 'group' ? 'pointer' : 'default'
                                }}>
                                <div style={{
                                    width: 34, height: 34, borderRadius: '50%',
                                    background: activeChat.photo_url ? 'transparent' : colorFor(activeChat.id),
                                    color: '#fff', overflow: 'hidden',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontWeight: 700, fontSize: 12, flexShrink: 0
                                }}>
                                    {activeChat.photo_url
                                        ? <img src={getImageUrl(activeChat.photo_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        : (activeChat.type === 'group' ? <BsPeopleFill size={15} /> : initials(activeChat.name))}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.2 }}>{activeChat.name}</div>
                                    <div style={{ fontSize: 11, opacity: 0.7 }}>
                                        {activeChat.type === 'group' ? `${activeChat.member_count || ''} members · tap for info` : (activeChat.role || '')}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div
                                onClick={() => setShowMyProfile(true)}
                                style={{
                                    flex: 1, display: 'flex', alignItems: 'center', gap: 10,
                                    cursor: 'pointer'
                                }}
                                title="Edit my profile">
                                <div style={{
                                    width: 32, height: 32, borderRadius: '50%',
                                    background: user.profile_photo_url ? 'transparent' : colorFor(user.id),
                                    color: '#fff', overflow: 'hidden', flexShrink: 0,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontWeight: 700, fontSize: 12,
                                    border: '2px solid rgba(255,255,255,0.15)'
                                }}>
                                    {user.profile_photo_url
                                        ? <img src={getImageUrl(user.profile_photo_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        : initials(user.name)}
                                </div>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.1 }}>Team Chat</div>
                                    <div style={{ fontSize: 10, opacity: 0.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {user.name} · tap to edit
                                    </div>
                                </div>
                            </div>
                        )}
                        {activeChat && (
                            <button
                                onClick={() => setSearchOpen(v => !v)}
                                title={searchOpen ? 'Close search' : 'Search messages'}
                                style={{
                                    background: searchOpen ? 'rgba(139,92,246,0.35)' : 'none',
                                    border: 'none', color: '#fff', padding: 6,
                                    borderRadius: 8, display: 'flex', cursor: 'pointer'
                                }}>
                                <BsSearch size={15} />
                            </button>
                        )}
                        {activeChat && (
                            <div style={{ position: 'relative' }} data-chat-popover>
                                <button
                                    onClick={() => setHeaderMenuOpen(v => !v)}
                                    title="More options"
                                    style={{
                                        background: headerMenuOpen ? 'rgba(139,92,246,0.35)' : 'none',
                                        border: 'none', color: '#fff', padding: 6,
                                        borderRadius: 8, display: 'flex', cursor: 'pointer'
                                    }}>
                                    <BsThreeDotsVertical size={15} />
                                </button>
                                {headerMenuOpen && (
                                    <div style={{
                                        position: 'absolute', top: 30, right: 0,
                                        background: '#252540', border: '1px solid rgba(255,255,255,0.1)',
                                        borderRadius: 10, padding: 4, minWidth: 160,
                                        boxShadow: '0 10px 30px rgba(0,0,0,0.5)', zIndex: 20
                                    }}>
                                        <button
                                            onClick={() => { setClearConfirm(true); setHeaderMenuOpen(false); }}
                                            style={{
                                                display: 'flex', width: '100%', alignItems: 'center', gap: 8,
                                                padding: '8px 10px', border: 'none', background: 'transparent',
                                                color: '#f87171', fontSize: 12, cursor: 'pointer',
                                                borderRadius: 6, textAlign: 'left'
                                            }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(248, 113, 113, 0.1)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                            <BsTrash size={13} />
                                            {activeChat.type === 'group' ? 'Clear chat' : 'Delete chat'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                        <button onClick={() => setOpen(false)}
                            style={{ background: 'none', border: 'none', color: '#fff', padding: 0, display: 'flex' }}>
                            <BsX size={22} />
                        </button>
                    </div>

                    {/* Clear-chat confirm dialog */}
                    {clearConfirm && (
                        <div style={{
                            position: 'absolute', inset: 0,
                            background: 'rgba(0, 0, 0, 0.6)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            zIndex: 40, padding: 20
                        }}>
                            <div style={{
                                background: '#1f1f36',
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                borderRadius: 14, padding: 20, maxWidth: 320, width: '100%'
                            }}>
                                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
                                    {activeChat?.type === 'group' ? 'Clear this chat?' : 'Delete this chat?'}
                                </div>
                                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5, marginBottom: 14 }}>
                                    All messages here will be removed from your view. Others in the chat will still see their copy. This can't be undone for you.
                                </div>
                                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                                    <button
                                        disabled={clearing}
                                        onClick={() => setClearConfirm(false)}
                                        style={{
                                            background: 'rgba(255,255,255,0.06)',
                                            border: '1px solid rgba(255,255,255,0.12)',
                                            color: '#fff', padding: '6px 14px', borderRadius: 8,
                                            fontSize: 12, cursor: 'pointer'
                                        }}>
                                        Cancel
                                    </button>
                                    <button
                                        disabled={clearing}
                                        onClick={async () => {
                                            if (!currentScope) return;
                                            setClearing(true);
                                            try {
                                                await clearChatForMe(currentScope);
                                                setMessages([]);
                                                setPinnedMessages([]);
                                                setHasMoreMessages(false);
                                                setClearConfirm(false);
                                                loadConversations();
                                                loadGroups();
                                            } catch (err) {
                                                alert('Could not clear: ' + (err.response?.data?.error || err.message));
                                            } finally {
                                                setClearing(false);
                                            }
                                        }}
                                        style={{
                                            background: '#ef4444', border: 'none',
                                            color: '#fff', padding: '6px 14px', borderRadius: 8,
                                            fontSize: 12, fontWeight: 600, cursor: clearing ? 'wait' : 'pointer',
                                            opacity: clearing ? 0.7 : 1
                                        }}>
                                        {clearing ? 'Clearing…' : (activeChat?.type === 'group' ? 'Clear chat' : 'Delete chat')}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Pinned message strip — only ever one, enforced by the
                        backend. Clicking it scrolls the thread to the message
                        and flashes it via the highlight class. */}
                    {activeChat && pinnedMessages.length > 0 && !searchOpen && (() => {
                        const p = pinnedMessages[0];
                        return (
                            <div className="chat-pinned-strip">
                                <div className="chat-pinned-header">
                                    <BsPinAngleFill size={11} />
                                    <span>Pinned message</span>
                                </div>
                                <button
                                    type="button"
                                    className="chat-pinned-item"
                                    onClick={() => jumpToMessage(p.id)}
                                    title="Jump to this message"
                                >
                                    <span className="chat-pinned-body">
                                        {p.speaker_id
                                            ? 'Shared a speaker card'
                                            : p.attachment_type === 'image'
                                                ? 'Shared a photo'
                                                : p.attachment_type === 'video'
                                                    ? 'Shared a video'
                                                    : p.attachment_url
                                                        ? `Shared an attachment${p.attachment_name ? ' · ' + p.attachment_name : ''}`
                                                        : p.body
                                                            ? (p.body.length > 90 ? p.body.slice(0, 90) + '…' : p.body)
                                                            : '(no text)'}
                                    </span>
                                </button>
                            </div>
                        );
                    })()}

                    {/* Search panel — slides below the header, searches within
                        the current conversation only. Clicking a result jumps
                        to that message in the thread. */}
                    {activeChat && searchOpen && (
                        <div className="chat-search-panel">
                            <div style={{ position: 'relative' }}>
                                <BsSearch style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.45)', fontSize: 13, zIndex: 1 }} />
                                <input
                                    autoFocus
                                    type="text"
                                    autoComplete="off"
                                    spellCheck="false"
                                    className="chat-search-input"
                                    value={searchQuery}
                                    onChange={e => setSearchQuery(e.target.value)}
                                    placeholder="Search in this chat…"
                                    style={{
                                        width: '100%', padding: '8px 32px 8px 32px',
                                        borderRadius: 8, fontSize: 13, outline: 'none'
                                    }}
                                />
                                {searchQuery && (
                                    <button
                                        type="button"
                                        onClick={() => setSearchQuery('')}
                                        title="Clear"
                                        style={{
                                            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
                                            background: 'none', border: 'none', color: 'rgba(255,255,255,0.55)',
                                            padding: 4, display: 'flex', cursor: 'pointer'
                                        }}>
                                        <BsX size={14} />
                                    </button>
                                )}
                            </div>
                            <div className="chat-search-results">
                                {searchQuery.trim().length < 2 ? (
                                    <div className="chat-search-hint">Type at least 2 characters to search</div>
                                ) : searching ? (
                                    <div className="chat-search-hint">Searching…</div>
                                ) : searchResults.length === 0 ? (
                                    <div className="chat-search-hint">No messages match "{searchQuery}"</div>
                                ) : (
                                    searchResults.map(r => (
                                        <button
                                            key={r.id}
                                            type="button"
                                            className="chat-search-result"
                                            onClick={() => jumpToMessage(r.id)}
                                        >
                                            <div className="chat-search-result-meta">
                                                <span className="chat-search-result-sender">{r.sender_name || 'Unknown'}</span>
                                                <span className="chat-search-result-time">{formatTime(r.created_at)}</span>
                                            </div>
                                            <div className="chat-search-result-body">
                                                {highlightMatch(r.body || '', searchQuery)}
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>
                        </div>
                    )}

                    {!activeChat ? (
                        <>
                            {/* Tabs */}
                            <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                                <TabBtn active={tab === 'direct'} onClick={() => setTab('direct')} badge={dmUnreadTotal}>Direct</TabBtn>
                                <TabBtn active={tab === 'groups'} onClick={() => setTab('groups')} badge={groupUnreadTotal}>Groups</TabBtn>
                            </div>

                            <div style={{ padding: 10, borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 8 }}>
                                <div style={{ position: 'relative', flex: 1 }}>
                                    <BsSearch style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'rgba(255,255,255,0.4)', fontSize: 13 }} />
                                    <input
                                        value={search}
                                        onChange={e => setSearch(e.target.value)}
                                        placeholder={tab === 'direct' ? 'Search teammates…' : 'Search groups…'}
                                        style={{
                                            width: '100%', padding: '8px 10px 8px 32px',
                                            background: '#262640',
                                            border: '1px solid rgba(255,255,255,0.08)',
                                            borderRadius: 8, color: '#fff', fontSize: 13, outline: 'none'
                                        }}
                                    />
                                </div>
                                {tab === 'groups' && isManagerish && (
                                    <button
                                        onClick={() => setShowCreate(true)}
                                        title="Create group"
                                        style={{
                                            width: 36, height: 36, borderRadius: 8,
                                            border: 'none', color: '#fff',
                                            background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            cursor: 'pointer', flexShrink: 0
                                        }}
                                    >
                                        <BsPlus size={20} />
                                    </button>
                                )}
                            </div>

                            <div style={{ flex: 1, overflowY: 'auto' }}>
                                {tab === 'direct' ? (
                                    filteredDms.length === 0 ? (
                                        <EmptyState text="No teammates found" />
                                    ) : filteredDms.map(c => (
                                        <ListItem key={c.id}
                                            color={colorFor(c.id)}
                                            avatarImage={c.profile_photo_url ? getImageUrl(c.profile_photo_url) : null}
                                            avatarText={initials(c.name)}
                                            title={c.name}
                                            subtitle={c.last_message ? (c.last_message.sender_id === user.id ? 'You: ' : '') + (c.last_message.body || (c.last_message.attachment_type === 'image' ? '📷 Photo' : '📎 ' + (c.last_message.attachment_name || 'Attachment'))) : 'Start a conversation'}
                                            time={c.last_message?.created_at}
                                            badge={c.unread_count}
                                            onClick={() => openChat({ type: 'user', id: c.id, name: c.name, role: c.role, photo_url: c.profile_photo_url })}
                                        />
                                    ))
                                ) : (
                                    filteredGroups.length === 0 ? (
                                        <EmptyState text={isManagerish ? 'No groups yet. Click + to create one.' : 'You are not part of any group yet.'} />
                                    ) : filteredGroups.map(g => (
                                        <ListItem key={g.id}
                                            color={colorFor(g.id)}
                                            avatarImage={g.photo_url ? getImageUrl(g.photo_url) : null}
                                            avatarNode={<BsPeopleFill size={15} />}
                                            title={g.name}
                                            subtitle={g.last_message
                                                ? (g.last_message.message_type === 'bot_report'
                                                    ? `${g.last_message.sender_name || 'Someone'} ran 📊 Event Report`
                                                    : `${g.last_message.sender_id === user.id ? 'You' : (g.last_message.sender_name || 'Someone')}: ${g.last_message.body || (g.last_message.attachment_type === 'image' ? '📷 Photo' : '📎 ' + (g.last_message.attachment_name || 'Attachment'))}`)
                                                : `${g.member_count} members${g.event_title ? ' · ' + g.event_title : ''}`}
                                            time={g.last_message?.created_at}
                                            badge={g.unread_count}
                                            onClick={() => openChat({ type: 'group', id: g.id, name: g.name, member_count: g.member_count, photo_url: g.photo_url, event_id: g.event_id, event_title: g.event_title })}
                                        />
                                    ))
                                )}
                            </div>
                        </>
                    ) : (
                        <>
                            <div
                                ref={scrollRef}
                                onScroll={(e) => {
                                    const el = e.currentTarget;
                                    // Track whether the user is parked near the bottom so the
                                    // auto-scroll effect knows whether to follow new messages.
                                    isNearBottomRef.current =
                                        el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
                                    // Trigger older-page load when the user scrolls within 80px of the top.
                                    if (el.scrollTop < 80 && hasMoreMessages && !loadingOlder) {
                                        loadOlder();
                                    }
                                }}
                                style={{
                                    flex: 1, overflowY: 'auto', padding: 14,
                                    display: 'flex', flexDirection: 'column', gap: 6
                                }}>
                                {/* Top loader — shown while we're pulling older history. */}
                                {loadingOlder && (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '8px 0', color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>
                                        <div style={{
                                            width: 14, height: 14, borderRadius: '50%',
                                            border: '2px solid rgba(255,255,255,0.12)',
                                            borderTopColor: 'rgba(255,255,255,0.55)',
                                            animation: 'chatSpin 0.8s linear infinite'
                                        }} />
                                        Loading older messages…
                                    </div>
                                )}
                                {/* Subtle hint that we've reached the very start of the thread. */}
                                {!hasMoreMessages && messages.length >= MESSAGE_PAGE_SIZE && (
                                    <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 10, padding: '6px 0' }}>
                                        — Beginning of conversation —
                                    </div>
                                )}
                                {messages.length === 0 ? (
                                    <div style={{ margin: 'auto', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
                                        {activeChat.type === 'group' ? `Start the conversation in ${activeChat.name}` : `Say hi to ${activeChat.name.split(' ')[0]} 👋`}
                                    </div>
                                ) : messages.map((m, i) => {
                                    if (m.message_type === 'bot_report') {
                                        return (
                                            <div key={m.id} id={`chat-msg-${m.id}`} style={{ width: '100%' }}>
                                                <BotReportCard m={m} />
                                            </div>
                                        );
                                    }
                                    return (
                                        <MessageRow
                                            key={m.id}
                                            m={m}
                                            prev={messages[i - 1]}
                                            userId={user.id}
                                            userName={user.name}
                                            isGroup={isGroupChat}
                                            groupMemberNames={groupMemberNames}
                                            highlighted={highlightMsgId === m.id}
                                            menuOpen={menuOpenId === m.id}
                                            reactPickerOpen={reactPickerId === m.id}
                                            onToggleMenu={handleToggleMenu}
                                            onReply={handleReplyClick}
                                            onCopy={handleCopy}
                                            onReact={handleReact}
                                            onTogglePin={handleTogglePin}
                                            onForward={handleForwardClick}
                                            onDelete={handleDeleteClick}
                                            onOpenReactPicker={handleOpenReactPicker}
                                            onCloseReactPicker={handleCloseReactPicker}
                                            onOpenSpeakerPage={handleOpenSpeakerPage}
                                        />
                                    );
                                })}
                                {peerTyping && activeChat.type === 'user' && (
                                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, marginTop: 4 }}>
                                        <div style={{
                                            padding: '10px 14px', borderRadius: 14, borderBottomLeftRadius: 4,
                                            background: '#2d2d47', display: 'flex', gap: 4, alignItems: 'center'
                                        }}>
                                            <span className="chat-typing-dot" style={{ animationDelay: '0s' }} />
                                            <span className="chat-typing-dot" style={{ animationDelay: '0.15s' }} />
                                            <span className="chat-typing-dot" style={{ animationDelay: '0.3s' }} />
                                        </div>
                                        <span style={{ fontSize: 10, opacity: 0.5 }}>
                                            {activeChat.name.split(' ')[0]} is typing…
                                        </span>
                                    </div>
                                )}
                            </div>
                            <input ref={fileInputRef} type="file" hidden onChange={handleFilePicked} />
                            <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={handleFilePicked} />

                            {mentionQuery !== null && mentionCandidates.length > 0 && (
                                <div style={{
                                    borderTop: '1px solid rgba(255,255,255,0.08)',
                                    background: '#252540',
                                    maxHeight: 160, overflowY: 'auto'
                                }}>
                                    {mentionCandidates.map((m, i) => (
                                        <div key={m.id}
                                            onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}
                                            onMouseEnter={() => setMentionIdx(i)}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 10,
                                                padding: '7px 12px', cursor: 'pointer',
                                                background: i === mentionIdx ? 'rgba(139,92,246,0.18)' : 'transparent'
                                            }}>
                                            {m.kind === 'bot' ? (
                                                <div style={{
                                                    width: 26, height: 26, borderRadius: '50%',
                                                    background: '#8b5cf6', color: '#fff',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    fontSize: 13, flexShrink: 0
                                                }}>📊</div>
                                            ) : (
                                                <div style={{
                                                    width: 26, height: 26, borderRadius: '50%',
                                                    background: m.profile_photo_url ? 'transparent' : colorFor(m.id),
                                                    color: '#fff', overflow: 'hidden',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                    fontWeight: 700, fontSize: 10, flexShrink: 0
                                                }}>
                                                    {m.profile_photo_url
                                                        ? <img src={getImageUrl(m.profile_photo_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                        : initials(m.name)}
                                                </div>
                                            )}
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: 12, fontWeight: 500 }}>
                                                    {m.kind === 'bot' ? `@${m.name}` : m.name}
                                                </div>
                                                <div style={{ fontSize: 10, opacity: 0.6, textTransform: m.kind === 'bot' ? 'none' : 'capitalize' }}>
                                                    {m.kind === 'bot' ? m.hint : m.role}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {replyTo && (
                                <div style={{
                                    padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,0.08)',
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    background: 'rgba(99,102,241,0.1)',
                                    borderLeft: '3px solid #8b5cf6'
                                }}>
                                    <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                                        <div style={{ fontWeight: 600, color: '#a78bfa' }}>
                                            Replying to {replyTo.sender_id === user.id ? 'yourself' : (replyTo.sender_name || 'User')}
                                        </div>
                                        <div style={{ opacity: 0.8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {replyTo.body || (replyTo.attachment_type === 'image' ? '📷 Photo' : '📎 ' + (replyTo.attachment_name || 'Attachment'))}
                                        </div>
                                    </div>
                                    <button onClick={() => setReplyTo(null)}
                                        style={{
                                            background: 'rgba(0,0,0,0.3)', border: 'none',
                                            color: '#fff', width: 22, height: 22, borderRadius: '50%',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            cursor: 'pointer'
                                        }}><BsX size={16} /></button>
                                </div>
                            )}

                            {pendingFile && (
                                <div style={{
                                    padding: '8px 10px', borderTop: '1px solid rgba(255,255,255,0.08)',
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    background: 'rgba(139,92,246,0.08)'
                                }}>
                                    {pendingPreview ? (
                                        <img src={pendingPreview} alt=""
                                            style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover' }} />
                                    ) : (
                                        <div style={{
                                            width: 44, height: 44, borderRadius: 6,
                                            background: '#2d2d47',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center'
                                        }}>
                                            <BsFileEarmark size={20} />
                                        </div>
                                    )}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {pendingFile.name}
                                        </div>
                                        <div style={{ fontSize: 10, opacity: 0.6 }}>{formatSize(pendingFile.size)}</div>
                                    </div>
                                    <button onClick={clearPending}
                                        style={{
                                            background: 'rgba(0,0,0,0.3)', border: 'none',
                                            color: '#fff', width: 22, height: 22, borderRadius: '50%',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            cursor: 'pointer'
                                        }}>
                                        <BsX size={16} />
                                    </button>
                                </div>
                            )}

                            <div style={{
                                padding: 10, borderTop: '1px solid rgba(255,255,255,0.08)',
                                display: 'flex', gap: 6, alignItems: 'flex-end'
                            }}>
                                <button onClick={() => pickFile('image/*')} title="Send image"
                                    style={{
                                        width: 34, height: 34, borderRadius: 8, border: 'none',
                                        background: 'transparent', color: 'rgba(255,255,255,0.7)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        cursor: 'pointer', flexShrink: 0
                                    }}>
                                    <BsImage size={16} />
                                </button>
                                <button onClick={() => pickFile('*')} title="Attach file"
                                    style={{
                                        width: 34, height: 34, borderRadius: 8, border: 'none',
                                        background: 'transparent', color: 'rgba(255,255,255,0.7)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        cursor: 'pointer', flexShrink: 0
                                    }}>
                                    <BsPaperclip size={16} />
                                </button>
                                <button onClick={() => setShowSpeaker(true)} title="Share speaker (adds to Speakers tab)"
                                    style={{
                                        width: 34, height: 34, borderRadius: 8, border: 'none',
                                        background: 'transparent', color: 'rgba(255,255,255,0.7)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        cursor: 'pointer', flexShrink: 0
                                    }}>
                                    <BsPersonBadge size={16} />
                                </button>
                                <textarea
                                    ref={inputRef}
                                    value={draft}
                                    onChange={handleDraftChange}
                                    onKeyDown={onKeyDown}
                                    placeholder="Type a message…"
                                    rows={1}
                                    autoComplete="off"
                                    spellCheck={false}
                                    className="chat-composer-input"
                                    style={{
                                        flex: 1, resize: 'none',
                                        background: '#262640',
                                        backgroundColor: '#262640',
                                        border: '1px solid rgba(255,255,255,0.08)',
                                        borderRadius: 10, color: '#fff',
                                        WebkitTextFillColor: '#fff',
                                        padding: '8px 10px', fontSize: 13, outline: 'none', maxHeight: 90,
                                        colorScheme: 'dark'
                                    }}
                                />
                                <button
                                    onClick={send}
                                    disabled={!draft.trim() && !pendingFile}
                                    style={{
                                        width: 36, height: 36, borderRadius: '50%', border: 'none', color: '#fff',
                                        background: (draft.trim() || pendingFile) ? 'linear-gradient(135deg, #8b5cf6, #6366f1)' : '#2d2d47',
                                        cursor: (draft.trim() || pendingFile) ? 'pointer' : 'not-allowed',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                                    }}
                                >
                                    <BsSendFill size={13} />
                                </button>
                            </div>
                        </>
                    )}
                </div>
            )}

            {showCreate && (
                <CreateGroupModal
                    onClose={() => setShowCreate(false)}
                    onCreated={() => { setShowCreate(false); loadGroups(); setTab('groups'); }}
                />
            )}
        </>
    );
}

function MessageActionMenu({ mine, onReply, onCopy, onReact, onPin, onForward, onDelete, isPinned }) {
    const items = [
        { label: 'Reply', icon: BsReply, onClick: onReply },
        { label: 'React', icon: BsEmojiSmile, onClick: onReact },
        ...(onCopy ? [{ label: 'Copy', icon: BsClipboard, onClick: onCopy }] : []),
        ...(onPin ? [{ label: isPinned ? 'Unpin' : 'Pin', icon: isPinned ? BsPinAngleFill : BsPinAngle, onClick: onPin }] : []),
        { label: 'Forward', icon: BsShare, onClick: onForward },
        { label: 'Delete', icon: BsTrash, onClick: onDelete, danger: true }
    ];
    return (
        <div data-chat-popover style={{
            position: 'absolute', top: 24, [mine ? 'right' : 'left']: 28,
            background: '#252540', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 10, padding: 4,
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            zIndex: 10, minWidth: 140
        }}>
            {items.map(it => (
                <button key={it.label} onClick={it.onClick}
                    style={{
                        display: 'flex', width: '100%', alignItems: 'center', gap: 8,
                        padding: '7px 10px', border: 'none', background: 'transparent',
                        color: it.danger ? '#f87171' : '#fff',
                        fontSize: 12, cursor: 'pointer', borderRadius: 6, textAlign: 'left'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <it.icon size={13} /> {it.label}
                </button>
            ))}
        </div>
    );
}

const QUICK_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
function EmojiPicker({ mine, onPick, onClose }) {
    return (
        <div data-chat-popover style={{
            position: 'absolute', top: -40, [mine ? 'right' : 'left']: 0,
            background: '#252540', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 20, padding: '4px 8px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
            zIndex: 10, display: 'flex', gap: 4
        }}>
            {QUICK_EMOJIS.map(e => (
                <button key={e} onClick={() => onPick(e)}
                    style={{ border: 'none', background: 'transparent', fontSize: 18, cursor: 'pointer', padding: 4, borderRadius: 4 }}
                    onMouseEnter={ev => ev.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                    onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}>
                    {e}
                </button>
            ))}
            <button onClick={onClose}
                style={{ border: 'none', background: 'transparent', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: 4 }}>
                <BsX size={14} />
            </button>
        </div>
    );
}

function ForwardModal({ message, conversations, groups, currentUser, onClose, onDone }) {
    const [picked, setPicked] = useState([]);
    const [sending, setSending] = useState(false);
    const [search, setSearch] = useState('');

    const toggle = (target) => {
        const key = `${target.type}-${target.id}`;
        setPicked(prev => {
            const found = prev.find(t => `${t.type}-${t.id}` === key);
            return found ? prev.filter(t => `${t.type}-${t.id}` !== key) : [...prev, target];
        });
    };
    const isPicked = (t) => picked.some(p => p.type === t.type && p.id === t.id);

    const allTargets = [
        ...conversations.filter(c => c.id !== currentUser.id).map(c => ({
            type: 'user', id: c.id, name: c.name, sub: c.role, photo: c.profile_photo_url, color: colorFor(c.id), initials: initials(c.name)
        })),
        ...groups.map(g => ({
            type: 'group', id: g.id, name: g.name, sub: `${g.member_count || ''} members`, photo: g.photo_url, color: colorFor(g.id), isGroup: true
        }))
    ].filter(t => !search.trim() || t.name?.toLowerCase().includes(search.toLowerCase()));

    const handleSend = async () => {
        if (picked.length === 0) return;
        setSending(true);
        try {
            await forwardMessage(message.id, picked.map(t => ({ type: t.type, id: t.id })));
            onDone?.();
        } catch {}
        finally { setSending(false); }
    };

    const preview = message.body || (message.attachment_type === 'image' ? '📷 Photo' : message.attachment_url ? `📎 ${message.attachment_name}` : '');

    return (
        <div onClick={onClose}
            style={{
                position: 'absolute', inset: 0, zIndex: 25,
                background: 'rgba(0,0,0,0.55)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 14, borderRadius: 16
            }}>
            <div onClick={e => e.stopPropagation()}
                style={{
                    background: '#1a1a2e', borderRadius: 14,
                    border: '1px solid rgba(255,255,255,0.12)',
                    padding: 14, width: '100%', maxWidth: 340,
                    display: 'flex', flexDirection: 'column', maxHeight: '86%',
                    color: '#fff', boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>Forward to…</div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, display: 'flex' }}>
                        <BsX size={20} />
                    </button>
                </div>
                {preview && (
                    <div style={{
                        background: '#262640', padding: '6px 10px', borderRadius: 8,
                        fontSize: 11, opacity: 0.85, marginBottom: 10,
                        borderLeft: '3px solid #8b5cf6',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                    }}>{preview}</div>
                )}
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                    style={{ ...inputStyle, marginBottom: 8 }} />
                <div style={{ flex: 1, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}>
                    {allTargets.length === 0 ? (
                        <div style={{ padding: 16, textAlign: 'center', opacity: 0.5, fontSize: 12 }}>No conversations</div>
                    ) : allTargets.map(t => {
                        const active = isPicked(t);
                        return (
                            <label key={`${t.type}-${t.id}`}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    padding: '8px 10px', cursor: 'pointer',
                                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                                    background: active ? 'rgba(139,92,246,0.15)' : 'transparent'
                                }}>
                                <input type="checkbox" checked={active} onChange={() => toggle(t)} />
                                <div style={{
                                    width: 30, height: 30, borderRadius: '50%',
                                    background: t.photo ? 'transparent' : t.color,
                                    color: '#fff', overflow: 'hidden',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontWeight: 700, fontSize: 10
                                }}>
                                    {t.photo
                                        ? <img src={getImageUrl(t.photo)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                        : (t.isGroup ? <BsPeopleFill size={13} /> : t.initials)}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 12, fontWeight: 500 }}>{t.name}</div>
                                    <div style={{ fontSize: 10, opacity: 0.6, textTransform: 'capitalize' }}>{t.sub}</div>
                                </div>
                            </label>
                        );
                    })}
                </div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
                    <button onClick={onClose}
                        style={{
                            padding: '7px 14px', border: '1px solid rgba(255,255,255,0.12)',
                            background: 'transparent', color: 'rgba(255,255,255,0.7)',
                            borderRadius: 8, fontSize: 12, cursor: 'pointer'
                        }}>Cancel</button>
                    <button onClick={handleSend} disabled={sending || picked.length === 0}
                        style={{
                            padding: '7px 14px', border: 'none',
                            background: picked.length > 0 ? 'linear-gradient(135deg, #8b5cf6, #6366f1)' : '#2d2d47',
                            color: '#fff', borderRadius: 8, fontSize: 12, fontWeight: 600,
                            cursor: picked.length > 0 ? 'pointer' : 'not-allowed',
                            opacity: sending ? 0.7 : 1
                        }}>{sending ? 'Sending…' : `Forward${picked.length > 0 ? ` (${picked.length})` : ''}`}</button>
                </div>
            </div>
        </div>
    );
}

function MyProfileModal({ user, onClose, onSaved }) {
    const [name, setName] = useState(user.name || '');
    const [email, setEmail] = useState(user.email || '');
    // `currentPassword` is only required when the user actually changes
    // their email — the modal hides the field until they edit the address.
    const [currentPassword, setCurrentPassword] = useState('');
    const [photo, setPhoto] = useState(null);
    const [preview, setPreview] = useState(user.profile_photo_url ? getImageUrl(user.profile_photo_url) : '');
    const [removePhoto, setRemovePhoto] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const inputRef = useRef(null);

    const emailChanged = email.trim().toLowerCase() !== (user.email || '').trim().toLowerCase();

    const handleFile = (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        setPhoto(f);
        setPreview(URL.createObjectURL(f));
        setRemovePhoto(false);
    };

    const clearPhoto = () => {
        setPhoto(null);
        setPreview('');
        setRemovePhoto(true);
    };

    const save = async () => {
        if (!name.trim()) return setError('Name is required');
        if (emailChanged) {
            if (!email.trim()) return setError('Email cannot be empty');
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email address');
            if (!currentPassword) return setError('Enter your current password to change your email');
        }
        setError('');
        setSaving(true);
        try {
            const r = await updateMyProfile({
                name: name.trim(),
                photo, removePhoto,
                email: emailChanged ? email.trim() : undefined,
                currentPassword: emailChanged ? currentPassword : undefined,
            });
            onSaved?.(r.data);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to save');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div onClick={onClose}
            style={{
                position: 'absolute', inset: 0, zIndex: 25,
                background: 'rgba(0,0,0,0.55)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 14, borderRadius: 16
            }}>
            <div onClick={e => e.stopPropagation()}
                style={{
                    background: '#1a1a2e', borderRadius: 14,
                    border: '1px solid rgba(255,255,255,0.12)',
                    padding: 16, width: '100%', maxWidth: 320,
                    color: '#fff', boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>My Profile</div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, display: 'flex' }}>
                        <BsX size={20} />
                    </button>
                </div>
                {error && (
                    <div style={{
                        background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                        color: '#f87171', padding: '6px 10px', borderRadius: 6, fontSize: 11, marginBottom: 10
                    }}>{error}</div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 14 }}>
                    <div
                        onClick={() => inputRef.current?.click()}
                        style={{
                            width: 84, height: 84, borderRadius: '50%',
                            background: preview ? 'transparent' : colorFor(user.id),
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', overflow: 'hidden',
                            border: '2px solid rgba(255,255,255,0.1)', position: 'relative'
                        }}>
                        {preview
                            ? <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <span style={{ fontWeight: 700, fontSize: 24 }}>{initials(user.name)}</span>}
                        <div style={{
                            position: 'absolute', bottom: 0, left: 0, right: 0,
                            background: 'rgba(0,0,0,0.6)', color: '#fff',
                            fontSize: 9, padding: '3px 0', textAlign: 'center', fontWeight: 600
                        }}>EDIT</div>
                    </div>
                    <input ref={inputRef} type="file" accept="image/*" hidden onChange={handleFile} />
                    {preview && (
                        <button onClick={clearPhoto}
                            style={{
                                marginTop: 8, background: 'transparent',
                                border: '1px solid rgba(255,255,255,0.12)',
                                color: 'rgba(255,255,255,0.7)', padding: '3px 10px',
                                fontSize: 10, borderRadius: 12, cursor: 'pointer'
                            }}>Remove photo</button>
                    )}
                </div>
                <div>
                    <label style={{ fontSize: 11, opacity: 0.7, display: 'block', marginBottom: 4 }}>Display name</label>
                    <input value={name} onChange={e => setName(e.target.value)}
                        style={{ ...inputStyle, padding: '8px 10px' }} />
                </div>
                <div style={{ marginTop: 10 }}>
                    <label style={{ fontSize: 11, opacity: 0.7, display: 'block', marginBottom: 4 }}>Email address</label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                        style={{ ...inputStyle, padding: '8px 10px' }} />
                </div>
                {emailChanged && (
                    <div style={{ marginTop: 10 }}>
                        <label style={{ fontSize: 11, opacity: 0.7, display: 'block', marginBottom: 4 }}>
                            Current password <span style={{ color: '#f59e0b' }}>(required to change email)</span>
                        </label>
                        <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
                            autoComplete="current-password"
                            style={{ ...inputStyle, padding: '8px 10px' }} />
                    </div>
                )}
                <div style={{ fontSize: 10, opacity: 0.5, marginTop: 8 }}>
                    {user.role}
                </div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 14 }}>
                    <button onClick={onClose}
                        style={{
                            padding: '7px 14px', border: '1px solid rgba(255,255,255,0.12)',
                            background: 'transparent', color: 'rgba(255,255,255,0.7)',
                            borderRadius: 8, fontSize: 12, cursor: 'pointer'
                        }}>Cancel</button>
                    <button onClick={save} disabled={saving}
                        style={{
                            padding: '7px 14px', border: 'none',
                            background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                            color: '#fff', borderRadius: 8, fontSize: 12, fontWeight: 600,
                            cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1
                        }}>{saving ? 'Saving…' : 'Save'}</button>
                </div>
            </div>
        </div>
    );
}

function GroupInfoPanel({ groupId, currentUser, onClose, onUpdated }) {
    const [group, setGroup] = useState(null);
    const [media, setMedia] = useState([]);
    const [tab, setTab] = useState('info');
    const [editField, setEditField] = useState(null);
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const [showAddMembers, setShowAddMembers] = useState(false);
    const [allUsers, setAllUsers] = useState([]);
    const [pickedUsers, setPickedUsers] = useState(new Set());
    const [userSearch, setUserSearch] = useState('');
    const photoInputRef = useRef(null);

    const loadGroup = () => {
        getChatGroup(groupId).then(r => setGroup(r.data)).catch(() => {});
    };

    useEffect(() => {
        loadGroup();
        getGroupMedia(groupId).then(r => setMedia(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    }, [groupId]);

    useEffect(() => {
        if (showAddMembers && allUsers.length === 0) {
            getUsers().then(r => setAllUsers(Array.isArray(r.data) ? r.data : [])).catch(() => {});
        }
    }, [showAddMembers]);

    const isManagerish = currentUser.role === 'admin' || currentUser.role === 'manager';
    const canEdit = group && (isManagerish || group.created_by === currentUser.id);
    const canManageMembers = isManagerish;

    const handlePhotoChange = async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        try {
            const r = await updateGroupPhoto(groupId, f);
            setGroup(prev => ({ ...prev, photo_url: r.data.photo_url }));
            onUpdated?.({ photo_url: r.data.photo_url });
        } catch {}
    };

    const togglePick = (id) => {
        const next = new Set(pickedUsers);
        if (next.has(id)) next.delete(id); else next.add(id);
        setPickedUsers(next);
    };

    const confirmAddMembers = async () => {
        if (pickedUsers.size === 0) return;
        try {
            await addGroupMembers(groupId, Array.from(pickedUsers));
            setPickedUsers(new Set());
            setShowAddMembers(false);
            setUserSearch('');
            loadGroup();
        } catch {}
    };

    const handleRemoveMember = async (memberId) => {
        if (!window.confirm('Remove this member from the group?')) return;
        try {
            await removeGroupMember(groupId, memberId);
            loadGroup();
        } catch {}
    };

    const startEdit = (field) => {
        setDraft(group?.[field] || '');
        setEditField(field);
    };

    const saveField = async () => {
        if (!editField) return;
        setSaving(true);
        try {
            await updateChatGroup(groupId, { [editField]: draft });
            setGroup(prev => ({ ...prev, [editField]: draft }));
            if (editField === 'name') onUpdated?.({ name: draft });
            setEditField(null);
        } catch {} finally { setSaving(false); }
    };

    const images = media.filter(m => m.attachment_type === 'image');
    const files = media.filter(m => m.attachment_type !== 'image');

    const FieldRow = ({ icon: Icon, label, field, value, multiline }) => (
        <div style={{
            display: 'flex', gap: 10, padding: '10px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            alignItems: 'flex-start'
        }}>
            <Icon size={16} style={{ marginTop: 2, color: 'rgba(255,255,255,0.6)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, opacity: 0.6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {label}
                </div>
                {editField === field ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginTop: 4 }}>
                        {multiline ? (
                            <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3}
                                style={{ ...inputStyle, resize: 'vertical' }} autoFocus />
                        ) : (
                            <input value={draft} onChange={e => setDraft(e.target.value)}
                                style={inputStyle} autoFocus
                                onKeyDown={e => { if (e.key === 'Enter') saveField(); if (e.key === 'Escape') setEditField(null); }} />
                        )}
                        <button onClick={saveField} disabled={saving}
                            style={{
                                width: 28, height: 28, borderRadius: 6, border: 'none',
                                background: 'linear-gradient(135deg, #8b5cf6, #6366f1)', color: '#fff',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                cursor: 'pointer', flexShrink: 0
                            }}><BsCheck2 size={14} /></button>
                    </div>
                ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                        <div style={{ flex: 1, fontSize: 13, whiteSpace: 'pre-wrap', color: value ? '#fff' : 'rgba(255,255,255,0.4)' }}>
                            {field === 'drive_link' && value ? (
                                <a href={value} target="_blank" rel="noreferrer" style={{ color: '#a78bfa', textDecoration: 'none', wordBreak: 'break-all' }}>
                                    {value}
                                </a>
                            ) : (value || `Add ${label.toLowerCase()}`)}
                        </div>
                        {canEdit && (
                            <button onClick={() => startEdit(field)}
                                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: 2 }}>
                                <BsPencilSquare size={12} />
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div style={{
            position: 'absolute', inset: 0, zIndex: 15,
            background: '#1a1a2e', display: 'flex', flexDirection: 'column',
            borderRadius: 16, overflow: 'hidden'
        }}>
            <div style={{
                padding: '14px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                display: 'flex', alignItems: 'center', gap: 10,
                background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(99,102,241,0.1))'
            }}>
                <button onClick={onClose}
                    style={{ background: 'none', border: 'none', color: '#fff', padding: 0, display: 'flex' }}>
                    <BsArrowLeft size={18} />
                </button>
                <div style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>Group Info</div>
                <button onClick={onClose}
                    style={{ background: 'none', border: 'none', color: '#fff', padding: 0, display: 'flex' }}>
                    <BsX size={22} />
                </button>
            </div>

            <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <TabBtn active={tab === 'info'} onClick={() => setTab('info')}>Info</TabBtn>
                <TabBtn active={tab === 'media'} onClick={() => setTab('media')}>Media & Files</TabBtn>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
                {!group ? (
                    <div style={{ padding: 24, textAlign: 'center', opacity: 0.5, fontSize: 12 }}>Loading…</div>
                ) : tab === 'info' ? (
                    <>
                        <div style={{
                            padding: 20, textAlign: 'center',
                            borderBottom: '1px solid rgba(255,255,255,0.06)'
                        }}>
                            <div
                                onClick={() => canEdit && photoInputRef.current?.click()}
                                style={{
                                    width: 80, height: 80, borderRadius: '50%',
                                    margin: '0 auto 10px',
                                    background: group.photo_url ? 'transparent' : colorFor(group.id),
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    cursor: canEdit ? 'pointer' : 'default',
                                    position: 'relative', overflow: 'hidden',
                                    border: '2px solid rgba(255,255,255,0.08)'
                                }}
                                title={canEdit ? 'Click to change photo' : ''}>
                                {group.photo_url ? (
                                    <img src={getImageUrl(group.photo_url)} alt=""
                                        style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                    <BsPeopleFill size={32} />
                                )}
                                {canEdit && (
                                    <div style={{
                                        position: 'absolute', bottom: 0, left: 0, right: 0,
                                        background: 'rgba(0,0,0,0.6)', color: '#fff',
                                        fontSize: 9, padding: '3px 0', textAlign: 'center', fontWeight: 600
                                    }}>EDIT</div>
                                )}
                            </div>
                            <input ref={photoInputRef} type="file" accept="image/*" hidden onChange={handlePhotoChange} />
                            <div style={{ fontWeight: 600, fontSize: 15 }}>{group.name}</div>
                            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
                                {group.event_title ? `Event: ${group.event_title} · ` : ''}{group.members?.length || 0} members
                            </div>
                        </div>

                        <FieldRow icon={BsPencilSquare} label="Name" field="name" value={group.name} />
                        <FieldRow icon={BsInfoCircle} label="Description" field="description" value={group.description} multiline />
                        <FieldRow icon={BsLink45Deg} label="Drive Link" field="drive_link" value={group.drive_link} />

                        <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                marginBottom: 8
                            }}>
                                <div style={{ fontSize: 10, opacity: 0.6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                    Members ({group.members?.length || 0})
                                </div>
                                {canManageMembers && (
                                    <button onClick={() => setShowAddMembers(true)}
                                        style={{
                                            padding: '4px 10px', fontSize: 11, fontWeight: 600,
                                            border: 'none', borderRadius: 6,
                                            background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                                            color: '#fff', cursor: 'pointer',
                                            display: 'flex', alignItems: 'center', gap: 4
                                        }}>
                                        <BsPlus size={14} /> Add
                                    </button>
                                )}
                            </div>
                            {(group.members || []).map(mem => (
                                <div key={mem.id}
                                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
                                    <div style={{
                                        width: 30, height: 30, borderRadius: '50%',
                                        background: mem.profile_photo_url ? 'transparent' : colorFor(mem.id),
                                        color: '#fff', overflow: 'hidden',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontWeight: 700, fontSize: 11
                                    }}>
                                        {mem.profile_photo_url
                                            ? <img src={getImageUrl(mem.profile_photo_url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                            : initials(mem.name)}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 12, fontWeight: 500 }}>{mem.name}</div>
                                        <div style={{ fontSize: 10, opacity: 0.6, textTransform: 'capitalize' }}>{mem.role}</div>
                                    </div>
                                    {mem.id === group.created_by ? (
                                        <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'rgba(139,92,246,0.2)', color: '#a78bfa' }}>
                                            Creator
                                        </span>
                                    ) : canManageMembers && (
                                        <button onClick={() => handleRemoveMember(mem.id)} title="Remove"
                                            style={{
                                                width: 24, height: 24, borderRadius: '50%',
                                                border: 'none', background: 'rgba(239,68,68,0.12)',
                                                color: '#f87171', cursor: 'pointer',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                                            }}>
                                            <BsX size={14} />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>

                        {showAddMembers && (
                            <div onClick={() => setShowAddMembers(false)}
                                style={{
                                    position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    padding: 14, borderRadius: 16, zIndex: 25
                                }}>
                                <div onClick={e => e.stopPropagation()}
                                    style={{
                                        background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.12)',
                                        borderRadius: 14, padding: 12, width: '100%', maxWidth: 320,
                                        display: 'flex', flexDirection: 'column', maxHeight: '80%',
                                        boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
                                    }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                        <div style={{ fontWeight: 600, fontSize: 14 }}>Add members</div>
                                        <button onClick={() => setShowAddMembers(false)}
                                            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, display: 'flex' }}>
                                            <BsX size={20} />
                                        </button>
                                    </div>
                                    <input value={userSearch} onChange={e => setUserSearch(e.target.value)}
                                        placeholder="Search users…"
                                        style={{ ...inputStyle, marginBottom: 8 }} />
                                    <div style={{ flex: 1, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}>
                                        {allUsers
                                            .filter(u => !group.members?.some(m => m.id === u.id))
                                            .filter(u => u.name?.toLowerCase().includes(userSearch.toLowerCase()))
                                            .map(u => {
                                                const picked = pickedUsers.has(u.id);
                                                return (
                                                    <label key={u.id}
                                                        style={{
                                                            display: 'flex', alignItems: 'center', gap: 10,
                                                            padding: '7px 10px', cursor: 'pointer',
                                                            borderBottom: '1px solid rgba(255,255,255,0.04)',
                                                            background: picked ? 'rgba(139,92,246,0.1)' : 'transparent'
                                                        }}>
                                                        <input type="checkbox" checked={picked} onChange={() => togglePick(u.id)} />
                                                        <div style={{
                                                            width: 26, height: 26, borderRadius: '50%',
                                                            background: colorFor(u.id), color: '#fff',
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                            fontWeight: 700, fontSize: 10
                                                        }}>{initials(u.name)}</div>
                                                        <div style={{ flex: 1, minWidth: 0 }}>
                                                            <div style={{ fontSize: 12, fontWeight: 500 }}>{u.name}</div>
                                                            <div style={{ fontSize: 10, opacity: 0.6, textTransform: 'capitalize' }}>{u.role}</div>
                                                        </div>
                                                    </label>
                                                );
                                            })}
                                    </div>
                                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
                                        <button onClick={() => setShowAddMembers(false)}
                                            style={{
                                                padding: '6px 12px', border: '1px solid rgba(255,255,255,0.12)',
                                                background: 'transparent', color: 'rgba(255,255,255,0.7)',
                                                borderRadius: 6, fontSize: 12, cursor: 'pointer'
                                            }}>Cancel</button>
                                        <button onClick={confirmAddMembers} disabled={pickedUsers.size === 0}
                                            style={{
                                                padding: '6px 12px', border: 'none',
                                                background: pickedUsers.size > 0 ? 'linear-gradient(135deg, #8b5cf6, #6366f1)' : 'rgba(255,255,255,0.08)',
                                                color: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 600,
                                                cursor: pickedUsers.size > 0 ? 'pointer' : 'not-allowed'
                                            }}>Add {pickedUsers.size > 0 ? `(${pickedUsers.size})` : ''}</button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                ) : (
                    <div style={{ padding: 12 }}>
                        {media.length === 0 ? (
                            <div style={{ padding: 24, textAlign: 'center', opacity: 0.5, fontSize: 12 }}>
                                <BsImages size={30} style={{ opacity: 0.4, marginBottom: 6 }} />
                                <div>No media shared yet</div>
                            </div>
                        ) : (
                            <>
                                {images.length > 0 && (
                                    <>
                                        <div style={{ fontSize: 10, opacity: 0.6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 8px 4px' }}>
                                            Images ({images.length})
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginBottom: 16 }}>
                                            {images.map(img => (
                                                <a key={img.id} href={getImageUrl(img.attachment_url)} target="_blank" rel="noreferrer"
                                                    title={`${img.sender_name || 'User'} · ${new Date(img.created_at).toLocaleDateString()}`}>
                                                    <img src={getImageUrl(img.attachment_url)} alt=""
                                                        style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 6, display: 'block' }} />
                                                </a>
                                            ))}
                                        </div>
                                    </>
                                )}
                                {files.length > 0 && (
                                    <>
                                        <div style={{ fontSize: 10, opacity: 0.6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, margin: '0 0 8px 4px' }}>
                                            Files ({files.length})
                                        </div>
                                        {files.map(f => (
                                            <a key={f.id} href={getImageUrl(f.attachment_url)} target="_blank" rel="noreferrer"
                                                download={f.attachment_name}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 10,
                                                    padding: '8px 10px', borderRadius: 8,
                                                    background: '#23233a',
                                                    marginBottom: 6, color: '#fff', textDecoration: 'none'
                                                }}>
                                                <AttachmentIcon type={f.attachment_type} />
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {f.attachment_name}
                                                    </div>
                                                    <div style={{ fontSize: 10, opacity: 0.6 }}>
                                                        {f.sender_name || 'User'} · {formatSize(f.attachment_size)}
                                                    </div>
                                                </div>
                                                <BsDownload size={13} style={{ opacity: 0.7 }} />
                                            </a>
                                        ))}
                                    </>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function SpeakerCard({ m, onOpen }) {
    return (
        <div style={{
            display: 'flex', gap: 10, padding: 8, borderRadius: 10,
            background: 'rgba(0,0,0,0.18)',
            maxWidth: 260, marginBottom: m.body || m.attachment_url ? 6 : 0
        }}>
            {m.speaker_photo_url ? (
                <img src={getImageUrl(m.speaker_photo_url)} alt={m.speaker_name}
                    style={{ width: 54, height: 54, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
            ) : (
                <div style={{
                    width: 54, height: 54, borderRadius: 8,
                    background: '#2d2d47',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                    <BsPersonBadge size={22} />
                </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, opacity: 0.75, marginBottom: 2 }}>
                    <BsCheckCircleFill size={9} color="#10b981" /> SPEAKER · Added
                </div>
                <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.speaker_name}
                </div>
                <div style={{ fontSize: 11, opacity: 0.8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.speaker_designation}{m.speaker_company ? ` · ${m.speaker_company}` : ''}
                </div>
                <button onClick={onOpen}
                    style={{
                        marginTop: 4, padding: '3px 8px', fontSize: 10,
                        border: '1px solid rgba(255,255,255,0.2)',
                        background: 'transparent', color: '#fff',
                        borderRadius: 6, cursor: 'pointer'
                    }}>View in Speakers</button>
            </div>
        </div>
    );
}

function ShareSpeakerModal({ onClose, onSubmit, initialEventId = null, initialEventTitle = null, lockEvent = false }) {
    const [events, setEvents] = useState([]);
    const [name, setName] = useState('');
    const [designation, setDesignation] = useState('');
    const [company, setCompany] = useState('');
    // For group chats scoped to an event, pre-select that event so the new
    // speaker lands on the right event without the user having to scan a list
    // of unrelated events. The dropdown is also locked in that case to keep
    // the speaker tied to the group's event.
    const [eventId, setEventId] = useState(initialEventId ? String(initialEventId) : '');
    const [photo, setPhoto] = useState(null);
    const [preview, setPreview] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [cropSrc, setCropSrc] = useState(null);
    const [cropName, setCropName] = useState('photo.png');
    const cropperRef = useRef(null);

    useEffect(() => {
        getEvents().then(r => setEvents(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    }, []);

    const handleFile = (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        setCropName(f.name || 'photo.png');
        const reader = new FileReader();
        reader.onload = () => setCropSrc(reader.result);
        reader.readAsDataURL(f);
    };

    const confirmCrop = () => {
        const cropper = cropperRef.current?.cropper;
        if (!cropper) return;
        const canvas = cropper.getCroppedCanvas({
            width: 400,
            height: 400,
            imageSmoothingQuality: 'high',
        });
        canvas.toBlob((blob) => {
            if (!blob) return;
            const baseName = (cropName.replace(/\.[^.]+$/, '') || 'photo') + '.png';
            const cropped = new File([blob], baseName, { type: 'image/png' });
            setPhoto(cropped);
            setPreview(URL.createObjectURL(blob));
            setCropSrc(null);
        }, 'image/png', 0.92);
    };

    // Photo ops (Enhance / Remove BG). Source is whatever's in the cropper
    // right now; result re-enters the cropper as a fresh data URL so the
    // user can re-frame.
    const { photoOp, error: cropOpError, runEnhance: handleEnhance, runRemoveBg: handleRemoveBackground } = usePhotoOps({
        getSource: () => cropSrc,
        onResult: (blob) => new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = () => { setCropSrc(reader.result); resolve(); };
            reader.readAsDataURL(blob);
        }),
    });

    const handleSubmit = async () => {
        setError('');
        if (!name.trim() || !designation.trim() || !company.trim() || !eventId || !photo) {
            return setError('All fields including photo are required');
        }
        setSaving(true);
        try {
            await onSubmit({ name: name.trim(), designation: designation.trim(), company: company.trim(), event_id: eventId, photo });
        } catch (err) {
            setError(err.response?.data?.error || 'Failed');
        } finally {
            setSaving(false);
        }
    };

    // Treat the form as "dirty" once the user has typed anything or loaded
    // a photo. While dirty, backdrop clicks are ignored — the X button is
    // the only way to discard work, so an accidental click outside doesn't
    // wipe the form. Empty form: backdrop closes as usual.
    const isDirty = !!(name.trim() || designation.trim() || company.trim() || eventId || photo || preview || cropSrc);
    const handleBackdropClick = () => { if (!isDirty) onClose(); };

    return (
        <div onClick={handleBackdropClick} data-chat-scope
            style={{
                position: 'absolute', inset: 0, zIndex: 20,
                background: 'rgba(0,0,0,0.55)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 14, borderRadius: 16
            }}>
            <div onClick={e => e.stopPropagation()} data-chat-scope
                style={{
                    background: '#1a1a2e', borderRadius: 14,
                    border: '1px solid rgba(255,255,255,0.12)',
                    padding: 14, width: '100%', maxWidth: 340, color: '#fff',
                    boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <BsPersonBadge /> Share Speaker
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, display: 'flex' }}>
                        <BsX size={20} />
                    </button>
                </div>
                <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 10 }}>
                    Fills in to the Speakers tab automatically.
                </div>
                {error && (
                    <div style={{
                        background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                        color: '#f87171', padding: '6px 10px', borderRadius: 6, fontSize: 11, marginBottom: 8
                    }}>{error}</div>
                )}
                <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                    <label style={{
                        width: 64, height: 64, borderRadius: 10,
                        border: '1px dashed rgba(255,255,255,0.2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', background: 'rgba(255,255,255,0.03)',
                        overflow: 'hidden', flexShrink: 0
                    }}>
                        <input type="file" accept="image/*" hidden onChange={handleFile} />
                        {preview
                            ? <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            : <BsImage size={20} style={{ opacity: 0.5 }} />}
                    </label>
                    <div style={{ flex: 1 }}>
                        <input value={name} onChange={e => setName(e.target.value)} placeholder="Full name *"
                            style={inputStyle} />
                        <input value={designation} onChange={e => setDesignation(e.target.value)} placeholder="Designation *"
                            style={{ ...inputStyle, marginTop: 6 }} />
                    </div>
                </div>
                <input value={company} onChange={e => setCompany(e.target.value)} placeholder="Company *" style={inputStyle} />
                <select value={eventId} onChange={e => setEventId(e.target.value)} disabled={lockEvent}
                    style={{ ...inputStyle, marginTop: 6, opacity: lockEvent ? 0.85 : 1, cursor: lockEvent ? 'not-allowed' : 'pointer' }}
                    title={lockEvent ? 'This group is scoped to a specific event' : undefined}>
                    <option value="">— Select event *—</option>
                    {lockEvent && initialEventId && !events.some(ev => String(ev.id) === String(initialEventId)) && (
                        <option value={initialEventId} style={{ background: '#1a1a2e' }}>{initialEventTitle || `Event #${initialEventId}`}</option>
                    )}
                    {events.map(ev => <option key={ev.id} value={ev.id} style={{ background: '#1a1a2e' }}>{ev.title}</option>)}
                </select>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
                    <button onClick={onClose}
                        style={{
                            padding: '7px 14px', border: '1px solid rgba(255,255,255,0.12)',
                            background: 'transparent', color: 'rgba(255,255,255,0.7)',
                            borderRadius: 8, fontSize: 12, cursor: 'pointer'
                        }}>Cancel</button>
                    <button onClick={handleSubmit} disabled={saving}
                        style={{
                            padding: '7px 14px', border: 'none',
                            background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                            color: '#fff', borderRadius: 8, fontSize: 12, fontWeight: 600,
                            cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1
                        }}>{saving ? 'Sharing…' : 'Share'}</button>
                </div>
            </div>

            {cropSrc && (
                // Backdrop swallows the click but does NOT close the cropper —
                // the user must use the X button (top right) or Cancel. Avoids
                // wiping in-progress crop/enhance work on a stray outside click.
                <div onClick={(e) => e.stopPropagation()}
                    style={{
                        position: 'absolute', inset: 0, zIndex: 30,
                        background: 'rgba(0,0,0,0.85)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: 10
                    }}>
                    <div onClick={(e) => e.stopPropagation()}
                        style={{
                            background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: 14, padding: 12, width: '100%', maxWidth: 380,
                            color: '#fff', display: 'flex', flexDirection: 'column', gap: 8
                        }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <BsCrop /> Crop to 400 × 400
                            </div>
                            <button onClick={() => setCropSrc(null)}
                                style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, display: 'flex' }}>
                                <BsX size={20} />
                            </button>
                        </div>
                        <Suspense fallback={
                            <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
                                Loading cropper…
                            </div>
                        }>
                            <Cropper
                                ref={cropperRef}
                                src={cropSrc}
                                style={{ height: 280, width: '100%' }}
                                aspectRatio={1}
                                viewMode={1}
                                dragMode="move"
                                autoCropArea={1}
                                background={false}
                                responsive
                                checkOrientation={false}
                                guides={true}
                            />
                        </Suspense>
                        {cropOpError && (
                            <div style={{
                                background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                                color: '#f87171', padding: '6px 10px', borderRadius: 6, fontSize: 11
                            }}>{cropOpError}</div>
                        )}
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' }}>
                            {/* Cutout.pro ops — operate on the image in the cropper.
                                Result re-loads into the same cropper. */}
                            <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={handleEnhance} disabled={!!photoOp}
                                    title="Auto-enhance the current photo (sharpen + upscale)."
                                    style={{
                                        padding: '6px 10px', border: '1px solid rgba(139,92,246,0.55)',
                                        background: 'transparent', color: '#a78bfa',
                                        borderRadius: 6, fontSize: 11, fontWeight: 600,
                                        cursor: photoOp ? 'wait' : 'pointer', opacity: photoOp ? 0.6 : 1,
                                        display: 'inline-flex', alignItems: 'center', gap: 4
                                    }}>
                                    <BsStars /> {photoOp === 'enhance' ? 'Enhancing…' : 'Enhance'}
                                </button>
                                <button onClick={handleRemoveBackground} disabled={!!photoOp}
                                    title="Remove background. Returns a transparent PNG."
                                    style={{
                                        padding: '6px 10px', border: '1px solid rgba(19,217,153,0.55)',
                                        background: 'transparent', color: '#13d999',
                                        borderRadius: 6, fontSize: 11, fontWeight: 600,
                                        cursor: photoOp ? 'wait' : 'pointer', opacity: photoOp ? 0.6 : 1,
                                        display: 'inline-flex', alignItems: 'center', gap: 4
                                    }}>
                                    <BsScissors /> {photoOp === 'remove-bg' ? 'Removing…' : 'Remove BG'}
                                </button>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => setCropSrc(null)} disabled={!!photoOp}
                                    style={{
                                        padding: '6px 12px', border: '1px solid rgba(255,255,255,0.12)',
                                        background: 'transparent', color: 'rgba(255,255,255,0.7)',
                                        borderRadius: 6, fontSize: 12, cursor: photoOp ? 'wait' : 'pointer'
                                    }}>Cancel</button>
                                <button onClick={confirmCrop} disabled={!!photoOp}
                                    style={{
                                        padding: '6px 12px', border: 'none',
                                        background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                                        color: '#fff', borderRadius: 6, fontSize: 12, fontWeight: 600,
                                        cursor: photoOp ? 'wait' : 'pointer', opacity: photoOp ? 0.6 : 1
                                    }}>Use this crop</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const inputStyle = {
    width: '100%', padding: '7px 10px',
    background: '#262640',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 6, color: '#fff', fontSize: 12, outline: 'none'
};

function DeleteDialog({ mine, onClose, onDelete }) {
    return (
        <div onClick={onClose}
            style={{
                position: 'absolute', inset: 0, zIndex: 20,
                background: 'rgba(0,0,0,0.55)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 16, borderRadius: 16
            }}>
            <div onClick={e => e.stopPropagation()}
                style={{
                    background: '#1a1a2e', borderRadius: 14,
                    border: '1px solid rgba(255,255,255,0.12)',
                    padding: 16, width: '100%', maxWidth: 300,
                    color: '#fff', textAlign: 'center',
                    boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
                }}>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Delete message?</div>
                <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 16 }}>
                    {mine ? 'This action cannot be undone.' : 'This message will only be removed for you.'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {mine && (
                        <button onClick={() => onDelete('everyone')}
                            style={{
                                padding: '10px', border: 'none', borderRadius: 8,
                                background: 'rgba(239,68,68,0.15)', color: '#f87171',
                                fontSize: 13, fontWeight: 600, cursor: 'pointer'
                            }}>Delete for everyone</button>
                    )}
                    <button onClick={() => onDelete('me')}
                        style={{
                            padding: '10px', border: 'none', borderRadius: 8,
                            background: '#2d2d47', color: '#fff',
                            fontSize: 13, fontWeight: 600, cursor: 'pointer'
                        }}>Delete for me</button>
                    <button onClick={onClose}
                        style={{
                            padding: '10px', border: 'none', borderRadius: 8,
                            background: 'transparent', color: 'rgba(255,255,255,0.6)',
                            fontSize: 13, cursor: 'pointer'
                        }}>Cancel</button>
                </div>
            </div>
        </div>
    );
}

function TabBtn({ active, onClick, children, badge }) {
    return (
        <button onClick={onClick}
            style={{
                flex: 1, padding: '10px', background: 'transparent',
                border: 'none',
                borderBottom: active ? '2px solid #8b5cf6' : '2px solid transparent',
                color: active ? '#fff' : 'rgba(255,255,255,0.5)',
                fontSize: 13, fontWeight: 600, cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
            }}>
            {children}
            {badge > 0 && (
                <span style={{
                    background: '#ef4444', color: '#fff',
                    borderRadius: 10, minWidth: 18, height: 18,
                    fontSize: 10, fontWeight: 700, padding: '0 5px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>{badge}</span>
            )}
        </button>
    );
}

function EmptyState({ text }) {
    return (
        <div style={{ padding: 24, textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
            {text}
        </div>
    );
}

// memoized so sidebar items don't re-render every time a chat-level
// state flips (e.g. switching tabs, typing flip, react picker open).
// Custom equality skips the onClick identity check — the sidebar passes
// fresh closures each render, but their captured behavior is stable, so
// reusing the prior closure is safe and avoids needless renders.
const ListItem = memo(
    function ListItem({ color, avatarText, avatarNode, avatarImage, title, subtitle, time, badge, onClick }) {
        return (
            <div onClick={onClick}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                style={{
                    display: 'flex', gap: 10, padding: '10px 14px', cursor: 'pointer',
                    borderBottom: '1px solid rgba(255,255,255,0.04)', alignItems: 'center'
                }}>
                <div style={{
                    width: 38, height: 38, borderRadius: '50%',
                    background: avatarImage ? 'transparent' : color, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 13, flexShrink: 0, overflow: 'hidden'
                }}>
                    {avatarImage
                        ? <img src={avatarImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        : (avatarNode || avatarText)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {title}
                        </span>
                        <span style={{ fontSize: 10, opacity: 0.5, flexShrink: 0 }}>{time ? formatTime(time) : ''}</span>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.65, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
                        {subtitle}
                    </div>
                </div>
                {badge > 0 && (
                    <span style={{
                        background: '#ef4444', color: '#fff',
                        borderRadius: 10, minWidth: 20, height: 20, fontSize: 10, fontWeight: 700,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 6px'
                    }}>{badge}</span>
                )}
            </div>
        );
    },
    (a, b) => (
        a.color === b.color &&
        a.avatarText === b.avatarText &&
        a.avatarNode === b.avatarNode &&
        a.avatarImage === b.avatarImage &&
        a.title === b.title &&
        a.subtitle === b.subtitle &&
        a.time === b.time &&
        a.badge === b.badge
        // onClick intentionally excluded — its captured values are stable
        // enough that re-render isn't worth the closure-identity diff.
    )
);

function CreateGroupModal({ onClose, onCreated }) {
    const { user } = useAuth();
    const [events, setEvents] = useState([]);
    const [users, setUsers] = useState([]);
    const [eventId, setEventId] = useState('');
    const [name, setName] = useState('');
    const [memberIds, setMemberIds] = useState(new Set());
    const [userSearch, setUserSearch] = useState('');
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        getEvents().then(r => setEvents(Array.isArray(r.data) ? r.data : [])).catch(() => {});
        getUsers().then(r => setUsers(Array.isArray(r.data) ? r.data : [])).catch(() => {});
    }, []);

    useEffect(() => {
        if (eventId && !name) {
            const ev = events.find(e => String(e.id) === String(eventId));
            if (ev) setName(ev.title);
        }
    }, [eventId]);

    const toggleMember = (id) => {
        const next = new Set(memberIds);
        if (next.has(id)) next.delete(id); else next.add(id);
        setMemberIds(next);
    };

    const handleCreate = async () => {
        setError('');
        if (!eventId) return setError('Select an event');
        if (memberIds.size === 0) return setError('Select at least one member');
        setSaving(true);
        try {
            await createChatGroup({
                event_id: Number(eventId),
                name: name.trim(),
                member_ids: Array.from(memberIds)
            });
            onCreated();
        } catch (err) {
            setError(err.response?.data?.error || 'Failed');
        } finally {
            setSaving(false);
        }
    };

    const filteredUsers = users.filter(u => u.id !== user.id && u.name?.toLowerCase().includes(userSearch.toLowerCase()));

    return (
        <div data-chat-scope style={{
            position: 'fixed', inset: 0, zIndex: 1060,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 20
        }} onClick={onClose}>
            <div onClick={e => e.stopPropagation()}
                style={{
                    width: 440, maxWidth: '100%', maxHeight: '90vh',
                    background: '#1a1a2e', borderRadius: 16,
                    border: '1px solid rgba(255,255,255,0.08)',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden',
                    color: '#fff'
                }}>
                <div style={{
                    padding: '14px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(99,102,241,0.1))'
                }}>
                    <div style={{ fontWeight: 600 }}>Create Group</div>
                    <button onClick={onClose}
                        style={{ background: 'none', border: 'none', color: '#fff', padding: 0, display: 'flex' }}>
                        <BsX size={22} />
                    </button>
                </div>

                <div style={{ padding: 16, overflowY: 'auto', flex: 1 }}>
                    {error && (
                        <div style={{
                            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                            color: '#f87171', padding: '8px 12px', borderRadius: 8, fontSize: 12, marginBottom: 12
                        }}>{error}</div>
                    )}

                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Event *</label>
                    <select value={eventId} onChange={e => setEventId(e.target.value)}
                        style={{
                            width: '100%', padding: '8px 10px', marginBottom: 12,
                            background: '#262640',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: 8, color: '#fff', fontSize: 13
                        }}>
                        <option value="">— Select event —</option>
                        {events.map(ev => <option key={ev.id} value={ev.id} style={{ background: '#1a1a2e' }}>{ev.title}</option>)}
                    </select>

                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>Group Name</label>
                    <input value={name} onChange={e => setName(e.target.value)}
                        placeholder="Defaults to event name"
                        style={{
                            width: '100%', padding: '8px 10px', marginBottom: 12,
                            background: '#262640',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: 8, color: '#fff', fontSize: 13
                        }} />

                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                        Members * <span style={{ opacity: 0.5, fontWeight: 400 }}>({memberIds.size} selected)</span>
                    </label>
                    <input value={userSearch} onChange={e => setUserSearch(e.target.value)}
                        placeholder="Search users…"
                        style={{
                            width: '100%', padding: '8px 10px', marginBottom: 8,
                            background: '#262640',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: 8, color: '#fff', fontSize: 13
                        }} />
                    <div style={{
                        maxHeight: 220, overflowY: 'auto',
                        border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8
                    }}>
                        {filteredUsers.length === 0 ? (
                            <div style={{ padding: 16, textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                                No users
                            </div>
                        ) : filteredUsers.map(u => {
                            const checked = memberIds.has(u.id);
                            return (
                                <label key={u.id}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 10,
                                        padding: '8px 12px', cursor: 'pointer',
                                        borderBottom: '1px solid rgba(255,255,255,0.04)',
                                        background: checked ? 'rgba(139,92,246,0.1)' : 'transparent'
                                    }}>
                                    <input type="checkbox" checked={checked} onChange={() => toggleMember(u.id)} />
                                    <div style={{
                                        width: 28, height: 28, borderRadius: '50%',
                                        background: colorFor(u.id), color: '#fff',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontWeight: 700, fontSize: 10
                                    }}>{initials(u.name)}</div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 13, fontWeight: 500 }}>{u.name}</div>
                                        <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'capitalize' }}>{u.role}</div>
                                    </div>
                                </label>
                            );
                        })}
                    </div>
                </div>

                <div style={{
                    padding: 12, borderTop: '1px solid rgba(255,255,255,0.08)',
                    display: 'flex', justifyContent: 'flex-end', gap: 8
                }}>
                    <button onClick={onClose}
                        style={{
                            padding: '8px 16px', background: 'transparent',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: 8, color: 'rgba(255,255,255,0.7)',
                            fontSize: 13, cursor: 'pointer'
                        }}>Cancel</button>
                    <button onClick={handleCreate} disabled={saving}
                        style={{
                            padding: '8px 16px', border: 'none',
                            background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                            borderRadius: 8, color: '#fff',
                            fontSize: 13, fontWeight: 600,
                            cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1
                        }}>{saving ? 'Creating…' : 'Create Group'}</button>
                </div>
            </div>
        </div>
    );
}
