import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Durable, append-only spool for inbound device events.
 *
 * Exists so that a database outage cannot lose a received datagram: the hot
 * path only appends to disk, and a separate drainer moves records into
 * Postgres afterwards.
 *
 * Why not a Postgres staging table: the spool has to survive exactly when the
 * database is unavailable, which is the case a staging table cannot cover.
 *
 * Format is JSONL, one entry per line. A crash can leave a partial trailing
 * line, which the reader discards and rewrites from the last committed offset.
 */
export interface SpoolEntry<T> {
  /** Stable id, unique per process boot, used to deduplicate retries. */
  ingestId: string;
  payload: T;
  /**
   * Failed drain attempts. Tracked in memory and reset on read rather than
   * persisted, so it is absent from the on-disk line.
   */
  attempts?: number;
}

export interface DurableSpoolOptions {
  /** Directory holding the data, offset and dead-letter files. */
  dir: string;
  /** Rotate once a fully drained file reaches this size. */
  maxBytes?: number;
  /** Refuse new records past this size, counting the drop instead. */
  hardMaxBytes?: number;
}

export interface SpoolStats {
  /** Records waiting to be drained. */
  backlog: number;
  /** Records refused because the hard size limit was hit. */
  dropped: number;
  /** Lines that could not be parsed and were skipped. */
  corrupt: number;
  /** Records moved to the dead-letter file. */
  deadLettered: number;
  /** Byte size of the active file. */
  bytes: number;
}

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_HARD_MAX_BYTES = 256 * 1024 * 1024;
const READ_CHUNK = 256 * 1024;

/**
 * Distinct per process boot, so ids cannot collide across restarts. Combined
 * with a monotonic counter this stays cheap; a per-entry UUID is not needed.
 */
const BOOT_ID = randomUUID().slice(0, 8);

export class DurableSpool<T> {
  private readonly dir: string;
  private readonly dataPath: string;
  private readonly offsetPath: string;
  private readonly deadLetterPath: string;
  private readonly maxBytes: number;
  private readonly hardMaxBytes: number;

  /** Kept open across appends: appendFileSync reopens the file every call. */
  private fd: number | null = null;
  private size = 0;
  private offset = 0;
  private sequence = 0;

  private dropped = 0;
  private corrupt = 0;
  private deadLettered = 0;
  /**
   * Pending count, derived lazily from disk on first use.
   *
   * `append` only increments it for records this process wrote, so a freshly
   * opened spool would otherwise report a backlog of zero while hundreds of
   * events wait on disk after a restart. That value feeds /api/health, so it
   * has to reflect reality even before the drainer touches the file.
   */
  private pending: number | null = null;

  constructor(options: DurableSpoolOptions) {
    this.dir = options.dir;
    this.dataPath = join(this.dir, 'events.jsonl');
    this.offsetPath = join(this.dir, 'events.offset');
    this.deadLetterPath = join(this.dir, 'events.dlq.jsonl');

    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.hardMaxBytes = options.hardMaxBytes ?? DEFAULT_HARD_MAX_BYTES;

    mkdirSync(this.dir, { recursive: true });
    this.size = this.currentSize();
    this.offset = this.readOffset();
  }

  /** Durable enqueue. Returns the assigned id, or null when refused. */
  append(payload: T): string | null {
    if (this.size >= this.hardMaxBytes) {
      this.dropped++;
      return null;
    }

    // Rotating only while fully drained keeps a single active file, so the
    // offset never has to span several files.
    if (this.size >= this.maxBytes && this.offset === this.size) {
      this.rotate();
    }

    const ingestId = `${BOOT_ID}-${(this.sequence++).toString(36)}`;
    const line = `${JSON.stringify({ ingestId, payload } satisfies SpoolEntry<T>)}\n`;

    const buffer = Buffer.from(line, 'utf8');
    try {
      writeSync(this.ensureOpen(), buffer);
    } catch (err) {
      // ENOSPC or a full socket/fs: the caller must surface this, because the
      // datagram is gone from the network either way.
      this.dropped++;
      throw err;
    }

    this.size += buffer.length;
    if (this.pending !== null) this.pending++;
    return ingestId;
  }

