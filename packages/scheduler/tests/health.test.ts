import { describe, expect, it, beforeEach } from 'vitest';
import {
  __resetSchedulerHealth,
  detectHangedLoops,
  markExpected,
  markNotExpected,
  overallHealthy,
  recordError,
  recordSuccess,
  recordSyslogBound,
  recordSnmpBound,
  setNextRun,
  snapshotHealth,
  TICK_GRACE_MS,
  type SchedulerName,
  type ServiceHealth,
} from '../src/index';

/**
 * Health registry of the scheduler loops.
 *
 * Moved verbatim from `apps/web/tests/lib/monitoring/scheduler-health.test.ts`
 * when the registry left the Next.js app: the state now lives in
 * `@ftth-copilot/scheduler`, so the suite lives with it.
 */
describe('scheduler-health registry', () => {
  beforeEach(() => {
    __resetSchedulerHealth();
  });

  it('starts with an empty snapshot', () => {
    expect(snapshotHealth()).toEqual({});
  });

  it('records a service as expected', () => {
    markExpected('polling');
    expect(snapshotHealth()).toEqual({
      polling: {
        expected: true,
        lastRunAt: null,
        lastError: null,
        lastErrorAt: null,
      },
    });
  });

  it('records a service as not expected', () => {
    markNotExpected('firmware');
    expect(snapshotHealth()).toEqual({
      firmware: {
        expected: false,
        lastRunAt: null,
        lastError: null,
        lastErrorAt: null,
      },
    });
  });

  it('records a successful tick and clears the last error', () => {
    markExpected('polling');
    recordError('polling', 'first failure', 1000);
    recordSuccess('polling', 2000);
    const snap = snapshotHealth();
    expect(snap['polling']?.lastRunAt).toBe(2000);
    expect(snap['polling']?.lastError).toBeNull();
    expect(snap['polling']?.lastErrorAt).toBeNull();
  });

  it('records an error and keeps the timestamp for the operator', () => {
    markExpected('polling');
    recordError('polling', 'port busy', 1500);
    const snap = snapshotHealth();
    expect(snap['polling']?.lastError).toBe('port busy');
    expect(snap['polling']?.lastErrorAt).toBe(1500);
  });

  it('tracks syslog bind state', () => {
    markExpected('syslog');
    recordSyslogBound(true);
    expect(snapshotHealth()['syslog']?.bound).toBe(true);
    recordSyslogBound(false);
    expect(snapshotHealth()['syslog']?.bound).toBe(false);
  });
});

describe('snapshotHealth', () => {
  beforeEach(() => {
    __resetSchedulerHealth();
  });

  it('regression: returns populated entries (not {}) after services register', () => {
    // The previous implementation used Object.entries(STATE) on a Map,
    // which always returned {} because Map properties are not
    // enumerable. /api/health therefore always reported
    // `services: {}` and `healthy: true`, masking every real error.
    markExpected('polling');
    recordSuccess('polling', 1_000);
    markExpected('syslog');
    recordSyslogBound(true);

    const snap = snapshotHealth();
    expect(Object.keys(snap).sort()).toEqual(['polling', 'syslog']);
    expect(snap['polling']?.expected).toBe(true);
    expect(snap['polling']?.lastRunAt).toBe(1_000);
    expect(snap['syslog']?.bound).toBe(true);
  });
});

