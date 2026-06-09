// Resolve "/uploads/foo.png" into an absolute http(s):// URL so third-party
// clients (WhatsApp, browsers) can actually fetch the image. Falls back to
// the current origin when VITE_BACKEND_URL isn't configured.
export function toAbsoluteUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    const backend = import.meta.env.VITE_BACKEND_URL || '';
    const base = backend ? backend.replace(/\/$/, '') : window.location.origin;
    return base + (path.startsWith('/') ? path : '/' + path);
}

// Briefly flash a self-dismissing toast at the bottom of the screen so the
// operator knows what happened. Built inline so this helper doesn't depend
// on whatever toast infra each page has (or doesn't have).
function flashToast(text, ms = 3500) {
    if (typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = [
        'position:fixed', 'left:50%', 'bottom:28px', 'transform:translateX(-50%) translateY(8px)',
        'background:#1f2937', 'color:#fff', 'padding:12px 18px', 'border-radius:10px',
        'font-size:13px', 'font-weight:500', 'letter-spacing:0.01em',
        'border:1px solid rgba(255,255,255,0.08)',
        'box-shadow:0 12px 32px rgba(0,0,0,0.4)',
        'z-index:99999', 'opacity:0', 'transition:opacity 0.2s, transform 0.2s',
        'max-width:min(90vw,420px)', 'text-align:center', 'line-height:1.45'
    ].join(';');
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateX(-50%) translateY(0)'; });
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(-50%) translateY(8px)';
        setTimeout(() => el.remove(), 220);
    }, ms);
}

// Build the bit of text that goes alongside the image on platforms that
// accept a caption (WhatsApp via Web Share, X, Telegram, Email body).
function buildCaption(speaker, eventTitle) {
    if (!speaker) return eventTitle || '';
    const who = speaker.name || '';
    const role = [speaker.designation, speaker.company].filter(Boolean).join(' at ');
    const where = eventTitle ? ` — ${eventTitle}` : '';
    if (role) return `${who}, ${role}${where}`.trim();
    return `${who}${where}`.trim();
}

// Fetch the SNS PNG once and reuse the blob for whichever action needed it
// (download / copy-image / Web Share file).
async function fetchSnsBlob(absoluteUrl) {
    const res = await fetch(absoluteUrl);
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
    const blob = await res.blob();
    return blob.type === 'image/png' ? blob : await reencodeAsPng(blob);
}

async function reencodeAsPng(blob) {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    return await new Promise((resolve, reject) => {
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Canvas to PNG conversion failed')), 'image/png');
    });
}

// === Per-platform actions ===
//
// Each action is "open a URL" or "do a clipboard / download op" — kept as
// tiny standalone functions so the share page can call them by name.
// Exported so SnsSharePage (and any future consumer) can wire buttons to
// these without re-implementing the per-platform deep-link formats.

export { buildCaption };
export const snsActions = {
    whatsapp: (absoluteUrl, speaker) => actWhatsApp(absoluteUrl, speaker),
    linkedin: (absoluteUrl) => actLinkedIn(absoluteUrl),
    twitter:  (absoluteUrl, _speaker, caption) => actTwitter(absoluteUrl, caption),
    facebook: (absoluteUrl) => actFacebook(absoluteUrl),
    telegram: (absoluteUrl, _speaker, caption) => actTelegram(absoluteUrl, caption),
    email:    (absoluteUrl, speaker, _caption, eventTitle) => actEmail(absoluteUrl, speaker, eventTitle),
    download: (absoluteUrl, speaker) => actDownload(absoluteUrl, speaker),
    copyimg:  (absoluteUrl) => actCopyImage(absoluteUrl),
    copyurl:  (absoluteUrl) => actCopyUrl(absoluteUrl),
};

