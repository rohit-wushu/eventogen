const crypto = require('crypto');

// Symmetric encryption for sensitive-at-rest values (Razorpay secret keys,
// etc.). Uses AES-256-GCM with a key derived from the ENCRYPTION_KEY env var,
// falling back to a SHA-256 of JWT_SECRET so the app doesn't blow up if admins
// haven't provisioned a dedicated encryption key yet.
//
// Format of the stored string: iv(hex) + ':' + tag(hex) + ':' + cipher(hex)
// which is self-describing and stays trivially rotatable in the future.

const ALGO = 'aes-256-gcm';

const getKey = () => {
    const raw = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'dev-insecure-encryption-key';
    // SHA-256 always yields 32 bytes which AES-256 needs regardless of the
    // source material's length.
    return crypto.createHash('sha256').update(String(raw)).digest();
};

const encrypt = (plaintext) => {
    if (plaintext == null || plaintext === '') return null;
    const key = getKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
};

const decrypt = (payload) => {
    if (!payload) return null;
    try {
        const [ivHex, tagHex, encHex] = String(payload).split(':');
        if (!ivHex || !tagHex || !encHex) return null;
        const key = getKey();
        const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
        const dec = Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]);
        return dec.toString('utf8');
    } catch {
        return null;
    }
};

// Masked preview suitable for returning to admin UIs — keeps the last 4 chars
// visible so they can confirm they've pasted the right key, without leaking
// the full secret back over the wire.
const maskSecret = (plaintext) => {
    if (!plaintext) return '';
    const s = String(plaintext);
    if (s.length <= 4) return '•'.repeat(s.length);
    return '•'.repeat(Math.max(4, s.length - 4)) + s.slice(-4);
};

module.exports = { encrypt, decrypt, maskSecret };
