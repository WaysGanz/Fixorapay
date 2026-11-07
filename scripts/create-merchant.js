'use strict';
// Pemakaian: node scripts/create-merchant.js <kode> "<Nama Merchant>"
// Secret API ditampilkan SEKALI di layar; di database hanya tersimpan terenkripsi.
const fs = require('node:fs');
if (fs.existsSync('.env')) process.loadEnvFile('.env');
const { loadConfig } = require('../src/config/env');
const { encrypt, randomToken } = require('../src/utils/crypto');

async function main() {
  const [code, name] = process.argv.slice(2);
  if (!code || !name) { console.error('Pemakaian: node scripts/create-merchant.js <kode> "<Nama>"'); process.exit(1); }
  const config = loadConfig();
  if (!config.encryptionKey) throw new Error('APP_ENCRYPTION_KEY belum diisi di .env');

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const keyId = 'fxk_' + randomToken(9);
  const secret = 'fxs_' + randomToken(32);
  const merchant = await prisma.merchant.upsert({ where: { code }, update: {}, create: { code, name } });
  await prisma.apiKey.create({ data: { merchantId: merchant.id, keyId, secretEnc: encrypt(secret, config.encryptionKey), label: 'created by script' } });
  console.log(`Merchant : ${merchant.code} (${merchant.id})\nKey ID   : ${keyId}\nSecret   : ${secret}\n\nSimpan secret sekarang; tidak bisa ditampilkan lagi.`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
