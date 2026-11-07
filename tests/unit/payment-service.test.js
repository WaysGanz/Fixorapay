'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('../helpers');

const KEY = 'idem-key-0001';

test('membuat pembayaran QRIS -> PENDING dengan instruksi & riwayat', async () => {
  const { service, repo, merchant, body } = build();
  const { payment, replayed } = await service.createPayment(merchant, body(), KEY);
  assert.equal(replayed, false);
  assert.equal(payment.status, 'PENDING');
  assert.match(payment.reference, /^FXP-/);
  assert.match(payment.instructions.qrString, /^MOCK-QRIS\|/);
  const hist = await repo.listHistory(payment.id);
  assert.deepEqual(hist.map((h) => h.toStatus), ['PENDING']);
});

test('VA & E-Wallet butuh channel valid', async () => {
  const { service, merchant, body } = build();
  await assert.rejects(() => service.createPayment(merchant, body({ method: 'VIRTUAL_ACCOUNT' }), KEY), { code: 'VALIDATION_ERROR' });
  const va = await service.createPayment(merchant, body({ method: 'VIRTUAL_ACCOUNT', channel: 'BCA' }), 'idem-key-va-1');
  assert.match(va.payment.instructions.vaNumber, /^88\d{10}$/);
  const ew = await service.createPayment(merchant, body({ orderId: 'ORD-2', method: 'EWALLET', channel: 'GOPAY' }), 'idem-key-ew-1');
  assert.match(ew.payment.instructions.deeplinkUrl, /^mock:\/\/pay\//);
});

test('validasi nominal: desimal, negatif, di luar batas, field asing', async () => {
  const { service, merchant, body } = build();
  for (const amount of [25000.5, -1000, 0, 999, 50_000_001, '25000', NaN]) {
    await assert.rejects(() => service.createPayment(merchant, body({ amount }), KEY), { code: 'VALIDATION_ERROR' }, `amount ${amount}`);
  }
  await assert.rejects(() => service.createPayment(merchant, body({ status: 'SUCCEEDED' }), KEY), { code: 'VALIDATION_ERROR' });
});

test('request kembar (Idempotency-Key sama) tidak membuat pembayaran ganda', async () => {
  const { service, repo, provider, merchant, body } = build();
  const a = await service.createPayment(merchant, body(), KEY);
  const b = await service.createPayment(merchant, body(), KEY);
  assert.equal(b.replayed, true);
  assert.equal(a.payment.id, b.payment.id);
  assert.equal(repo.payments.size, 1);
  assert.equal(provider.store.size, 1);
});

test('request kembar BERSAMAAN hanya menghasilkan satu pembayaran', async () => {
  const { service, repo, provider, merchant, body } = build();
  const results = await Promise.all(Array.from({ length: 6 }, () => service.createPayment(merchant, body(), KEY)));
  assert.equal(new Set(results.map((r) => r.payment.id)).size, 1);
  assert.equal(repo.payments.size, 1);
  assert.equal(provider.store.size, 1);
  assert.equal((await repo.listHistory(results[0].payment.id)).length, 1, 'hanya satu transisi PENDING');
});

test('Idempotency-Key sama tapi isi beda -> 409', async () => {
  const { service, merchant, body } = build();
  await service.createPayment(merchant, body(), KEY);
  await assert.rejects(() => service.createPayment(merchant, body({ amount: 30000 }), KEY), { code: 'IDEMPOTENCY_KEY_REUSED', status: 409 });
});

test('satu order tidak boleh punya dua pembayaran aktif, tapi boleh bayar ulang setelah expired', async () => {
  const { service, provider, merchant, body, advance } = build();
  const first = await service.createPayment(merchant, body(), KEY);
  await assert.rejects(() => service.createPayment(merchant, body(), 'idem-key-0002'), { code: 'ORDER_ALREADY_HAS_PAYMENT' });
  provider.simulateExpire(first.payment.reference);
  advance(60 * 60_000);
  await service.getStatus(merchant, first.payment.id, { refresh: true });
  const second = await service.createPayment(merchant, body(), 'idem-key-0002');
  assert.notEqual(second.payment.id, first.payment.id);
});

test('provider timeout: payment tetap CREATED, retry dengan key sama memakai reference yang sama', async () => {
  const { service, repo, provider, merchant, body } = build();
  provider.injectFailure('create', 'timeout');
  await assert.rejects(() => service.createPayment(merchant, body(), KEY), { code: 'PROVIDER_UNAVAILABLE', status: 502 });
  const [stuck] = [...repo.payments.values()];
  assert.equal(stuck.status, 'CREATED');
  assert.equal((await repo.listAttempts(stuck.id))[0].outcome, 'TIMEOUT');

  const retry = await service.createPayment(merchant, body(), KEY);
  assert.equal(retry.payment.id, stuck.id);
  assert.equal(retry.payment.reference, stuck.reference);
  assert.equal(retry.payment.status, 'PENDING');
  assert.equal(provider.store.size, 1);
});

test('provider gagal berulang melewati batas percobaan -> FAILED', async () => {
  const { service, repo, provider, merchant, body } = build();
  provider.injectFailure('create', 'unavailable', 3);
  for (let i = 0; i < 3; i++) await assert.rejects(() => service.createPayment(merchant, body(), KEY), { code: 'PROVIDER_UNAVAILABLE' });
  await assert.rejects(() => service.createPayment(merchant, body(), KEY), { code: 'PROVIDER_UNAVAILABLE' });
  assert.equal([...repo.payments.values()][0].status, 'FAILED');
});

test('provider menolak tegas -> FAILED & 422', async () => {
  const { service, repo, provider, merchant, body } = build();
  provider.injectFailure('create', 'reject');
  await assert.rejects(() => service.createPayment(merchant, body(), KEY), { code: 'PROVIDER_REJECTED', status: 422 });
  assert.equal([...repo.payments.values()][0].status, 'FAILED');
});

test('pembayaran sukses: status final hanya dari laporan provider (bukan klaim klien)', async () => {
  const { service, provider, merchant, body } = build();
  const { payment } = await service.createPayment(merchant, body(), KEY);
  assert.equal((await service.getStatus(merchant, payment.id, { refresh: true })).status, 'PENDING');
  provider.simulatePay(payment.reference);
  const done = await service.getStatus(merchant, payment.id, { refresh: true });
  assert.equal(done.status, 'SUCCEEDED');
  assert.ok(done.paidAt);
});

test('nominal tidak cocok -> anomali, status TIDAK berubah', async () => {
  const { service, repo, merchant, body } = build();
  const { payment } = await service.createPayment(merchant, body(), KEY);
  const r = await service.applyProviderStatus(payment.id, { status: 'SUCCEEDED', paidAmount: 1000 });
  assert.equal(r.anomaly, 'AMOUNT_MISMATCH');
  assert.equal((await repo.getById(payment.id)).status, 'PENDING');
  const r2 = await service.applyProviderStatus(payment.id, { status: 'SUCCEEDED' });
  assert.equal(r2.anomaly, 'MISSING_AMOUNT');
});

test('laporan sukses kembar bersifat idempotent', async () => {
  const { service, repo, merchant, body } = build();
  const { payment } = await service.createPayment(merchant, body(), KEY);
  const rep = { status: 'SUCCEEDED', paidAmount: 25000 };
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => service.applyProviderStatus(payment.id, rep)));
  assert.equal([a, b, c].filter((r) => r.changed).length, 1, 'hanya satu yang benar-benar mengubah status');
  assert.equal((await repo.listHistory(payment.id)).filter((h) => h.toStatus === 'SUCCEEDED').length, 1);
});

