import type { DurableSpool, SpoolEntry } from './event-spool';

/**
 * Drains the durable spool into Postgres in batches.
 *
 * Responsibilities kept here: batch size, retry with backoff, and quarantining
 * entries that keep failing. Persistence is injected so the drainer can be
 * tested without a database.
 */

/** Stores one batch. Must be idempotent; the spool ids make it so. */
export type BatchWriter<T> = (entries: SpoolEntry<T>[]) => Promise<void>;

export interface EventDrainerOptions<T> {
  spool: DurableSpool<T>;
  write: BatchWriter<T>;
  /** Entries per insert. Larger batches amortise the round trip. */
  batchSize?: number;
  /** Consecutive failed batches tolerated before quarantining the batch. */
  maxConsecutiveFailures?: number;
  /** Backoff steps in ms, indexed by consecutive failure count. */
  backoffMs?: number[];
  pollMs?: number;
  onBatchDrained?: (count: number) => void;
  onBatchFailed?: (error: unknown, count: number) => void;
  onQuarantined?: (count: number) => void;
}

export interface DrainResult {
  drained: number;
  failed: number;
  quarantined: number;
  /** True when backoff says to hold off, so callers can skip the attempt. */
  deferred: boolean;
}

const DEFAULT_BACKOFF_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

export class EventDrainer<T> {
  private readonly spool: DurableSpool<T>;
  private readonly write: BatchWriter<T>;
  private readonly batchSize: number;
  private readonly maxConsecutiveFailures: number;
  private readonly backoffMs: number[];
  private readonly pollMs: number;

  private timer: ReturnType<typeof setInterval> | null = null;
  /** Guards against a slow batch overlapping the next tick. */
  private draining = false;
  private consecutiveFailures = 0;
  private nextAttemptAt = 0;

  private readonly onBatchDrained?: (count: number) => void;
  private readonly onBatchFailed?: (error: unknown, count: number) => void;
  private readonly onQuarantined?: (count: number) => void;

  constructor(options: EventDrainerOptions<T>) {
    this.spool = options.spool;
    this.write = options.write;
    this.batchSize = options.batchSize ?? 250;
    this.maxConsecutiveFailures = options.maxConsecutiveFailures ?? 10;
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.pollMs = options.pollMs ?? 1_000;

    this.onBatchDrained = options.onBatchDrained;
    this.onBatchFailed = options.onBatchFailed;
    this.onQuarantined = options.onQuarantined;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.drainOnce();
    }, this.pollMs);
    // Do not hold the process open purely to drain.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Drain at most one batch.
   *
   * The offset advances only after the batch is durably stored, so a crash in
   * between re-reads the batch and the unique ingest id absorbs the duplicate.
   */
  async drainOnce(now = Date.now()): Promise<DrainResult> {
    if (this.draining) return { drained: 0, failed: 0, quarantined: 0, deferred: true };
    if (now < this.nextAttemptAt) {
      return { drained: 0, failed: 0, quarantined: 0, deferred: true };
    }

    const { entries, nextOffset } = this.spool.readBatch(this.batchSize);
    if (entries.length === 0) return { drained: 0, failed: 0, quarantined: 0, deferred: false };

    this.draining = true;
    try {
      await this.write(entries);
      this.spool.commit(nextOffset, entries.length);
      this.consecutiveFailures = 0;
      this.onBatchDrained?.(entries.length);
      return {
        drained: entries.length,
        failed: 0,
        quarantined: 0,
        deferred: false,
      };
    } catch (err) {
      this.consecutiveFailures++;

      // Past the threshold the batch cannot be stored. Quarantine it rather
      // than blocking the queue forever; the dead-letter file keeps the data
      // so an operator can replay it once the database is healthy.
      if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
        for (const entry of entries) {
          this.spool.deadLetter(entry, errorMessage(err));
        }
        this.spool.commit(nextOffset, entries.length);
        this.consecutiveFailures = 0;
        this.nextAttemptAt = 0;
        this.onQuarantined?.(entries.length);
        return {
          drained: 0,
          failed: 0,
          quarantined: entries.length,
          deferred: false,
        };
      }

      this.scheduleBackoff();
      this.onBatchFailed?.(err, entries.length);
      return {
        drained: 0,
        failed: entries.length,
        quarantined: 0,
        deferred: false,
      };
    } finally {
      this.draining = false;
    }
  }

  stats(): { consecutiveFailures: number; draining: boolean } {
    return {
      consecutiveFailures: this.consecutiveFailures,
      draining: this.draining,
    };
  }

  private scheduleBackoff(): void {
    const index = Math.min(this.consecutiveFailures - 1, this.backoffMs.length - 1);
    this.nextAttemptAt = Date.now() + (this.backoffMs[index] ?? 30_000);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}