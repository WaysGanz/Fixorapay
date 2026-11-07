'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../../src/config/env');
const { encrypt, decrypt, canonicalJson, fingerprint } = require('../../src/utils/crypto');
const { createLogger } = require('../../src/utils/logger');
const { MockProvider } = require('../../src/providers/mock/mock.provider');

const KEY = 'a'.repeat(64);

test('production menolak provider mock, key enkripsi kosong, dan DATABASE_URL kosong', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'mock', APP_ENCRYPTION_KEY: KEY, DATABASE_URL: 'x' }), /mock tidak boleh/);
  assert.throws(() => loadConfig({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'x' }), /APP_ENCRYPTION_KEY wajib/);
  assert.doesNotThrow(() => loadConfig({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'x', APP_ENCRYPTION_KEY: KEY, DATABASE_URL: 'postgresql://x' }));
});

test('config menolak angka tidak valid dan key enkripsi salah format', () => {
  assert.throws(() => loadConfig({ MAX_PAYMENT_AMOUNT: '12.5' }), /MAX_PAYMENT_AMOUNT/);
  assert.throws(() => loadConfig({ APP_ENCRYPTION_KEY: 'pendek' }), /64 karakter hex/);
});

test('enkripsi secret: round-trip, IV acak, dan terdeteksi jika dirusak', () => {
  const a = encrypt('rahasia', KEY); const b = encrypt('rahasia', KEY);
  assert.notEqual(a, b);
  assert.equal(decrypt(a, KEY), 'rahasia');
  assert.throws(() => decrypt(a.slice(0, -4) + 'AAAA', KEY));
  assert.throws(() => decrypt(a, 'b'.repeat(64)));
});

test('fingerprint stabil terhadap urutan key', () => {
  assert.equal(fingerprint({ a: 1, b: { c: 2, d: 3 } }), fingerprint({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
  assert.equal(canonicalJson({ b: undefined, a: 1 }), '{"a":1}');
});

test('logger menyamarkan field sensitif', () => {
  const lines = [];
  const log = createLogger({ sink: (l) => lines.push(l) });
  log.info('x', { secret: 's3cr3t', nested: { apiKey: 'k', ok: 1 }, signature: 'sig' });
  assert.ok(!/s3cr3t|"k"|"sig"/.test(lines[0]));
  assert.match(lines[0], /\[REDACTED\]/);
});

test('webhook mock: tanda tangan valid, dirusak, kedaluwarsa', () => {
  const now = new Date('2026-11-07T10:00:00Z');
  const p = new MockProvider({ webhookSecret: 's', clock: () => now });
  const w = p.signWebhook({ eventId: 'e1', reference: 'R', status: 'SUCCEEDED', paidAmount: 100 });
  assert.equal(p.verifyWebhook(w).valid, true);
  assert.equal(p.verifyWebhook({ ...w, rawBody: w.rawBody.replace('100', '999') }).reason, 'BAD_SIGNATURE');
  assert.equal(p.verifyWebhook({ ...w, now: new Date(now.getTime() + 3600_000) }).reason, 'STALE_TIMESTAMP');
  assert.equal(p.verifyWebhook({ rawBody: w.rawBody, headers: {} }).valid, false);
});
