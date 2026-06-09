// Cutout.pro wrapper — currently only the photo-enhancement endpoint, which
// powers the "Enhance" button in SpeakerFormPage and SNSGeneratorPage. The
// existing @imgly background-removal pipeline still runs automatically on
// every speaker photo upload (see backend/utils/imageProcessor.js); Cutout
// is opt-in per click so we don't burn API credits on every upload.
//
// All requests go from the server only — the API key never reaches the
// browser. Set CUTOUT_API_KEY in backend/.env.

const CUTOUT_BASE = 'https://www.cutout.pro';

class CutoutError extends Error {
    constructor(message, { status, payload } = {}) {
        super(message);
        this.name = 'CutoutError';
        this.status = status;
        this.payload = payload;
    }
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

    if (ct.startsWith('image/')) {
        const ab = await res.arrayBuffer();
        return { buffer: Buffer.from(ab), contentType: ct };
    }

    if (ct.includes('json')) {
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
        return { buffer: Buffer.from(ab), contentType: dl.headers.get('content-type') || 'image/png' };
    }

    throw new CutoutError(`Unexpected Cutout response content-type: ${ct}`);
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
