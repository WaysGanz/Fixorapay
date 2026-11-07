'use strict';

/**
 * Kontrak adapter provider. Payment engine hanya bicara lewat kelas ini,
 * sehingga provider bisa diganti tanpa mengubah engine.
 *
 * Status laporan yang dikembalikan adapter (dinormalisasi):
 *   PENDING | SUCCEEDED | FAILED | EXPIRED | CANCELLED
 *
 * createPayment({ reference, amount, method, channel, customer, expiresAt, metadata })
 *   -> { providerRef, instructions, expiresAt? }
 * getPaymentStatus({ reference, providerRef })
 *   -> { status, paidAmount?, providerRef?, occurredAt?, reason? }
 * cancelPayment({ reference, providerRef }) -> { cancelled: true }
 * refundPayment({ reference, providerRef, amount, reason }) -> { refundRef, status }
 * verifyWebhook({ rawBody, headers, now }) -> { valid, reason?, event? }
 *   event: { eventId, reference, status, paidAmount?, providerRef?, occurredAt? }
 *
 * Adapter HARUS melempar ProviderTimeoutError / ProviderRejectedError /
 * ProviderUnavailableError (lihat ../errors.js).
 */
class PaymentProvider {
  get name() { throw new Error('name belum diimplementasi'); }
  get capabilities() {
    return { cancel: false, refund: false, channels: { QRIS: [], VIRTUAL_ACCOUNT: [], EWALLET: [] } };
  }
  async createPayment() { throw new Error('createPayment belum diimplementasi'); }
  async getPaymentStatus() { throw new Error('getPaymentStatus belum diimplementasi'); }
  async cancelPayment() { throw new Error('cancelPayment belum diimplementasi'); }
  async refundPayment() { throw new Error('refundPayment belum diimplementasi'); }
  verifyWebhook() { throw new Error('verifyWebhook belum diimplementasi'); }
}

module.exports = { PaymentProvider };
