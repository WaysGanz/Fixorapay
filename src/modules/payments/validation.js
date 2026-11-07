'use strict';
const { AppError } = require('../../utils/errors');

const METHODS = ['QRIS', 'VIRTUAL_ACCOUNT', 'EWALLET'];
const ALLOWED = new Set(['orderId', 'amount', 'method', 'channel', 'customer', 'expiresInMinutes', 'metadata']);

function validateCreatePayment(body, { config, provider }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('VALIDATION_ERROR', 'Body harus berupa objek JSON', 400);
  }
  const errors = [];
  const bad = (field, message) => errors.push({ field, message });

  for (const k of Object.keys(body)) if (!ALLOWED.has(k)) bad(k, 'Field tidak dikenal');

  if (typeof body.orderId !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(body.orderId)) {
    bad('orderId', 'Wajib string 1-64 karakter (huruf, angka, . _ : -)');
  }

  if (!Number.isSafeInteger(body.amount)) bad('amount', 'Harus bilangan bulat Rupiah (tanpa desimal)');
  else if (body.amount < config.minPaymentAmount || body.amount > config.maxPaymentAmount) {
    bad('amount', `Harus antara ${config.minPaymentAmount} dan ${config.maxPaymentAmount}`);
  }

  if (!METHODS.includes(body.method)) bad('method', `Harus salah satu dari ${METHODS.join(', ')}`);
  else {
    const allowed = provider.capabilities.channels[body.method] || [];
    if (allowed.length) {
      if (!allowed.includes(body.channel)) bad('channel', `Wajib salah satu dari ${allowed.join(', ')}`);
    } else if (body.channel !== undefined && body.channel !== null) bad('channel', 'Tidak dipakai untuk metode ini');
  }

  let customer = null;
  if (body.customer !== undefined && body.customer !== null) {
    const c = body.customer;
    if (typeof c !== 'object' || Array.isArray(c)) bad('customer', 'Harus objek');
    else {
      if (c.name !== undefined && (typeof c.name !== 'string' || c.name.length < 1 || c.name.length > 100)) bad('customer.name', '1-100 karakter');
      if (c.email !== undefined && (typeof c.email !== 'string' || c.email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email))) bad('customer.email', 'Email tidak valid');
      if (c.phone !== undefined && (typeof c.phone !== 'string' || !/^\+?[0-9]{8,15}$/.test(c.phone))) bad('customer.phone', 'Nomor telepon tidak valid');
      customer = { name: c.name, email: c.email, phone: c.phone };
    }
  }

  let expiresInMinutes = config.defaultExpiryMinutes;
  if (body.expiresInMinutes !== undefined) {
    if (!Number.isInteger(body.expiresInMinutes) || body.expiresInMinutes < 5 || body.expiresInMinutes > 1440) bad('expiresInMinutes', 'Bilangan bulat 5-1440');
    else expiresInMinutes = body.expiresInMinutes;
  }

  let metadata = null;
  if (body.metadata !== undefined && body.metadata !== null) {
    if (typeof body.metadata !== 'object' || Array.isArray(body.metadata) || Buffer.byteLength(JSON.stringify(body.metadata)) > 2048) {
      bad('metadata', 'Harus objek, maksimal 2 KB');
    } else metadata = body.metadata;
  }

  if (errors.length) throw new AppError('VALIDATION_ERROR', 'Input tidak valid', 400, errors);

  return {
    orderId: body.orderId,
    amount: body.amount,
    method: body.method,
    channel: body.channel ?? null,
    customer,
    expiresInMinutes,
    metadata,
  };
}

module.exports = { validateCreatePayment, METHODS };
