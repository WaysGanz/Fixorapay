'use strict';
const { decrypt } = require('../utils/crypto');

// Untuk test/development tanpa database.
class MemoryKeyStore {
  constructor(keys = []) { this.keys = new Map(keys.map((k) => [k.keyId, k])); }
  async find(keyId) { const k = this.keys.get(keyId); return k && k.active !== false ? k : null; }
}

// Secret disimpan terenkripsi (AES-256-GCM); hanya didekripsi saat memverifikasi request.
class PrismaKeyStore {
  constructor(prisma, encryptionKey) { this.prisma = prisma; this.encryptionKey = encryptionKey; }
  async find(keyId) {
    const k = await this.prisma.apiKey.findUnique({ where: { keyId }, include: { merchant: true } });
    if (!k || !k.active || k.revokedAt || !k.merchant.active) return null;
    return { keyId: k.keyId, merchantId: k.merchantId, secret: decrypt(k.secretEnc, this.encryptionKey) };
  }
}

module.exports = { MemoryKeyStore, PrismaKeyStore };
