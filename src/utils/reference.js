'use strict';
const crypto = require('node:crypto');

// Reference unik yang dikirim ke provider: FXP-<waktu base36>-<12 hex acak>
function newReference(prefix = 'FXP') {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`.toUpperCase();
}

module.exports = { newReference };
