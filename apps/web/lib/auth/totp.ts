/**
 * Pure TypeScript TOTP (Time-based One-Time Password) implementation.
 * RFC 6238 compliant using Node.js crypto module.
 * No external dependencies required.
 */
import { createHmac, randomBytes } from 'node:crypto';

// Base32 alphabet for encoding/decoding
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Base32 decode a string (RFC 4648).
 * Removes padding and spaces, decodes to Buffer.
 */
export function base32Decode(encoded: string): Buffer {
  // Remove spaces and padding
  const cleaned = encoded.replace(/\s+/g, '').replace(/=+$/, '').toUpperCase();
  const bits = cleaned.split('').map((c) => {
    const idx = BASE32_ALPHABET.indexOf(c);
    if (idx === -1) throw new Error(`Invalid base32 character: ${c}`);
    return idx.toString(2).padStart(5, '0');
  }).join('');

  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }

  return Buffer.from(bytes);
}

/**
 * Base32 encode a Buffer to string (RFC 4648).
 */
export function base32Encode(data: Buffer): string {
  const bits = Array.from(data).map((b) => b.toString(2).padStart(8, '0')).join('');
  const paddedBits = bits + '0'.repeat((8 - (bits.length % 8)) % 8);

  let result = '';
  for (let i = 0; i + 5 <= paddedBits.length; i += 5) {
    const idx = parseInt(paddedBits.slice(i, i + 5), 2);
    result += BASE32_ALPHABET[idx]!;
  }

  // Add padding
  while (result.length % 8 !== 0) {
    result += '=';
  }

  return result;
}

/**
 * Generate a random base32 secret suitable for TOTP.
 * Returns a 20-character base32 string (80 bits of entropy).
 */
export function generateSecret(): string {
  return base32Encode(randomBytes(10));
}

/**
 * Generate TOTP code for a given secret and time.
 * RFC 6238 compliant HMAC-SHA1 implementation.
 *
 * @param secret Base32-encoded secret
 * @param time Optional time in milliseconds (defaults to Date.now())
 * @returns 6-digit TOTP code as string
 */
export function totp(secret: string, time?: number): string {
  const key = base32Decode(secret);
  const counter = Math.floor((time ?? Date.now()) / 30000);

  // Convert counter to 8-byte big-endian buffer
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(counter), 0);

  // HMAC-SHA1
  const hmac = createHmac('sha1', key).update(buf).digest();

  // Dynamic truncation
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]!) << 16) |
    ((hmac[offset + 2]!) << 8) |
    hmac[offset + 3]!;

  // Return 6-digit code, zero-padded
  return String(code % 1000000).padStart(6, '0');
}

/**
 * Verify a TOTP code with ±1 time window tolerance.
 * Handles clock drift between server and authenticator.
 *
 * @param secret Base32-encoded secret
 * @param code 6-digit TOTP code to verify
 * @returns true if code is valid
 */
export function verifyTOTP(secret: string, code: string): boolean {
  const now = Date.now();
  // Check current time window and ±1 window (±30 seconds tolerance)
  return [now - 30000, now, now + 30000].some((t) => totp(secret, t) === code);
}

/**
 * Generate otpauth:// URI for QR code generation.
 * Compatible with Google Authenticator and similar apps.
 *
 * @param secret Base32-encoded secret
 * @param issuer Service name (e.g., "FTTH-Copilot")
 * @param account User account (e.g., email)
 * @returns otpauth URI string
 */
export function generateOtpAuthUri(
  secret: string,
  issuer: string,
  account: string,
): string {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedAccount = encodeURIComponent(account);
  return `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;
}
