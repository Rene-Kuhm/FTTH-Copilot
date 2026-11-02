import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DurableSpool, type SpoolEntry } from './spool';

/**
 * Replay del dead-letter del spool.
 *
 * El drainer mueve al dead-letter los eventos que no se pueden guardar (una
 * clave foránea rota, por ejemplo). Hasta ahora esos datos quedaban guardados
 * pero nunca volvían: sin un replay, en la práctica es pérdida. Cuando el
 * operador corrige el registro en el NMS, los traps tienen que poder volver.
 *
 * Dos decisiones:
 *
 *   - **El `ingestId` se conserva.** Es la clave de idempotencia del insert
 *     (`createMany` con `skipDuplicates`), así que un evento que ya se
 *     guardó vuelve con el mismo id y la base lo descarta en vez de
 *     duplicarlo. Un replay repetido no agrega filas.
 *   - **Lo recuperado sale del archivo del dead-letter.** El spool es
 *     durable: una vez que el evento está ahí, que se consuma la línea del
 *     dead-letter no lo pierde. Dejarlo haría que cada replay re-encolara lo
 *     mismo.
 */

/** A dead-lettered record, as the drainer writes it. */
export interface DeadLetterRecord<T> {
  /** Idempotency key of the event. */
  ingestId: string;
  /** The event that could not be stored. */
  payload: T;
  /** Why it was dead-lettered. */
  reason: string;
  /** When it was dead-lettered. */
  deadLetteredAt: string;
}

/** A payload that carries the tenant of the event. */
interface TenantScoped {
  tenantId?: string | null;
}

export interface ReplayDeadLetterOptions {
  /** Directory holding the spool files. */
  dir: string;
  /** Only replay the events of this tenant. */
  tenantId?: string;
  /** Count and report without writing anything. */
  dryRun?: boolean;
  /** Remove the replayed records from the dead-letter file (default). */
  consume?: boolean;
}

export interface ReplayDeadLetterResult {
  /** Records found in the dead-letter file. */
  found: number;
  /** Events handed back to the spool. */
  recovered: number;
  /** Events left aside because they belong to another tenant. */
  skipped: number;
  /** Lines that could not be parsed. */
  unreadable: number;
  /** Events the spool refused (hard size limit). */
  refused: number;
  /** Records left in the dead-letter file. */
  remaining: number;
  /** Ids of the events that went back to the spool, in replay order. */
  ingestIds: string[];
}

const DEAD_LETTER_FILE = 'events.dlq.jsonl';

/** Reads the dead-letter file, keeping the raw line of every record. */
function readRecords<T>(
  dir: string,
): { lines: string[]; records: Array<{ line: string; record: DeadLetterRecord<T> }>; unreadable: number } {
  const path = join(dir, DEAD_LETTER_FILE);
  const empty = { lines: [] as string[], records: [] as Array<{ line: string; record: DeadLetterRecord<T> }>, unreadable: 0 };
  if (!existsSync(path)) return empty;

  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');

  const records: Array<{ line: string; record: DeadLetterRecord<T> }> = [];
  let unreadable = 0;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Partial<DeadLetterRecord<T>>;
      if (typeof parsed.ingestId !== 'string' || parsed.payload === undefined) {
        unreadable += 1;
        continue;
      }
      records.push({
        line,
        record: {
          ingestId: parsed.ingestId,
          payload: parsed.payload,
          reason: typeof parsed.reason === 'string' ? parsed.reason : '',
          deadLetteredAt: typeof parsed.deadLetteredAt === 'string' ? parsed.deadLetteredAt : '',
        },
      });
    } catch {
      unreadable += 1;
    }
  }

  return { lines, records, unreadable };
}

/**
 * Hands the dead-lettered events back to the spool.
 *
 * The spool directory belongs to one process at a time, so the replay needs
 * the directory free: the worker that owns it has to be stopped first. In
 * `dryRun` the spool is never opened, so the command works with the worker
 * running.
 */
export function replayDeadLetter<T extends TenantScoped>(
  options: ReplayDeadLetterOptions,
): ReplayDeadLetterResult {
  const { dir, tenantId, dryRun = false, consume = true } = options;

  const { lines, records, unreadable } = readRecords<T>(dir);
  const found = lines.length;

  const selected = records.filter(({ record }) => {
    if (tenantId === undefined) return true;
    return (record.payload as TenantScoped).tenantId === tenantId;
  });
  const skipped = records.length - selected.length;

  const result: ReplayDeadLetterResult = {
    found,
    recovered: 0,
    skipped,
    unreadable,
    refused: 0,
    remaining: found,
    ingestIds: [],
  };

  if (dryRun) {
    result.ingestIds = selected.map(({ record }) => record.ingestId);
    return result;
  }

  const spool = new DurableSpool<T>({ dir });
  try {
    for (const { record } of selected) {
      const entry: SpoolEntry<T> = { ingestId: record.ingestId, payload: record.payload };
      if (spool.requeue(entry)) {
        result.recovered += 1;
        result.ingestIds.push(record.ingestId);
      } else {
        result.refused += 1;
      }
    }
  } finally {
    spool.close();
  }

  if (consume) {
    const recovered = new Set(selected.map(({ record }) => record.ingestId));
    const kept = lines.filter((line) => {
      try {
        const parsed = JSON.parse(line) as Partial<DeadLetterRecord<T>>;
        return typeof parsed.ingestId !== 'string' || !recovered.has(parsed.ingestId);
      } catch {
        return true;
      }
    });
    writeFileSync(join(dir, DEAD_LETTER_FILE), kept.length === 0 ? '' : `${kept.join('\n')}\n`);
    result.remaining = kept.length;
  }

  return result;
}
