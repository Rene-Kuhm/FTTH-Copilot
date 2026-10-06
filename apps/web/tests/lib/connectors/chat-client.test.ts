import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Tenant connector resolution for the chat path, previously at 0% coverage.
 *
 * This module decrypts stored NMS credentials and hands them to a live client.
 * The branches that matter are the ones that decide *which* credentials get
 * sent to ISP equipment: a Mikrotik secret can arrive as a JSON object, as
 * `user:password`, or as a bare token, and a misread there means either the
 * wrong account is used or a credential is handed to the wrong field.
 */

const decryptApiKey = vi.hoisted(() => vi.fn());
// Each client is constructed with `new`, so these are constructor functions
// rather than plain mock returns.
const smartolt = vi.hoisted(() =>
  vi.fn(function (this: Record<string, unknown>, opts: unknown) {
    this.kind = 'smartolt';
    this.opts = opts;
  }),
);
const mikrowisp = vi.hoisted(() =>
  vi.fn(function (this: Record<string, unknown>, opts: unknown) {
    this.kind = 'mikrowisp';
    this.opts = opts;
  }),
);
const mikrotik = vi.hoisted(() =>
  vi.fn(function (this: Record<string, unknown>, opts: unknown) {
    this.kind = 'mikrotik';
    this.opts = opts;
  }),
);

vi.mock('@ftth-copilot/db', () => ({ decryptApiKey }));
vi.mock('@ftth-copilot/connectors-smartolt', () => ({ SmartOltClient: smartolt }));
vi.mock('@ftth-copilot/connectors-mikrowisp', () => ({ MikrowispClient: mikrowisp }));
vi.mock('@ftth-copilot/connectors-mikrotik', () => ({ MikrotikNmsAdapter: mikrotik }));

const { buildConnectorFromConnection, ConnectorResolutionError } = await import(
  '@/lib/connectors/chat-client'
);

// A top-level await import yields a value binding, so the class cannot be
// used in type position; derive the instance type instead.
type ConnectorError = InstanceType<typeof ConnectorResolutionError>;

type Connection = Parameters<typeof buildConnectorFromConnection>[0];

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-1',
    tenantId: 'tenant-1',
    label: 'NMS principal',
    provider: 'SMARTOLT',
    baseUrl: 'https://nms.example.com',
    encryptedKey: 'enc:blob',
    ...overrides,
  } as Connection;
}

beforeEach(() => {
  vi.clearAllMocks();
  decryptApiKey.mockReturnValue('secret');
  // Instantiating the ctor clears its recorded calls but keeps the behaviour.
  smartolt.mockClear();
  mikrowisp.mockClear();
  mikrotik.mockClear();
});

describe('buildConnectorFromConnection', () => {
  it('refuses to build a connector with no base URL', () => {
    // Falling back to a default host would send ISP credentials somewhere the
    // operator never configured.
    expect(() => buildConnectorFromConnection(connection({ baseUrl: '' }))).toThrow(
      ConnectorResolutionError,
    );
    expect(() => buildConnectorFromConnection(connection({ baseUrl: '' }))).toThrow(
      /URL base/i,
    );
    expect(smartolt).not.toHaveBeenCalled();
  });

  it('reports an undecryptable key as a configuration problem, not a crash', () => {
    decryptApiKey.mockImplementation(() => {
      throw new Error('KMS key mismatch');
    });

    try {
      buildConnectorFromConnection(connection());
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectorResolutionError);
      expect((err as ConnectorError).status).toBe(409);
      expect((err as Error).message).toMatch(/descifrar|configurarlo/i);
    }
    // The raw KMS error must not leak to the caller.
    expect(smartolt).not.toHaveBeenCalled();
  });

  it('builds a SmartOLT client with the decrypted key', () => {
    decryptApiKey.mockReturnValue('api-key-123');

    const result = buildConnectorFromConnection(connection({ provider: 'SMARTOLT' }));

    expect(smartolt).toHaveBeenCalledWith({
      useMock: false,
      apiKey: 'api-key-123',
      apiBaseUrl: 'https://nms.example.com',
    });
    expect(result.dataSource).toMatchObject({
      mode: 'live',
      connectionId: 'conn-1',
      provider: 'SMARTOLT',
    });
  });

  it('builds a Mikrowisp client with the decrypted token', () => {
    decryptApiKey.mockReturnValue('token-abc');

    buildConnectorFromConnection(connection({ provider: 'MIKROWISP' }));

    expect(mikrowisp).toHaveBeenCalledWith({
      useMock: false,
      token: 'token-abc',
      apiBaseUrl: 'https://nms.example.com',
    });
  });

  describe('Mikrotik credentials', () => {
    it('reads username and password from a JSON secret', () => {
      decryptApiKey.mockReturnValue('{"username":"ops","password":"s3cr3t"}');

      buildConnectorFromConnection(connection({ provider: 'MIKROTIK' }));

      expect(mikrotik).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'ops', password: 's3cr3t' }),
      );
    });

    it('splits a user:password secret on the first colon only', () => {
      // Passwords may contain colons; splitting on the last one would truncate
      // the username and produce a credential that can never authenticate.
      decryptApiKey.mockReturnValue('ops:s3cr3t:with:colons');

      buildConnectorFromConnection(connection({ provider: 'MIKROTIK' }));

      expect(mikrotik).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'ops', password: 's3cr3t:with:colons' }),
      );
    });

    it('defaults the username to admin for a bare token', () => {
      decryptApiKey.mockReturnValue('bare-token');

      buildConnectorFromConnection(connection({ provider: 'MIKROTIK' }));

      expect(mikrotik).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'admin', password: 'bare-token' }),
      );
    });

    it('derives TLS and port from the base URL', () => {
      buildConnectorFromConnection(
        connection({ provider: 'MIKROTIK', baseUrl: 'https://router.lan:8728' }),
      );

      expect(mikrotik).toHaveBeenCalledWith(
        expect.objectContaining({ host: 'router.lan', port: 8728, useTls: true }),
      );
    });

    it('uses no TLS for a plain http base URL', () => {
      buildConnectorFromConnection(
        connection({ provider: 'MIKROTIK', baseUrl: 'http://router.lan:80' }),
      );

      expect(mikrotik).toHaveBeenCalledWith(
        expect.objectContaining({ useTls: false }),
      );
    });

    it('rejects an unparseable base URL before constructing anything', () => {
      try {
        buildConnectorFromConnection(
          connection({ provider: 'MIKROTIK', baseUrl: 'not-a-url' }),
        );
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConnectorResolutionError);
        expect((err as ConnectorError).status).toBe(400);
      }
      expect(mikrotik).not.toHaveBeenCalled();
    });
  });

  it('refuses an unimplemented provider instead of falling back to mock data', () => {
    // Serving simulated NMS data to a NOC would look like real telemetry.
    try {
      buildConnectorFromConnection(connection({ provider: 'NETSENSE' }));
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectorResolutionError);
      expect((err as ConnectorError).status).toBe(422);
      expect((err as Error).message).toMatch(/no est[aá] implementado/i);
    }
  });

  it('never returns a connector in mock mode', () => {
    const result = buildConnectorFromConnection(connection({ provider: 'SMARTOLT' }));
    expect(result.dataSource.mode).toBe('live');
  });
});