'use strict';

// Hanya field yang aman dikirim ke merchant. Fingerprint, providerRef mentah, dsb. tidak ikut.
function toPublic(p) {
  return {
    id: p.id,
    reference: p.reference,
    orderId: p.orderId,
    amount: p.amount,
    currency: p.currency,
    method: p.method,
    channel: p.channel,
    status: p.status,
    instructions: p.instructions,
    expiresAt: p.expiresAt ? new Date(p.expiresAt).toISOString() : null,
    paidAt: p.paidAt ? new Date(p.paidAt).toISOString() : null,
    lateSettlement: Boolean(p.lateSettlement),
    failureReason: p.failureReason,
    createdAt: new Date(p.createdAt).toISOString(),
  };
}

module.exports = { toPublic };
