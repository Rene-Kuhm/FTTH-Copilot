export interface SyslogMessageParts {
  priority: number;
  timestamp?: string | null;
  hostname?: string | null;
  tag?: string | null;
  message: string;
}

/**
 * Inverse of `parseSyslogMessage`: builds a RFC 3164 line from its parts.
 * Round-tripping through the parser yields the same fields, so the emitter and
 * the receiver stay consistent with zero hardware.
 */
export function buildSyslogMessage(parts: SyslogMessageParts): string {
  const pri = `<${parts.priority}>`;
  const ts = parts.timestamp ? `${parts.timestamp} ` : '';
  const host = parts.hostname ? `${parts.hostname} ` : '';
  const tagPart = parts.tag ? `${parts.tag}: ` : '';
  return `${pri}${ts}${host}${tagPart}${parts.message}`;
}

export interface SocScenarioOptions {
  sourceIp?: string;
  hostname?: string;
}

/**
 * A synthetic SOC scenario: a burst of SSH auth failures from one source
 * (brute force), followed by a successful access (access_after_failures) and a
 * config change. Emitted as RFC 3164 lines the syslog receiver would ingest.
 */
export function buildSocScenarioMessages(opts: SocScenarioOptions = {}): string[] {
  const ip = opts.sourceIp ?? '203.0.113.5';
  const hostname = opts.hostname ?? 'edge-01';
  const messages: string[] = [];

  for (let i = 0; i < 6; i++) {
    messages.push(
      buildSyslogMessage({
        priority: 13,
        hostname,
        tag: 'sshd',
        message: `Failed password for root from ${ip} port 22 ssh2`,
      }),
    );
  }

  messages.push(
    buildSyslogMessage({
      priority: 13,
      hostname,
      tag: 'sshd',
      message: `Accepted publickey for admin from ${ip} port 22 ssh2`,
    }),
  );

  messages.push(
    buildSyslogMessage({
      priority: 13,
      hostname,
      tag: 'cli',
      message: 'configured by admin from console',
    }),
  );

  return messages;
}
