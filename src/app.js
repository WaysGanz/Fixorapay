'use strict';
const crypto = require('node:crypto');
const { buildPaymentRoutes } = require('./modules/payments/payment.routes');
const { createServiceAuth } = require('./middleware/serviceAuth');
const { createRateLimiter } = require('./middleware/rateLimit');
const { createErrorHandler, notFoundHandler } = require('./middleware/errorHandler');

function createApp({ config, logger, service, provider, keyStore }) {
  // require di dalam fungsi: dependency HTTP hanya dibutuhkan saat server benar-benar dijalankan.
  const express = require('express');
  const helmet = require('helmet');
  const cors = require('cors');

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => { req.id = crypto.randomUUID(); res.setHeader('X-Request-Id', req.id); next(); });
  app.use(helmet());
  // Server-to-server: tanpa CORS kecuali origin diizinkan eksplisit lewat CORS_ORIGINS.
  if (config.corsOrigins.length) app.use(cors({ origin: config.corsOrigins, methods: ['GET', 'POST'] }));
  app.use(createRateLimiter({ max: config.rateLimitPerMinute }));
  // rawBody disimpan karena tanda tangan HMAC dihitung dari byte asli, bukan hasil parse.
  app.use(express.json({ limit: '100kb', verify: (req, res, buf) => { req.rawBody = buf; } }));

  app.get('/health', (req, res) => res.json({ status: 'ok', provider: provider.name }));

  const auth = createServiceAuth({ keyStore, config, logger });
  app.use('/api/v1', buildPaymentRoutes({ express, service, provider, auth }));

  app.use(notFoundHandler);
  app.use(createErrorHandler({ logger }));
  return app;
}

module.exports = { createApp };
