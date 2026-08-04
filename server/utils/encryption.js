// server/utils/encryption.js
//
// Field-level encryption for sensitive Contact fields (passport number, DOB,
// medical/dietary notes). Uses AES-256-GCM: each value gets its own random IV,
// and the auth tag is stored alongside the ciphertext so tampering is detectable.
//
// Required env var: ENCRYPTION_KEY — a 64-character hex string (32 bytes).
// Generate one with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// Store this in your secrets manager / .env — NEVER commit it, and never store
// it in the database. Rotating it means re-encrypting all existing rows.

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommended for GCM

function getKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'ENCRYPTION_KEY env var must be a 64-character hex string (32 bytes). ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Encrypts a plaintext string. Returns null if given null/undefined/empty,
 * so optional fields stay optional instead of encrypting empty strings.
 * Output format: "<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */
function encryptField(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') {
    return null;
  }
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

/**
 * Decrypts a value produced by encryptField. Returns null for null input.
 * Throws if the ciphertext or auth tag has been tampered with.
 */
function decryptField(stored) {
  if (stored === null || stored === undefined) {
    return null;
  }
  const key = getKey();
  const [ivHex, authTagHex, ciphertextHex] = stored.split(':');
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Malformed encrypted field value');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}

/** Masks a decrypted value for display before step-up auth, e.g. passport numbers. */
function maskValue(plaintext, visibleTrailingChars = 4) {
  if (!plaintext) return null;
  const str = String(plaintext);
  if (str.length <= visibleTrailingChars) return '•'.repeat(str.length);
  return '•'.repeat(str.length - visibleTrailingChars) + str.slice(-visibleTrailingChars);
}

module.exports = { encryptField, decryptField, maskValue };