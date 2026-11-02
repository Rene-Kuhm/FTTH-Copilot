/**
 * T0.3 — Agrupación en eventos y split temporal (decisión D9 del learning loop).
 *
 * D9, textual: *Train = antes de `T`, eval = después de `T`. Dentro de cada
 * lado, los incidentes que comparten ancestro en `TopologyEdge` (vigente en
 * `observedAt`) en una ventana de 2 h se agrupan como un evento y nunca
 * quedan partidos entre train y eval. Nunca split aleatorio.*
 *
 * Dos aclaraciones que el tablero deja abiertas y este módulo fija:
 *
 * 1. **El agrupamiento es global y el corte es posterior.** Se agrupan
 *    primero todos los incidentes y después se parte. Si se agrupara por
 *    lado, dos incidentes del mismo evento podrían caer en lados distintos
 *    sin que nadie lo notara.
 * 2. **Un evento que cruza el corte va a `train`.** Así el conjunto de
 *    evaluación es *estrictamente* posterior a `T`: ningún incidente
 *    anterior al corte puede EVALuar algo que el modelo ya vio.
 */
import { createHash } from 'node:crypto';

import { LearningInputError } from './errors';
import type {
  LearningEvent,
  LearningIncident,
  LearningTopologyEdge,
  TemporalSplit,
} from './types';

/** Ventana por defecto de agrupación: 2 horas (decisión D9). */
export const DEFAULT_EVENT_WINDOW_MS = 2 * 60 * 60 * 1000;

/** Incidente validado, con su instante en epoch para comparar. */
interface IndexedIncident {
  readonly index: number;
  readonly incident: LearningIncident;
  readonly observedAtMs: number;
}

/** Arista validada, con su vigencia en epoch. */
interface IndexedEdge {
  readonly parentKey: string;
  readonly childKey: string;
  readonly validFromMs: number;
  readonly validToMs: number | null;
}

/** Clave de nodo: tipo e id. El tenant se antepone al usar la clave. */
function nodeKey(kind: string, id: string): string {
  return `${kind}${id}`;
}

function validateIncident(incident: LearningIncident, index: number): number {
  if (!incident.tenantId || !incident.incidentId || !incident.nodeKind || !incident.nodeId) {
    throw new LearningInputError(
      `incidente inválido en la posición ${index}: falta tenantId, incidentId, nodeKind o nodeId`,
    );
  }
  const observedAtMs = Date.parse(incident.observedAt);
  if (!Number.isFinite(observedAtMs)) {
    throw new LearningInputError(
      `incidente ${incident.incidentId}: observedAt inválida (${incident.observedAt})`,
    );
  }
  return observedAtMs;
}

function indexEdges(topology: readonly LearningTopologyEdge[]): Map<string, IndexedEdge[]> {
  const byTenant = new Map<string, IndexedEdge[]>();
  for (const edge of topology) {
    if (!edge.tenantId || !edge.parentKind || !edge.parentId || !edge.childKind || !edge.childId) {
      throw new LearningInputError('arista topológica inválida: falta tenantId o un extremo');
    }
    const validFromMs = Date.parse(edge.validFrom);
    if (!Number.isFinite(validFromMs)) {
      throw new LearningInputError(
        `arista ${edge.parentId}->${edge.childId}: validFrom inválida (${edge.validFrom})`,
      );
    }
    const validToMs = edge.validTo == null ? null : Date.parse(edge.validTo);
    if (edge.validTo != null && !Number.isFinite(validToMs as number)) {
      throw new LearningInputError(
        `arista ${edge.parentId}->${edge.childId}: validTo inválida (${edge.validTo})`,
      );
    }

    const list = byTenant.get(edge.tenantId) ?? [];
    list.push({
      parentKey: nodeKey(edge.parentKind, edge.parentId),
      childKey: nodeKey(edge.childKind, edge.childId),
      validFromMs,
      validToMs,
    });
    byTenant.set(edge.tenantId, list);
  }
  return byTenant;
}

/** ¿La arista estaba vigente en ese instante? */
function isEdgeValidAt(edge: IndexedEdge, atMs: number): boolean {
  if (atMs < edge.validFromMs) return false;
  if (edge.validToMs !== null && atMs >= edge.validToMs) return false;
  return true;
}

/**
 * Ancestros del nodo en ese instante: el nodo mismo y todos los padres
 * alcanzables por aristas vigentes. La topología es temporal, así que el
 * mismo nodo puede tener ancestros distintos en instantes distintos.
 */
function ancestorsAt(
  startKey: string,
  edges: readonly IndexedEdge[],
  atMs: number,
): Set<string> {
  const ancestors = new Set<string>([startKey]);
  const pending = [startKey];
  while (pending.length > 0) {
    const current = pending.shift() as string;
    for (const edge of edges) {
      if (edge.childKey !== current) continue;
      if (!isEdgeValidAt(edge, atMs)) continue;
      if (ancestors.has(edge.parentKey)) continue;
      ancestors.add(edge.parentKey);
      pending.push(edge.parentKey);
    }
  }
  return ancestors;
}

/** Id determinista del evento: mismos incidentes ⇒ mismo id (invariante I8). */
function buildEventId(tenantId: string, incidentIds: readonly string[]): string {
  const payload = `${tenantId}|${incidentIds.join(',')}`;
  return `e_${createHash('sha256').update(payload).digest('hex').slice(0, 16)}`;
}

