import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SNAPSHOT_WINDOW_DAYS,
  runLearningSnapshot,
  type LearningArtifactDraft,
  type LearningSnapshotStore,
} from '../src/learning-snapshot';

/**
 * The persistence shell of the learning snapshot.
 *
 * The worker is the shell: it reads the rows, calls the pure core of
 * `@ftth-copilot/learning` and stores the frozen artifact. The hash is
 * computed by the pure core, so two runs over the same data always agree.
 */

interface Recorded {
  readonly tenants: string[];
  readonly feedback: Array<{ tenantId: string; windowStart: Date; windowEnd: Date }>;
  readonly incidents: Array<{ tenantId: string; windowStart: Date; windowEnd: Date }>;
  readonly topology: string[];
  readonly artifacts: LearningArtifactDraft[];
  /** Hashes that already exist: the store reports "not created". */
  readonly existingHashes: Set<string>;
}

function fakeStore(overrides: Partial<LearningSnapshotStore> = {}): {
  store: LearningSnapshotStore;
  recorded: Recorded;
} {
  const recorded: Recorded = {
    tenants: ['tenant-1'],
    feedback: [],
    incidents: [],
    topology: [],
    artifacts: [],
    existingHashes: new Set<string>(),
  };

  const store: LearningSnapshotStore = {
    listTenants: async () => recorded.tenants,
    readFeedback: async (tenantId, window) => {
      recorded.feedback.push({ tenantId, windowStart: window.start, windowEnd: window.end });
      return [];
    },
    readIncidents: async (tenantId, window) => {
      recorded.incidents.push({ tenantId, windowStart: window.start, windowEnd: window.end });
      return [];
    },
    readTopology: async (tenantId) => {
      recorded.topology.push(tenantId);
      return [];
    },
    writeArtifact: async (artifact) => {
      recorded.artifacts.push(artifact);
      if (recorded.existingHashes.has(artifact.snapshotHash)) return false;
      return true;
    },
    ...overrides,
  };

  return { store, recorded };
}

const NOW = new Date('2026-11-02T12:00:00.000Z');

describe('runLearningSnapshot — congela el dataset por tenant', () => {
  it('persiste un artefacto con su hash, su ventana y su versión de código', async () => {
    const { store, recorded } = fakeStore();

    const outcomes = await runLearningSnapshot({ now: NOW }, store);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.tenantId).toBe('tenant-1');
    expect(outcomes[0]?.snapshotHash).toMatch(/^s_[0-9a-f]{16}$/);
    expect(outcomes[0]?.created).toBe(true);

    expect(recorded.artifacts).toHaveLength(1);
    expect(recorded.artifacts[0]?.snapshotHash).toBe(outcomes[0]?.snapshotHash);
    expect(recorded.artifacts[0]?.codeVersion).toBeTruthy();
    expect(recorded.artifacts[0]?.windowEnd.getTime()).toBe(NOW.getTime());
  });

  it('la ventana es determinista: el corte es el punto medio', async () => {
    const { store, recorded } = fakeStore();

    await runLearningSnapshot({ now: NOW, windowDays: 10 }, store);

    const ventana = recorded.feedback[0]!;
    const inicio = ventana.windowStart.getTime();
    const fin = ventana.windowEnd.getTime();
    expect(fin - inicio).toBe(10 * 24 * 60 * 60 * 1000);

    // El corte T es el punto medio de la ventana: mismo dataset, mismo split.
    const corte = inicio + (fin - inicio) / 2;
    expect(corte).toBeGreaterThan(inicio);
    expect(corte).toBeLessThan(fin);
  });

  it('la ventana por defecto son 30 días', async () => {
    expect(DEFAULT_SNAPSHOT_WINDOW_DAYS).toBe(30);
  });

  it('lee solo lo del tenant pedido', async () => {
    const { store, recorded } = fakeStore();

    await runLearningSnapshot({ tenantId: 'tenant-9', now: NOW }, store);

    expect(recorded.feedback[0]?.tenantId).toBe('tenant-9');
    expect(recorded.incidents[0]?.tenantId).toBe('tenant-9');
    expect(recorded.topology).toEqual(['tenant-9']);
  });

  it('sin tenantId congela todos los tenants', async () => {
    const { store, recorded } = fakeStore();
    recorded.tenants.push('tenant-2');

    const outcomes = await runLearningSnapshot({ now: NOW }, store);

    expect(outcomes.map((o) => o.tenantId)).toEqual(['tenant-1', 'tenant-2']);
    expect(recorded.artifacts).toHaveLength(2);
  });

  it('volver a congelar el mismo dataset no crea un artefacto nuevo', async () => {
    const { store, recorded } = fakeStore();

    const primero = await runLearningSnapshot({ now: NOW }, store);
    recorded.existingHashes.add(primero[0]!.snapshotHash);
    const segundo = await runLearningSnapshot({ now: NOW }, store);

    expect(segundo[0]?.snapshotHash).toBe(primero[0]?.snapshotHash);
    expect(segundo[0]?.created).toBe(false);
  });

  it('el contenido congelado viaja en el artefacto', async () => {
    const { store, recorded } = fakeStore({
      readFeedback: async () => [
        {
          tenantId: 'tenant-1',
          versionId: 'v_1',
          feedbackId: 'f_1',
          authorUserId: 'u_1',
          label: 'confirmed',
          submittedAt: '2026-10-20T10:00:00.000Z',
        },
      ],
    });

    await runLearningSnapshot({ now: NOW }, store);

    const payload = recorded.artifacts[0]?.payload as {
      counts?: { labelled?: number; confirmed?: number };
      labels?: unknown[];
    };
    expect(payload.counts?.labelled).toBe(1);
    expect(payload.counts?.confirmed).toBe(1);
    expect(payload.labels).toHaveLength(1);
  });

  it('sin tenants no inventa nada', async () => {
    const { store, recorded } = fakeStore();
    recorded.tenants.length = 0;

    const outcomes = await runLearningSnapshot({ now: NOW }, store);

    expect(outcomes).toEqual([]);
    expect(recorded.artifacts).toHaveLength(0);
  });
});
