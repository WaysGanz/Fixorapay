'use strict';
const crypto = require('node:crypto');
const { PaymentProvider } = require('../interfaces/payment-provider');
const { ProviderRejectedError, ProviderUnavailableError } = require('../errors');
const { hmacHex, safeEqualHex } = require('../../utils/crypto');

/**
 * MOCK PROVIDER - hanya untuk development & test. Skema signature webhook di sini
 * adalah skema MOCK buatan sendiri, BUKAN format provider nyata mana pun.
 * Adapter provider asli harus mengikuti dokumentasi resmi masing-masing.
 */
class MockProvider extends PaymentProvider {
  constructor({ webhookSecret = 'mock-secret', clock = () => new Date(), toleranceSeconds = 300 } = {}) {
    super();
    this.webhookSecret = webhookSecret;
    this.clock = clock;
    this.toleranceSeconds = toleranceSeconds;
    this.store = new Map(); // reference -> record
    this.calls = { create: 0, status: 0, cancel: 0, refund: 0 };
    this.failures = [];
  }

  get name() { return 'mock'; }
  get capabilities() {
    return {
      cancel: true,
      refund: true,
      channels: {
        QRIS: [],
        VIRTUAL_ACCOUNT: ['BCA', 'BNI', 'BRI', 'MANDIRI'],
        EWALLET: ['GOPAY', 'SHOPEEPAY', 'DANA', 'OVO'],
      },
    };
  }

  /** Suntik kegagalan untuk test: op = create|status|cancel, kind = timeout|unavailable|reject */
  injectFailure(op, kind, times = 1) { for (let i = 0; i < times; i++) this.failures.push({ op, kind }); }

  async #maybeFail(op) {
    const idx = this.failures.findIndex((f) => f.op === op);
    if (idx === -1) return;
    const [{ kind }] = this.failures.splice(idx, 1);
    if (kind === 'timeout') await new Promise(() => {}); // tidak pernah selesai -> kena timeout engine
    if (kind === 'unavailable') throw new ProviderUnavailableError('Mock: provider down');
    if (kind === 'reject') throw new ProviderRejectedError('Mock: request ditolak');
  }

  async createPayment(req) {
    this.calls.create++;
    await this.#maybeFail('create');
    // Mock mendedup berdasarkan reference. Perilaku provider nyata soal reference duplikat
    // HARUS dicek di dokumentasi resminya.
    const existing = this.store.get(req.reference);
    if (existing) return this.#view(existing);
    const rec = {
      reference: req.reference,
      providerRef: 'MOCK-' + crypto.randomBytes(5).toString('hex').toUpperCase(),
      amount: req.amount,
      method: req.method,
      channel: req.channel,
      status: 'PENDING',
      expiresAt: req.expiresAt,
      paidAmount: null,
      instructions: this.#instructions(req),
    };
    this.store.set(req.reference, rec);
    return this.#view(rec);
  }

  #instructions(req) {
    if (req.method === 'QRIS') return { type: 'QR', qrString: `MOCK-QRIS|${req.reference}|${req.amount}` };
    if (req.method === 'VIRTUAL_ACCOUNT') {
      const va = '88' + String(crypto.randomInt(0, 1e10)).padStart(10, '0');
      return { type: 'VA', bank: req.channel, vaNumber: va };
    }
    return { type: 'EWALLET', channel: req.channel, deeplinkUrl: `mock://pay/${req.reference}` };
  }

  #view(rec) { return { providerRef: rec.providerRef, instructions: rec.instructions, expiresAt: rec.expiresAt }; }

  async getPaymentStatus({ reference }) {
    this.calls.status++;
    await this.#maybeFail('status');
    const rec = this.store.get(reference);
    if (!rec) throw new ProviderRejectedError('Mock: reference tidak dikenal');
    const status = { PENDING: 'PENDING', PAID: 'SUCCEEDED', EXPIRED: 'EXPIRED', CANCELLED: 'CANCELLED', FAILED: 'FAILED' }[rec.status];
    return { status, paidAmount: rec.paidAmount ?? undefined, providerRef: rec.providerRef, occurredAt: rec.occurredAt };
  }

  async cancelPayment({ reference }) {
    this.calls.cancel++;
    await this.#maybeFail('cancel');
    const rec = this.store.get(reference);
    if (!rec) throw new ProviderRejectedError('Mock: reference tidak dikenal');
    if (rec.status !== 'PENDING') throw new ProviderRejectedError('Mock: transaksi tidak bisa dibatalkan');
    rec.status = 'CANCELLED';
    return { cancelled: true };
  }

  async refundPayment() { throw new ProviderRejectedError('Mock: refund akan diimplementasi bersama ledger (Phase 3)'); }

  // --- helper simulasi (hanya mock) ---
  simulatePay(reference, { amount } = {}) {
    const rec = this.store.get(reference);
    if (!rec) throw new Error('reference tidak ada di mock');
    rec.status = 'PAID';
    rec.paidAmount = amount ?? rec.amount;
    rec.occurredAt = this.clock();
  }
  simulateExpire(reference) { this.store.get(reference).status = 'EXPIRED'; }
  simulateFail(reference) { this.store.get(reference).status = 'FAILED'; }

  // --- webhook (skema MOCK) ---
  signWebhook(payload, timestamp = Math.floor(this.clock().getTime() / 1000)) {
    const rawBody = JSON.stringify(payload);
    const signature = hmacHex(this.webhookSecret, `${timestamp}.${rawBody}`);
    return { rawBody, headers: { 'x-mock-timestamp': String(timestamp), 'x-mock-signature': signature } };
  }

  verifyWebhook({ rawBody, headers, now = this.clock() }) {
    const ts = headers['x-mock-timestamp'];
    const sig = headers['x-mock-signature'];
    if (!ts || !sig || !/^\d{10}$/.test(ts)) return { valid: false, reason: 'MISSING_OR_BAD_HEADERS' };
    if (Math.abs(now.getTime() / 1000 - Number(ts)) > this.toleranceSeconds) return { valid: false, reason: 'STALE_TIMESTAMP' };
    const expected = hmacHex(this.webhookSecret, `${ts}.${rawBody}`);
    if (!safeEqualHex(expected, sig)) return { valid: false, reason: 'BAD_SIGNATURE' };
    let body;
    try { body = JSON.parse(rawBody); } catch { return { valid: false, reason: 'BAD_JSON' }; }
    return {
      valid: true,
      event: { eventId: body.eventId, reference: body.reference, status: body.status, paidAmount: body.paidAmount, providerRef: body.providerRef },
    };
  }
}

module.exports = { MockProvider };