  /**
   * Read up to `limit` complete entries from the committed offset.
   * A trailing partial line is left for the next call.
   */
  readBatch(limit: number): { entries: SpoolEntry<T>[]; nextOffset: number } {
    const entries: SpoolEntry<T>[] = [];
    if (this.offset >= this.size || limit <= 0) {
      return { entries, nextOffset: this.offset };
    }

    const chunk = Buffer.allocUnsafe(READ_CHUNK);
    let carry = '';
    let consumed = 0;
    let fd: number | null = null;

    try {
      fd = openSync(this.dataPath, 'r');
    } catch {
      // The file can disappear under us (rotation, or a test tearing down the
      // spool directory). A missing file is an empty queue, not a crash.
      return { entries, nextOffset: this.offset };
    }

    try {
      while (entries.length < limit) {
        const bytes = readSync(fd, chunk, 0, READ_CHUNK, this.offset + consumed);
        if (bytes === 0) break;

        consumed += bytes;
        carry += chunk.toString('utf8', 0, bytes);

        let newline = carry.indexOf('\n');
        while (newline !== -1 && entries.length < limit) {
          const line = carry.slice(0, newline);
          carry = carry.slice(newline + 1);
          if (line.trim()) this.pushEntry(entries, line);
          newline = carry.indexOf('\n');
        }
      }
    } finally {
      closeSync(fd);
    }

    // Whatever is still in `carry` has not been consumed: either a partial
    // trailing line, or complete lines past the batch limit left for next call.
    const unconsumed = Buffer.byteLength(carry, 'utf8');
    return { entries, nextOffset: this.offset + consumed - unconsumed };
  }

  /**
   * Persist the drain progress. Call only after the batch is durably stored,
   * so a crash in between re-processes the batch and dedup absorbs it.
   *
   * `consumedCount` is the number of entries between the previous commit and
   * this one, used to track backlog without rescanning the file.
   */
  commit(offset: number, consumedCount = 0): void {
    if (offset <= this.offset) return;
    this.offset = Math.min(offset, this.size);
    if (this.pending !== null) this.pending = Math.max(0, this.pending - consumedCount);

    const temp = `${this.offsetPath}.tmp`;
    writeFileSync(temp, String(this.offset), 'utf8');
    renameSync(temp, this.offsetPath);

    if (this.offset === this.size) this.rotate();
  }

  /** Move an entry that keeps failing out of the active queue. */
  deadLetter(entry: SpoolEntry<T>, reason: string): void {
    this.deadLettered++;
    const record = { ...entry, reason, deadLetteredAt: new Date().toISOString() };
    writeFileSync(this.deadLetterPath, `${JSON.stringify(record)}\n`, {
      flag: 'a',
    });
  }

  stats(): SpoolStats {
    if (this.pending === null) this.pending = this.countBacklog();

    return {
      backlog: this.pending,
      dropped: this.dropped,
      corrupt: this.corrupt,
      deadLettered: this.deadLettered,
      bytes: this.size,
    };
  }

  close(): void {
    if (this.fd !== null) {
      closeSync(this.fd);
      this.fd = null;
    }
  }

  private pushEntry(entries: SpoolEntry<T>[], line: string): void {
    try {
      const parsed = JSON.parse(line) as Partial<SpoolEntry<T>>;
      if (typeof parsed.ingestId !== 'string') throw new Error('missing ingestId');
      entries.push({
        ingestId: parsed.ingestId,
        payload: parsed.payload as T,
        attempts: parsed.attempts ?? 0,
      });
    } catch {
      // Skip the bad line but keep its bytes consumed so the reader advances.
      this.corrupt++;
    }
  }

  private ensureOpen(): number {
    if (this.fd === null) this.fd = openSync(this.dataPath, 'a');
    return this.fd;
  }

  private rotate(): void {
    // Rename is atomic, so a crash here leaves either the old or new file.
    if (this.size > 0 && existsSync(this.dataPath)) {
      renameSync(this.dataPath, join(this.dir, 'events.consumed.jsonl'));
    }
    this.close();
    this.size = 0;
    this.offset = 0;
    writeFileSync(this.offsetPath, '0', 'utf8');
  }

  private currentSize(): number {
    try {
      return statSync(this.dataPath).size;
    } catch {
      return 0;
    }
  }

  /**
   * Count uncommitted records by reading from the offset to the end.
   *
   * Runs at most once per process, on the first stats() call, because /api/health
   * calls stats() on every request and the answer feeds the backlog figure an
   * operator reads during an outage.
   */
  private countBacklog(): number {
    if (this.offset >= this.size) return 0;

    let count = 0;
    let carry = '';
    let consumed = 0;
    const buffer = Buffer.allocUnsafe(READ_CHUNK);
    let fd: number | null = null;

    try {
      fd = openSync(this.dataPath, 'r');
      while (consumed + this.offset < this.size) {
        const bytes = readSync(fd, buffer, 0, READ_CHUNK, this.offset + consumed);
        if (bytes === 0) break;
        consumed += bytes;
        carry += buffer.toString('utf8', 0, bytes);
        count += carry.split('\n').length - 1;
        carry = carry.slice(carry.lastIndexOf('\n') + 1);
      }
    } catch {
      return count;
    } finally {
      if (fd !== null) closeSync(fd);
    }

    // A trailing line with no terminator is an incomplete write, not a record.
    return carry.length > 0 ? count + 1 : count;
  }

  private readOffset(): number {
    try {
      const stored = Number.parseInt(readFileSync(this.offsetPath, 'utf8'), 10);
      // A stored offset past the file means the file was rotated underneath
      // us; start over rather than skipping unprocessed records.
      return Number.isFinite(stored) && stored <= this.size ? stored : 0;
    } catch {
      return 0;
    }
  }
}