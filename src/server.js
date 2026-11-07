'use strict';
const fs = require('node:fs');
const { loadConfig } = require('./config/env');
const { createLogger } = require('./utils/logger');
const { createProvider } = require('./providers');
const { PaymentService } = require('./modules/payments/payment.service');
const { PrismaPaymentRepository } = require('./modules/payments/payment.repository.prisma');
const { PrismaKeyStore } = require('./database/keystore');
const { createApp } = require('./app');

if (fs.existsSync('.env')) process.loadEnvFile('.env'); // bawaan Node 22, tanpa dotenv

const config = loadConfig(); // gagal cepat jika konfigurasi tidak aman (mis. mock di production)
const logger = createLogger({ level: config.logLevel });

async function main() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  await prisma.$connect();

  const provider = createProvider(config);
  const service = new PaymentService({ repo: new PrismaPaymentRepository(prisma), provider, config, logger });
  const keyStore = new PrismaKeyStore(prisma, config.encryptionKey);
  const app = createApp({ config, logger, service, provider, keyStore });

  const server = app.listen(config.port, () => logger.info('server.started', { port: config.port, provider: provider.name, env: config.nodeEnv }));

  // Sementara: job expiry berkala. Diganti BullMQ repeatable job di Phase 4.
  const timer = setInterval(() => {
    service.expireDue().then((s) => s.checked && logger.info('payment.expire_sweep', s)).catch((err) => logger.error('payment.expire_sweep_failed', { err }));
  }, 60_000);
  timer.unref();

  const shutdown = (sig) => {
    logger.info('server.shutdown', { sig });
    server.close(async () => { await prisma.$disconnect(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => { logger.error('server.fatal', { err }); process.exit(1); });
