import type { SecurityEvent, SecurityFinding } from './types';

export interface DetectorOptions {
  now?: number;
  windowMs?: number;
  minFailures?: number;
}

const MINUTE_MS = 60 * 1000;

function sortByTime(events: SecurityEvent[]): SecurityEvent[] {
  return [...events].sort((a, b) => a.t - b.t);
}

function sourceKey(sourceIp: string | null): string {
  return sourceIp ?? '(unknown)';
}

function inWindow(t: number, now: number, windowMs: number): boolean {
  return now - t <= windowMs;
}

/**
 * Flags a source with at least `minFailures` auth_failure events in the last
 * `windowMs` — the classic brute-force signal.
 */
export function detectBruteForce(
  events: SecurityEvent[],
  opts: DetectorOptions = {},
): SecurityFinding[] {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowMs ?? 5 * MINUTE_MS;
  const minFailures = opts.minFailures ?? 5;

  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.category !== 'auth_failure') continue;
    if (!inWindow(event.t, now, windowMs)) continue;
    const key = sourceKey(event.sourceIp);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const findings: SecurityFinding[] = [];
  for (const [key, count] of counts) {
    if (count < minFailures) continue;
    findings.push({
      id: `brute-force-${key}`,
      kind: 'brute_force',
      severity: 'critical',
      sourceIp: key === '(unknown)' ? null : key,
      title: `Posible fuerza bruta desde ${key}`,
      description: `${count} intentos de autenticación fallidos en los últimos ${Math.round(windowMs / MINUTE_MS)} min.`,
      detectedAt: new Date(now).toISOString(),
    });
  }
  return findings;
}

/**
 * Flags a successful access that follows repeated auth failures from the same
 * source — success immediately after a brute-force attempt.
 */
export function detectAccessAfterFailures(
  events: SecurityEvent[],
  opts: DetectorOptions = {},
): SecurityFinding[] {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowMs ?? 5 * MINUTE_MS;
  const minFailures = opts.minFailures ?? 3;

  const sorted = sortByTime(events);
  const findings: SecurityFinding[] = [];

  for (const event of sorted) {
    if (event.category !== 'access') continue;
    const key = sourceKey(event.sourceIp);

    const priorFailures = sorted.filter(
      (e) =>
        e.category === 'auth_failure' &&
        sourceKey(e.sourceIp) === key &&
        e.t < event.t &&
        e.t >= event.t - windowMs,
    ).length;

    if (priorFailures < minFailures) continue;

    findings.push({
      id: `access-after-failures-${key}-${event.t}`,
      kind: 'access_after_failures',
      severity: 'warning',
      sourceIp: event.sourceIp,
      title: `Acceso tras fallos repetidos desde ${key}`,
      description: `Login exitoso después de ${priorFailures} fallos recientes desde la misma fuente.`,
      detectedAt: new Date(now).toISOString(),
    });
  }
  return findings;
}

/**
 * Flags every config_change event — for a SOC, configuration changes on network
 * devices are always notable and should be reviewed.
 */
export function detectConfigChange(
  events: SecurityEvent[],
  opts: DetectorOptions = {},
): SecurityFinding[] {
  const now = opts.now ?? Date.now();
  const findings: SecurityFinding[] = [];

  for (const event of sortByTime(events)) {
    if (event.category !== 'config_change') continue;
    const key = sourceKey(event.sourceIp);
    findings.push({
      id: `config-change-${key}-${event.t}`,
      kind: 'config_change',
      severity: 'warning',
      sourceIp: event.sourceIp,
      title: 'Cambio de configuración detectado',
      description: event.message || 'Evento de cambio de configuración en un equipo.',
      detectedAt: new Date(now).toISOString(),
    });
  }
  return findings;
}
