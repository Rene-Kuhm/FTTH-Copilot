/**
 * Prioridad del barrido FEC (S5) y registro de ONUs degradadas.
 *
 * El barrido FEC gasta el presupuesto de la cuenta en `get_onu_details`: con
 * 15 llamadas por hora tardaba semanas en dar la vuelta. Con ~600 por hora el
 * primer barrido entra en horas, pero entonces el orden importa: las ONUs que
 * los eventos marcan degradadas van primero, y el resto sigue en el
 * round-robin de siempre.
 *
 * `rankFecCandidates` es una función pura: recibe el reloj como dato (cada
 * señal degradada trae su `atMs`) y no toca la base ni la red.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { OnuSummary } from '@ftth-copilot/connectors-core';
import {
  __resetDegradedOnusForTests,
  recordDegradedOnu,
  snapshotDegradedOnus,
  type DegradedOnuSignal,
} from '../src/degraded-onus';
import { rankFecCandidates } from '../src/fec-priority';

function onu(id: string, rxPowerDbm?: number): OnuSummary {
  return {
    id,
    serial: `SN-${id}`,
    oltId: 'OLT-1',
    status: 'online',
    ...(rxPowerDbm === undefined ? {} : { rxPowerDbm }),
  };
}

function degraded(onuId: string, atMs: number, rxPowerDbm?: number): DegradedOnuSignal {
  return {
    onuId,
    atMs,
    reason: 'signal_changed',
    ...(rxPowerDbm === undefined ? {} : { rxPowerDbm }),
  };
}

const SCOPE = { tenantId: 'tenant-1', connectionId: 'conn-1' };

beforeEach(() => {
  __resetDegradedOnusForTests();
});

describe('rankFecCandidates', () => {
  it('sin ONUs o con un tamaño de corte inválido no devuelve nada', () => {
    expect(rankFecCandidates({ onus: [], tickIndex: 0, sliceSize: 8 })).toEqual([]);
    expect(
      rankFecCandidates({ onus: [onu('ONU-1')], tickIndex: 0, sliceSize: 0 }),
    ).toEqual([]);
  });

  it('sin ONUs degradadas es el round-robin determinista de siempre', () => {
    const onus = ['ONU-04', 'ONU-01', 'ONU-03', 'ONU-02'].map((id) => onu(id));

    const first = rankFecCandidates({ onus, tickIndex: 0, sliceSize: 2 });
    const second = rankFecCandidates({ onus, tickIndex: 1, sliceSize: 2 });

    expect(first.map((o) => o.id)).toEqual(['ONU-01', 'ONU-02']);
    expect(second.map((o) => o.id)).toEqual(['ONU-03', 'ONU-04']);
    // No muta la entrada.
    expect(onus.map((o) => o.id)).toEqual(['ONU-04', 'ONU-01', 'ONU-03', 'ONU-02']);
  });

  it('pone primero las degradadas: peor señal, después la más reciente, después el id', () => {
    const onus = ['ONU-01', 'ONU-02', 'ONU-03', 'ONU-04', 'ONU-05'].map((id) => onu(id));
    const signals = [
      degraded('ONU-02', 1_000, -28.4),
      degraded('ONU-04', 1_000, -30.2),
      degraded('ONU-01', 5_000),
      degraded('ONU-05', 9_000, -28.4),
    ];

    const ranked = rankFecCandidates({ onus, degraded: signals, tickIndex: 0, sliceSize: 4 });

    // Peor señal primero (-30.2, después las dos de -28.4, la más reciente
    // primero), y al final la que no trajo lectura de potencia.
    expect(ranked.map((o) => o.id)).toEqual(['ONU-04', 'ONU-05', 'ONU-02', 'ONU-01']);
  });

  it('ignora una ONU degradada que ya no está en el inventario', () => {
    const onus = [onu('ONU-01'), onu('ONU-02')];

    const ranked = rankFecCandidates({
      onus,
      degraded: [degraded('ONU-99', 1_000, -35)],
      tickIndex: 0,
      sliceSize: 2,
    });

    expect(ranked.map((o) => o.id)).toEqual(['ONU-01', 'ONU-02']);
  });

  it('completa el corte con el round-robin del resto, sin repetir degradadas', () => {
    const onus = ['ONU-01', 'ONU-02', 'ONU-03', 'ONU-04'].map((id) => onu(id));

    const ranked = rankFecCandidates({
      onus,
      degraded: [degraded('ONU-03', 1_000, -29)],
      tickIndex: 0,
      sliceSize: 3,
    });

    expect(ranked.map((o) => o.id)).toEqual(['ONU-03', 'ONU-01', 'ONU-02']);
  });

  it('con un corte que cubre todo el inventario devuelve todas, degradadas primero', () => {
    const onus = ['ONU-01', 'ONU-02', 'ONU-03'].map((id) => onu(id));

    const ranked = rankFecCandidates({
      onus,
      degraded: [degraded('ONU-02', 1_000, -31)],
      tickIndex: 3,
      sliceSize: 10,
    });

    expect(ranked.map((o) => o.id)).toEqual(['ONU-02', 'ONU-01', 'ONU-03']);
    expect(ranked).toHaveLength(3);
  });
});

describe('el registro de ONUs degradadas', () => {
  it('guarda la señal más reciente de cada ONU', () => {
    recordDegradedOnu(SCOPE, degraded('ONU-01', 1_000, -29));
    recordDegradedOnu(SCOPE, { ...degraded('ONU-01', 2_000, -31), reason: 'rx1490_reading' });

    const signals = snapshotDegradedOnus(SCOPE, 2_500);

    expect(signals).toHaveLength(1);
    expect(signals[0]?.rxPowerDbm).toBe(-31);
    expect(signals[0]?.reason).toBe('rx1490_reading');
  });

  it('descarta lo que venció su TTL', () => {
    recordDegradedOnu(SCOPE, degraded('ONU-01', 1_000, -29));

    expect(snapshotDegradedOnus(SCOPE, 1_000 + 60_000, 60_000)).toHaveLength(1);
    expect(snapshotDegradedOnus(SCOPE, 1_000 + 60_001, 60_000)).toHaveLength(0);
  });

  it('aísla por tenant y por conexión', () => {
    recordDegradedOnu(SCOPE, degraded('ONU-01', 1_000, -29));

    expect(snapshotDegradedOnus({ tenantId: 'tenant-2', connectionId: 'conn-1' }, 1_500)).toEqual(
      [],
    );
    expect(snapshotDegradedOnus({ tenantId: 'tenant-1', connectionId: 'conn-2' }, 1_500)).toEqual(
      [],
    );
  });

  it('ordena por id para que el resultado sea determinista', () => {
    recordDegradedOnu(SCOPE, degraded('ONU-02', 1_000, -29));
    recordDegradedOnu(SCOPE, degraded('ONU-01', 2_000, -31));

    expect(snapshotDegradedOnus(SCOPE, 2_500).map((s) => s.onuId)).toEqual(['ONU-01', 'ONU-02']);
  });
});
