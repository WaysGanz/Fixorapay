'use strict';

class ProviderError extends Error {
  constructor(message, code = 'PROVIDER_ERROR') { super(message); this.name = this.constructor.name; this.code = code; }
}
// Provider tidak merespons: hasil TIDAK diketahui (transaksi mungkin sudah dibuat di sisi provider).
class ProviderTimeoutError extends ProviderError { constructor(m = 'Provider timeout') { super(m, 'PROVIDER_TIMEOUT'); } }
// Provider menolak request secara tegas (data tidak valid, tidak didukung, dsb).
class ProviderRejectedError extends ProviderError { constructor(m = 'Provider menolak request') { super(m, 'PROVIDER_REJECTED'); } }
// Provider error/tidak tersedia (5xx, jaringan): hasil tidak diketahui, aman di-retry dengan reference yang sama.
class ProviderUnavailableError extends ProviderError { constructor(m = 'Provider tidak tersedia') { super(m, 'PROVIDER_UNAVAILABLE'); } }

module.exports = { ProviderError, ProviderTimeoutError, ProviderRejectedError, ProviderUnavailableError };
