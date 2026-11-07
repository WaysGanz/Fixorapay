'use strict';
const { AppError } = require('../utils/errors');

// Fixed-window limiter per IP, in-memory (satu instance). Untuk multi-instance pindah ke Redis.
function createRateLimiter({ max, windowMs = 60_000, clock = () => Date.now() }) {
  const hits = new Map();
  return function rateLimit(req, res, next) {
    const now = clock();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
    const key = req.ip || 'unknown';
    const entry = hits.get(key) || { count: 0, reset: now + windowMs };
    entry.count++;
    hits.set(key, entry);
    res.setHeader && res.setHeader('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      res.setHeader && res.setHeader('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return next(new AppError('RATE_LIMITED', 'Terlalu banyak request', 429));
    }
    return next();
  };
}

module.exports = { createRateLimiter };