describe('overallHealthy', () => {
  beforeEach(() => {
    __resetSchedulerHealth();
  });

  it('returns true for an empty snapshot (no expected services means nothing to fail)', () => {
    expect(overallHealthy({})).toBe(true);
  });

  it('returns true when no services are expected', () => {
    markNotExpected('polling');
    expect(overallHealthy(snapshotHealth())).toBe(true);
  });

  it('returns false when an expected service has never run', () => {
    markExpected('polling');
    // No recordSuccess call → lastRunAt stays null.
    expect(overallHealthy(snapshotHealth(), 5 * 60 * 1000, 10_000)).toBe(false);
  });

  it('returns true once the expected service has run successfully', () => {
    markExpected('polling');
    recordSuccess('polling', 5_000);
    expect(overallHealthy(snapshotHealth(), 5 * 60 * 1000, 10_000)).toBe(true);
  });

  it('returns false when an expected service has a recent error', () => {
    markExpected('polling');
    recordSuccess('polling', 1_000);
    recordError('polling', 'NMS down', 9_500);
    // now=10000, errorAt=9500 → diff=500 < recentErrorMs=600000
    expect(overallHealthy(snapshotHealth(), 5 * 60 * 1000, 10_000)).toBe(false);
  });

  it('returns true once the error window has elapsed (the operator had time to act)', () => {
    markExpected('polling');
    recordError('polling', 'NMS down', 1_000);
    // now=400_000, errorAt=1000 → diff=399_000 > recentErrorMs=60_000
    expect(overallHealthy(snapshotHealth(), 60_000, 400_000)).toBe(true);
  });

  it('returns false when syslog is expected but never bound', () => {
    markExpected('syslog');
    // No bind callback fired → bound stays undefined.
    expect(overallHealthy(snapshotHealth(), 5 * 60 * 1000, 10_000)).toBe(false);
  });

  it('returns false when syslog was bound but then closed (bound=false)', () => {
    markExpected('syslog');
    recordSyslogBound(true);
    recordSyslogBound(false);
    expect(overallHealthy(snapshotHealth(), 5 * 60 * 1000, 10_000)).toBe(false);
  });

  it('returns false when ANY expected service is unhealthy (not just one)', () => {
    markExpected('polling');
    markExpected('firmware');
    recordSuccess('polling', 1_000);
    recordError('firmware', 'audit failed', 9_500);
    expect(overallHealthy(snapshotHealth(), 5 * 60 * 1000, 10_000)).toBe(false);
  });
});

describe('detectHangedLoops (Fase 2 — 2.6)', () => {
  const NOW = 1_700_000_000_000;

  function snap(entries: Array<[SchedulerName, ServiceHealth]>): Record<string, ServiceHealth> {
    return Object.fromEntries(entries);
  }

  it('reports services that never ran (ausencia de primera ejecución)', () => {
    const s = snap([
      ['polling', { expected: true, lastRunAt: null, lastError: null, lastErrorAt: null }],
      ['firmware', { expected: true, lastRunAt: null, lastError: null, lastErrorAt: null }],
    ]);
    expect(detectHangedLoops(s, NOW).sort()).toEqual(['firmware', 'polling']);
  });

  it('reports services whose last successful tick is too old (ciclo colgado)', () => {
    const s = snap([
      [
        'polling',
        { expected: true, lastRunAt: NOW - 20 * 60 * 1000, lastError: null, lastErrorAt: null },
      ],
    ]);
    expect(detectHangedLoops(s, NOW)).toEqual(['polling']);
  });

  it('does NOT report services that ran recently (healthy)', () => {
    const s = snap([
      ['polling', { expected: true, lastRunAt: NOW - 30_000, lastError: null, lastErrorAt: null }],
    ]);
    expect(detectHangedLoops(s, NOW)).toEqual([]);
  });

  it('does NOT report services that are not expected (env flag off)', () => {
    const s = snap([
      ['polling', { expected: false, lastRunAt: null, lastError: null, lastErrorAt: null }],
    ]);
    expect(detectHangedLoops(s, NOW)).toEqual([]);
  });

  it('is idempotent — same snapshot → same list', () => {
    const s = snap([
      ['polling', { expected: true, lastRunAt: null, lastError: null, lastErrorAt: null }],
    ]);
    expect(detectHangedLoops(s, NOW)).toEqual(detectHangedLoops(s, NOW));
  });
});

/**
 * Un loop que todavía no tuvo su primer tick desde el arranque.
 *
 * El registro de salud vive en la memoria del proceso y se vacía en cada
 * arranque: un worker recién levantado tiene sus loops "esperados" y ningún
 * tick todavía. Medido como "nunca corrió", eso es un loop muerto — y el
 * health del sistema queda degradado aunque el loop vaya a tickear en
 * cinco segundos. Con el firmware, cuyo primer tick está a 24 h, esa
 * degradación duraba casi un día después de cada despliegue.
 *
 * El plazo del próximo tick (`nextRunAt`) es lo que distingue las dos
 * cosas: un loop *calentando* —su tick todavía no venció— no está
 * degradado, y uno *colgado* —el tick que debía haber ocurrido no
 * ocurrió— sí.
 */
