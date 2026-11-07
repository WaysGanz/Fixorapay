'use strict';
const { loadConfig } = require('../src/config/env');
const { createLogger } = require('../src/utils/logger');
const { MockProvider } = require('../src/providers/mock/mock.provider');
const { MemoryPaymentRepository } = require('../src/modules/payments/payment.repository.memory');
const { PaymentService } = require('../src/modules/payments/payment.service');

function build(envOverrides = {}) {
  const time = { t: Date.parse('2026-11-07T10:00:00Z') };
  const clock = () => new Date(time.t);
  const config = loadConfig({ NODE_ENV: 'test', PROVIDER_TIMEOUT_MS: '30', EXPIRY_GRACE_SECONDS: '300', ...envOverrides });
  const logger = createLogger({ level: 'silent' });
  const provider = new MockProvider({ webhookSecret: 'test-secret', clock });
  const repo = new MemoryPaymentRepository({ clock });
  const service = new PaymentService({ repo, provider, config, logger, clock });
  const merchant = { id: 'merchant-1' };
  const advance = (ms) => { time.t += ms; };
  const body = (o = {}) => ({ orderId: 'ORD-1', amount: 25000, method: 'QRIS', ...o });
  return { service, repo, provider, config, clock, merchant, advance, body };
}

module.exports = { build };
