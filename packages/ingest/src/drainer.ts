import type { DurableSpool, SpoolEntry } from './spool';
import { classifyWriteError, errorMessage as describeError } from './errors';

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

      // Un error pasajero no manda nada al dead-letter: los eventos se quedan
      // en disco y se reintentan. Una caída del store tiene que ser un
      // retraso, no una pérdida.
      if (classifyWriteError(err) === 'transient') {
        this.scheduleBackoff();
        this.onBatchFailed?.(err, entries.length);
        return {
          drained: 0,
          failed: entries.length,
          quarantined: 0,
          deferred: false,
        };
      }

      // El lote falló por algo permanente: uno de los eventos no puede
      // guardarse nunca. Se reintenta evento por evento para que ese evento no
      // bloquee a los que están detrás.
      return this.retryOneByOne(entries.length);
    } finally {
      this.draining = false;
    }
  }

  /**
   * Reintenta evento por evento un lote que falló por un motivo permanente.
   *
   * El caso real: un evento con una foreign key inválida hace fallar el lote
   * entero. Sin esto, ese evento queda primero en la cola y **todos** los
   * posteriores fallan con él, incluidos los de remitentes sanos.
   *
   * Cada evento se lee solo, se escribe solo y se comitea solo:
   *
   *   - se guardó → cuenta como drenado;
   *   - falló por algo permanente → va al dead-letter con la razón, y se sigue
   *     con el próximo;
   *   - falló por algo pasajero → se corta acá y el resto queda en disco,
   *     porque el store dejó de estar disponible.
   */
  private async retryOneByOne(remaining: number): Promise<DrainResult> {
    let drained = 0;
    let quarantined = 0;
    let failed = 0;

    for (let i = 0; i < remaining; i++) {
      const { entries, nextOffset } = this.spool.readBatch(1);
      if (entries.length === 0) break;
      const entry = entries[0]!;

      try {
        await this.write([entry]);
        this.spool.commit(nextOffset, 1);
        drained += 1;
      } catch (err) {
        if (classifyWriteError(err) === 'transient') {
          // El store volvió a caerse: el resto queda en disco.
          failed += 1;
          this.scheduleBackoff();
          this.onBatchFailed?.(err, 1);
          break;
        }

        this.spool.deadLetter(entry, describeError(err));
        this.spool.commit(nextOffset, 1);
        quarantined += 1;
        this.onQuarantined?.(1);
      }
    }

    if (failed === 0) {
      // El lote quedó resuelto: todo se guardó o fue al dead-letter por un
      // motivo permanente. No queda nada que reintentar.
      this.consecutiveFailures = 0;
      this.nextAttemptAt = 0;
    }

    return { drained, failed, quarantined, deferred: failed > 0 };
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
