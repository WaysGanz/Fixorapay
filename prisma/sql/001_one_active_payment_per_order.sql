-- Jalankan setelah `prisma migrate` pertama (Prisma tidak mendukung partial unique index di schema).
-- Menjamin satu order hanya punya SATU pembayaran aktif/berhasil, bahkan saat dua request
-- dengan Idempotency-Key berbeda masuk bersamaan.
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_payment_per_order
  ON payment_transactions ("merchantId", "orderId")
  WHERE status NOT IN ('FAILED', 'EXPIRED', 'CANCELLED');
