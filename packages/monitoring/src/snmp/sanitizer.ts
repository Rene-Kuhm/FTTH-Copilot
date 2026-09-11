/**
 * SNMP Capture & Evidence Sanitizer (Roadmap Fase 8).
 *
 * Provides deterministic scrubbing for:
 * 1. Community strings and SNMP credentials.
 * 2. IPv4 and IPv6 addresses (mapped to RFC 5737 doc IPs or tokens).
 * 3. Hostnames and private domain names.
 * 4. Customer PII, PPPoE credentials, circuit IDs.
 * 5. Serial numbers (preserving standard 4-char vendor prefixes).
 */

export interface SnmpSanitizerOptions {
  /** Known community strings to redact */
  customCommunities?: string[];
  /** Custom IP addresses to explicitly redact */
  customIps?: string[];
  /** Whether to preserve vendor prefix in serials (e.g. HWTC, ZTEG). Default true. */
  preserveVendorSerialPrefix?: boolean;
  /** IP replacement mode: 'doc-ip' (RFC 5737) or 'token'. Default 'doc-ip'. */
  ipReplacementMode?: 'doc-ip' | 'token';
}

export interface SanitizerReport {
  communitiesCount: number;
  ipsCount: number;
  serialsCount: number;
  credentialsCount: number;
}

const KNOWN_VENDOR_PREFIXES = [
  'HWTC', // Huawei
  'ZTEG', // ZTE
  'ALCL', // Nokia / Alcatel-Lucent
  'FHTT', // FiberHome
  'CXNK', // Calix
  'ADTN', // Adtran
  'VSOL', // VSOL
  'BDCM', // BDCOM
  'CDAT', // C-Data
  'UBNT', // Ubiquiti
  'DZSI', // DZS
  'ZYXL', // Zyxel
  'GPON', // Generic GPON
];

const COMMON_COMMUNITIES = ['public', 'private', 'community', 'secret', 'admin', 'monitor'];

/**
 * Sanitizes a raw text string (such as snmpwalk output, syslog, or debug logs).
 */
