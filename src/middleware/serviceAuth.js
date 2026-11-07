'use strict';
const { AppError } = require('../utils/errors');
const { sha256Hex, hmacHex, safeEqualHex } = require('../utils/crypto');

// String yang ditandatangani: timestamp, method, path+query asli, dan hash body mentah.
function buildSigningString({ timestamp, method, path, bodyHash }) {
  return [timestamp, method.toUpperCase(), path, bodyHash].join('\n');
}

// Dipakai klien (FIXORA GAME) dan test untuk membuat header autentikasi.
function signRequest({ keyId, secret, method, path, body = '', timestamp = Math.floor(Date.now() / 1000) }) {
  const bodyHash = sha256Hex(body);
  const signature = hmacHex(secret, buildSigningString({ timestamp, method, path, bodyHash }));
  return { 'x-api-key-id': keyId, 'x-timestamp': String(timestamp), 'x-signature': signature };
}

/**
 * keyStore.find(keyId) -> { keyId, merchantId, secret } | null
 * Cache anti-replay ada di memori proses ini; untuk multi-instance pindahkan ke Redis (Phase 4).
 */
function createServiceAuth({ keyStore, config, logger, clock = () => new Date() }) {
  const seen = new Map();
  const toleranceMs = config.signatureToleranceSeconds * 1000;
  const deny = (reason, req) => {
    logger.warn('auth.denied', { reason, path: req.originalUrl || req.url, ip: req.ip });
    return new AppError('UNAUTHORIZED', 'Autentikasi gagal', 401); // pesan sama untuk semua sebab
  };

  return async function serviceAuth(req, res, next) {
    try {
      const keyId = req.headers['x-api-key-id'];
      const ts = req.headers['x-timestamp'];
      const sig = req.headers['x-signature'];
      if (!keyId || !ts || !sig) return next(deny('MISSING_HEADERS', req));
      if (!/^\d{10}$/.test(ts)) return next(deny('BAD_TIMESTAMP', req));

      const nowMs = clock().getTime();
      if (Math.abs(nowMs - Number(ts) * 1000) > toleranceMs) return next(deny('STALE_TIMESTAMP', req));

      const key = await keyStore.find(keyId);
      if (!key) return next(deny('UNKNOWN_KEY', req));

      const expected = hmacHex(key.secret, buildSigningString({
        timestamp: ts, method: req.method, path: req.originalUrl || req.url, bodyHash: sha256Hex(req.rawBody || ''),
      }));
      if (!safeEqualHex(expected, sig)) return next(deny('BAD_SIGNATURE', req));

      // Replay: tanda tangan yang sama tidak boleh dipakai dua kali dalam jendela toleransi.
      const replayKey = `${keyId}:${sig}`;
      for (const [k, exp] of seen) if (exp <= nowMs) seen.delete(k);
      if (seen.has(replayKey)) return next(deny('REPLAY', req));
      seen.set(replayKey, nowMs + toleranceMs * 2);

      req.merchant = { id: key.merchantId, keyId: key.keyId };
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { createServiceAuth, signRequest, buildSigningString };
