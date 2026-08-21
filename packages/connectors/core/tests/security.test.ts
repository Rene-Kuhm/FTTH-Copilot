import { afterEach, describe, expect, it } from 'vitest';
import { assertSafeNmsBaseUrl, assertSafeNmsRequestUrl } from '../src/security';

const ENV_KEYS = [
  'NMS_ALLOW_HTTP',
  'NMS_ALLOW_PRIVATE_NETWORKS',
  'NMS_ALLOWED_HOSTS',
  'NMS_ALLOWED_PORTS',
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('NMS URL policy', () => {
  it('accepts a public HTTPS base URL and normalizes its trailing slash', async () => {
    await expect(
      assertSafeNmsBaseUrl('https://demo.smartolt.com/', { resolveDns: false }),
    ).resolves.toBe('https://demo.smartolt.com');
  });

  it.each([
    'http://example.com',
    'not-a-url',
    'file:///etc/passwd',
    'https://localhost',
    'https://127.0.0.1',
    'https://10.0.0.1',
    'https://169.254.169.254',
    'https://[::1]',
    'https://user:pass@example.com',
    'https://example.com?redirect=https://internal',
    'https://example.com:8443',
  ])('rejects unsafe URL %s', async (url) => {
    await expect(assertSafeNmsBaseUrl(url, { resolveDns: false })).rejects.toMatchObject({
      code: 'UNSAFE_NMS_URL',
    });
  });

  it('supports explicit private-network and HTTP opt-ins for self-hosted NMS', async () => {
    process.env['NMS_ALLOW_HTTP'] = 'true';
    process.env['NMS_ALLOW_PRIVATE_NETWORKS'] = 'true';
    process.env['NMS_ALLOWED_PORTS'] = '8080';
    await expect(
      assertSafeNmsBaseUrl('http://192.168.1.20:8080', { resolveDns: false }),
    ).resolves.toBe('http://192.168.1.20:8080');
  });

  it('accepts a public literal IP without a DNS lookup', async () => {
    await expect(assertSafeNmsBaseUrl('https://8.8.8.8')).resolves.toBe('https://8.8.8.8');
  });

  it('enforces the optional host allowlist', async () => {
    process.env['NMS_ALLOWED_HOSTS'] = 'isp.smartolt.com';
    await expect(
      assertSafeNmsBaseUrl('https://other.smartolt.com', { resolveDns: false }),
    ).rejects.toThrow(/NMS_ALLOWED_HOSTS/);
  });

  it('keeps request paths under the configured base path', async () => {
    await expect(
      assertSafeNmsRequestUrl('https://nms.example.com/api/v1', '/GetRouters', {
        resolveDns: false,
      }),
    ).resolves.toBe('https://nms.example.com/api/v1/GetRouters');
  });
});
