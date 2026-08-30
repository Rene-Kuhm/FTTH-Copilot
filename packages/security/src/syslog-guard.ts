/**
 * Defensive guards for the syslog receiver. Syslog arrives over UDP from
 * devices that may be misconfigured or malicious, so both the message size and
 * the ingest rate must be bounded to keep the events table and the database
 * from being flooded.
 */

/** Default cap on a stored syslog message, in UTF-16 code units. */
export const DEFAULT_MAX_SYSLOG_MESSAGE_LENGTH = 2000;

/** Truncates a syslog message to `maxLength` characters. */
export function truncateSyslogMessage(
  message: string,
  maxLength: number = DEFAULT_MAX_SYSLOG_MESSAGE_LENGTH,
): string {
  if (message.length <= maxLength) return message;
  return message.slice(0, maxLength);
}

export interface RateWindowCounterOptions {
  /** Maximum number of events accepted per window. */
  maxEvents: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateWindowCounter {
  /** True if the event is within budget (and counts it); false if dropped. */
  allow(nowMs: number): boolean;
}

/**
 * A fixed-window rate counter. Zero-dependency and injectable-time so it can be
 * unit-tested deterministically.
 */
export function createRateWindowCounter(
  opts: RateWindowCounterOptions,
): RateWindowCounter {
  let windowStart = 0;
  let count = 0;

  return {
    allow(nowMs: number): boolean {
      if (nowMs - windowStart >= opts.windowMs) {
        windowStart = nowMs;
        count = 0;
      }
      if (count >= opts.maxEvents) return false;
      count += 1;
      return true;
    },
  };
}
