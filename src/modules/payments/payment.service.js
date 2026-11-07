'use strict';
const { AppError, UniqueViolationError, notFound } = require('../../utils/errors');
const { newReference } = require('../../utils/reference');
const { fingerprint } = require('../../utils/crypto');
const { STATUS: S, PAID_STATES, canTransition } = require('./status');
const { validateCreatePayment } = require('./validation');
const { ProviderTimeoutError, ProviderRejectedError } = require('../../providers/errors');

const REORDERABLE = new Set([S.FAILED, S.EXPIRED, S.CANCELLED]);
const KNOWN = new Set(Object.values(S));

function withTimeout(fn, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new ProviderTimeoutError(`Provider tidak merespons dalam ${ms} ms`)), ms); });
  return Promise.race([Promise.resolve().then(fn), timeout]).finally(() => clearTimeout(timer));
}

class PaymentService {
  constructor({ repo, provider, config, logger, clock = () => new Date() }) {
    this.repo = repo; this.provider = provider; this.config = config; this.log = logger; this.clock = clock;
  }

  // ---------- create ----------
  async createPayment(merchant, input, idempotencyKey) {
    const data = validateCreatePayment(input, { config: this.config, provider: this.provider });
    const fp = fingerprint(data);

    const existing = await this.repo.getByIdempotencyKey(merchant.id, idempotencyKey);
    if (existing) return this.#replay(existing, fp);

    const siblings = await this.repo.listByOrder(merchant.id, data.orderId);
    if (siblings.some((p) => !REORDERABLE.has(p.status))) {
      throw new AppError('ORDER_ALREADY_HAS_PAYMENT', 'Order ini sudah punya pembayaran aktif atau berhasil', 409);
    }

    let payment;
    try {
      payment = await this.repo.createPayment({
        merchantId: merchant.id,
        reference: newReference(),
        orderId: data.orderId,
        idempotencyKey,
        requestFingerprint: fp,
        amount: data.amount,
        method: data.method,
        channel: data.channel,
        provider: this.provider.name,
        customer: data.customer,
        metadata: data.metadata,
        expiresAt: new Date(this.clock().getTime() + data.expiresInMinutes * 60_000),
      });
    } catch (e) {
      if (!(e instanceof UniqueViolationError)) throw e;
      // Request kembar yang masuk bersamaan: pakai record pemenang.
      const winner = await this.repo.getByIdempotencyKey(merchant.id, idempotencyKey);
      if (winner) return this.#replay(winner, fp);
      throw new AppError('CONFLICT', 'Konflik saat membuat pembayaran, coba lagi', 409);
    }
    this.log.info('payment.created', { paymentId: payment.id, reference: payment.reference, amount: payment.amount, method: payment.method });
    return { payment: await this.#dispatchToProvider(payment), replayed: false };
  }

  async #replay(existing, fp) {
    if (existing.requestFingerprint !== fp) {
      throw new AppError('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key sudah dipakai untuk request dengan isi berbeda', 409);
    }
    // Percobaan sebelumnya mungkin gagal/timeout di sisi provider: lanjutkan dengan reference yang SAMA.
    const payment = existing.status === S.CREATED ? await this.#dispatchToProvider(existing) : existing;
    return { payment, replayed: true };
  }

  async #dispatchToProvider(payment) {
    if (payment.status !== S.CREATED) return payment;

    const attempts = await this.repo.listAttempts(payment.id);
    const failed = attempts.filter((a) => a.operation === 'CREATE' && a.outcome !== 'SUCCESS').length;
    if (failed >= this.config.maxCreateAttempts) {
      await this.#fail(payment, 'provider_create_attempts_exhausted');
      throw new AppError('PROVIDER_UNAVAILABLE', 'Provider tidak tersedia, pembayaran dibatalkan', 502);
    }

