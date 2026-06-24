// Generic image-processing routes — server-side proxies to paid services
// like Cutout.pro. The browser never sees the API key.
//
// Today this only exposes /enhance (powering the "Enhance" button in the
// speaker form + SNS generator). Add background-removal / upscale / etc.
// here as needed — the multer + protect plumbing is already set up.

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { protect } = require('../middleware/authMiddleware');
const { enhanceImage, removeBackground, CutoutError } = require('../services/cutout');
const { createUpload, fileUrl } = require('../utils/storage');

// Disk-backed upload for "store this image, give me a URL" flows (SNS
// template background, future generic uploads). Storage is metered under
// 'sns-templates' so it counts toward the tenant's plan quota.
const diskUpload = createUpload('sns-bg', {
    limits: { fileSize: 8 * 1024 * 1024 },
    source: 'sns-templates',
});

// Keep the upload in memory — we never persist the original on disk, we
// just forward it to Cutout and pipe the enhanced bytes straight back.
// 10 MB cap mirrors what Cutout itself accepts on the free tier.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
});

// Shared handler factory — keeps the two endpoints (enhance, remove-bg) in
// lockstep on auth + multer + error shape; only the Cutout call differs.
function runCutoutOp(opFn, label) {
    return async (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No image file provided' });
        try {
            const { buffer, contentType } = await opFn(req.file.buffer, {
                contentType: req.file.mimetype || 'image/png',
                filename: req.file.originalname || 'photo.png',
            });
            res.set('Content-Type', contentType);
            res.set('Cache-Control', 'no-store');
            return res.send(buffer);
        } catch (err) {
            if (err instanceof CutoutError) {
                console.warn(`Cutout ${label} error:`, err.message, err.payload || '');
                return res.status(502).json({ error: err.message });
            }
            console.error(`${label} failed:`, err);
            return res.status(500).json({ error: err.message || `${label} failed` });
        }
    };
}

router.post('/enhance',   protect, upload.single('image'), runCutoutOp(enhanceImage,    'enhance'));
router.post('/remove-bg', protect, upload.single('image'), runCutoutOp(removeBackground, 'remove-bg'));

// POST /api/image/upload — store the file to /uploads/ and return its URL.
// Used by the SNS template editor so the picked background gets a real,
// persistable URL instead of a session-scoped blob: URL that vanishes on
// save (the template payload skips blob: URLs).
router.post('/upload', protect, diskUpload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });
    const url = fileUrl(req.file);
    if (!url) return res.status(500).json({ error: 'Failed to resolve upload URL' });
    res.json({ url });
});

module.exports = router;