test('gagal & expired dicatat; FAILED tidak bisa jadi SUCCEEDED', async () => {
  const { service, repo, merchant, body } = build();
  const a = await service.createPayment(merchant, body(), KEY);
  const f = await service.applyProviderStatus(a.payment.id, { status: 'FAILED', reason: 'bank_declined' });
  assert.equal(f.payment.status, 'FAILED');
  assert.equal(f.payment.failureReason, 'bank_declined');
  const bad = await service.applyProviderStatus(a.payment.id, { status: 'SUCCEEDED', paidAmount: 25000 });
  assert.equal(bad.anomaly, 'INVALID_TRANSITION');
  const b = await service.createPayment(merchant, body({ orderId: 'ORD-9' }), 'idem-key-0009');
  assert.equal((await service.applyProviderStatus(b.payment.id, { status: 'EXPIRED' })).payment.status, 'EXPIRED');
  assert.equal((await repo.getById(b.payment.id)).status, 'EXPIRED');
});

test('late settlement: dibayar setelah expired tetap tercatat SUCCEEDED + ditandai', async () => {
  const { service, merchant, body } = build();
  const { payment } = await service.createPayment(merchant, body(), KEY);
  await service.applyProviderStatus(payment.id, { status: 'EXPIRED' });
  const r = await service.applyProviderStatus(payment.id, { status: 'SUCCEEDED', paidAmount: 25000 });
  assert.equal(r.payment.status, 'SUCCEEDED');
  assert.equal(r.payment.lateSettlement, true);
  assert.equal(r.late, true);
});