    const started = Date.now();
    let result;
    try {
      result = await withTimeout(() => this.provider.createPayment({
        reference: payment.reference, amount: payment.amount, method: payment.method, channel: payment.channel,
        customer: payment.customer, expiresAt: payment.expiresAt, metadata: payment.metadata,
      }), this.config.providerTimeoutMs);
    } catch (e) {
      const outcome = e instanceof ProviderTimeoutError ? 'TIMEOUT' : e instanceof ProviderRejectedError ? 'REJECTED' : 'ERROR';
      await this.repo.addAttempt({ paymentId: payment.id, operation: 'CREATE', outcome, error: String(e.message).slice(0, 300), durationMs: Date.now() - started });
      this.log.warn('payment.provider_create_failed', { paymentId: payment.id, outcome, err: e });
      if (outcome === 'REJECTED') {
        await this.#fail(payment, 'provider_rejected');
        throw new AppError('PROVIDER_REJECTED', 'Provider menolak pembayaran', 422);
      }
      // Timeout/error: hasil tidak pasti, payment tetap CREATED agar bisa di-retry dengan reference sama.
      throw new AppError('PROVIDER_UNAVAILABLE', 'Provider sementara tidak tersedia, coba kirim ulang dengan Idempotency-Key yang sama', 502);
    }

