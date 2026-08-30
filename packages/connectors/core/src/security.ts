import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { isIP } from 'node:net';

export const NMS_REQUEST_TIMEOUT_MS = Number.parseInt(
  process.env['NMS_REQUEST_TIMEOUT_MS'] ?? '10000',
  10,
);

export class UnsafeNmsUrlError extends Error {
  readonly code = 'UNSAFE_NMS_URL';

  constructor(message: string) {
    super(message);
    this.name = 'UnsafeNmsUrlError';
  }
}

interface UrlValidationOptions {
  resolveDns?: boolean;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIp(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
  const version = isIP(normalized);
  if (version === 4) return isPrivateIpv4(normalized);
  if (version !== 6) return true;

  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length);
    return isIP(mapped) !== 4 || isPrivateIpv4(mapped);
  }

  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
}

function allowedHosts(): Set<string> {
  return new Set(
    (process.env['NMS_ALLOWED_HOSTS'] ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
}

function assertStaticUrlPolicy(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeNmsUrlError('La URL del NMS no es válida.');
  }

  const allowHttp = process.env['NMS_ALLOW_HTTP'] === 'true';
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new UnsafeNmsUrlError('La URL del NMS debe usar HTTPS.');
  }
  if (url.username || url.password) {
    throw new UnsafeNmsUrlError('La URL del NMS no puede incluir credenciales.');
  }
  if (url.hash || url.search) {
    throw new UnsafeNmsUrlError('La URL base del NMS no puede incluir query ni fragmento.');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new UnsafeNmsUrlError('La URL del NMS no puede apuntar a localhost.');
  }

  const configuredHosts = allowedHosts();
  if (configuredHosts.size > 0 && !configuredHosts.has(hostname)) {
    throw new UnsafeNmsUrlError('El host del NMS no está incluido en NMS_ALLOWED_HOSTS.');
  }

  const defaultPort = url.protocol === 'https:' ? '443' : '80';
  const port = url.port || defaultPort;
  const allowedPorts = new Set(
    (process.env['NMS_ALLOWED_PORTS'] ?? '443')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (!allowedPorts.has(port)) {
    throw new UnsafeNmsUrlError(`El puerto ${port} no está permitido para conexiones NMS.`);
  }

  if (isIP(hostname) && isPrivateIp(hostname) && process.env['NMS_ALLOW_PRIVATE_NETWORKS'] !== 'true') {
    throw new UnsafeNmsUrlError('La URL del NMS no puede apuntar a una red privada.');
  }

  return url;
}

async function assertDnsPolicy(url: URL): Promise<void> {
  if (process.env['NMS_ALLOW_PRIVATE_NETWORKS'] === 'true' || isIP(url.hostname)) return;

  let addresses: LookupAddress[];
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new UnsafeNmsUrlError('No se pudo resolver el host del NMS.');
  }
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new UnsafeNmsUrlError('El host del NMS resuelve a una red privada o no válida.');
  }
}

export async function assertSafeNmsBaseUrl(
  rawUrl: string,
  options: UrlValidationOptions = {},
): Promise<string> {
  const url = assertStaticUrlPolicy(rawUrl);
  if (options.resolveDns !== false) await assertDnsPolicy(url);
  return url.toString().replace(/\/$/, '');
}

/**
 * Validates a per-request URL against the configured base URL and re-checks
 * the network policy (DNS included) on every call.
 *
 * Residual risk (accepted): between the DNS resolution here and the actual
 * `fetch` there is a small check-then-connect window, so a determined attacker
 * who controls the NMS hostname's DNS could attempt a rebinding race. Fully
 * closing it requires pinning the resolved IP in the HTTP connection, which
 * breaks TLS SNI/Host validation and is intentionally not done for operator-
 * configured NMS URLs (the base URL is set by a `manage_connectors` user, not
 * by untrusted input).
 */
export async function assertSafeNmsRequestUrl(
  baseUrl: string,
  path: string,
  options: UrlValidationOptions = {},
): Promise<string> {
  const normalizedBase = await assertSafeNmsBaseUrl(baseUrl, options);
  const url = new URL(path.replace(/^\//, ''), `${normalizedBase}/`);
  const base = new URL(`${normalizedBase}/`);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) {
    throw new UnsafeNmsUrlError('La ruta solicitada sale de la URL base configurada.');
  }
  return url.toString();
}
