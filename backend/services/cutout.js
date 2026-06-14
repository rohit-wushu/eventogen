// Cutout.pro wrapper — currently only the photo-enhancement endpoint, which
// powers the "Enhance" button in SpeakerFormPage and SNSGeneratorPage. The
// existing @imgly background-removal pipeline still runs automatically on
// every speaker photo upload (see backend/utils/imageProcessor.js); Cutout
// is opt-in per click so we don't burn API credits on every upload.
//
// All requests go from the server only — the API key never reaches the
// browser. Set CUTOUT_API_KEY in backend/.env.

const sharp = require('sharp');

const CUTOUT_BASE = 'https://www.cutout.pro';

class CutoutError extends Error {
    constructor(message, { status, payload } = {}) {
        super(message);
        this.name = 'CutoutError';
        this.status = status;
        this.payload = payload;
    }
}

// Cutout's /photoEnhance flattens any alpha channel into white. When the
// source is a transparent PNG (e.g. a speaker headshot whose background has
// already been removed), we want the enhanced output to stay transparent.
// This helper takes the original alpha mask and re-applies it to the
// enhanced buffer, resizing the mask to match if Cutout upscaled the image.
async function preserveAlpha(originalBuffer, enhancedBuffer) {
    const srcMeta = await sharp(originalBuffer).metadata();
    if (!srcMeta.hasAlpha) return enhancedBuffer; // nothing to preserve

    const enhancedMeta = await sharp(enhancedBuffer).metadata();

    // Extract the source alpha as RAW bytes (single channel, one byte per pixel).
    // The .raw() call here is critical — without it, toBuffer() returns PNG-
    // encoded bytes, which would then fail to be re-interpreted as raw later.
    const alphaRaw = await sharp(originalBuffer)
        .ensureAlpha()
        .extractChannel('alpha')
        .raw()
        .toBuffer({ resolveWithObject: true });

    // Resize the alpha mask to match Cutout's (possibly upscaled) output, then
    // dump it back to raw so joinChannel can accept it.
    const resizedMaskRaw = await sharp(alphaRaw.data, {
            raw: { width: alphaRaw.info.width, height: alphaRaw.info.height, channels: 1 },
        })
        .resize(enhancedMeta.width, enhancedMeta.height, { kernel: 'lanczos3' })
        .raw()
        .toBuffer();

    return sharp(enhancedBuffer)
        .removeAlpha()              // drop whatever Cutout gave us as alpha
        .joinChannel(resizedMaskRaw, {
            raw: { width: enhancedMeta.width, height: enhancedMeta.height, channels: 1 },
        })
        .png()
        .toBuffer();
}

// Lazy-read the key so a missing var produces a clear error at first use
// rather than a confusing "undefined header" at boot.
function getApiKey() {
    const key = process.env.CUTOUT_API_KEY;
    if (!key) throw new CutoutError('CUTOUT_API_KEY is not set in backend/.env');
    return key;
}

