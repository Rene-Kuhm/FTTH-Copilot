/**
 * The persistence shell of the learning snapshot (task T0.5).
 *
 * The worker is the shell: it reads the rows of a tenant, hands them to the
 * pure core of `@ftth-copilot/learning` and stores the frozen artifact. The
 * hash is computed by the pure core, so two runs over the same data always
 * agree — and a different dataset always gets a different hash.
 *
 * The snapshot is **append-only**: freezing means storing, not rewriting.
 * Storing the same dataset twice does not create a second row, and a
 * different dataset coexists with the previous one.
 *
 * The store is injected, so the shell can be tested without a database.
 */
import { Prisma, prisma } from '@ftth-copilot/db';
import {
  LEARNING_CODE_VERSION,
  buildLearningSnapshot,
  type LearningFeedbackRow,
  type LearningIncident,
  type LearningSnapshot,
  type LearningTopologyEdge,
} from '@ftth-copilot/learning';

/** How far back the frozen dataset reaches, in days. */
export const DEFAULT_SNAPSHOT_WINDOW_DAYS = 30;

/** The temporal window of a snapshot, with the cut `T` of the split. */
export interface LearningSnapshotWindow {
  readonly start: Date;
  readonly end: Date;
  /**
   * Cut `T` of the temporal split: the middle of the window.
   *
   * It is derived from the window and not from the clock, so the same window
   * always produces the same split — and the cut travels in the hash.
   */
  readonly cutoff: Date;
}

/** The artifact to store. */
export interface LearningArtifactDraft {
  readonly tenantId: string;
  readonly kind: 'snapshot';
  readonly snapshotHash: string;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly codeVersion: string;
  readonly payload: Prisma.InputJsonValue;
}

/**
 * Where the shell reads from and writes to.
 *
 * Every method is tenant-scoped: the shell never reads a row of a tenant it
 * was not asked about (invariant I3).
 */
export interface LearningSnapshotStore {
  listTenants(): Promise<readonly string[]>;
  readFeedback(
    tenantId: string,
    window: LearningSnapshotWindow,
  ): Promise<readonly LearningFeedbackRow[]>;
  readIncidents(
    tenantId: string,
    window: LearningSnapshotWindow,
  ): Promise<readonly LearningIncident[]>;
  readTopology(tenantId: string): Promise<readonly LearningTopologyEdge[]>;
  /** Stores the artifact. Returns `true` if it was new. */
  writeArtifact(artifact: LearningArtifactDraft): Promise<boolean>;
}

/** What the shell did for one tenant. */
export interface LearningSnapshotOutcome {
  readonly tenantId: string;
  readonly snapshotHash: string;
  /** `false` when the very same dataset was already frozen. */
  readonly created: boolean;
  readonly counts: LearningSnapshot['counts'];
}

/** What the job asks for. */
export interface LearningSnapshotRequest {
  /** Tenant to freeze. Without it, every tenant is frozen. */
  readonly tenantId?: string;
  /** How far back the dataset reaches. Defaults to 30 days. */
  readonly windowDays?: number;
  /** "Now". Defaults to the current clock. */
  readonly now?: Date;
}