async function actDownload(absoluteUrl, speaker) {
    const blob = await fetchSnsBlob(absoluteUrl);
    const url = URL.createObjectURL(blob);
    const safeName = (speaker?.name || 'sns-card').replace(/[^a-z0-9-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'sns-card';
    const a = document.createElement('a');
    a.href = url; a.download = `${safeName}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flashToast('Downloaded.');
}

async function actCopyImage(absoluteUrl) {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
        flashToast("This browser can't copy images. Use Download instead.");
        return;
    }
    const blob = await fetchSnsBlob(absoluteUrl);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    flashToast('Image copied — paste anywhere with Ctrl/⌘+V');
}

async function actCopyUrl(absoluteUrl) {
    await navigator.clipboard.writeText(absoluteUrl);
    flashToast('Link copied to clipboard.');
}

// WhatsApp: copy the PNG to clipboard, open wa.me. We deliberately don't
// pass an image URL via `?text=` because WhatsApp's link-preview crawler
// often can't reach private hosts, so the recipient would see a bare URL
// with no thumbnail. Operator pastes the image into the chat themselves.
async function actWhatsApp(absoluteUrl, speaker) {
    let copied = false;
    try {
        const blob = await fetchSnsBlob(absoluteUrl);
        if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            copied = true;
        }
    } catch (err) {
        console.warn('WhatsApp image clipboard copy failed', err);
    }
    const cleanedPhone = (speaker?.mobile_no || '').replace(/\D/g, '');
    const hasUsablePhone = cleanedPhone.length >= 10;
    const url = hasUsablePhone ? `https://wa.me/${cleanedPhone}` : `https://wa.me/`;
    window.open(url, '_blank', 'noopener,noreferrer');
    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
    const pasteHint = isMac ? '⌘V' : 'Ctrl+V';
    flashToast(copied
        ? `Image copied — paste in WhatsApp with ${pasteHint}`
        : "Couldn't auto-copy image. Download it and drag into WhatsApp.");
}

function actLinkedIn(absoluteUrl) {
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(absoluteUrl)}`, '_blank', 'noopener,noreferrer');
}

function actTwitter(absoluteUrl, caption) {
    const params = new URLSearchParams();
    if (caption) params.set('text', caption);
    params.set('url', absoluteUrl);
    window.open(`https://twitter.com/intent/tweet?${params.toString()}`, '_blank', 'noopener,noreferrer');
}

function actFacebook(absoluteUrl) {
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(absoluteUrl)}`, '_blank', 'noopener,noreferrer');
}

function actTelegram(absoluteUrl, caption) {
    const params = new URLSearchParams();
    params.set('url', absoluteUrl);
    if (caption) params.set('text', caption);
    window.open(`https://t.me/share/url?${params.toString()}`, '_blank', 'noopener,noreferrer');
}

function actEmail(absoluteUrl, speaker, eventTitle) {
    const subject = encodeURIComponent(speaker?.name
        ? `Speaker spotlight: ${speaker.name}${eventTitle ? ` — ${eventTitle}` : ''}`
        : (eventTitle || 'SNS Card'));
    const bodyText = `${buildCaption(speaker, eventTitle)}\n\n${absoluteUrl}\n`;
    window.location.href = `mailto:?subject=${subject}&body=${encodeURIComponent(bodyText)}`;
}

// === Popover ===
//
// Self-contained DOM, no React dep. We render it once near the click target
// and tear it down on outside click / Esc. Inline styles to dodge global CSS
// conflicts (this widget appears on multiple pages with different themes).

const ITEMS = [
    { id: 'whatsapp', label: 'WhatsApp', emoji: '💬',  desc: 'Copy image + open chat' },
    { id: 'linkedin', label: 'LinkedIn', emoji: '💼',  desc: 'Share to your feed' },
    { id: 'twitter',  label: 'X / Twitter', emoji: '𝕏', desc: 'Tweet with link' },
    { id: 'facebook', label: 'Facebook', emoji: '📘',  desc: 'Share to your wall' },
    { id: 'telegram', label: 'Telegram', emoji: '✈️',  desc: 'Share to a chat' },
    { id: 'email',    label: 'Email',    emoji: '✉️',  desc: 'Open mail client' },
    { id: '---' },
    { id: 'download', label: 'Download PNG', emoji: '⬇️', desc: 'Save to disk' },
    { id: 'copyimg',  label: 'Copy image',   emoji: '🖼️', desc: 'Paste as image anywhere' },
    { id: 'copyurl',  label: 'Copy link',    emoji: '🔗', desc: 'Copy image URL' },
];

function closeExistingPopover() {
    document.querySelectorAll('[data-sns-share-popover]').forEach(n => n.remove());
}

