# FIXORA PAY

Payment orchestration internal untuk FIXORA GAME. Status: **Phase 1 + Payment Engine (mock provider)**. Belum production-ready.

## Sudah ada
- Payment engine: create (idempotent), status, cancel, list, expiry sweep, late settlement
- State machine status transaksi (`src/modules/payments/status.js`)
- Adapter provider + **mock provider** (`src/providers`)
- Auth service-to-service: API key + HMAC-SHA256 + timestamp + anti-replay
- Config yang gagal cepat (production menolak mock), logger JSON dengan redaksi, rate limit, Helmet
- Schema Prisma (merchants, api_keys, payment_transactions, attempts, status history, provider_events)

## Belum ada (urutan berikut)
Webhook engine + BullMQ -> ledger + reconciliation -> adapter PJP asli -> integrasi FIXORA GAME/Digiflazz -> admin auth & dashboard. Refund butuh ledger, jadi menyusul.

## Menjalankan
```bash
npm install
cp .env.example .env            # isi DATABASE_URL & APP_ENCRYPTION_KEY
npx prisma migrate dev          # lalu jalankan prisma/sql/001_*.sql
npm run merchant:create -- fixora-game "FIXORA GAME"   # catat Key ID & Secret
npm test                        # tanpa database/Redis
npm run dev
```

## Memanggil API (HMAC)
Header: `X-Api-Key-Id`, `X-Timestamp` (detik), `X-Signature`, `Idempotency-Key` (untuk POST /payments).
`signature = HMAC_SHA256(secret, timestamp \n METHOD \n path+query \n sha256(rawBody))`. Lihat `signRequest()` di `src/middleware/serviceAuth.js`.

## Catatan jujur
- Test (34) dijalankan dengan repository in-memory + mock provider. Lapisan Express, Prisma, dan Postgres BELUM pernah dijalankan; uji dulu di mesin dengan internet.
- Cache anti-replay & rate limit di memori (satu instance); pindah ke Redis bersama BullMQ.
- Skema signature webhook mock adalah buatan sendiri, bukan format provider nyata.