export function sanitizeSnmpText(text: string, options: SnmpSanitizerOptions = {}): string {
  let result = text;
  const ipMode = options.ipReplacementMode ?? 'doc-ip';
  const preservePrefix = options.preserveVendorSerialPrefix !== false;

  // 1. Redact community strings
  const communitiesToRedact = new Set<string>([
    ...COMMON_COMMUNITIES,
    ...(options.customCommunities ?? []),
  ]);

  for (const comm of communitiesToRedact) {
    if (!comm || comm.length < 2) continue;
    // Replace standalone community or inside snmp flags (-c public)
    const escaped = comm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?<=\\b|-c\\s+|community[:=]\\s*["']?)${escaped}(?=["']?\\b)`, 'gi');
    result = result.replace(regex, '<REDACTED_COMMUNITY>');
  }

  // Also replace generic community string key-values: community: "secretValue"
  result = result.replace(
    /("?community"?\s*[:=]\s*["'])([^"'\r\n]+)(["'])/gi,
    '$1<REDACTED_COMMUNITY>$3',
  );

  // 2. Redact Passwords / Credentials / Secrets
  result = result.replace(
    /(authKey|privKey|password|secret|passphrase|pppoe_pass)\s*[:=]\s*["']?([^"'\s,;]+)["']?/gi,
    '$1: "<REDACTED_SECRET>"',
  );

  // 3. Redact IPv4 Addresses (preserve 127.0.0.1, 0.0.0.0, and already redacted)
  const ipMap = new Map<string, string>();
  let docIpCounter = 1;

  const ipv4Regex = /(?<![.\d])(?!127\.0\.0\.1(?![.\d]))(?!0\.0\.0\.0(?![.\d]))(?!192\.0\.2\.)(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![.\d])/g;

  result = result.replace(ipv4Regex, (matched) => {
    if (ipMode === 'token') {
      return '<REDACTED_IP>';
    }
    if (!ipMap.has(matched)) {
      ipMap.set(matched, `192.0.2.${docIpCounter++}`);
    }
    return ipMap.get(matched)!;
  });

  // 4. Redact IPv6 Addresses (excluding ::1 and ::)
  const ipv6Regex = /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b|\b(?:[0-9a-fA-F]{1,4}:){1,7}:(?::[0-9a-fA-F]{1,4}){1,7}\b/g;
  result = result.replace(ipv6Regex, (matched) => {
    if (matched === '::1' || matched === '::') return matched;
    return ipMode === 'token' ? '<REDACTED_IPV6>' : '2001:db8::1';
  });

  // 5. Redact Internal Hostnames and FQDNs
  result = result.replace(
    /\b(?:[a-zA-Z0-9_-]+\.)+(?:corp|local|internal|lan|telecom|isp\.net)\b/gi,
    'olt-sanitized.isp.example',
  );

  // 6. Redact Subscriber Identifiers & Circuit IDs
  result = result.replace(
    /(circuit-id|subscriber-id|client-name|customer-name|pppoe-user)\s*[:=]\s*["']?([^"'\r\n,;]+)["']?/gi,
    '$1: "<REDACTED_CUSTOMER_ID>"',
  );

  // 7. Mask Serial Numbers while preserving vendor prefix
  if (preservePrefix) {
    for (const prefix of KNOWN_VENDOR_PREFIXES) {
      // Matches e.g. HWTC12345678, ZTEG00ABCDEF, ALCL98765432
      const serialRegex = new RegExp(`\\b(${prefix})([0-9A-Fa-f]{6,12})\\b`, 'g');
      result = result.replace(serialRegex, (_match, pfx, payload) => {
        const masked = '*'.repeat(payload.length);
        return `${pfx}${masked}`;
      });
    }
  } else {
    for (const prefix of KNOWN_VENDOR_PREFIXES) {
      const serialRegex = new RegExp(`\\b${prefix}[0-9A-Fa-f]{6,12}\\b`, 'g');
      result = result.replace(serialRegex, '<REDACTED_SERIAL>');
    }
  }

  return result;
}

/**
 * Sanitizes a structured JavaScript/JSON object (e.g. RawSnmpEvidenceEnvelope or fixture).
 */
export function sanitizeSnmpObject<T = unknown>(obj: T, options: SnmpSanitizerOptions = {}): T {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return sanitizeSnmpText(obj, options) as unknown as T;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeSnmpObject(item, options)) as unknown as T;
  }

  if (typeof obj === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const lowerKey = key.toLowerCase();

      // Explicit field-based sanitization
      if (
        lowerKey === 'community' ||
        lowerKey.includes('passphrase') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('key') ||
        lowerKey.includes('auth') ||
        lowerKey.includes('priv') ||
        lowerKey.includes('password')
      ) {
        copy[key] = '<REDACTED_COMMUNITY>';
      } else if (lowerKey === 'senderip' || lowerKey === 'agentaddress' || lowerKey === 'ip') {
        const ipStr = String(value);
        copy[key] = sanitizeSnmpText(ipStr, options);
      } else if (lowerKey === 'serial' || lowerKey === 'onuserial') {
        copy[key] = sanitizeSnmpText(String(value), options);
      } else {
        copy[key] = sanitizeSnmpObject(value, options);
      }
    }
    return copy as T;
  }

  return obj;
}

/**
 * Auto-detecting sanitizer entrypoint. If input is valid JSON, parses, sanitizes, and pretty-prints JSON.
 * Otherwise, sanitizes as text.
 */
export function sanitizeSnmpCapture(input: string, options: SnmpSanitizerOptions = {}): string {
  const trimmed = input.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      const parsed = JSON.parse(trimmed);
      const sanitized = sanitizeSnmpObject(parsed, options);
      return JSON.stringify(sanitized, null, 2);
    } catch {
      // Fall through to plain text sanitization if JSON parse fails
    }
  }
  return sanitizeSnmpText(input, options);
}
