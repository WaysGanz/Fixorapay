'use strict';
const crypto = require('node:crypto');

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');
const hmacHex = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// JSON dengan urutan key stabil, untuk fingerprint request idempotency.
function canonicalJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
  return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined)
    .map((k) => JSON.stringify(k) + ':' + canonicalJson(v[k])).join(',') + '}';
}
const fingerprint = (v) => sha256Hex(canonicalJson(v));
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

// AES-256-GCM untuk secret API key (HMAC butuh secret asli, jadi tidak bisa di-hash satu arah).
function encrypt(plain, keyHex) {
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) throw new Error('APP_ENCRYPTION_KEY harus 64 karakter hex');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

function decrypt(payload, keyHex) {
  const [v, iv, tag, data] = String(payload).split('.');
  if (v !== 'v1') throw new Error('Format ciphertext tidak dikenal');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
}

module.exports = { sha256Hex, hmacHex, safeEqualHex, canonicalJson, fingerprint, randomToken, encrypt, decrypt };
