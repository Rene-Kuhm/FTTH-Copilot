/**
 * RFC 3164 (BSD syslog) parser. Handles the common `<PRI>timestamp hostname
 * tag: message` shape and degrades gracefully when fields are missing.
 */

export interface ParsedSyslog {
  /** Raw priority value (facility * 8 + severity), 0..191. */
  priority: number;
  /** Syslog facility, 0..23. */
  facility: number;
  /** Syslog severity, 0..7. */
  severity: number;
  /** Raw timestamp string (e.g. "Aug 30 10:00:00"), or null. */
  timestamp: string | null;
  /** Source hostname or IP, or null. */
  hostname: string | null;
  /** Program tag (e.g. "sshd"), or null. */
  tag: string | null;
  /** Remaining message text. */
  message: string;
}

const TIMESTAMP_RE = /^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(.*)$/;
const TAG_RE = /^([^:]{1,32}):\s?(.*)$/;

/**
 * Parses a single RFC 3164 syslog line. Returns null when the line does not
 * start with a valid `<PRI>` prefix.
 */
export function parseSyslogMessage(line: string): ParsedSyslog | null {
  if (!line.startsWith('<')) return null;

  const close = line.indexOf('>');
  if (close <= 0) return null;

  const priority = Number(line.slice(1, close));
  if (!Number.isInteger(priority) || priority < 0 || priority > 191) return null;

  const facility = Math.floor(priority / 8);
  const severity = priority % 8;
  let remainder = line.slice(close + 1).trim();

  let timestamp: string | null = null;
  const tsMatch = remainder.match(TIMESTAMP_RE);
  if (tsMatch) {
    timestamp = tsMatch[1]!;
    remainder = tsMatch[2]!.trim();
  }

  let hostname: string | null = null;
  const hostMatch = remainder.match(/^(\S+)\s+(.*)$/);
  if (hostMatch) {
    hostname = hostMatch[1]!;
    remainder = hostMatch[2]!.trim();
  }

  let tag: string | null = null;
  let message = remainder;
  const tagMatch = remainder.match(TAG_RE);
  if (tagMatch) {
    tag = tagMatch[1]!.trim();
    message = tagMatch[2]!.trim();
  }

  return { priority, facility, severity, timestamp, hostname, tag, message };
}
