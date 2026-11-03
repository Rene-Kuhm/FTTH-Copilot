import { describe, expect, it } from 'vitest';
import { decideWarmup, warmupJobId, WARMUP_WINDOW_MS } from '../src/warmup';

/**
 * La decisión de forzar el tick de calentamiento.
 *
 * El schedule de un loop es una rejilla que BullMQ no reprograma: el `upsert`
 * de un schedule que ya existe deja la rejilla como estaba. Después de un
 * reinicio, el próximo tick del loop es el que la rejilla tenía previsto —
 * y para el firmware ese tick está a 24 h. El tick de calentamiento es lo
 * que hace que el loop pruebe que funciona enseguida después de un
 * reinicio, en lugar de desaparecer hasta el próximo turno de la rejilla.
 *
 * Pero un tick de calentamiento es trabajo duplicado si el schedule ya tiene
 * un tick a la vista, y duplicado de verdad si lo fuerzan dos workers a la
 * vez. La decisión es pura a propósito: el reloj y la rejilla entran como
 * datos, y el comportamiento se puede probar sin Redis.
 */
describe('la decisión de forzar el tick de calentamiento', () => {
  const NOW = 1_700_000_000_000;

  it('no se fuerza cuando el próximo tick del schedule ya está cerca', () => {
    // El propio tick del schedule va a servir de calentamiento.
    const decision = decideWarmup({
      nextRunAtMs: NOW + 10_000,
      nowMs: NOW,
    });
    expect(decision.force).toBe(false);
  });

  it('no se fuerza cuando el próximo tick del schedule ya pasó y está pendiente', () => {
    // El job del schedule está en la cola y va a salir de una: forzarlo sería
    // un segundo poll en la misma ventana.
    const decision = decideWarmup({
      nextRunAtMs: NOW - 5_000,
      nowMs: NOW,
    });
    expect(decision.force).toBe(false);
  });

  it('se fuerza cuando el próximo tick del schedule está lejos', () => {
    const decision = decideWarmup({
      nextRunAtMs: NOW + 6 * 60 * 60 * 1000,
      nowMs: NOW,
    });
    expect(decision.force).toBe(true);
  });

  it('no se fuerza cuando el schedule no tiene un próximo tick conocido', () => {
    const decision = decideWarmup({ nextRunAtMs: null, nowMs: NOW });
    expect(decision.force).toBe(false);
  });

  it('la ventana que decide si el tick está cerca es la misma para las dos reglas', () => {
    // A diez segundos del slot el tick del schedule todavía cuenta como
    // cercano; a un minuto ya no.
    const cerca = decideWarmup({
      nextRunAtMs: NOW + WARMUP_WINDOW_MS - 1_000,
      nowMs: NOW,
    });
    const lejos = decideWarmup({
      nextRunAtMs: NOW + WARMUP_WINDOW_MS + 1_000,
      nowMs: NOW,
    });
    expect(cerca.force).toBe(false);
    expect(lejos.force).toBe(true);
  });
});

describe('el id del job de calentamiento', () => {
  it('sale del scope del loop y de la ranura del schedule', () => {
    expect(warmupJobId('poll-connections', 1_700_000_000_000)).toBe(
      'warmup-poll-connections-1700000000000',
    );
  });

  it('dos workers que ven la misma ranura producen el mismo id', () => {
    // Es lo que hace que BullMQ encole un solo job: el id repetido es un job
    // repetido, no dos.
    expect(warmupJobId('poll-connections', 42)).toBe(warmupJobId('poll-connections', 42));
  });

  it('ranuras distintas producen ids distintos', () => {
    expect(warmupJobId('poll-connections', 42)).not.toBe(warmupJobId('poll-connections', 43));
  });

  it('el id no lleva los caracteres que BullMQ rechaza', () => {
    expect(warmupJobId('poll:connections', 42)).not.toContain(':');
  });
});
