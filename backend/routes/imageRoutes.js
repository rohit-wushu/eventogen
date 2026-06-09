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

module.exports = router;
