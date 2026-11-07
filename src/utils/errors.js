'use strict';

class AppError extends Error {
  constructor(code, message, status = 400, details) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

class UniqueViolationError extends Error {
  constructor(target) {
    super('Unique constraint violated');
    this.name = 'UniqueViolationError';
    this.target = target;
  }
}

const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} tidak ditemukan`, 404);

module.exports = { AppError, UniqueViolationError, notFound };
