import type { DurableSpool, SpoolEntry } from './spool';
import {
  classifyWriteErrorDetailed,
  errorMessage as describeError,
} from './errors';

/**
 * Drains the durable spool into Postgres in batches.
 *
 * Responsibilities kept here: batch size, retry with backoff, and deciding
 * which events go to the dead-letter file. Persistence is injected so the
 * drainer can be tested without a database.
 */

/** Stores one batch. Must be idempotent; the spool ids make it so. */
export type BatchWriter<T> = (entries: SpoolEntry<T>[]) => Promise<void>;

export interface EventDrainerOptions<T> {
  spool: DurableSpool<T>;
  write: BatchWriter<T>;
  /** Entries per insert. Larger batches amortise the round trip. */
  batchSize?: number;
  /** Backoff steps in ms, indexed by consecutive failure count. */
  backoffMs?: number[];
  pollMs?: number;
  onBatchDrained?: (count: number) => void;
  onBatchFailed?: (error: unknown, count: number) => void;
  /**
   * Se llama cuando todo el lote falló con el mismo código.
   *
   * Es la señal de "la base no está lista" (una migración que no corrió, un
   * permiso faltante): hay que alertar, no perder eventos.
   */
  onSharedFailure?: (code: string, count: number) => void;
  /** Intentos de un evento con un error no reconocido antes de su dead-letter. */
  maxUnclassifiedAttempts?: number;
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
  private readonly onSharedFailure?: (code: string, count: number) => void;
  private readonly maxUnclassifiedAttempts: number;

  /**
   * Intentos fallidos por evento cuando el error no está reconocido.
   *
   * Vive en la instancia a propósito: el evento que no se puede guardar queda
   * primero en el spool y se vuelve a leer en cada pasada, así que el conteo
   * tiene que sobrevivir entre pasadas.
   */
  private readonly unclassifiedAttempts = new Map<string, number>();
  private readonly onQuarantined?: (count: number) => void;

  constructor(options: EventDrainerOptions<T>) {
    this.spool = options.spool;
    this.write = options.write;
    this.batchSize = options.batchSize ?? 250;
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.pollMs = options.pollMs ?? 1_000;

    this.onBatchDrained = options.onBatchDrained;
    this.onBatchFailed = options.onBatchFailed;
    this.onSharedFailure = options.onSharedFailure;
    this.maxUnclassifiedAttempts = options.maxUnclassifiedAttempts ?? 5;
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

      const detailed = classifyWriteErrorDetailed(err);

      // Un error pasajero **reconocido** significa que el store no está
      // disponible: los eventos se quedan en disco y se reintentan. Una caída
      // de Postgres tiene que ser un retraso, no una pérdida.
      //
      // Un error que nadie reconoce no se resuelve acá: puede ser de un solo
      // evento (un código nuevo de Prisma, un payload mal formado), así que
      // pasa por el reintento evento por evento, que sabe distinguirlo.
      if (detailed.class === 'transient' && detailed.recognized) {
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
      return this.resolveOneByOne(entries.length);
    } finally {
      this.draining = false;
    }
  }

  /**
   * Resuelve un lote que falló, evento por evento.
   *
   * Se hace en dos fases a propósito. Las escrituras son idempotentes (el
   * `ingestId` único absorbe un duplicado), así que primero se prueba **todo**
   * el lote sin comitear nada, y recién con el panorama completo se decide:
   * sin eso no se puede distinguir "este evento está roto" de "la base no está
   * lista todavía", y confundirlas manda el backlog entero al dead-letter.
   *
   * Las dos reglas que salen de ahí:
   *
   *   - **Nada se guardó y todos fallaron con el mismo código** → el problema
   *     es de la base o del código (una migración que no corrió, un permiso
   *     faltante), no de los eventos. No se manda nada al dead-letter y todo
   *     queda en disco.
   *   - **Un evento no reconocido falla una y otra vez mientras otros se
   *     guardan** → el problema es de ese evento. Va al dead-letter después de
   *     `maxUnclassifiedAttempts`, para que no frene a los que vienen detrás.
   */
  private async resolveOneByOne(remaining: number): Promise<DrainResult> {
    const { entries } = this.spool.readBatchWithOffsets(remaining);
    if (entries.length === 0) {
      return { drained: 0, failed: 0, quarantined: 0, deferred: false };
    }

    // ── Fase 1: probar cada evento sin tocar el offset ────────────────────
    const outcomes: Array<{
      entry: SpoolEntry<T>;
      endOffset: number;
      stored: boolean;
      error?: unknown;
      detailed?: ReturnType<typeof classifyWriteErrorDetailed>;
    }> = [];

    for (const { entry, endOffset } of entries) {
      try {
        await this.write([entry]);
        // Un evento que se guardó ya no cuenta intentos fallidos.
        this.unclassifiedAttempts.delete(entry.ingestId);
        outcomes.push({ entry, endOffset, stored: true });
      } catch (err) {
        outcomes.push({
          entry,
          endOffset,
          stored: false,
          error: err,
          detailed: classifyWriteErrorDetailed(err),
        });
      }
    }

    const failures = outcomes.filter((outcome) => !outcome.stored);
    const storedInPass = outcomes.length - failures.length;

    // ── Regla 1: el fallo es de la base, no de los eventos ────────────────
    const distinctCodes = new Set(failures.map((failure) => failure.detailed?.code ?? 'unknown'));
    const allFailedAlike =
      storedInPass === 0 && failures.length === outcomes.length && distinctCodes.size === 1;

    if (allFailedAlike) {
      const code = [...distinctCodes][0] ?? 'unknown';
      this.onSharedFailure?.(code, failures.length);
      this.scheduleBackoff();
      // Nada se comiteó: el lote entero queda en disco. Se reporta como fallo
      // (no como "diferido") para que el llamador sepa que el store rechazó
      // los eventos y no que no había nada para hacer.
      return { drained: 0, failed: failures.length, quarantined: 0, deferred: false };
    }

    // ── Fase 2: comitear en orden, decidiendo cada fallo ──────────────────
    let drained = 0;
    let quarantined = 0;
    let failed = 0;

    for (const outcome of outcomes) {
      if (outcome.stored) {
        this.spool.commit(outcome.endOffset, 1);
        drained += 1;
        continue;
      }

      const detailed = outcome.detailed!;
      let reason: string | null = null;

      if (detailed.class === 'permanent') {
        reason = describeError(outcome.error);
      } else if (!detailed.recognized) {
        // Un error que nadie reconoce. Se reintenta, pero no para siempre: con
        // otros eventos guardándose, el problema es este evento.
        const attempts = (this.unclassifiedAttempts.get(outcome.entry.ingestId) ?? 0) + 1;
        this.unclassifiedAttempts.set(outcome.entry.ingestId, attempts);
        if (attempts >= this.maxUnclassifiedAttempts && storedInPass > 0) {
          reason = `unclassified-exhausted: ${describeError(outcome.error)}`;
        }
      }

      if (reason === null) {
        // Se reintenta más tarde. Los que vienen detrás esperan: el offset es
        // uno solo y no se puede avanzar por encima de un evento pendiente.
        failed += 1;
        this.scheduleBackoff();
        this.onBatchFailed?.(outcome.error, 1);
        break;
      }

      this.spool.deadLetter(outcome.entry, reason);
      this.spool.commit(outcome.endOffset, 1);
      this.unclassifiedAttempts.delete(outcome.entry.ingestId);
      quarantined += 1;
      this.onQuarantined?.(1);
    }

    if (failed === 0) {
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
