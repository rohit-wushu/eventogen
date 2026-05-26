// Server-signed math captcha — stateless, no DB required.
// Public form GETs receive { question, token }. The token encodes the
// expected answer + an expiry, signed with HMAC-SHA256. On submit the
// client echoes the token + the user's answer and we verify both.
const crypto = require('crypto');

const SECRET = process.env.CAPTCHA_SECRET || process.env.JWT_SECRET || 'change-me';
const TTL_MS = 10 * 60 * 1000; // 10 minutes

function generateMathCaptcha() {
    // Single-digit operands keep the answer trivially solvable for humans
    // while still blocking the simplest spam scripts. We always return a
    // non-negative answer so subtraction never confuses the visitor.
    const a = 1 + Math.floor(Math.random() * 9);
    const b = 1 + Math.floor(Math.random() * 9);
    const op = Math.random() < 0.5 ? '+' : '-';
    const x = op === '+' ? a : Math.max(a, b);
    const y = op === '+' ? b : Math.min(a, b);
    const answer = op === '+' ? (x + y) : (x - y);
    const exp = Date.now() + TTL_MS;
    const payload = `${answer}.${exp}`;
    const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
    const token = `${Buffer.from(payload).toString('base64url')}.${sig}`;
    return { question: `${x} ${op} ${y}`, token };
}

function verifyMathCaptcha(token, userAnswer) {
    if (!token || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [b64, sig] = parts;
    let payload;
    try { payload = Buffer.from(b64, 'base64url').toString('utf8'); } catch { return false; }
    const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
    if (sig.length !== expected.length) return false;
    try {
        if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    } catch { return false; }
    const [answerStr, expStr] = payload.split('.');
    const exp = Number(expStr);
    if (!exp || Date.now() > exp) return false;
    return Number(String(userAnswer).trim()) === Number(answerStr);
}

module.exports = { generateMathCaptcha, verifyMathCaptcha };
