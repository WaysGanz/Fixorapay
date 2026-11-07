'use strict';
const { MockProvider } = require('./mock/mock.provider');

// Registry provider. Adapter PJP asli ditambahkan di Phase 6 (harus mengikuti dokumentasi resmi).
function createProvider(config, { clock } = {}) {
  switch (config.provider) {
    case 'mock':
      return new MockProvider({ webhookSecret: config.mockWebhookSecret || 'dev-only-mock-secret', clock, toleranceSeconds: config.signatureToleranceSeconds });
    default:
      throw new Error(`Provider "${config.provider}" belum tersedia`);
  }
}

module.exports = { createProvider };
