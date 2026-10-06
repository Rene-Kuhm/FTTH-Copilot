import { describe, it, expect } from 'vitest';
import {
  base32Encode,
  base32Decode,
  generateSecret,
  totp,
  verifyTOTP,
  generateOtpAuthUri,
} from '@/lib/auth/totp';

/**
 * TOTP and Base32 coverage for `lib/auth/totp.ts`, which had no tests at all.
 *
 * The TOTP vectors below are the RFC 4226 / RFC 6238 reference values for the
 * standard "12345678901234567890" secret. Checking against them means the
 * implementation is verified against the specification, not against itself: a
 * change that broke HMAC truncation or the counter would fail here even if
 * `verifyTOTP` were updated to match.
 */
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    for (const sample of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) {
      expect(base32Decode(base32Encode(Buffer.from(sample, 'ascii'))).toString('ascii')).toBe(
        sample,
      );
    }
  });

  it('matches the RFC 4648 test vectors', () => {
    // RFC 4648 section 10 shows the padded forms.
    expect(base32Encode(Buffer.from('f', 'ascii'))).toBe('MY======');
    expect(base32Encode(Buffer.from('fo', 'ascii'))).toBe('MZXQ====');
    expect(base32Encode(Buffer.from('foo', 'ascii'))).toBe('MZXW6===');
    expect(base32Encode(Buffer.from('foob', 'ascii'))).toBe('MZXW6YQ=');
    expect(base32Encode(Buffer.from('fooba', 'ascii'))).toBe('MZXW6YTB');
    expect(base32Encode(Buffer.from('foobar', 'ascii'))).toBe('MZXW6YTBOI======');
  });

  it('is case-insensitive on decode', () => {
    const encoded = base32Encode(Buffer.from('foobar', 'ascii'));
    expect(base32Decode(encoded.toLowerCase()).toString('ascii')).toBe('foobar');
  });

  it('keeps every one-byte value distinct', () => {
    // The encoder padded to 8 bits instead of 5, so any input whose length was
    // not a multiple of 5 lost its trailing bits: 224 of 256 one-byte values
    // encoded to the same 32 strings. Distinct inputs must never collide, or
    // two MFA secrets would be interchangeable.
    const encoded = new Set<number>();
    for (let value = 0; value < 256; value++) {
      encoded.add(base32Encode(Buffer.from([value])).replace(/=+$/, '').length);
    }
    const strings = new Set<string>();
    for (let value = 0; value < 256; value++) {
      strings.add(base32Encode(Buffer.from([value])));
    }
    expect(strings.size).toBe(256);
    expect(encoded.size).toBe(1);
  });

  it.each([1, 2, 3, 4, 6, 7, 8, 9])(
    'round-trips a %i byte buffer that is not a multiple of 5',
    (length) => {
      const data = Buffer.from(Array.from({ length }, (_, i) => (i * 37 + 11) % 256));
      expect(base32Decode(base32Encode(data)).equals(data)).toBe(true);
    },
  );
});

describe('totp against RFC 6238 reference vectors', () => {
  // RFC 6238 Appendix B, SHA-1 column, 8-digit codes truncated to 6.
  const vectors: Array<[seconds: number, expected: string]> = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ];

  it.each(vectors)('produces %i -> %s', (seconds, expected) => {
    expect(totp(RFC_SECRET, seconds * 1000)).toBe(expected);
  });

  it('produces a stable code for the same instant', () => {
    const t = 1_700_000_000_000;
    expect(totp(RFC_SECRET, t)).toBe(totp(RFC_SECRET, t));
  });

  it('changes across the 30 second counter window', () => {
    // Anchor on a window boundary: an arbitrary instant plus 29s may already
    // have crossed into the next counter, which would make this assert nothing.
    const windowStart = Math.floor(1_700_000_000_000 / 30_000) * 30_000;
    expect(totp(RFC_SECRET, windowStart)).toBe(
      totp(RFC_SECRET, windowStart + 29_000),
    );
    expect(totp(RFC_SECRET, windowStart)).not.toBe(
      totp(RFC_SECRET, windowStart + 30_000),
    );
  });

  it('always returns exactly six digits', () => {
    for (let i = 0; i < 200; i++) {
      expect(totp(RFC_SECRET, 1_700_000_000_000 + i * 7919)).toMatch(/^\d{6}$/);
    }
  });
});

describe('verifyTOTP', () => {
  it('accepts the code for the current window', () => {
    const secret = generateSecret();
    expect(verifyTOTP(secret, totp(secret))).toBe(true);
  });

  it('accepts a code from an adjacent window for clock drift', () => {
    const secret = generateSecret();
    const now = Date.now();
    expect(verifyTOTP(secret, totp(secret, now - 30_000))).toBe(true);
    expect(verifyTOTP(secret, totp(secret, now + 30_000))).toBe(true);
  });

  it('rejects a code from an unrelated window', () => {
    const secret = generateSecret();
    expect(verifyTOTP(secret, totp(secret, Date.now() - 300_000))).toBe(false);
  });

  it('rejects a code for a different secret', () => {
    expect(verifyTOTP(generateSecret(), totp(generateSecret()))).toBe(false);
  });

  it('rejects malformed codes without throwing', () => {
    const secret = generateSecret();
    for (const bad of ['', 'abcdef', '12345', '1234567', 'not-a-code']) {
      expect(verifyTOTP(secret, bad)).toBe(false);
    }
  });
});

describe('generateSecret', () => {
  it('produces a distinct 32 character Base32 secret each time', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateSecret()));
    expect(secrets.size).toBe(50);
    for (const secret of secrets) expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  });
});

describe('generateOtpAuthUri', () => {
  it('builds an otpauth URI an authenticator app can parse', () => {
    const uri = generateOtpAuthUri('JBSWY3DPEHPK3PXP', 'FTTH-Copilot', 'user@example.com');

    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=FTTH-Copilot');
    // The label carries the issuer and account, percent-encoded.
    expect(uri).toContain('user%40example.com');
    expect(uri).toMatch(/[?&]algorithm=SHA1/);
    expect(uri).toMatch(/[?&]digits=6/);
    expect(uri).toMatch(/[?&]period=30/);
  });
});
