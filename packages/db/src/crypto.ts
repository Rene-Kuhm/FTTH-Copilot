/**
 * API key encryption at rest.
 *
 * NMS credentials (SmartOLT API keys, etc.) are stored encrypted in the DB.
 * Uses AES-256-GCM with a key derived from KMS_MASTER_KEY via SHA-256.
 *
 * The format stored in `encryptedKey` is base64:
 *   iv (12 bytes) || ciphertext || authTag (16 bytes)
 *
 * Format stored in `encryptionMeta` is base64 of the IV alone (for rotation/debug).
 */
import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const KEY = deriveKey();
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function deriveKey(): Buffer {
  const seed = process.env['KMS_MASTER_KEY'] ?? 'dev-only-insecure-master-key-replace-me';
  return crypto.createHash('sha256').update(seed).digest();
}

export function encryptApiKey(plaintext: string): {
  encryptedKey: string;
  iv: string;
} {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const blob = Buffer.concat([iv, ciphertext, authTag]).toString('base64');
  return { encryptedKey: blob, iv: iv.toString('base64') };
}

export function decryptApiKey(encryptedKey: string, _iv: string): string {
  const blob = Buffer.from(encryptedKey, 'base64');
  if (blob.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted blob');
  }
  const iv = blob.subarray(0, IV_LENGTH);
  const authTag = blob.subarray(blob.length - AUTH_TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH, blob.length - AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
