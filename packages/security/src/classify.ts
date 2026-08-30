import type { ParsedSyslog } from './syslog';

export type EventCategory = 'auth_failure' | 'access' | 'config_change' | 'other';

const AUTH_FAILURE_RE =
  /(failed password|authentication failure|invalid user|incorrect password|unauthorized|permission denied)/i;
const CONFIG_CHANGE_RE =
  /(configure|config|commit|write memory|running-config|startup-config|save config)/i;
const ACCESS_RE =
  /(accepted|session opened|logged in|login successful|connected|user .* entered)/i;

/**
 * Classifies a parsed syslog event into a coarse security category using
 * keyword heuristics. auth_failure is checked first because it is the most
 * security-relevant and its keywords can overlap with generic access text.
 */
export function classifyEvent(ev: ParsedSyslog): EventCategory {
  const text = `${ev.tag ?? ''} ${ev.message}`;
  if (AUTH_FAILURE_RE.test(text)) return 'auth_failure';
  if (CONFIG_CHANGE_RE.test(text)) return 'config_change';
  if (ACCESS_RE.test(text)) return 'access';
  return 'other';
}
