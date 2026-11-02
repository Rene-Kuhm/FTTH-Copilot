/**
 * T0.2 — Resolución de etiquetas (decisión D1 del learning loop).
 *
 * Por cada `(tenantId, versionId)`:
 *
 * 1. De cada `authorUserId` solo cuenta su opinión más reciente: el
 *    historial se conserva en la tabla, pero un técnico que se arrepiente
 *    corrige su veredicto, no deja dos votos.
 * 2. Si todos los autores coinciden → esa etiqueta.
 * 3. Si discrepan → `conflicted`. Queda fuera del entrenamiento y se cuenta
 *    aparte, porque una tasa alta de conflicto es en sí misma una métrica:
 *    señala diagnósticos ambiguos.
 * 4. `insufficient_data` nunca es positivo ni negativo: es una abstención
 *    correcta y alimenta el corpus de la invariante I7.
 *
 * Se descartó "gana el de mayor rol": convierte la jerarquía del NOC en
 * verdad técnica y esconde el desacuerdo, que es justo lo valioso.
 *
 * Todo es determinista: el mismo conjunto de filas produce el mismo
 * resultado, sin importar el orden de llegada.
 */
import {
  FEEDBACK_LABEL_CONFIRMED,
  FEEDBACK_LABEL_INCORRECT,
  FEEDBACK_LABEL_INSUFFICIENT,
  RESOLVED_LABEL_CONFLICTED,
  isFeedbackLabel,
  type FeedbackLabel,
} from '@ftth-copilot/shared';

import type {
  LabelResolution,
  LearningFeedbackRow,
  ResolvedLabel,
  ResolvedLabelEntry,
  TrainingPartition,
} from './types';

/** Opciones de `resolveLabels`. */
export interface ResolveLabelsOptions {
  /**
   * Versiones que el llamador conoce. Una fila que apunta a otra versión se
   * descarta como huérfana: su diagnóstico ya no existe y no hay nada que
   * verificar.
   */
  readonly knownVersionIds?: ReadonlySet<string>;
}

/** Fila validada: la etiqueta ya es del juego cerrado y la fecha se lee. */
interface NormalizedRow {
  readonly tenantId: string;
  readonly versionId: string;
  readonly feedbackId: string;
  readonly authorUserId: string;
  readonly label: FeedbackLabel;
  readonly submittedAt: string;
  readonly submittedAtMs: number;
}

/** ¿La fila tiene los datos mínimos para usarse? */
function isStructurallySound(row: LearningFeedbackRow): boolean {
  return (
    row.tenantId.length > 0 &&
    row.versionId.length > 0 &&
    row.feedbackId.length > 0 &&
    row.authorUserId.length > 0 &&
    Number.isFinite(Date.parse(row.submittedAt))
  );
}

/**
 * Compara dos filas del mismo autor. La más reciente gana; si empatan en el
 * tiempo, gana la de `feedbackId` mayor. El desempate existe para que dos
 * corridas sobre las mismas filas den el mismo resultado (invariante I8).
 */
function isLaterThan(candidate: NormalizedRow, current: NormalizedRow): boolean {
  if (candidate.submittedAtMs !== current.submittedAtMs) {
    return candidate.submittedAtMs > current.submittedAtMs;
  }
  return candidate.feedbackId > current.feedbackId;
}

/**
 * Resuelve las etiquetas de un conjunto de filas de feedback.
 *
 * No muta la entrada. Las filas que no se pueden usar se descartan y se
 * cuentan por motivo: descartarlas en silencio sería mentir sobre el
 * tamaño real de la muestra.
 */
