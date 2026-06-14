const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { removeBackground: cutoutRemoveBackground, CutoutError } = require('../services/cutout');

// Run Cutout.pro's background-removal API. Reads the input file, calls
// Cutout, writes the transparent-PNG result to outputPath. Throws on any
// failure so the caller can fall back to a no-BG-removal path.
const runBgRemovalWorker = async (inputPath, outputPath) => {
    const buffer = fs.readFileSync(inputPath);
    const ext = path.extname(inputPath).toLowerCase();
    const mime = ext === '.png' ? 'image/png'
              : ext === '.webp' ? 'image/webp'
              : 'image/jpeg';
    const { buffer: result } = await cutoutRemoveBackground(buffer, {
        contentType: mime,
        filename: path.basename(inputPath),
    });
    fs.writeFileSync(outputPath, result);
};

const cropTo400 = (input, outputPath) =>
    sharp(input)
        .resize(400, 400, { fit: 'cover', position: 'centre' })
        .png()
        .toFile(outputPath);

// Turn a speaker name into a filesystem- and URL-safe slug:
//   "Dr. M.C. Sudhakar"  → "dr-m-c-sudhakar"
//   "Smt Manjula N, IAS" → "smt-manjula-n-ias"
// Falls back to 'speaker' if the name has no usable characters.
const slugify = (name) => {
    const slug = String(name || '')
        .normalize('NFKD').replace(/[̀-ͯ]/g, '') // strip accents
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')   // non-alphanumeric → hyphen
        .replace(/^-+|-+$/g, '')        // trim leading/trailing hyphens
        .slice(0, 60);                  // keep filenames sane
    return slug || 'speaker';
};

// Pick a free output path: `<slug>.png`, then `<slug>-2.png`, `<slug>-3.png`…
// so two speakers with the same name don't overwrite each other.
const uniqueOutPath = (dir, slug) => {
    let candidate = path.join(dir, `${slug}.png`);
    let n = 2;
    while (fs.existsSync(candidate)) {
        candidate = path.join(dir, `${slug}-${n}.png`);
        n++;
    }
    return candidate;
};

/**
 * Process an already-saved upload: BG removal + 400x400 PNG.
 * Never throws. Returns `{ relPath: '/uploads/xxx.png' }`.
 *
 * `desiredName` (optional) — when given, the output file is named after a
 * slug of it (e.g. the speaker's name) instead of the random upload name,
 * so the public URL reads `/uploads/dr-m-c-sudhakar.png` instead of
 * `/uploads/speaker-1774508749767.png`.
 */
const processSpeakerPhoto = async (absInputPath, desiredName) => {
    const normalizedInput = path.resolve(absInputPath);
    if (!fs.existsSync(normalizedInput)) {
        console.warn('[imageProcessor] Input file missing:', normalizedInput);
        return { relPath: `/uploads/${path.basename(absInputPath)}` };
    }

    const dir = path.dirname(normalizedInput);
    const ext = path.extname(normalizedInput);
    const base = path.basename(normalizedInput, ext);
    // Name-based output when a desiredName is provided; otherwise keep the
    // original random base (backward compatible).
    const outPath = desiredName
        ? uniqueOutPath(dir, slugify(desiredName))
        : path.join(dir, `${base}.png`);
    const bgTemp = path.join(dir, `${base}.bg.png`);

    // 1) BG removal in a child process + sharp crop on the result
    try {
        await runBgRemovalWorker(normalizedInput, bgTemp);
        await cropTo400(bgTemp, outPath);
        fs.unlink(bgTemp, () => {});
        if (path.resolve(normalizedInput) !== path.resolve(outPath)) {
            fs.unlink(normalizedInput, () => {});
        }
        return { relPath: `/uploads/${path.basename(outPath)}` };
    } catch (err) {
        console.warn('[imageProcessor] BG removal failed, falling back to crop-only:', err.message);
        fs.unlink(bgTemp, () => {});
    }

    // 2) Fallback: plain sharp crop to 400x400
    try {
        const tempPath = path.resolve(normalizedInput) === path.resolve(outPath)
            ? path.join(dir, `${base}.tmp.png`)
            : outPath;
        await cropTo400(normalizedInput, tempPath);
        if (tempPath !== outPath) fs.renameSync(tempPath, outPath);
        if (path.resolve(normalizedInput) !== path.resolve(outPath)) {
            fs.unlink(normalizedInput, () => {});
        }
        return { relPath: `/uploads/${path.basename(outPath)}` };
    } catch (err) {
        console.error('[imageProcessor] Fallback crop failed, keeping original:', err.message);
    }

    // 3) Give up — keep the raw file as-is
    return { relPath: `/uploads/${path.basename(normalizedInput)}` };
};

const deleteUpload = (storedPath) => {
    if (!storedPath) return;
    try {
        const filename = String(storedPath).replace(/^\/?uploads\//, '').split('/').pop();
        if (!filename) return;
        fs.unlink(path.join('uploads', filename), () => {});
    } catch { /* ignore */ }
};

// No-op: the worker loads the model per invocation, so there's nothing to pre-warm.
// Kept so server.js's existing call site still works.
const warmUp = async () => {};

module.exports = { processSpeakerPhoto, deleteUpload, warmUp };
