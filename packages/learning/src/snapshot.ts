/**
 * T0.5 — El snapshot del learning loop (parte pura).
 *
 * El job `learning.snapshot` congela el dataset de un tenant. Congelar es
 * exactamente esto: un **hash de contenido**. Mismo contenido, misma ventana
 * y misma versión de código ⇒ mismo hash. Si el dataset cambió, el hash
 * cambió, y se sabe.
 *
 * Esta parte es pura: recibe las filas ya cargadas y devuelve el snapshot.
 * Quien lee de la base y quien lo persiste son el shell (el worker); aquí no
 * hay I/O.
 *
 * El snapshot es **de un solo tenant**: las filas de otro tenant se filtran
 * antes de calcular nada. Un snapshot de `tenant-1` no puede contener datos
 * de `tenant-2` (invariante I3).
 */
import { createHash } from 'node:crypto';

import { DEFAULT_EVENT_WINDOW_MS, groupIntoEvents, temporalSplit } from './events';
import { resolveLabels } from './labels';
import type {
  LabelResolution,
  LearningEvent,
  LearningFeedbackRow,
  LearningIncident,
  LearningTopologyEdge,
  TemporalSplit,
} from './types';

/** Entrada del snapshot: las filas ya cargadas por el shell de persistencia. */
export interface LearningSnapshotInput {
  readonly tenantId: string;
  /** Inicio de la ventana temporal cubierta (ISO 8601). */
  readonly windowStart: string;
  /** Fin de la ventana temporal cubierta (ISO 8601). */
  readonly windowEnd: string;
  /** Versión del código que produce el snapshot: entra en el hash. */
  readonly codeVersion: string;
  /** Corte `T` del split temporal (ISO 8601). */
  readonly cutoff: string;
  readonly feedbackRows: readonly LearningFeedbackRow[];
  readonly incidents: readonly LearningIncident[];
  readonly topology: readonly LearningTopologyEdge[];
  /** Ventana de agrupación de eventos. Por defecto, 2 h (decisión D9). */
  readonly eventWindowMs?: number;
}

/** Conteos del snapshot congelado. */
export interface LearningSnapshotCounts {
  readonly events: number;
  /** Versiones con etiqueta resuelta. */
  readonly labelled: number;
  readonly confirmed: number;
  readonly incorrect: number;
  readonly insufficientData: number;
  readonly conflicted: number;
  /** Filas de feedback que no se pudieron usar. */
  readonly discarded: number;
  readonly train: number;
  readonly eval: number;
  readonly crossing: number;
}

/** El dataset congelado. */
export interface LearningSnapshot {
  readonly tenantId: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly codeVersion: string;
  readonly cutoff: string;
  /** Hash del contenido: `s_` + 16 hexadecimales. */
  readonly snapshotHash: string;
  readonly events: readonly LearningEvent[];
  readonly labels: LabelResolution;
  readonly split: TemporalSplit;
  readonly counts: LearningSnapshotCounts;
}

/**
 * Serialización canónica del snapshot.
 *
 * El orden de las claves es el del objeto literal y las listas van ordenadas,
 * así que el mismo contenido produce siempre la misma cadena. El hash sale de
 * ahí: si cambia una línea de esta función, cambia el hash de todos los
 * snapshots — por eso la versión de código entra también en el hash.
 */
function canonicalPayload(snapshot: Omit<LearningSnapshot, 'snapshotHash'>): string {
  return JSON.stringify({
    version: 1,
    tenantId: snapshot.tenantId,
    windowStart: snapshot.windowStart,
    windowEnd: snapshot.windowEnd,
    codeVersion: snapshot.codeVersion,
    cutoff: snapshot.cutoff,
    labels: snapshot.labels.entries.map((entry) => [
      entry.tenantId,
      entry.versionId,
      entry.label,
      entry.authorCount,
      entry.feedbackIds,
    ]),
    events: snapshot.events.map((event) => [
      event.eventId,
      event.incidentIds,
      event.startedAt,
      event.endedAt,
    ]),
    split: {
      train: snapshot.split.train.map((event) => event.eventId),
      eval: snapshot.split.eval.map((event) => event.eventId),
      crossing: snapshot.split.crossing.map((event) => event.eventId),
    },
  });
}

/** Hash del snapshot: `s_` + 16 hexadecimales. */
function hashSnapshot(snapshot: Omit<LearningSnapshot, 'snapshotHash'>): string {
  const digest = createHash('sha256').update(canonicalPayload(snapshot)).digest('hex');
  return `s_${digest.slice(0, 16)}`;
}

/**
 * Congela el dataset de un tenant.
 *
 * Filtra por `tenantId` antes de calcular nada, resuelve las etiquetas
 * (D1), agrupa los incidentes en eventos (D9) y parte por tiempo (D9).
 */
export function buildLearningSnapshot(input: LearningSnapshotInput): LearningSnapshot {
  const feedbackRows = input.feedbackRows.filter((row) => row.tenantId === input.tenantId);
  const incidents = input.incidents.filter((incident) => incident.tenantId === input.tenantId);
  const topology = input.topology.filter((edge) => edge.tenantId === input.tenantId);

  const labels = resolveLabels(feedbackRows);
  const events = groupIntoEvents(
    incidents,
    topology,
    input.eventWindowMs ?? DEFAULT_EVENT_WINDOW_MS,
  );
  const split = temporalSplit(events, input.cutoff);

  const discarded =
    labels.discarded.invalidLabel +
    labels.discarded.orphanVersion +
    labels.discarded.malformed;

  const base: Omit<LearningSnapshot, 'snapshotHash'> = {
    tenantId: input.tenantId,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    codeVersion: input.codeVersion,
    cutoff: input.cutoff,
    events,
    labels,
    split,
    counts: {
      events: events.length,
      labelled: labels.entries.length,
      confirmed: labels.counts.confirmed,
      incorrect: labels.counts.incorrect,
      insufficientData: labels.counts.insufficientData,
      conflicted: labels.counts.conflicted,
      discarded,
      train: split.train.length,
      eval: split.eval.length,
      crossing: split.crossing.length,
    },
  };

  return { ...base, snapshotHash: hashSnapshot(base) };
}
