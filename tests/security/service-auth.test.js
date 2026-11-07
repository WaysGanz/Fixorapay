'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServiceAuth, signRequest } = require('../../src/middleware/serviceAuth');
const { createRateLimiter } = require('../../src/middleware/rateLimit');
const { MemoryKeyStore } = require('../../src/database/keystore');
const { loadConfig } = require('../../src/config/env');
const { createLogger } = require('../../src/utils/logger');

const NOW = Date.parse('2026-11-07T10:00:00Z');
const SECRET = 'super-secret-value';
const config = loadConfig({ NODE_ENV: 'test' });
const logger = createLogger({ level: 'silent' });
const keyStore = new MemoryKeyStore([{ keyId: 'key_1', merchantId: 'm1', secret: SECRET }, { keyId: 'key_off', merchantId: 'm2', secret: SECRET, active: false }]);
const auth = createServiceAuth({ keyStore, config, logger, clock: () => new Date(NOW) });

function run({ method = 'POST', path = '/api/v1/payments', body = '{"amount":25000}', headers, rawBody } = {}) {
  const h = headers ?? signRequest({ keyId: 'key_1', secret: SECRET, method, path, body, timestamp: NOW / 1000 });
  const req = { method, originalUrl: path, headers: h, rawBody: Buffer.from(rawBody ?? body), ip: '1.1.1.1' };
  return new Promise((resolve) => auth(req, {}, (err) => resolve({ err, req })));
}

test('request bertanda tangan valid diterima dan membawa identitas merchant', async () => {
  const { err, req } = await run();
  assert.equal(err, undefined);
  assert.deepEqual(req.merchant, { id: 'm1', keyId: 'key_1' });
});

test('header hilang / key tidak dikenal / key nonaktif -> 401 seragam', async () => {
  for (const headers of [
    {},
    signRequest({ keyId: 'nope', secret: SECRET, method: 'POST', path: '/api/v1/payments', body: '{"amount":25000}', timestamp: NOW / 1000 }),
    signRequest({ keyId: 'key_off', secret: SECRET, method: 'POST', path: '/api/v1/payments', body: '{"amount":25000}', timestamp: NOW / 1000 }),
  ]) {
    const { err } = await run({ headers });
    assert.equal(err.status, 401);
    assert.equal(err.message, 'Autentikasi gagal');
  }
});

test('secret salah, body dimodifikasi, path/method diganti -> ditolak', async () => {
  const wrongSecret = signRequest({ keyId: 'key_1', secret: 'salah', method: 'POST', path: '/api/v1/payments', body: '{"amount":25000}', timestamp: NOW / 1000 });
  assert.equal((await run({ headers: wrongSecret })).err.status, 401);
  assert.equal((await run({ rawBody: '{"amount":99999999}' })).err.status, 401, 'body diubah di tengah jalan');
  const signedForPost = signRequest({ keyId: 'key_1', secret: SECRET, method: 'POST', path: '/api/v1/payments', body: '', timestamp: NOW / 1000 });
  assert.equal((await run({ method: 'GET', path: '/api/v1/payments', body: '', headers: signedForPost })).err.status, 401, 'method diganti');
  assert.equal((await run({ path: '/api/v1/payments/other', headers: signedForPost })).err.status, 401, 'path diganti');
});

test('timestamp kedaluwarsa atau format salah -> ditolak', async () => {
  const old = signRequest({ keyId: 'key_1', secret: SECRET, method: 'POST', path: '/api/v1/payments', body: '{"amount":25000}', timestamp: NOW / 1000 - 3600 });
  assert.equal((await run({ headers: old })).err.status, 401);
  assert.equal((await run({ headers: { ...old, 'x-timestamp': 'abc' } })).err.status, 401);
});

test('replay: tanda tangan yang sama tidak bisa dipakai dua kali', async () => {
  const headers = signRequest({ keyId: 'key_1', secret: SECRET, method: 'POST', path: '/api/v1/payments', body: '{"amount":1}', timestamp: NOW / 1000 });
  assert.equal((await run({ body: '{"amount":1}', headers })).err, undefined);
  assert.equal((await run({ body: '{"amount":1}', headers })).err.status, 401);
});

test('rate limiter memblokir setelah melewati batas dan reset setelah jendela', () => {
  let t = 0;
  const limiter = createRateLimiter({ max: 3, windowMs: 1000, clock: () => t });
  const hit = () => { let e; limiter({ ip: 'x' }, { setHeader() {} }, (err) => { e = err; }); return e; };
  assert.equal(hit(), undefined); assert.equal(hit(), undefined); assert.equal(hit(), undefined);
  assert.equal(hit().status, 429);
  t = 1500;
  assert.equal(hit(), undefined);
});