// Cutout's image-enhancer endpoint upscales/sharpens photos. Returns the
// enhanced image as a Buffer (PNG/JPG depending on what Cutout sends back).
//
// `filename` is whatever Cutout's multipart parser wants to log; the actual
// file extension is derived from `contentType` so it doesn't have to match.
async function enhanceImage(buffer, { contentType = 'image/png', filename = 'photo.png' } = {}) {
    if (!buffer || !buffer.length) throw new CutoutError('enhanceImage: empty buffer');

    const form = new FormData();
    form.append('file', new Blob([buffer], { type: contentType }), filename);

    const res = await fetch(`${CUTOUT_BASE}/api/v1/photoEnhance`, {
        method: 'POST',
        headers: {
            // Cutout.pro uses a custom header (not Authorization: Bearer).
            APIKEY: getApiKey(),
        },
        body: form,
    });

    // Cutout responses are inconsistent: success paths return either raw
    // image bytes OR a JSON envelope with a downloadable URL. Errors are
    // always JSON. We sniff the content-type and branch accordingly.
    const ct = res.headers.get('content-type') || '';

    if (!res.ok) {
        const detail = ct.includes('json') ? await res.json().catch(() => null) : await res.text().catch(() => '');
        throw new CutoutError(`Cutout enhance failed (HTTP ${res.status})`, { status: res.status, payload: detail });
    }

    let enhancedBuffer;
    if (ct.startsWith('image/')) {
        const ab = await res.arrayBuffer();
        enhancedBuffer = Buffer.from(ab);
    } else if (ct.includes('json')) {
        const json = await res.json();
        // Cutout's JSON envelope shape: { code: 0, data: { imageUrl: '...' } }
        // Non-zero code = quota / auth / format error from their side.
        if (json && json.code && json.code !== 0) {
            throw new CutoutError(json.msg || `Cutout enhance rejected (code ${json.code})`, { status: res.status, payload: json });
        }
        const url = json?.data?.imageUrl || json?.data?.url || json?.imageUrl;
        if (!url) throw new CutoutError('Cutout response had no image URL', { payload: json });

        const dl = await fetch(url);
        if (!dl.ok) throw new CutoutError(`Could not download enhanced image (HTTP ${dl.status})`);
        const ab = await dl.arrayBuffer();
        enhancedBuffer = Buffer.from(ab);
    } else {
        throw new CutoutError(`Unexpected Cutout response content-type: ${ct}`);
    }

    // Re-attach the original alpha channel so transparent inputs stay
    // transparent (Cutout flattens alpha to white). No-op for opaque sources.
    try {
        const finalBuffer = await preserveAlpha(buffer, enhancedBuffer);
        return { buffer: finalBuffer, contentType: 'image/png' };
    } catch (err) {
        // If alpha re-application fails for any reason, fall back to the raw
        // enhanced bytes so the user still gets the enhanced result.
        console.warn('[cutout] preserveAlpha failed, returning flat enhanced image:', err.message);
        return { buffer: enhancedBuffer, contentType: ct.startsWith('image/') ? ct : 'image/png' };
    }
}

// Cutout.pro background-removal endpoint. mattingType=6 is the documented
// general auto-matter that works on any subject (people, products, etc.).
// Returns a transparent-background PNG as a Buffer. Response handling mirrors
// enhanceImage above (Cutout returns either raw bytes or a JSON envelope).
async function removeBackground(buffer, { contentType = 'image/png', filename = 'photo.png', mattingType = 6 } = {}) {
    if (!buffer || !buffer.length) throw new CutoutError('removeBackground: empty buffer');

    const form = new FormData();
    form.append('file', new Blob([buffer], { type: contentType }), filename);

    const res = await fetch(`${CUTOUT_BASE}/api/v1/matting?mattingType=${mattingType}`, {
        method: 'POST',
        headers: { APIKEY: getApiKey() },
        body: form,
    });

    const ct = res.headers.get('content-type') || '';

    if (!res.ok) {
        const detail = ct.includes('json') ? await res.json().catch(() => null) : await res.text().catch(() => '');
        throw new CutoutError(`Cutout matting failed (HTTP ${res.status})`, { status: res.status, payload: detail });
    }

    if (ct.startsWith('image/')) {
        const ab = await res.arrayBuffer();
        return { buffer: Buffer.from(ab), contentType: ct };
    }

    if (ct.includes('json')) {
        const json = await res.json();
        if (json && json.code && json.code !== 0) {
            throw new CutoutError(json.msg || `Cutout matting rejected (code ${json.code})`, { status: res.status, payload: json });
        }
        const url = json?.data?.imageUrl || json?.data?.url || json?.imageUrl;
        if (!url) throw new CutoutError('Cutout response had no image URL', { payload: json });

        const dl = await fetch(url);
        if (!dl.ok) throw new CutoutError(`Could not download matted image (HTTP ${dl.status})`);
        const ab = await dl.arrayBuffer();
        return { buffer: Buffer.from(ab), contentType: dl.headers.get('content-type') || 'image/png' };
    }

    throw new CutoutError(`Unexpected Cutout response content-type: ${ct}`);
}

module.exports = { enhanceImage, removeBackground, CutoutError };
