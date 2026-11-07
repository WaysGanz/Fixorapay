'use strict';

const STATUS = Object.freeze({
  CREATED: 'CREATED',
  PENDING: 'PENDING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  REFUND_PENDING: 'REFUND_PENDING',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
});
const S = STATUS;

// EXPIRED -> SUCCEEDED sengaja diizinkan: jika provider mengonfirmasi uang masuk setelah kita
// menandai expired (late settlement), uang pelanggan tidak boleh "hilang". Ditandai lateSettlement.
const TRANSITIONS = Object.freeze({
  [S.CREATED]: [S.PENDING, S.FAILED, S.CANCELLED, S.EXPIRED],
  [S.PENDING]: [S.SUCCEEDED, S.FAILED, S.EXPIRED, S.CANCELLED],
  [S.EXPIRED]: [S.SUCCEEDED],
  [S.SUCCEEDED]: [S.REFUND_PENDING],
  [S.REFUND_PENDING]: [S.REFUNDED, S.PARTIALLY_REFUNDED, S.SUCCEEDED],
  [S.PARTIALLY_REFUNDED]: [S.REFUND_PENDING],
  [S.FAILED]: [],
  [S.CANCELLED]: [],
  [S.REFUNDED]: [],
});

const PAID_STATES = new Set([S.SUCCEEDED, S.REFUND_PENDING, S.PARTIALLY_REFUNDED, S.REFUNDED]);

const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);
const isTerminal = (s) => (TRANSITIONS[s] || []).length === 0;

module.exports = { STATUS, TRANSITIONS, PAID_STATES, canTransition, isTerminal };
