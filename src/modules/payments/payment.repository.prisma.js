'use strict';
const { UniqueViolationError } = require('../../utils/errors');

// Implementasi Prisma/PostgreSQL dari kontrak repository yang sama dengan versi memory.
class PrismaPaymentRepository {
  constructor(prisma) { this.prisma = prisma; }

  async createPayment(data) {
    try {
      return await this.prisma.paymentTransaction.create({ data });
    } catch (e) {
      if (e && e.code === 'P2002') throw new UniqueViolationError(e.meta && e.meta.target);
      throw e;
    }
  }

  getById(id) { return this.prisma.paymentTransaction.findUnique({ where: { id } }); }

  getByIdempotencyKey(merchantId, idempotencyKey) {
    return this.prisma.paymentTransaction.findUnique({ where: { merchantId_idempotencyKey: { merchantId, idempotencyKey } } });
  }

  listByOrder(merchantId, orderId) { return this.prisma.paymentTransaction.findMany({ where: { merchantId, orderId } }); }

  // UPDATE ... WHERE id AND status IN (...) + riwayat status dalam satu transaksi database.
  compareAndSetStatus(id, fromStatuses, patch, history) {
    return this.prisma.$transaction(async (tx) => {
      const res = await tx.paymentTransaction.updateMany({ where: { id, status: { in: fromStatuses } }, data: { ...patch, updatedAt: new Date() } });
      if (res.count !== 1) return null;
      await tx.paymentStatusHistory.create({
        data: { paymentId: id, fromStatus: history.from ?? null, toStatus: history.to, reason: history.reason ?? null, source: history.source, meta: history.meta ?? undefined },
      });
      return tx.paymentTransaction.findUnique({ where: { id } });
    });
  }

  async addAttempt(a) { await this.prisma.paymentAttempt.create({ data: a }); }
  listAttempts(paymentId) { return this.prisma.paymentAttempt.findMany({ where: { paymentId }, orderBy: { createdAt: 'asc' } }); }
  listHistory(paymentId) { return this.prisma.paymentStatusHistory.findMany({ where: { paymentId }, orderBy: { createdAt: 'asc' } }); }

  listDuePending(cutoff, limit = 100) {
    return this.prisma.paymentTransaction.findMany({ where: { status: 'PENDING', expiresAt: { lte: cutoff } }, orderBy: { expiresAt: 'asc' }, take: limit });
  }

  async list({ merchantId, status, orderId, limit = 20, offset = 0 }) {
    const where = { merchantId, ...(status ? { status } : {}), ...(orderId ? { orderId } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.paymentTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit, skip: offset }),
      this.prisma.paymentTransaction.count({ where }),
    ]);
    return { items, total };
  }
}

module.exports = { PrismaPaymentRepository };
