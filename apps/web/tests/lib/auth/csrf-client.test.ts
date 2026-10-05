// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { csrfFetch, getCsrfToken } from '@/lib/auth/csrf-client';

const TOKEN = 'a'.repeat(64);

/**
 * Stub the cookie jar instead of writing real cookies: happy-dom keeps cookie
 * state between tests and does not reliably honour Max-Age=0 for deletion.
 */
function withCookie(value: string): void {
  vi.spyOn(document, 'cookie', 'get').mockReturnValue(value);
}

describe('getCsrfToken', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the token from document.cookie', () => {
    withCookie(`ftth_csrf=${TOKEN}`);
    expect(getCsrfToken()).toBe(TOKEN);
  });

  it('tolerates the space browsers add after the semicolon', () => {
    withCookie(`other=1; ftth_csrf=${TOKEN}`);
    expect(getCsrfToken()).toBe(TOKEN);
  });

  it('returns null when the cookie is absent', () => {
    withCookie('other=1');
    expect(getCsrfToken()).toBeNull();
  });

  it('does not match a cookie whose name merely ends with the token name', () => {
    withCookie(`not_ftth_csrf=${TOKEN}`);
    expect(getCsrfToken()).toBeNull();
  });
});

describe('csrfFetch', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    withCookie(`ftth_csrf=${TOKEN}`);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'attaches the CSRF header on %s',
    async (method) => {
      await csrfFetch('/api/zones', { method });

      const headers = fetchMock.mock.calls[0][1].headers;
      expect(headers['X-CSRF-Token']).toBe(TOKEN);
    },
  );

  it('sends cookies by default so the gate can compare them', async () => {
    await csrfFetch('/api/zones', { method: 'POST' });

    expect(fetchMock.mock.calls[0][1].credentials).toBe('include');
  });

  it('preserves caller-supplied headers', async () => {
    await csrfFetch('/api/zones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBe(
      'application/json',
    );
  });

  it('does not attach the header on safe methods', async () => {
    await csrfFetch('/api/zones');

    expect(
      fetchMock.mock.calls[0][1].headers?.['X-CSRF-Token'],
    ).toBeUndefined();
  });

  it('throws instead of sending a mutation that would be rejected', async () => {
    withCookie('');

    await expect(csrfFetch('/api/zones', { method: 'POST' })).rejects.toThrow(
      /CSRF token missing/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * Guards the regression that reached main in PR #274: the middleware rejected
 * every client mutation because no call site sent the header. Unit tests on the
 * gate alone cannot catch a client that never calls it, so assert the call sites
 * themselves.
 */
describe('client mutation call sites', () => {
  const componentsDir = join(process.cwd(), 'components');
  const MUTATION = /method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/;

  /**
   * Return the full argument list of a call whose opening paren is at `start`.
   * Scanning to the matching paren keeps a GET call from inheriting the method
   * of a nearby mutation.
   */
  function extractArgs(source: string, start: number): string {
    let depth = 0;
    let quote: string | null = null;

    for (let i = start; i < source.length; i++) {
      const char = source[i];

      if (quote) {
        if (char === '\\') i++;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        quote = char;
        continue;
      }
      if (char === '(' || char === '{' || char === '[') depth++;
      else if (char === ')' || char === '}' || char === ']') {
        depth--;
        if (depth === 0) return source.slice(start, i + 1);
      }
    }
    return source.slice(start);
  }

  it('route state-changing requests through csrfFetch', () => {
    const files = readdirSync(componentsDir).filter((f) => f.endsWith('.tsx'));
    const violations: string[] = [];

    for (const file of files) {
      const source = readFileSync(join(componentsDir, file), 'utf8');

      // Only bare fetch() calls can bypass the gate.
      const bareCalls = [...source.matchAll(/(?<![a-zA-Z])fetch\s*\(/g)];
      for (const call of bareCalls) {
        const openParen = call.index + call[0].length - 1;
        if (!MUTATION.test(extractArgs(source, openParen))) continue;

        const line = source.slice(0, call.index).split('\n').length;
        violations.push(
          `${file}:${line} calls fetch() with a mutating method but not csrfFetch()`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});