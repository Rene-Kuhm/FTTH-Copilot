import { describe, expect, it } from 'vitest';
import {
  REDACTED_MARKER,
  createRedactor,
  isSensitiveKey,
  redactSensitiveData,
  redactString,
} from '../src/redaction';

describe('default redactor', () => {
  it('keeps the keys agent-core always redacted', () => {
    expect(isSensitiveKey('apiKey')).toBe(true);
    expect(isSensitiveKey('X-Api-Key')).toBe(true);
    expect(isSensitiveKey('Proxy-Authorization')).toBe(true);
    expect(isSensitiveKey('hostname')).toBe(false);
  });

  it('does not redact a key it was not told about', () => {
    // `community` and customer fields are the logger's business, not the
    // default redactor's: agent-core spans must keep their old behaviour.
    expect(isSensitiveKey('community')).toBe(false);
    expect(isSensitiveKey('email')).toBe(false);
    expect(redactSensitiveData({ email: 'a@b.co' })).toEqual({ email: 'a@b.co' });
  });

  it('redacts credentials in text', () => {
    expect(redactString('https://admin:pass123@router.isp.com/rest')).toBe(
      `https://admin:${REDACTED_MARKER}@router.isp.com/rest`,
    );
    expect(redactString('Authorization: Bearer abc.def.ghi')).toBe(
      `Authorization: Bearer ${REDACTED_MARKER}`,
    );
  });
});

describe('createRedactor', () => {
  it('redacts the extra keys, whatever their case or separators', () => {
    const redactor = createRedactor({ extraKeys: ['community'] });

    expect(redactor.isSensitiveKey('community')).toBe(true);
    expect(redactor.isSensitiveKey('Community')).toBe(true);
    expect(redactor.redactSensitiveData({ community: 'public', oltId: 'OLT-1' })).toEqual({
      community: REDACTED_MARKER,
      oltId: 'OLT-1',
    });
  });

  it('keeps redacting the base keys', () => {
    const redactor = createRedactor({ extraKeys: ['community'] });

    expect(redactor.redactSensitiveData({ password: 'x' })).toEqual({ password: REDACTED_MARKER });
  });

  it('applies the extra text patterns after the base ones', () => {
    const redactor = createRedactor({
      extraPatterns: [{ pattern: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, replacement: '[REDACTED_EMAIL]' }],
    });

    expect(redactor.redactString('contact ana@example.com now')).toBe(
      'contact [REDACTED_EMAIL] now',
    );
  });

  it('reaches into nested objects and arrays', () => {
    const redactor = createRedactor({ extraKeys: ['community'] });
    const out = redactor.redactSensitiveData({
      senders: [{ ip: '10.0.0.1', community: 'secret' }],
    });

    expect(out).toEqual({ senders: [{ ip: '10.0.0.1', community: REDACTED_MARKER }] });
  });

  it('does not recurse forever on a deep structure', () => {
    const redactor = createRedactor();
    let deep: Record<string, unknown> = { password: 'x' };
    for (let i = 0; i < 20; i++) deep = { next: deep };

    expect(() => redactor.redactSensitiveData(deep)).not.toThrow();
  });
});