/**
 * Agrupa los incidentes en eventos.
 *
 * Dos incidentes quedan en el mismo evento si comparten un ancestro
 * topológico (válido en el instante en que se observaron) y caen dentro de
 * la ventana. La agrupación es transitiva: si A une con B y B une con C,
 * los tres son un evento.
 *
 * Nunca agrupa incidentes de tenants distintos, aunque compartan ids de
 * nodo.
 */
export function groupIntoEvents(
  incidents: readonly LearningIncident[],
  topology: readonly LearningTopologyEdge[],
  windowMs: number = DEFAULT_EVENT_WINDOW_MS,
): LearningEvent[] {
  if (!Number.isFinite(windowMs) || windowMs < 0) {
    throw new LearningInputError(`ventana inválida: ${windowMs}`);
  }

  const rows: IndexedIncident[] = incidents.map((incident, index) => ({
    index,
    incident,
    observedAtMs: validateIncident(incident, index),
  }));

  const edgesByTenant = indexEdges(topology);

  // Union-find sobre los índices de los incidentes.
  const parent = new Int32Array(rows.length);
  for (let i = 0; i < rows.length; i += 1) parent[i] = i;

  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== root) {
      const next = parent[x];
      parent[x] = root;
      x = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    // Se une por el índice menor: el resultado no depende del orden de
    // recorrido.
    if (rootA < rootB) parent[rootB] = rootA;
    else parent[rootA] = rootB;
  };

  // Un incidente entra en el cubo de cada uno de sus ancestros.
  const buckets = new Map<string, number[]>();
  for (const row of rows) {
    const tenantId = row.incident.tenantId;
    const edges = edgesByTenant.get(tenantId) ?? [];
    const ancestors = ancestorsAt(
      nodeKey(row.incident.nodeKind, row.incident.nodeId),
      edges,
      row.observedAtMs,
    );
    for (const ancestor of ancestors) {
      // El tenant va en la clave: dos tenants pueden usar el mismo id de nodo.
      const key = `${tenantId}${ancestor}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(row.index);
      else buckets.set(key, [row.index]);
    }
  }

  // Dentro de cada cubo, en orden temporal, se unen los vecinos que entran
  // en la ventana. Encadenar vecinos es equivalente a unir todos los pares
  // dentro de la ventana.
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => rows[a]!.observedAtMs - rows[b]!.observedAtMs || a - b);
    for (let i = 1; i < bucket.length; i += 1) {
      const gap = rows[bucket[i]!]!.observedAtMs - rows[bucket[i - 1]!]!.observedAtMs;
      if (gap <= windowMs) union(bucket[i - 1]!, bucket[i]!);
    }
  }

  const components = new Map<number, number[]>();
  for (let i = 0; i < rows.length; i += 1) {
    const root = find(i);
    const component = components.get(root);
    if (component) component.push(i);
    else components.set(root, [i]);
  }

  const events: LearningEvent[] = [];
  for (const component of components.values()) {
    const ordered = [...component].sort((a, b) => a - b);
    const incidentIds = ordered.map((i) => rows[i]!.incident.incidentId).sort();
    const observedAtMs = ordered.map((i) => rows[i]!.observedAtMs);
    const tenantId = rows[ordered[0]!]!.incident.tenantId;

    events.push({
      tenantId,
      eventId: buildEventId(tenantId, incidentIds),
      incidentIds,
      startedAt: new Date(Math.min(...observedAtMs)).toISOString(),
      endedAt: new Date(Math.max(...observedAtMs)).toISOString(),
    });
  }

  // Orden estable: por tenant y por inicio.
  return events.sort((a, b) => {
    if (a.tenantId !== b.tenantId) return a.tenantId < b.tenantId ? -1 : 1;
    if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? -1 : 1;
    return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
  });
}

/**
 * Parte los eventos alrededor del corte `T`.
 *
 * - `train`: lo que termina en `T` o antes, **más** lo que cruza el corte.
 * - `eval`: lo que empieza estrictamente después de `T`.
 * - `crossing`: el subconjunto de `train` que cruza el corte.
 *
 * Mandar el evento que cruza a `train` es lo que garantiza que `eval` sea
 * estrictamente posterior a `T`: si fuera a `eval`, la evaluación mediría
 * sobre incidentes que el modelo ya vio.
 */
export function temporalSplit(
  events: readonly LearningEvent[],
  cutoff: string,
): TemporalSplit {
  const cutoffMs = Date.parse(cutoff);
  if (!Number.isFinite(cutoffMs)) {
    throw new LearningInputError(`corte inválido: ${cutoff}`);
  }

  const train: LearningEvent[] = [];
  const evalEvents: LearningEvent[] = [];
  const crossing: LearningEvent[] = [];

  for (const event of events) {
    const startedAtMs = Date.parse(event.startedAt);
    const endedAtMs = Date.parse(event.endedAt);

    if (startedAtMs > cutoffMs) {
      evalEvents.push(event);
      continue;
    }
    if (endedAtMs > cutoffMs) crossing.push(event);
    train.push(event);
  }

  return { train, eval: evalEvents, crossing };
}
