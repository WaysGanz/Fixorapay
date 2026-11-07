'use strict';
const crypto = require('node:crypto');
const { UniqueViolationError } = require('../../utils/errors');

// Repository in-memory: meniru constraint database (unique + compare-and-set) untuk test tanpa Postgres.
class MemoryPaymentRepository {
  constructor({ clock = () => new Date() } = {}) {
    this.clock = clock;
    this.payments = new Map();
    this.attempts = [];
    this.histories = [];
  }

  async createPayment(data) {
    for (const p of this.payments.values()) {
      if (p.reference === data.reference) throw new UniqueViolationError(['reference']);
      if (p.merchantId === data.merchantId && p.idempotencyKey === data.idempotencyKey) {
        throw new UniqueViolationError(['merchantId', 'idempotencyKey']);
      }
    }
    const now = this.clock();
    const rec = {
      id: crypto.randomUUID(), currency: 'IDR', status: 'CREATED', providerRef: null, instructions: null,
      customer: null, metadata: null, failureReason: null, lateSettlement: false, expiresAt: null, paidAt: null,
      ...data, createdAt: now, updatedAt: now,
    };
    this.payments.set(rec.id, rec);
    return { ...rec };
  }

  async getById(id) { const p = this.payments.get(id); return p ? { ...p } : null; }

  async getByIdempotencyKey(merchantId, key) {
    for (const p of this.payments.values()) if (p.merchantId === merchantId && p.idempotencyKey === key) return { ...p };
    return null;
  }

  async listByOrder(merchantId, orderId) {
    return [...this.payments.values()].filter((p) => p.merchantId === merchantId && p.orderId === orderId).map((p) => ({ ...p }));
  }

  // Update atomik hanya jika status saat ini ada di `fromStatuses`; mengembalikan null jika kalah balapan.
  async compareAndSetStatus(id, fromStatuses, patch, history) {
    const p = this.payments.get(id);
    if (!p || !fromStatuses.includes(p.status)) return null;
    Object.assign(p, patch, { updatedAt: this.clock() });
    this.histories.push({ id: crypto.randomUUID(), paymentId: id, fromStatus: history.from ?? null, toStatus: history.to, reason: history.reason ?? null, source: history.source, meta: history.meta ?? null, createdAt: this.clock() });
    return { ...p };
  }

  async addAttempt(a) { this.attempts.push({ id: crypto.randomUUID(), createdAt: this.clock(), ...a }); }
  async listAttempts(paymentId) { return this.attempts.filter((a) => a.paymentId === paymentId); }
  async listHistory(paymentId) { return this.histories.filter((h) => h.paymentId === paymentId); }

  async listDuePending(cutoff, limit = 100) {
    return [...this.payments.values()]
      .filter((p) => p.status === 'PENDING' && p.expiresAt && new Date(p.expiresAt) <= cutoff)
      .sort((a, b) => new Date(a.expiresAt) - new Date(b.expiresAt)).slice(0, limit).map((p) => ({ ...p }));
  }

  async list({ merchantId, status, orderId, limit = 20, offset = 0 }) {
    const all = [...this.payments.values()]
      .filter((p) => p.merchantId === merchantId && (!status || p.status === status) && (!orderId || p.orderId === orderId))
      .sort((a, b) => b.createdAt - a.createdAt);
    return { items: all.slice(offset, offset + limit).map((p) => ({ ...p })), total: all.length };
  }
}

module.exports = { MemoryPaymentRepository };