function showPopover(clickEvent, ctx) {
    closeExistingPopover();
    const { absoluteUrl, speaker, eventTitle } = ctx;
    const caption = buildCaption(speaker, eventTitle);

    const anchorRect = clickEvent?.currentTarget?.getBoundingClientRect?.()
        || { left: window.innerWidth / 2 - 140, bottom: window.innerHeight / 2, top: window.innerHeight / 2, width: 0 };

    const wrap = document.createElement('div');
    wrap.setAttribute('data-sns-share-popover', '');
    wrap.style.cssText = [
        'position:fixed', 'z-index:99998',
        'background:#111827', 'color:#fff',
        'border:1px solid rgba(255,255,255,0.08)', 'border-radius:12px',
        'box-shadow:0 16px 48px rgba(0,0,0,0.55)',
        'padding:6px', 'min-width:240px', 'max-width:280px',
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
        'opacity:0', 'transform:translateY(-4px)', 'transition:opacity 0.12s, transform 0.12s',
    ].join(';');

    // Position below the anchor, clamped to the viewport.
    const desiredTop = Math.min(anchorRect.bottom + 6, window.innerHeight - 360);
    const desiredLeft = Math.min(Math.max(8, anchorRect.left), window.innerWidth - 290);
    wrap.style.top = `${Math.max(8, desiredTop)}px`;
    wrap.style.left = `${desiredLeft}px`;

    for (const it of ITEMS) {
        if (it.id === '---') {
            const hr = document.createElement('div');
            hr.style.cssText = 'height:1px;background:rgba(255,255,255,0.07);margin:4px 6px';
            wrap.appendChild(hr);
            continue;
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style.cssText = [
            'all:unset', 'display:flex', 'align-items:center', 'gap:10px',
            'width:calc(100% - 12px)', 'padding:9px 10px', 'border-radius:8px',
            'cursor:pointer', 'box-sizing:border-box', 'transition:background 0.12s',
        ].join(';');
        btn.onmouseenter = () => btn.style.background = 'rgba(139,92,246,0.18)';
        btn.onmouseleave = () => btn.style.background = 'transparent';

        const icon = document.createElement('span');
        icon.textContent = it.emoji;
        icon.style.cssText = 'font-size:18px;width:22px;text-align:center;flex-shrink:0';

        const text = document.createElement('span');
        text.style.cssText = 'display:flex;flex-direction:column;line-height:1.25;min-width:0';
        const title = document.createElement('span');
        title.textContent = it.label;
        title.style.cssText = 'font-size:13px;font-weight:600';
        const sub = document.createElement('span');
        sub.textContent = it.desc;
        sub.style.cssText = 'font-size:11px;color:rgba(255,255,255,0.55);margin-top:1px';
        text.appendChild(title); text.appendChild(sub);

        btn.appendChild(icon); btn.appendChild(text);
        btn.onclick = async () => {
            close();
            try {
                if (it.id === 'whatsapp') await actWhatsApp(absoluteUrl, speaker);
                else if (it.id === 'linkedin') actLinkedIn(absoluteUrl);
                else if (it.id === 'twitter') actTwitter(absoluteUrl, caption);
                else if (it.id === 'facebook') actFacebook(absoluteUrl);
                else if (it.id === 'telegram') actTelegram(absoluteUrl, caption);
                else if (it.id === 'email') actEmail(absoluteUrl, speaker, eventTitle);
                else if (it.id === 'download') await actDownload(absoluteUrl, speaker);
                else if (it.id === 'copyimg') await actCopyImage(absoluteUrl);
                else if (it.id === 'copyurl') await actCopyUrl(absoluteUrl);
            } catch (err) {
                console.error('SNS share action failed', err);
                flashToast('Action failed. Try again.');
            }
        };
        wrap.appendChild(btn);
    }

    document.body.appendChild(wrap);
    requestAnimationFrame(() => {
        wrap.style.opacity = '1';
        wrap.style.transform = 'translateY(0)';
    });

    function close() {
        document.removeEventListener('mousedown', onDocDown, true);
        document.removeEventListener('keydown', onKey, true);
        wrap.remove();
    }
    function onDocDown(e) { if (!wrap.contains(e.target)) close(); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    // Defer so the originating click doesn't immediately close us.
    setTimeout(() => {
        document.addEventListener('mousedown', onDocDown, true);
        document.addEventListener('keydown', onKey, true);
    }, 0);
}

// Open the share UI for an SNS card. On mobile / Safari this hands the
// actual PNG file to the OS share sheet (so WhatsApp, Messages, AirDrop,
// Notes, etc. all show up); on desktop browsers without file-share support
// it falls back to the in-app popover with every destination wired up.
//
// Usage:
//   <button onClick={(e) => openSnsShareSheet(e, { snsUrl, speaker, eventTitle })}>
export async function openSnsShareSheet(clickEvent, { snsUrl, speaker, eventTitle }) {
    const absoluteUrl = toAbsoluteUrl(snsUrl);
    if (!absoluteUrl) return;

    // Native share sheet path — best UX where supported. We share the file
    // itself (not just a URL) so the recipient receives an actual image.
    if (typeof navigator !== 'undefined' && navigator.canShare && navigator.share) {
        try {
            const blob = await fetchSnsBlob(absoluteUrl);
            const safeName = (speaker?.name || 'sns-card').replace(/[^a-z0-9-]+/gi, '-').toLowerCase() || 'sns-card';
            const file = new File([blob], `${safeName}.png`, { type: 'image/png' });
            if (navigator.canShare({ files: [file] })) {
                await navigator.share({
                    files: [file],
                    title: speaker?.name ? `${speaker.name}${eventTitle ? ` – ${eventTitle}` : ''}` : 'SNS Card',
                    text: buildCaption(speaker, eventTitle),
                });
                return; // user picked an app from the OS sheet
            }
        } catch (err) {
            // User cancelled the native sheet → don't fall back to popover.
            if (err?.name === 'AbortError') return;
            // Other errors (CORS / file unsupported) → fall through to popover.
            console.warn('Native share unavailable, falling back to popover', err);
        }
    }

    showPopover(clickEvent, { absoluteUrl, speaker, eventTitle });
}

// Back-compat: the previous WhatsApp-only entry point. Existing call sites
// can keep working until they migrate; new code should use openSnsShareSheet.
export async function shareSnsToWhatsApp({ snsUrl, speaker }) {
    const absoluteUrl = toAbsoluteUrl(snsUrl);
    if (!absoluteUrl) return;
    await actWhatsApp(absoluteUrl, speaker);
}