test('expireDue: provider masih PENDING lewat grace -> EXPIRED; provider sudah PAID -> SUCCEEDED', async () => {
  const { service, provider, merchant, body, advance } = build();
  const a = await service.createPayment(merchant, body({ orderId: 'A' }), 'idem-key-aaaa');
  const b = await service.createPayment(merchant, body({ orderId: 'B' }), 'idem-key-bbbb');
  const c = await service.createPayment(merchant, body({ orderId: 'C' }), 'idem-key-cccc');
  provider.simulatePay(b.payment.reference);
  advance(30 * 60_000 + 10_000); // lewat expiry, belum lewat grace
  assert.equal((await service.expireDue()).checked, 0);
  advance(6 * 60_000); // lewat grace
  const s = await service.expireDue();
  assert.deepEqual(s, { checked: 3, expired: 2, succeeded: 1, unchanged: 0 });
  assert.equal((await service.getPayment(merchant, a.payment.id)).status, 'EXPIRED');
  assert.equal((await service.getPayment(merchant, b.payment.id)).status, 'SUCCEEDED');
  assert.equal((await service.getPayment(merchant, c.payment.id)).status, 'EXPIRED');
});

test('expireDue tidak meng-expire jika provider tidak bisa dihubungi', async () => {
  const { service, provider, merchant, body, advance } = build();
  const a = await service.createPayment(merchant, body(), KEY);
  advance(40 * 60_000);
  provider.injectFailure('status', 'timeout');
  const s = await service.expireDue();
  assert.equal(s.unchanged, 1);
  assert.equal((await service.getPayment(merchant, a.payment.id)).status, 'PENDING');
});

test('cancel: PENDING bisa, SUCCEEDED tidak; isolasi antar merchant', async () => {
  const { service, provider, merchant, body } = build();
  const a = await service.createPayment(merchant, body({ orderId: 'A' }), 'idem-key-aaaa');
  assert.equal((await service.cancelPayment(merchant, a.payment.id)).status, 'CANCELLED');
  const b = await service.createPayment(merchant, body({ orderId: 'B' }), 'idem-key-bbbb');
  provider.simulatePay(b.payment.reference);
  await service.getStatus(merchant, b.payment.id, { refresh: true });
  await assert.rejects(() => service.cancelPayment(merchant, b.payment.id), { code: 'INVALID_STATE' });
  await assert.rejects(() => service.getPayment({ id: 'merchant-lain' }, b.payment.id), { code: 'NOT_FOUND' });
});

test('cancel saat provider sudah menerima pembayaran -> 409 dan status ter-sinkron', async () => {
  const { service, provider, merchant, body } = build();
  const { payment } = await service.createPayment(merchant, body(), KEY);
  provider.simulatePay(payment.reference); // dibayar tapi kita belum tahu
  await assert.rejects(() => service.cancelPayment(merchant, payment.id), { code: 'INVALID_STATE' });
  assert.equal((await service.getPayment(merchant, payment.id)).status, 'SUCCEEDED');
});
