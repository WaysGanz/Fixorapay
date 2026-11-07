'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { STATUS: S, canTransition, isTerminal, TRANSITIONS } = require('../../src/modules/payments/status');

test('transisi valid', () => {
  assert.ok(canTransition(S.CREATED, S.PENDING));
  assert.ok(canTransition(S.PENDING, S.SUCCEEDED));
  assert.ok(canTransition(S.SUCCEEDED, S.REFUND_PENDING));
  assert.ok(canTransition(S.EXPIRED, S.SUCCEEDED), 'late settlement harus bisa dicatat');
});

test('transisi tidak valid ditolak', () => {
  assert.equal(canTransition(S.FAILED, S.SUCCEEDED), false);
  assert.equal(canTransition(S.CANCELLED, S.PENDING), false);
  assert.equal(canTransition(S.SUCCEEDED, S.FAILED), false);
  assert.equal(canTransition(S.CREATED, S.SUCCEEDED), false, 'tidak boleh sukses tanpa lewat PENDING');
});

test('status terminal & semua status punya aturan', () => {
  for (const s of [S.FAILED, S.CANCELLED, S.REFUNDED]) assert.ok(isTerminal(s));
  for (const s of Object.values(S)) assert.ok(s in TRANSITIONS, `${s} belum punya aturan transisi`);
});
