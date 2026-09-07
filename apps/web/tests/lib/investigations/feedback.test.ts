import { describe, expect, it } from 'vitest';
import {
  buildIdempotencyKey,
  clampFreeText,
  FEEDBACK_LABELS,
  generateFeedbackId,
  isFeedbackLabel,
  LABEL_PROMPT,
} from '@/lib/investigations/feedback';

describe('feedback helper: enum', () => {
  it('accepts only the three closed labels', () => {
    expect(isFeedbackLabel('confirmed')).toBe(true);
    expect(isFeedbackLabel('incorrect')).toBe(true);
    expect(isFeedbackLabel('insufficient_data')).toBe(true);
  });

  it('rejects anything else, including future extensions', () => {
    // The Fase 1 spec closes the enum. Any new label must ship under a
    // separate spec change that includes a Prisma migration.
    expect(isFeedbackLabel('maintenance')).toBe(false);
    expect(isFeedbackLabel('')).toBe(false);
    expect(isFeedbackLabel(null)).toBe(false);
    expect(isFeedbackLabel(42)).toBe(false);
    expect(isFeedbackLabel({})).toBe(false);
  });

  it('exports a stable list of three labels', () => {
    expect(FEEDBACK_LABELS).toEqual(['confirmed', 'incorrect', 'insufficient_data']);
  });

  it('exposes a non-empty prompt for every label', () => {
    for (const label of FEEDBACK_LABELS) {
      expect(LABEL_PROMPT[label]).toMatch(/[A-Za-z]{4}/);
    }
  });
});

describe('feedback helper: clampFreeText', () => {
  it('returns null for null / undefined / empty / whitespace', () => {
    expect(clampFreeText(null)).toBeNull();
    expect(clampFreeText(undefined)).toBeNull();
    expect(clampFreeText('')).toBeNull();
    expect(clampFreeText('   \n\t ')).toBeNull();
  });

  it('returns trimmed string when under the cap', () => {
    expect(clampFreeText('  hello  ')).toBe('hello');
    expect(clampFreeText('a'.repeat(100))).toHaveLength(100);
  });

  it('truncates by bytes when the input exceeds 4 KiB', () => {
    // 5 KiB of ASCII → truncated to 4096 bytes. The result MUST still
    // be a valid UTF-8 string.
    const big = 'a'.repeat(5 * 1024);
    const out = clampFreeText(big);
    expect(out).not.toBeNull();
    expect(new TextEncoder().encode(out ?? '').byteLength).toBe(4 * 1024);
  });

  it('does not split a multi-byte UTF-8 character in the middle', () => {
    // Each U+4F60 is 3 bytes in UTF-8. 1500 of them = 4500 bytes.
    // The clamp MUST NOT emit a lone byte sequence; the result must
    // round-trip through TextEncoder.
    const chars = '你'.repeat(1500);
    const out = clampFreeText(chars);
    expect(out).not.toBeNull();
    expect(new TextEncoder().encode(out ?? '').byteLength).toBeLessThanOrEqual(4 * 1024);
    // The truncated form MUST round-trip without replacement char (U+FFFD).
    expect(out ?? '').not.toMatch(/�/);
  });
});

describe('feedback helper: idempotency', () => {
  it('produces the same key for the same inputs', () => {
    const a = buildIdempotencyKey('t1', 'r1', 'v1', 'u1', 'confirmed');
    const b = buildIdempotencyKey('t1', 'r1', 'v1', 'u1', 'confirmed');
    expect(a).toBe(b);
  });

  it('differs when any input changes', () => {
    const base = buildIdempotencyKey('t1', 'r1', 'v1', 'u1', 'confirmed');
    // Tenant
    expect(buildIdempotencyKey('t2', 'r1', 'v1', 'u1', 'confirmed')).not.toBe(base);
    // Run
    expect(buildIdempotencyKey('t1', 'r2', 'v1', 'u1', 'confirmed')).not.toBe(base);
    // Version
    expect(buildIdempotencyKey('t1', 'r1', 'v2', 'u1', 'confirmed')).not.toBe(base);
    // Author
    expect(buildIdempotencyKey('t1', 'r1', 'v1', 'u2', 'confirmed')).not.toBe(base);
    // Label
    expect(buildIdempotencyKey('t1', 'r1', 'v1', 'u1', 'incorrect')).not.toBe(base);
  });

  it('does not collide for two users with the same display name', () => {
    // The separator is \u0001 (Start Of Heading). Inputs that look
    // identical when concatenated must still produce different keys
    // because the separator is never legal in an opaque runId.
    const a = buildIdempotencyKey('t1', 'r\x01u1', 'v1', 'u1', 'confirmed');
    const b = buildIdempotencyKey('t1', 'r', 'u1\x01v1', 'u1', 'confirmed');
    expect(a).not.toBe(b);
  });
});

describe('feedback helper: generateFeedbackId', () => {
  it('produces a UUID-shaped string prefixed with f_', () => {
    const id = generateFeedbackId();
    expect(id).toMatch(/^f_[0-9a-f]{32}$/);
  });

  it('produces a different id on every call', () => {
    const ids = new Set(Array.from({ length: 64 }, () => generateFeedbackId()));
    expect(ids.size).toBe(64);
  });

  it('never collides with runId or versionId prefixes', () => {
    // r_ and v_ are reserved by Fase 0 contracts.
    const id = generateFeedbackId();
    expect(id.startsWith('r_')).toBe(false);
    expect(id.startsWith('v_')).toBe(false);
  });
});