export function resolveLabels(
  rows: readonly LearningFeedbackRow[],
  options: ResolveLabelsOptions = {},
): LabelResolution {
  const knownVersionIds = options.knownVersionIds;
  const discarded: { invalidLabel: number; orphanVersion: number; malformed: number } = {
    invalidLabel: 0,
    orphanVersion: 0,
    malformed: 0,
  };
  const usable: NormalizedRow[] = [];

  for (const row of rows) {
    if (!isStructurallySound(row)) {
      discarded.malformed += 1;
      continue;
    }
    if (!isFeedbackLabel(row.label)) {
      discarded.invalidLabel += 1;
      continue;
    }
    if (knownVersionIds && !knownVersionIds.has(row.versionId)) {
      discarded.orphanVersion += 1;
      continue;
    }
    usable.push({
      tenantId: row.tenantId,
      versionId: row.versionId,
      feedbackId: row.feedbackId,
      authorUserId: row.authorUserId,
      label: row.label,
      submittedAt: row.submittedAt,
      submittedAtMs: Date.parse(row.submittedAt),
    });
  }

  // Agrupar por (tenantId, versionId) sin concatenar strings: dos tenants
  // distintos pueden compartir versionId sin mezclarse (invariante I3).
  const byTenant = new Map<string, Map<string, NormalizedRow[]>>();
  for (const row of usable) {
    let versions = byTenant.get(row.tenantId);
    if (!versions) {
      versions = new Map<string, NormalizedRow[]>();
      byTenant.set(row.tenantId, versions);
    }
    const group = versions.get(row.versionId);
    if (group) group.push(row);
    else versions.set(row.versionId, [row]);
  }

  const entries: ResolvedLabelEntry[] = [];
  const counts: { confirmed: number; incorrect: number; insufficientData: number; conflicted: number } =
    {
      confirmed: 0,
      incorrect: 0,
      insufficientData: 0,
      conflicted: 0,
    };

  for (const [tenantId, versions] of [...byTenant.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    for (const [versionId, group] of [...versions.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      const entry = resolveGroup(tenantId, versionId, group);
      entries.push(entry);

      switch (entry.label) {
        case FEEDBACK_LABEL_CONFIRMED:
          counts.confirmed += 1;
          break;
        case FEEDBACK_LABEL_INCORRECT:
          counts.incorrect += 1;
          break;
        case FEEDBACK_LABEL_INSUFFICIENT:
          counts.insufficientData += 1;
          break;
        default:
          counts.conflicted += 1;
          break;
      }
    }
  }

  return {
    entries,
    counts,
    discarded,
  };
}

/** Resuelve un `(tenantId, versionId)`: última opinión por autor y consenso. */
function resolveGroup(
  tenantId: string,
  versionId: string,
  group: readonly NormalizedRow[],
): ResolvedLabelEntry {
  // Una sola opinión por autor: la más reciente.
  const latestByAuthor = new Map<string, NormalizedRow>();
  for (const row of group) {
    const current = latestByAuthor.get(row.authorUserId);
    if (!current || isLaterThan(row, current)) {
      latestByAuthor.set(row.authorUserId, row);
    }
  }

  const kept = [...latestByAuthor.values()].sort((a, b) =>
    a.feedbackId < b.feedbackId ? -1 : a.feedbackId > b.feedbackId ? 1 : 0,
  );

  const distinctLabels = new Set<ResolvedLabel>(kept.map((row) => row.label));
  const label: ResolvedLabel =
    distinctLabels.size === 1 ? (kept[0]?.label as ResolvedLabel) : RESOLVED_LABEL_CONFLICTED;

  const latest = [...kept].sort((a, b) => {
    if (a.submittedAtMs !== b.submittedAtMs) return a.submittedAtMs - b.submittedAtMs;
    return a.feedbackId < b.feedbackId ? -1 : a.feedbackId > b.feedbackId ? 1 : 0;
  })[kept.length - 1];

  return {
    tenantId,
    versionId,
    label,
    authorCount: kept.length,
    latestSubmittedAt: latest?.submittedAt ?? '',
    feedbackIds: kept.map((row) => row.feedbackId),
  };
}

/**
 * Reparte las entradas resueltas según para qué se usan.
 *
 * `insufficient_data` nunca es positiva ni negativa: alimenta el corpus de
 * abstención de la invariante I7. `conflicted` no entra en ningún corpus.
 */
export function partitionForTraining(resolution: LabelResolution): TrainingPartition {
  const positives: ResolvedLabelEntry[] = [];
  const negatives: ResolvedLabelEntry[] = [];
  const abstentions: ResolvedLabelEntry[] = [];
  const conflicted: ResolvedLabelEntry[] = [];

  for (const entry of resolution.entries) {
    switch (entry.label) {
      case FEEDBACK_LABEL_CONFIRMED:
        positives.push(entry);
        break;
      case FEEDBACK_LABEL_INCORRECT:
        negatives.push(entry);
        break;
      case FEEDBACK_LABEL_INSUFFICIENT:
        abstentions.push(entry);
        break;
      default:
        conflicted.push(entry);
        break;
    }
  }

  return { positives, negatives, abstentions, conflicted };
}
