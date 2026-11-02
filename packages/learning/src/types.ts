/**
 * Contratos de datos del núcleo del learning loop (Fase 0).
 *
 * Son **tipos**, no comportamiento: el comportamiento vive en `labels.ts`
 * (T0.2), `events.ts` (T0.3) y `sufficiency.ts` (T0.4). Cada función del
 * paquete es pura: recibe el tiempo como parámetro, no lee el reloj, no
 * toca la base ni la red (AGENTS.md §4).
 *
 * Los tipos que también existen en otro paquete **no** se redefinen acá:
 * las etiquetas de feedback y el umbral de muestra son canónicos en
 * `@ftth-copilot/shared` (`shared/src/learning.ts`).
 */
import type { FeedbackLabel, ResolvedLabel } from '@ftth-copilot/shared';

export type { FeedbackLabel, ResolvedLabel };

// ── Feedback (T0.2) ─────────────────────────────────────────────────────────

/**
 * Fila de feedback tal como la guarda la base: una opinión de un técnico
 * sobre una versión de investigación.
 *
 * `label` es `string` y no `FeedbackLabel` a propósito: la columna es de
 * texto libre en la base y puede traer un valor fuera del juego cerrado.
 * `resolveLabels` lo detecta y lo cuenta como fila descartada en vez de
 * adivinar.
 */
export interface LearningFeedbackRow {
  readonly tenantId: string;
  readonly versionId: string;
  readonly feedbackId: string;
  readonly authorUserId: string;
  readonly label: string;
  /** ISO 8601. Es la marca de tiempo que ordena las opiniones de un autor. */
  readonly submittedAt: string;
}

/** Etiqueta ya resuelta para un `(tenantId, versionId)`. */
export interface ResolvedLabelEntry {
  readonly tenantId: string;
  readonly versionId: string;
  /** `conflicted` cuando los técnicos no coinciden (decisión D1). */
  readonly label: ResolvedLabel;
  /** Cuántos autores distintos participaron en la resolución. */
  readonly authorCount: number;
  /** Marca de tiempo de la opinión que se conservó (la más reciente). */
  readonly latestSubmittedAt: string;
  /** Ids de las filas conservadas, una por autor, en orden estable. */
  readonly feedbackIds: readonly string[];
}

/** Conteos por etiqueta resuelta. */
export interface LabelCounts {
  readonly confirmed: number;
  readonly incorrect: number;
  readonly insufficientData: number;
  readonly conflicted: number;
}

/** Filas que se descartaron, con el motivo. */
export interface DiscardedRows {
  /** Etiqueta fuera del juego cerrado: no se puede adivinar qué quiso decir. */
  readonly invalidLabel: number;
  /** La fila apunta a una versión que el llamador no conoce. */
  readonly orphanVersion: number;
}

/** Resultado de resolver las etiquetas de un conjunto de filas. */
export interface LabelResolution {
  /** Una entrada por `(tenantId, versionId)`, ordenada de forma estable. */
  readonly entries: readonly ResolvedLabelEntry[];
  readonly counts: LabelCounts;
  readonly discarded: DiscardedRows;
}

/**
 * Reparto de las entradas resueltas según para qué se usan (decisión D1):
 * `insufficient_data` nunca es positiva ni negativa — alimenta el corpus de
 * abstención (invariante I7).
 */
export interface TrainingPartition {
  readonly positives: readonly ResolvedLabelEntry[];
  readonly negatives: readonly ResolvedLabelEntry[];
  /** Abstenciones correctas: alimentan el corpus de I7, no el entrenamiento. */
  readonly abstentions: readonly ResolvedLabelEntry[];
  /** Conflictos: quedan fuera de todo y se cuentan aparte. */
  readonly conflicted: readonly ResolvedLabelEntry[];
}

// ── Eventos y split temporal (T0.3) ─────────────────────────────────────────

/**
 * Incidente con el nodo de red donde se observó. El nodo es lo que se
 * correlaciona con la topología temporal.
 */
export interface LearningIncident {
  readonly tenantId: string;
  readonly incidentId: string;
  /** Tipo de nodo (`onu`, `olt`, `splitter`, ...). */
  readonly nodeKind: string;
  /** Identificador del nodo. */
  readonly nodeId: string;
  /** ISO 8601. */
  readonly observedAt: string;
}

/**
 * Arista topológica temporal: `child` cuelga de `parent` en el intervalo
 * `[validFrom, validTo)`. Espejo del modelo `TopologyEdge`.
 */
export interface LearningTopologyEdge {
  readonly parentKind: string;
  readonly parentId: string;
  readonly childKind: string;
  readonly childId: string;
  readonly validFrom: string;
  /** `null` o ausente = la arista sigue vigente. */
  readonly validTo?: string | null;
}

/**
 * Evento: un grupo de incidentes que comparten ancestro topológico y caen
 * dentro de la misma ventana temporal. Un evento nunca se parte entre
 * train y eval (decisión D9).
 */
export interface LearningEvent {
  readonly tenantId: string;
  /** Identificador determinista: mismos incidentes ⇒ mismo id. */
  readonly eventId: string;
  /** Incidentes del evento, ordenados de forma estable. */
  readonly incidentIds: readonly string[];
  /** ISO 8601 del incidente más temprano. */
  readonly startedAt: string;
  /** ISO 8601 del incidente más tardío. */
  readonly endedAt: string;
}

/** Reparto temporal de los eventos alrededor del corte `T`. */
export interface TemporalSplit {
  /** Eventos anteriores al corte, más los que lo cruzan. */
  readonly train: readonly LearningEvent[];
  /** Eventos estrictamente posteriores al corte. */
  readonly eval: readonly LearningEvent[];
  /** Subconjunto de `train`: los eventos que cruzan el corte. */
  readonly crossing: readonly LearningEvent[];
}

// ── Suficiencia (T0.4) ─────────────────────────────────────────────────────

/** Estado de una métrica frente a su muestra mínima. */
export type SufficiencyStatus = 'sufficient' | 'insufficient';

/**
 * Resultado de una métrica evaluada contra su muestra mínima (invariante
 * I10). Cuando `status` es `insufficient`, `value` es `null`: nunca un
 * número inventado.
 */
export interface SufficiencyResult<T> {
  readonly status: SufficiencyStatus;
  readonly value: T | null;
  /** Tamaño de la muestra que se evaluó. */
  readonly sampleSize: number;
  /** Umbral contra el que se comparó. */
  readonly minSampleSize: number;
}

/** Una métrica nombrada con su tamaño de muestra. */
export interface MetricSample {
  readonly name: string;
  readonly sampleSize: number;
}

/** Estado de una métrica nombrada dentro de un reporte. */
export interface MetricSufficiency {
  readonly name: string;
  readonly status: SufficiencyStatus;
  readonly sampleSize: number;
  readonly minSampleSize: number;
}

/** Reporte de suficiencia de un conjunto de métricas. */
export interface SufficiencyReport {
  readonly minSampleSize: number;
  readonly metrics: readonly MetricSufficiency[];
  /** `true` solo si **todas** las métricas tienen muestra suficiente. */
  readonly isCalibrated: boolean;
}
