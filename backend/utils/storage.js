const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ─── File storage adapter ───────────────────────────────────────────
// Lets the app run with multiple Node instances behind a load balancer
// without uploads being stuck on whichever box happened to receive them.
//
// Selection logic, run once at startup:
//   • If S3_BUCKET is set in the environment AND both `multer-s3` and
//     `@aws-sdk/client-s3` are installed → uploads go to S3 and the
//     `mountStatic` no-op skips the /uploads Express handler.
//   • Otherwise → falls back to the original local-disk behavior so the
//     app still runs on a single box without any extra setup.
//
// Routes use `createUpload(prefix)` to get a configured multer instance
// and `fileUrl(file)` to build the public URL — both work the same in
// either mode, so route code doesn't branch on S3-vs-disk.

const S3_BUCKET = process.env.S3_BUCKET;
const S3_REGION = process.env.S3_REGION || 'us-east-1';
const S3_PUBLIC_URL = process.env.S3_PUBLIC_URL; // optional CDN/CloudFront base

let s3Client = null;
let multerS3 = null;

if (S3_BUCKET) {
    try {
        const { S3Client } = require('@aws-sdk/client-s3');
        multerS3 = require('multer-s3');
        s3Client = new S3Client({
            region: S3_REGION,
            ...(process.env.AWS_ACCESS_KEY_ID && {
                credentials: {
                    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
                }
            })
        });
        console.log(`📦 S3 storage enabled — bucket=${S3_BUCKET} region=${S3_REGION}`);
    } catch (e) {
        console.warn(
            '⚠️ S3_BUCKET is set but the S3 dependencies are not installed.\n' +
            '   Falling back to local disk uploads. To enable S3, run:\n' +
            '   npm install @aws-sdk/client-s3 multer-s3'
        );
    }
}

const usingS3 = () => !!(S3_BUCKET && s3Client && multerS3);

// Ensure the local uploads dir exists in disk mode (multer used to assume it).
if (!usingS3()) {
    try { fs.mkdirSync(path.join(__dirname, '..', 'uploads'), { recursive: true }); } catch (_) {}
}

// Builds a unique, collision-safe filename. `prefix` can be a plain string
// (`'chat'` → `chat-<ts>-<rand>.ext`) or a function `(req, file) => string`
// for cases where the prefix depends on the user (e.g. `user-<userId>`).
const buildFilename = (prefix) => (req, file, cb) => {
    try {
        const base = typeof prefix === 'function' ? prefix(req, file) : prefix;
        const ext = path.extname(file.originalname || '');
        const rand = Math.random().toString(36).slice(2, 8);
        cb(null, `${base}-${Date.now()}-${rand}${ext}`);
    } catch (e) {
        cb(e);
    }
};

// `prefix` — string or `(req, file) => string`. `opts` is passed straight
// to multer (limits, fileFilter, etc.).
const createUpload = (prefix, opts = {}) => {
    if (usingS3()) {
        return multer({
            storage: multerS3({
                s3: s3Client,
                bucket: S3_BUCKET,
                contentType: multerS3.AUTO_CONTENT_TYPE,
                key: buildFilename(prefix)
            }),
            ...opts
        });
    }
    return multer({
        storage: multer.diskStorage({
            destination: (req, file, cb) => cb(null, 'uploads/'),
            filename: buildFilename(prefix)
        }),
        ...opts
    });
};

// Public URL for an uploaded file. Multer-s3 sets `file.location` to the
// absolute S3/CloudFront URL; local disk uploads continue to be served
// from `/uploads/<name>` by Express static.
const fileUrl = (file) => {
    if (!file) return null;
    if (file.location) {
        // If S3_PUBLIC_URL is set (e.g. a CDN), rewrite the host so end-
        // users hit the CDN instead of the bucket origin.
        if (S3_PUBLIC_URL && file.key) {
            return `${S3_PUBLIC_URL.replace(/\/$/, '')}/${file.key}`;
        }
        return file.location;
    }
    if (file.filename) return `/uploads/${file.filename}`;
    return null;
};

// Server.js calls this once at startup. In disk mode we serve `/uploads`
// as a static directory; in S3 mode the URLs are absolute so this is a
// no-op.
const mountStatic = (app) => {
    if (!usingS3()) {
        const express = require('express');
        app.use('/uploads', express.static('uploads'));
    }
};

module.exports = { createUpload, fileUrl, mountStatic, usingS3 };