    await this.repo.addAttempt({ paymentId: payment.id, operation: 'CREATE', outcome: 'SUCCESS', providerRef: result.providerRef, durationMs: Date.now() - started });
    const updated = await this.repo.compareAndSetStatus(
      payment.id, [S.CREATED],
      { status: S.PENDING, providerRef: result.providerRef, instructions: result.instructions, expiresAt: result.expiresAt || payment.expiresAt },
      { from: S.CREATED, to: S.PENDING, reason: 'provider_created', source: 'system' },
    );
    return updated || (await this.repo.getById(payment.id)); // request lain sudah memajukan status
  }

  async #fail(payment, reason) {
    return this.repo.compareAndSetStatus(payment.id, [S.CREATED], { status: S.FAILED, failureReason: reason },
      { from: S.CREATED, to: S.FAILED, reason, source: 'system' });
  }

  // ---------- baca ----------
  async getPayment(merchant, id) {
    const p = await this.repo.getById(id);
    if (!p || p.merchantId !== merchant.id) throw notFound('Pembayaran');
    return p;
  }

  async getStatus(merchant, id, { refresh = false } = {}) {
    let p = await this.getPayment(merchant, id);
    if (refresh && p.status === S.PENDING) p = (await this.#syncWithProvider(p)).payment;
    return p;
  }

  list(merchant, filters) { return this.repo.list({ merchantId: merchant.id, ...filters }); }

  // ---------- perubahan status dari sumber tepercaya (provider/webhook yang sudah diverifikasi) ----------
  // Dipakai bersama oleh pengecekan status, job expiry, dan (Phase 4) webhook worker.
  async applyProviderStatus(paymentId, report, { source = 'provider' } = {}) {
    for (let i = 0; i < 3; i++) {
      const p = await this.repo.getById(paymentId);
      if (!p) throw notFound('Pembayaran');
      const target = report.status;
      if (!KNOWN.has(target)) throw new AppError('INVALID_REPORT', `Status provider tidak dikenal: ${target}`, 400);

      if (target === S.PENDING) return { payment: p, changed: false };
      if (target === p.status || (target === S.SUCCEEDED && PAID_STATES.has(p.status))) {
        return { payment: p, changed: false, duplicate: true }; // idempotent: laporan kembar tidak memproses ulang
      }

      if (target === S.SUCCEEDED) {
        if (!Number.isSafeInteger(report.paidAmount)) return this.#anomaly(p, 'MISSING_AMOUNT', report);
        if (report.paidAmount !== p.amount) return this.#anomaly(p, 'AMOUNT_MISMATCH', report);
      }
      if (!canTransition(p.status, target)) return this.#anomaly(p, 'INVALID_TRANSITION', report);

      const now = this.clock();
      const patch = { status: target };
      if (target === S.SUCCEEDED) {
        patch.paidAt = report.occurredAt instanceof Date ? report.occurredAt : now;
        if (p.status === S.EXPIRED) patch.lateSettlement = true;
      }
      if (target === S.FAILED) patch.failureReason = report.reason || 'provider_reported_failed';

      const updated = await this.repo.compareAndSetStatus(p.id, [p.status], patch,
        { from: p.status, to: target, reason: report.reason || 'provider_report', source, meta: { providerRef: report.providerRef } });
      if (updated) {
        const late = target === S.SUCCEEDED && p.status === S.EXPIRED;
        this.log[late ? 'warn' : 'info']('payment.status_changed', { paymentId: p.id, from: p.status, to: target, late });
        return { payment: updated, changed: true, late };
      }
    }
    throw new AppError('CONFLICT', 'Status pembayaran berubah bersamaan, coba lagi', 409);
  }

  #anomaly(p, code, report) {
    // Tidak mengubah status: nominal/transisi tidak masuk akal harus diperiksa manual.
    this.log.error('payment.anomaly', { paymentId: p.id, code, current: p.status, reported: report.status, expected: p.amount, paid: report.paidAmount });
    return { payment: p, changed: false, anomaly: code };
  }

  // ---------- sinkronisasi & expiry ----------
  #pastGrace(p) {
    return Boolean(p.expiresAt) && this.clock().getTime() > new Date(p.expiresAt).getTime() + this.config.expiryGraceSeconds * 1000;
  }

  async #syncWithProvider(p) {
    let report;
    try {
      report = await withTimeout(() => this.provider.getPaymentStatus({ reference: p.reference, providerRef: p.providerRef }), this.config.providerTimeoutMs);
    } catch (e) {
      this.log.warn('payment.status_check_failed', { paymentId: p.id, err: e });
      return { payment: p, stale: true };
    }
    const res = await this.applyProviderStatus(p.id, report, { source: 'status_check' });
    if (res.payment.status === S.PENDING && this.#pastGrace(res.payment)) {
      // Provider masih bilang PENDING tapi sudah lewat batas + grace: expire lokal. Jika ternyata
      // dibayar belakangan, applyProviderStatus akan memulihkannya sebagai late settlement.
      const upd = await this.repo.compareAndSetStatus(p.id, [S.PENDING], { status: S.EXPIRED },
        { from: S.PENDING, to: S.EXPIRED, reason: 'local_expiry_after_grace', source: 'system' });
      return { payment: upd || (await this.repo.getById(p.id)), changed: Boolean(upd) };
    }
    return res;
  }

  // Dipanggil job berkala (nanti BullMQ). Tidak pernah meng-expire tanpa memeriksa provider lebih dulu.
  async expireDue({ limit = 100 } = {}) {
    const cutoff = new Date(this.clock().getTime() - this.config.expiryGraceSeconds * 1000);
    const due = await this.repo.listDuePending(cutoff, limit);
    const summary = { checked: due.length, expired: 0, succeeded: 0, unchanged: 0 };
    for (const p of due) {
      const r = await this.#syncWithProvider(p);
      if (r.payment.status === S.EXPIRED) summary.expired++;
      else if (r.payment.status === S.SUCCEEDED) summary.succeeded++;
      else summary.unchanged++;
    }
    return summary;
  }

  // ---------- cancel ----------
  async cancelPayment(merchant, id) {
    const p = await this.getPayment(merchant, id);
    if (p.status === S.CANCELLED) return p;
    if (![S.CREATED, S.PENDING].includes(p.status)) {
      throw new AppError('INVALID_STATE', `Pembayaran berstatus ${p.status} tidak bisa dibatalkan`, 409);
    }
    if (p.status === S.PENDING) {
      if (!this.provider.capabilities.cancel) throw new AppError('NOT_SUPPORTED', 'Provider tidak mendukung pembatalan', 422);
      try {
        await withTimeout(() => this.provider.cancelPayment({ reference: p.reference, providerRef: p.providerRef }), this.config.providerTimeoutMs);
      } catch (e) {
        if (e instanceof ProviderRejectedError) {
          const fresh = await this.#syncWithProvider(p); // mungkin sudah dibayar
          throw new AppError('INVALID_STATE', `Pembayaran tidak bisa dibatalkan (status sekarang ${fresh.payment.status})`, 409);
        }
        throw new AppError('PROVIDER_UNAVAILABLE', 'Provider tidak tersedia, pembatalan belum dilakukan', 502);
      }
    }
    const updated = await this.repo.compareAndSetStatus(p.id, [S.CREATED, S.PENDING], { status: S.CANCELLED },
      { from: p.status, to: S.CANCELLED, reason: 'cancelled_by_merchant', source: 'merchant' });
    if (!updated) throw new AppError('CONFLICT', 'Status berubah bersamaan, periksa ulang', 409);
    return updated;
  }
}

module.exports = { PaymentService };
