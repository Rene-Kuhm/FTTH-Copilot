/**
 * API key encryption at rest.
 *
 * NMS credentials (SmartOLT API keys, etc.) are stored encrypted in the DB.
 * Uses AES-256-GCM with a key derived from KMS_MASTER_KEY via SHA-256.
 *
 * The format stored in `encryptedKey` is base64:
 *   iv (12 bytes) || ciphertext || authTag (16 bytes)
 *
 * SECURITY: KMS_MASTER_KEY is read from env at runtime. In production the app
 * refuses to start without it — no silent insecure fallback. Resolved lazily
 * so Next.js build time can succeed even when env vars aren't set.
 */
import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function resolveSecret(envVar: string, devFallback: string): string {
  const value = process.env[envVar];
  if (value) return value;
  if (process.env['NODE_ENV'] === 'production') {
    throw new Error(
      `${envVar} is not set. Refusing to start in production with an insecure default.`,
    );
  }
  return devFallback;
}

let _masterKey: Buffer | undefined;
function getMasterKey(): Buffer {
  if (_masterKey === undefined) {
    const seed = resolveSecret('KMS_MASTER_KEY', 'dev-only-insecure-master-key-replace-me');
    _masterKey = crypto.createHash('sha256').update(seed).digest();
  }
  return _masterKey;
}

export function encryptApiKey(plaintext: string): { encryptedKey: string } {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, getMasterKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const blob = Buffer.concat([iv, ciphertext, authTag]).toString('base64');
  return { encryptedKey: blob };
}

export function decryptApiKey(encryptedKey: string): string {
  const blob = Buffer.from(encryptedKey, 'base64');
  if (blob.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Invalid encrypted blob');
  }
  const iv = blob.subarray(0, IV_LENGTH);
  const authTag = blob.subarray(blob.length - AUTH_TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH, blob.length - AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGO, getMasterKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
