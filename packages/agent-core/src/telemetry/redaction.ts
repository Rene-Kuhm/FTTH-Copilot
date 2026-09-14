/**
 * Strict redaction of secrets, tokens, credentials, and sensitive data
 * for LLM traces and telemetry spans.
 */

const SENSITIVE_KEYS = new Set([
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
  'password',
  'passwd',
  'private_key',
  'privatekey',
  'secret',
  'token',
  'webhookurl',
  'webhook_url',
]);

const BEARER_REGEX = /bearer\s+[a-zA-Z0-9_\-.~+/]+=*/gi;
const BASIC_AUTH_REGEX = /basic\s+[a-zA-Z0-9+/]+=*/gi;
const URL_CREDENTIALS_REGEX = /(https?:\/\/)([^:\s]+):([^@\s]+)@/gi;
const API_KEY_PATTERNS = [
  /\b(?:sk|pk|mm|ghp|gho)[_-][a-zA-Z0-9_\-]{16,}\b/g,
  /\b[A-Fa-f0-9]{32,64}\b/g, // hex tokens/hashes when formatted as secrets
];

export const REDACTED_MARKER = '[REDACTED]';

export function isSensitiveKey(key: string): boolean {
  if (!key || typeof key !== 'string') return false;
  const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
  return SENSITIVE_KEYS.has(normalizedKey);
}

/**
 * Sanitizes a string, replacing known credential tokens and patterns with [REDACTED].
 */
export function redactString(input: string): string {
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

  return sanitized;
}

/**
 * Recursively redacts an object or array, stripping sensitive properties
 * and redacting string values.
 */
export function redactSensitiveData<T = unknown>(data: T, depth = 0): T {
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
      const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
      if (SENSITIVE_KEYS.has(normalizedKey)) {
        result[key] = REDACTED_MARKER;
      } else {
        result[key] = redactSensitiveData(value, depth + 1);
      }
    }
    return result as T;
  }

  return data;
}
