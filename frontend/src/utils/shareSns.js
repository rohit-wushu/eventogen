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
// operator knows the image is on their clipboard and what to do next. Built
// inline so this helper doesn't depend on whatever toast infra each page
// has (or doesn't have).
function flashToast(text, ms = 4500) {
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

// Copy the SNS card to the clipboard and open WhatsApp so the operator
// pastes the actual image as an attachment. We do this instead of pushing
// a wa.me link with the image URL in the text because:
//
//  1. WhatsApp's link-preview crawler can't reach localhost (and many
//     production setups), so the URL would arrive as a bare link with no
//     thumbnail.
//  2. Even when WhatsApp can fetch the URL, the recipient gets a link
//     card — not an actual image they can save / forward.
//
// Browser support: ClipboardItem with image/png covers Chrome, Edge, and
// Safari 13.1+. Firefox is limited; if the copy fails we fall back to
// opening WhatsApp anyway and tell the operator to drag the downloaded
// PNG into the chat instead.
export async function shareSnsToWhatsApp({ snsUrl, speaker }) {
    const absoluteUrl = toAbsoluteUrl(snsUrl);
    if (!absoluteUrl) return;

    let copied = false;
    try {
        const res = await fetch(absoluteUrl);
        const blob = await res.blob();
        // ClipboardItem requires image/png explicitly; if for some reason
        // the upload was stored as something else, re-encode through a
        // canvas before copying.
        const pngBlob = blob.type === 'image/png' ? blob : await reencodeAsPng(blob);
        if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
            copied = true;
        }
    } catch (err) {
        console.warn('SNS image clipboard copy failed', err);
    }

    const cleanedPhone = (speaker?.mobile_no || '').replace(/\D/g, '');
    const hasUsablePhone = cleanedPhone.length >= 10;
    // No `?text=` parameter — we don't want any pre-filled text in the
    // chat; the operator just pastes the image and hits send.
    const url = hasUsablePhone ? `https://wa.me/${cleanedPhone}` : `https://wa.me/`;
    window.open(url, '_blank', 'noopener,noreferrer');

    const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
    const pasteHint = isMac ? '⌘V' : 'Ctrl+V';
    flashToast(copied
        ? `Image copied — paste in WhatsApp with ${pasteHint}`
        : 'Couldn\'t auto-copy image. Download it and drag into WhatsApp.'
    );
}

// Convert a non-PNG image blob to PNG via an offscreen canvas so it's
// acceptable to ClipboardItem.
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
