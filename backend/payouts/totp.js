/* ==========================================================================
   Second factor for releasing salaries: TOTP (RFC 6238, Google/Microsoft
   Authenticator compatible) + AES-256-GCM to keep the TOTP secrets encrypted
   in the database. Uses only Node's crypto; no extra packages.
   ========================================================================== */
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(buf) {
  let bits = 0; let value = 0; let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0; let value = 0; const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

const newSecret = () => base32Encode(crypto.randomBytes(20));

function hotp(secret, counter) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, '0');
}

/**
 * Checks a 6-digit code (±1 step of 30 s for clock drift).
 * Returns the matched time step (store it: a step may be used only once) or null.
 */
function verifyTotp(secret, code, { now = Date.now(), lastStep = -1 } = {}) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const step = Math.floor(now / 30000);
  for (const s of [step - 1, step, step + 1]) {
    if (s <= lastStep) continue; // replay of an already-used code
    const expected = hotp(secret, s);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return s;
  }
  return null;
}

const otpauthUri = (secret, account, issuer = 'RRD HRMS Payouts') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

/** AES-256-GCM with a key derived from PAYOUT_ENCRYPTION_KEY (keep it only in the server's environment). */
function cipher(keyMaterial) {
  if (!keyMaterial || String(keyMaterial).length < 32) return null;
  const key = crypto.createHash('sha256').update(String(keyMaterial)).digest();
  return {
    encrypt(text) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
      return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
    },
    decrypt(blob) {
      const [v, iv, tag, data] = String(blob).split(':');
      if (v !== 'v1') throw new Error('Unknown secret format');
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      d.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
    },
    /** keyed hash, e.g. to recognise the same bank account without storing it again */
    fingerprint: (text) => crypto.createHmac('sha256', key).update(String(text)).digest('hex').slice(0, 40),
  };
}

module.exports = { newSecret, hotp, verifyTotp, otpauthUri, cipher, base32Encode, base32Decode };
