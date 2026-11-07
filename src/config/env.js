'use strict';

function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const problems = [];
  const int = (key, def) => {
    const raw = env[key];
    if (raw === undefined || raw === '') return def;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) { problems.push(`${key} harus bilangan bulat >= 0`); return def; }
    return n;
  };

  const cfg = {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port: int('PORT', 4000),
    databaseUrl: env.DATABASE_URL || '',
    logLevel: env.LOG_LEVEL || 'info',
    provider: env.PAYMENT_PROVIDER || 'mock',
    encryptionKey: env.APP_ENCRYPTION_KEY || '',
    mockWebhookSecret: env.MOCK_WEBHOOK_SECRET || '',
    minPaymentAmount: int('MIN_PAYMENT_AMOUNT', 1000),
    maxPaymentAmount: int('MAX_PAYMENT_AMOUNT', 50_000_000),
    defaultExpiryMinutes: int('PAYMENT_EXPIRY_MINUTES', 30),
    expiryGraceSeconds: int('EXPIRY_GRACE_SECONDS', 300),
    providerTimeoutMs: int('PROVIDER_TIMEOUT_MS', 10_000),
    maxCreateAttempts: int('MAX_PROVIDER_CREATE_ATTEMPTS', 3),
    signatureToleranceSeconds: int('SIGNATURE_TOLERANCE_SECONDS', 300),
    rateLimitPerMinute: int('RATE_LIMIT_PER_MINUTE', 120),
    corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  };

  if (cfg.maxPaymentAmount < cfg.minPaymentAmount) problems.push('MAX_PAYMENT_AMOUNT harus >= MIN_PAYMENT_AMOUNT');
  if (cfg.encryptionKey && !/^[0-9a-fA-F]{64}$/.test(cfg.encryptionKey)) problems.push('APP_ENCRYPTION_KEY harus 64 karakter hex');
  if (cfg.isProduction) {
    if (cfg.provider === 'mock') problems.push('PAYMENT_PROVIDER=mock tidak boleh dipakai di production');
    if (!cfg.encryptionKey) problems.push('APP_ENCRYPTION_KEY wajib di production');
    if (!cfg.databaseUrl) problems.push('DATABASE_URL wajib di production');
  }
  if (problems.length) throw new Error('Konfigurasi tidak valid:\n- ' + problems.join('\n- '));
  return Object.freeze(cfg);
}

module.exports = { loadConfig };
