/**
 * Strict redaction of secrets, tokens, credentials, and sensitive data
 * for LLM traces, telemetry spans and logs.
 *
 * It lives in `shared` because `shared` is the base of the workspace: the
 * telemetry in `agent-core` and the structured logger both need it, and two
 * redactors of secrets would diverge the day one of them learns a new
 * pattern.
 *
 * The default exports (`redactString`, `redactSensitiveData`, ...) keep the
 * exact behaviour they had in `agent-core`. A caller that needs to redact
 * more builds its own redactor with `createRedactor`.
 */

const BASE_SENSITIVE_KEYS: readonly string[] = [
  'apikey',
  'api_key',
  'apisecret',
  'api_secret',
  'authorization',
  'bearer',
  'cookie',
  'credentials',
  'encryptedkey',
  'encrypted_key',
  'key',
  'passwd',
  'password',
  'private_key',
  'privatekey',
  'proxyauthorization',
  'secret',
  'token',
  'webhookurl',
  'webhook_url',
  'wwwauthenticate',
  'xapikey',
  'xauthtoken',
];

const BEARER_REGEX = /bearer\s+[a-zA-Z0-9_\-.~+/]+=*/gi;
const BASIC_AUTH_REGEX = /basic\s+[a-zA-Z0-9+/]+=*/gi;
const URL_CREDENTIALS_REGEX = /(https?:\/\/)([^:\s]+):([^@\s]+)@/gi;
const API_KEY_PATTERNS = [
  /\b(?:sk|pk|mm|ghp|gho)[_-][a-zA-Z0-9_\-]{16,}\b/g,
  /\b[A-Fa-f0-9]{32,64}\b/g, // hex tokens/hashes when formatted as secrets
];

export const REDACTED_MARKER = '[REDACTED]';

/** How a key is compared: case and `-`/`_` do not matter. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

/** A text pattern to redact, with the replacement to put in its place. */
export interface RedactionPattern {
  pattern: RegExp;
  /** Replacement string, with `$1`... for groups. */
  replacement: string;
}

export interface RedactorOptions {
  /** Keys redacted on top of the base ones. Compared without case or `-`/`_`. */
  extraKeys?: readonly string[];
  /** Text patterns applied after the base ones. */
  extraPatterns?: readonly RedactionPattern[];
}

export interface Redactor {
  isSensitiveKey(key: string): boolean;
  redactString(input: string): string;
  redactSensitiveData<T = unknown>(data: T, depth?: number): T;
}

/**
 * Builds a redactor.
 *
 * With no options it is the redactor `agent-core` always had.
 */
export function createRedactor(options: RedactorOptions = {}): Redactor {
  const sensitiveKeys = new Set(
    [...BASE_SENSITIVE_KEYS, ...(options.extraKeys ?? [])].map(normalizeKey),
  );
  const extraPatterns = options.extraPatterns ?? [];

  function isSensitiveKey(key: string): boolean {
    if (!key || typeof key !== 'string') return false;
    return sensitiveKeys.has(normalizeKey(key));
  }

  /**
   * Sanitizes a string, replacing known credential tokens and patterns with [REDACTED].
   */
  function redactString(input: string): string {
    if (!input || typeof input !== 'string') return input;

    let sanitized = input
      .replace(BEARER_REGEX, `Bearer ${REDACTED_MARKER}`)
      .replace(BASIC_AUTH_REGEX, `Basic ${REDACTED_MARKER}`)
      .replace(URL_CREDENTIALS_REGEX, `$1$2:${REDACTED_MARKER}@`);

    for (const pattern of API_KEY_PATTERNS) {
      // Only redact high-entropy hex if it looks like an API key assignment or token
      if (pattern.source.includes('A-Fa-f0-9')) {
        sanitized = sanitized.replace(
          /(?:key|token|secret|password)["']?\s*[:=]\s*["']?([A-Fa-f0-9]{32,64})/gi,
          (match, token) => match.replace(token, REDACTED_MARKER),
        );
      } else {
        sanitized = sanitized.replace(pattern, REDACTED_MARKER);
      }
    }

    for (const extra of extraPatterns) {
      sanitized = sanitized.replace(extra.pattern, extra.replacement);
    }

    return sanitized;
  }

  /**
   * Recursively redacts an object or array, stripping sensitive properties
   * and redacting string values.
   */
  function redactSensitiveData<T = unknown>(data: T, depth = 0): T {
    if (depth > 10 || data === null || data === undefined) {
      return data;
    }

    if (typeof data === 'string') {
      return redactString(data) as unknown as T;
    }

    if (Array.isArray(data)) {
      return data.map((item) => redactSensitiveData(item, depth + 1)) as unknown as T;
    }

    if (typeof data === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
        if (sensitiveKeys.has(normalizeKey(key))) {
          result[key] = REDACTED_MARKER;
        } else {
          result[key] = redactSensitiveData(value, depth + 1);
        }
      }
      return result as T;
    }

    return data;
  }

  return { isSensitiveKey, redactString, redactSensitiveData };
}

const defaultRedactor = createRedactor();

export const isSensitiveKey = defaultRedactor.isSensitiveKey;
export const redactString = defaultRedactor.redactString;
export const redactSensitiveData = defaultRedactor.redactSensitiveData;