/** Builds the window of the snapshot around `now`. */
export function buildSnapshotWindow(
  now: Date,
  windowDays: number = DEFAULT_SNAPSHOT_WINDOW_DAYS,
): LearningSnapshotWindow {
  const end = new Date(now.getTime());
  const start = new Date(end.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const cutoff = new Date(start.getTime() + (end.getTime() - start.getTime()) / 2);
  return { start, end, cutoff };
}

/** The frozen content, as a plain object the database can store. */
function snapshotPayload(snapshot: LearningSnapshot): Prisma.InputJsonObject {
  return {
    tenantId: snapshot.tenantId,
    windowStart: snapshot.windowStart,
    windowEnd: snapshot.windowEnd,
    codeVersion: snapshot.codeVersion,
    cutoff: snapshot.cutoff,
    counts: {
      events: snapshot.counts.events,
      labelled: snapshot.counts.labelled,
      confirmed: snapshot.counts.confirmed,
      incorrect: snapshot.counts.incorrect,
      insufficientData: snapshot.counts.insufficientData,
      conflicted: snapshot.counts.conflicted,
      discarded: snapshot.counts.discarded,
      train: snapshot.counts.train,
      eval: snapshot.counts.eval,
      crossing: snapshot.counts.crossing,
    },
    labels: snapshot.labels.entries.map((entry) => ({
      tenantId: entry.tenantId,
      versionId: entry.versionId,
      label: entry.label,
      authorCount: entry.authorCount,
      feedbackIds: entry.feedbackIds,
    })),
    events: snapshot.events.map((event) => ({
      eventId: event.eventId,
      incidentIds: event.incidentIds,
      startedAt: event.startedAt,
      endedAt: event.endedAt,
    })),
    split: {
      train: snapshot.split.train.map((event) => event.eventId),
      eval: snapshot.split.eval.map((event) => event.eventId),
      crossing: snapshot.split.crossing.map((event) => event.eventId),
    },
  };
}

/**
 * Freezes the dataset of one tenant (or of every tenant) and stores it.
 *
 * The pure core does the work: the shell only moves data.
 */
export async function runLearningSnapshot(
  request: LearningSnapshotRequest = {},
  store: LearningSnapshotStore = prismaLearningSnapshotStore,
): Promise<readonly LearningSnapshotOutcome[]> {
  const now = request.now ?? new Date();
  const window = buildSnapshotWindow(now, request.windowDays);
  const tenants = request.tenantId ? [request.tenantId] : await store.listTenants();

  const outcomes: LearningSnapshotOutcome[] = [];
  for (const tenantId of tenants) {
    const [feedbackRows, incidents, topology] = await Promise.all([
      store.readFeedback(tenantId, window),
      store.readIncidents(tenantId, window),
      store.readTopology(tenantId),
    ]);

    const snapshot = buildLearningSnapshot({
      tenantId,
      windowStart: window.start.toISOString(),
      windowEnd: window.end.toISOString(),
      codeVersion: LEARNING_CODE_VERSION,
      cutoff: window.cutoff.toISOString(),
      feedbackRows,
      incidents,
      topology,
    });

    const created = await store.writeArtifact({
      tenantId,
      kind: 'snapshot',
      snapshotHash: snapshot.snapshotHash,
      windowStart: window.start,
      windowEnd: window.end,
      codeVersion: LEARNING_CODE_VERSION,
      payload: snapshotPayload(snapshot),
    });

    outcomes.push({
      tenantId,
      snapshotHash: snapshot.snapshotHash,
      created,
      counts: snapshot.counts,
    });
  }

  return outcomes;
}

/**
 * The store backed by Postgres.
 *
 * `createMany` with `skipDuplicates` is what makes freezing idempotent: two
 * workers that freeze the same dataset at the same time produce the same
 * hash, and the database keeps one row instead of racing.
 */
export const prismaLearningSnapshotStore: LearningSnapshotStore = {
  async listTenants(): Promise<readonly string[]> {
    const tenants = await prisma.tenant.findMany({ select: { id: true } });
    return tenants.map((tenant) => tenant.id);
  },

  async readFeedback(
    tenantId: string,
    window: LearningSnapshotWindow,
  ): Promise<readonly LearningFeedbackRow[]> {
    const rows = await prisma.investigationFeedback.findMany({
      where: { tenantId, submittedAt: { gte: window.start, lte: window.end } },
      orderBy: { submittedAt: 'asc' },
    });
    return rows.map((row) => ({
      tenantId: row.tenantId,
      versionId: row.versionId,
      feedbackId: row.feedbackId,
      authorUserId: row.authorUserId,
      label: row.label,
      submittedAt: row.submittedAt.toISOString(),
    }));
  },

  async readIncidents(
    tenantId: string,
    window: LearningSnapshotWindow,
  ): Promise<readonly LearningIncident[]> {
    const rows = await prisma.incident.findMany({
      where: { tenantId, lastSeenAt: { gte: window.start, lte: window.end } },
      orderBy: { lastSeenAt: 'asc' },
    });
    return rows.map((row) => ({
      tenantId: row.tenantId,
      incidentId: row.id,
      // `Incident.deviceKind` (OLT | ONU) es un subconjunto de los tipos de
      // nodo de la topología, así que el mismo id correlelaciona.
      nodeKind: row.deviceKind,
      nodeId: row.deviceId,
      observedAt: row.lastSeenAt.toISOString(),
    }));
  },

  async readTopology(tenantId: string): Promise<readonly LearningTopologyEdge[]> {
    const rows = await prisma.topologyEdge.findMany({ where: { tenantId } });
    return rows.map((row) => ({
      tenantId: row.tenantId,
      parentKind: row.parentKind,
      parentId: row.parentId,
      childKind: row.childKind,
      childId: row.childId,
      validFrom: row.validFrom.toISOString(),
      validTo: row.validTo?.toISOString() ?? null,
    }));
  },

  async writeArtifact(artifact: LearningArtifactDraft): Promise<boolean> {
    const result = await prisma.learningArtifact.createMany({
      data: [
        {
          tenantId: artifact.tenantId,
          kind: artifact.kind,
          snapshotHash: artifact.snapshotHash,
          windowStart: artifact.windowStart,
          windowEnd: artifact.windowEnd,
          codeVersion: artifact.codeVersion,
          payload: artifact.payload,
        },
      ],
      skipDuplicates: true,
    });
    return result.count > 0;
  },
};
