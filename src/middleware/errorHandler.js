'use strict';
const { AppError } = require('../utils/errors');

function notFoundHandler(req, res, next) {
  next(new AppError('NOT_FOUND', 'Endpoint tidak ditemukan', 404));
}

function createErrorHandler({ logger }) {
  // eslint-disable-next-line no-unused-vars
  return function errorHandler(err, req, res, next) {
    let e = err;
    if (err && err.type === 'entity.parse.failed') e = new AppError('INVALID_JSON', 'Body bukan JSON yang valid', 400);
    else if (err && err.type === 'entity.too.large') e = new AppError('PAYLOAD_TOO_LARGE', 'Body terlalu besar', 413);

    if (e instanceof AppError) {
      return res.status(e.status).json({ error: { code: e.code, message: e.message, details: e.details, requestId: req.id } });
    }
    logger.error('request.unhandled_error', { requestId: req.id, path: req.originalUrl, err: e });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan pada server', requestId: req.id } });
  };
}

module.exports = { createErrorHandler, notFoundHandler };
