const crypto = require('crypto');

// Symmetric encryption for OAuth access/refresh tokens stored in
// social_accounts. We use AES-256-GCM so each ciphertext carries an
// authentication tag — if anyone tampers with the row in the DB, decrypt
// will throw and we surface the error instead of silently returning
// corrupted tokens to a platform API.
//
// Envelope format:  v1.<iv-b64>.<ciphertext-b64>.<authTag-b64>
//
// Why version-prefix? When SOCIAL_TOKEN_KEY rotates we add a new branch
// (v2…) and re-encrypt rows on first read. v1-prefixed rows keep decrypting
// with the old key during the transition.
//
// Key: 32 raw bytes, base64-encoded in SOCIAL_TOKEN_KEY. Generate with:
//     node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;          // 96 bits, GCM standard
const VERSION = 'v1';

function loadKey() {
    const raw = process.env.SOCIAL_TOKEN_KEY;
    if (!raw) {
        throw new Error('SOCIAL_TOKEN_KEY missing from env. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
    }
    const buf = Buffer.from(raw, 'base64');
    if (buf.length !== 32) {
        throw new Error(`SOCIAL_TOKEN_KEY must decode to 32 bytes (got ${buf.length}). Did you base64-encode 32 random bytes?`);
    }
    return buf;
}

// Encrypt a plaintext string. Returns the envelope string ready to store in
// a TEXT column. Pass through null/undefined unchanged so callers can write
// `encrypt(refreshToken)` without first checking presence.
function encrypt(plain) {
    if (plain == null || plain === '') return null;
    const key = loadKey();
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGO, key, iv);
    const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64'), ct.toString('base64'), tag.toString('base64')].join('.');
}

// Decrypt an envelope. Throws if tampered (auth tag mismatch) or wrong key.
function decrypt(envelope) {
    if (envelope == null || envelope === '') return null;
    const parts = String(envelope).split('.');
    if (parts.length !== 4) throw new Error('tokenCrypto: invalid envelope shape');
    const [version, ivB64, ctB64, tagB64] = parts;
    if (version !== VERSION) throw new Error(`tokenCrypto: unsupported version "${version}"`);
    const key = loadKey();
    const iv = Buffer.from(ivB64, 'base64');
    const ct = Buffer.from(ctB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
}

module.exports = { encrypt, decrypt };
