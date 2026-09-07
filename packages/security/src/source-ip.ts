/**
 * Source-IP extraction from syslog message bodies.
 *
 * Background (Fase F / SOC ingestion contract):
 *
 * When a router forwards syslog lines for many internal hosts, the
 * RFC 3164 `hostname` token identifies the router, NOT the origin of
 * the access attempt. Storing the hostname as `DeviceEvent.sourceIp`
 * caused the brute-force / access-after-failures detectors to merge
 * attacks from distinct remote IPs into a single "source", because
 * every event carried the same router hostname.
 *
 * The correct semantic: `sourceIp` is the IP of the access attempt,
 * which lives inside the message body (e.g. "Failed password for root
 * from 1.2.3.4 port 22 ssh2"). The hostname stays in a separate field
 * (the DeviceEvent already has `sourceIp`, but not a dedicated hostname
 * column — the hostname is preserved in the message itself).
 *
 * This module exposes one function, `extractSourceIpFromMessage`, that
 * scans the message for a strict IPv4 literal and falls back to a
 * caller-supplied value (typically the UDP `rinfo.address`) when the
 * message has no IP. It does NOT return the hostname under any
 * circumstance — that was the bug.
 */

// Each octet: 0-255, no leading zeros except for "0" itself. Anchored
// with `\b` so "1.2.3.4.5" matches "1.2.3.4" but not "4.5" alone.
// IPv6 is intentionally NOT extracted here: the security detectors
// operate on IPv4 (NMS/ISP scope). If a future detector needs IPv6,
// extend this regex or add a parallel helper; do not silently coerce.
const IPV4_RE =
  /\b(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\b/;

/**
 * Returns the first IPv4 literal in the message, or `fallback` when no
 * valid IPv4 appears. Returns `null` when no IP is found AND no
 * fallback is supplied.
 *
 * The function does NOT consider the message hostname or any
 * RFC-3164 metadata — only the literal text of the message body. The
 * caller is responsible for having already parsed/stripped the syslog
 * envelope (`parseSyslogMessage` is the canonical parser).
 *
 * IPv6-only messages return the fallback (or null) — pin this as a
 * known limitation; extending to IPv6 is a separate, larger change
 * (it touches detector grouping and the existing data, which is
 * IPv4-shaped).
 */
export function extractSourceIpFromMessage(
  message: string,
  fallback?: string | null,
): string | null {
  if (typeof message !== 'string' || message.length === 0) {
    return fallback ?? null;
  }
  const m = IPV4_RE.exec(message);
  if (m && typeof m[0] === 'string' && m[0].length > 0) {
    return m[0];
  }
  return fallback ?? null;
}