describe('un loop que todavía no tuvo su primer tick', () => {
  const NOW = 1_700_000_000_000;

  beforeEach(() => {
    __resetSchedulerHealth();
  });

  it('no cuenta como degradado mientras su próximo tick esperado no venció', () => {
    markExpected('firmware', { intervalMs: 86_400_000, nextRunAt: NOW + 60_000 });

    expect(overallHealthy(snapshotHealth(), 5 * 60 * 1000, NOW)).toBe(true);
    expect(detectHangedLoops(snapshotHealth(), NOW)).toEqual([]);
  });

  it('cuenta como degradado cuando el tick que esperaba ya venció', () => {
    markExpected('firmware', { intervalMs: 86_400_000, nextRunAt: NOW - TICK_GRACE_MS - 1_000 });

    expect(overallHealthy(snapshotHealth(), 5 * 60 * 1000, NOW)).toBe(false);
    expect(detectHangedLoops(snapshotHealth(), NOW)).toEqual(['firmware']);
  });

  it('aguanta la ventana de gracia: un tick que llega tarde todavía no cuelga al loop', () => {
    markExpected('firmware', { intervalMs: 86_400_000, nextRunAt: NOW - TICK_GRACE_MS + 1_000 });

    expect(overallHealthy(snapshotHealth(), 5 * 60 * 1000, NOW)).toBe(true);
    expect(detectHangedLoops(snapshotHealth(), NOW)).toEqual([]);
  });

  it('sigue degradado cuando el loop no tiene plazo conocido', () => {
    // Sin plazo no hay con qué absolverlo: es el caso de siempre.
    markExpected('firmware');

    expect(overallHealthy(snapshotHealth(), 5 * 60 * 1000, NOW)).toBe(false);
    expect(detectHangedLoops(snapshotHealth(), NOW)).toEqual(['firmware']);
  });

  it('publica el plazo y la cadencia del loop', () => {
    markExpected('polling', { intervalMs: 900_000, nextRunAt: NOW + 900_000 });

    const snap = snapshotHealth();
    expect(snap['polling']?.nextRunAt).toBe(NOW + 900_000);
    expect(snap['polling']?.intervalMs).toBe(900_000);
  });

  it('el plazo se puede corregir sin tocar el resto del estado', () => {
    markExpected('polling', { intervalMs: 900_000, nextRunAt: NOW });
    setNextRun('polling', NOW + 900_000);

    const snap = snapshotHealth();
    expect(snap['polling']?.nextRunAt).toBe(NOW + 900_000);
    expect(snap['polling']?.intervalMs).toBe(900_000);
  });

  it('un loop que ya corrió no cuelga mientras su próximo tick no venció', () => {
    // El umbral fijo de diez minutos colgaría a este loop: su último tick
    // fue hace una hora. El plazo del schedule manda sobre ese umbral.
    markExpected('polling', { intervalMs: 900_000, nextRunAt: NOW + 900_000 });
    recordSuccess('polling', NOW - 3_600_000);

    expect(detectHangedLoops(snapshotHealth(), NOW)).toEqual([]);
    expect(overallHealthy(snapshotHealth(), 5 * 60 * 1000, NOW)).toBe(true);
  });

  it('un loop que corrió y cuyo plazo venció está colgado', () => {
    markExpected('polling', { intervalMs: 900_000, nextRunAt: NOW - TICK_GRACE_MS - 1_000 });
    recordSuccess('polling', NOW - 3_600_000);

    expect(detectHangedLoops(snapshotHealth(), NOW)).toEqual(['polling']);
  });

  it('un receptor sigue sin depender de un tick', () => {
    markExpected('syslog');
    recordSyslogBound(true);

    expect(detectHangedLoops(snapshotHealth(), NOW)).toEqual([]);
    expect(overallHealthy(snapshotHealth(), 5 * 60 * 1000, NOW)).toBe(true);
  });
});

/**
 * The receivers are not loops.
 *
 * The syslog and SNMP receivers hold a UDP socket: they do not tick, so
 * there is no last run to judge them by. Their health is whether the socket
 * is bound. A receiver that was judged by its clock would be reported as
 * hung forever.
 */
describe('the health of the receivers', () => {
  beforeEach(() => {
    __resetSchedulerHealth();
  });

  it('does not report a bound receiver as hung', () => {
    markExpected('syslog');
    recordSyslogBound(true);
    markExpected('snmp');
    recordSnmpBound(true);

    expect(detectHangedLoops(snapshotHealth(), Date.now())).toEqual([]);
  });

  it('reports a receiver whose socket is not bound as unhealthy', () => {
    markExpected('syslog');
    recordSyslogBound(false);

    expect(overallHealthy(snapshotHealth())).toBe(false);
  });

  it('leaves a bound receiver healthy even without a tick', () => {
    markExpected('syslog');
    recordSyslogBound(true);

    expect(overallHealthy(snapshotHealth())).toBe(true);
  });
});
