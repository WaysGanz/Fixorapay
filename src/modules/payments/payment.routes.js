'use strict';
const { AppError } = require('../../utils/errors');
const { toPublic } = require('./payment.presenter');
const { STATUS } = require('./status');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function idempotencyKey(req) {
  const k = req.headers['idempotency-key'];
  if (typeof k !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(k)) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Header Idempotency-Key wajib (8-64 karakter: huruf, angka, _ -)', 400);
  }
  return k;
}

function paramId(req) {
  if (!UUID.test(req.params.id)) throw new AppError('NOT_FOUND', 'Pembayaran tidak ditemukan', 404);
  return req.params.id;
}

// `express` di-inject agar modul ini tidak punya dependency keras saat test.
function buildPaymentRoutes({ express, service, provider, auth }) {
  const router = express.Router();
  router.use(auth);

  router.get('/payment-methods', (req, res) => {
    const ch = provider.capabilities.channels;
    res.json({ data: Object.keys(ch).map((method) => ({ method, channels: ch[method] })) });
  });

  router.post('/payments', wrap(async (req, res) => {
    const { payment, replayed } = await service.createPayment(req.merchant, req.body, idempotencyKey(req));
    res.set('Idempotent-Replayed', String(replayed)).status(replayed ? 200 : 201).json({ data: toPublic(payment) });
  }));

  router.get('/payments', wrap(async (req, res) => {
    const { status, orderId } = req.query;
    if (status !== undefined && !STATUS[status]) throw new AppError('VALIDATION_ERROR', 'status tidak valid', 400);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const { items, total } = await service.list(req.merchant, { status, orderId: typeof orderId === 'string' ? orderId : undefined, limit, offset });
    res.json({ data: items.map(toPublic), meta: { total, limit, offset } });
  }));

  router.get('/payments/:id', wrap(async (req, res) => {
    res.json({ data: toPublic(await service.getPayment(req.merchant, paramId(req))) });
  }));

  router.get('/payments/:id/status', wrap(async (req, res) => {
    const p = await service.getStatus(req.merchant, paramId(req), { refresh: req.query.refresh === 'true' });
    res.json({ data: { id: p.id, reference: p.reference, status: p.status, paidAt: p.paidAt ? new Date(p.paidAt).toISOString() : null } });
  }));

  router.post('/payments/:id/cancel', wrap(async (req, res) => {
    res.json({ data: toPublic(await service.cancelPayment(req.merchant, paramId(req))) });
  }));

  return router;
}

module.exports = { buildPaymentRoutes };
