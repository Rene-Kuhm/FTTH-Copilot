import { hostname } from 'node:os';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readlinkSync,
  renameSync,
  rmSync,
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
  /** How often the owner refreshes the lock of the directory. */
  heartbeatMs?: number;
  /**
   * How long a lock from another process table (another container) is
   * honoured before it is considered abandoned.
   *
   * A pid cannot be checked across containers, so freshness is the only
   * signal left: a live owner keeps refreshing the lock, a dead one does
   * not.
   */
  foreignOwnerStaleMs?: number;
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

/** Default period of the lock heartbeat. */
const DEFAULT_HEARTBEAT_MS = 5_000;

/** Default age at which a lock from another container is considered stale. */
const DEFAULT_FOREIGN_OWNER_STALE_MS = 30_000;

/**
 * Distinct per process boot, so ids cannot collide across restarts. Combined
 * with a monotonic counter this stays cheap; a per-entry UUID is not needed.
 */
const BOOT_ID = randomUUID().slice(0, 8);

/**
 * Monotonic counter of the ingest ids issued by this process.
 *
 * It is module-scoped on purpose, not a field of the spool: recreating a
 * spool inside the same process must not restart the sequence. The ingest id
 * is the deduplication key of the durable path — `DeviceEvent.ingestId` is
 * unique and `ingestEvents` writes with `skipDuplicates` — so two different
 * events sharing an id would make Postgres drop the second one **silently**,
 * which is exactly the loss the durable path exists to prevent.
 *
 * Across restarts the id cannot collide either: `BOOT_ID` is different in
 * every process.
 */
let ingestSequence = 0;

/**
 * Name of the lock file that gives a spool directory to one process.
 */
const LOCK_FILE = 'owner.lock';

/**
 * Version of the lock format.
 *
 * The identity fields below (start time, boot id) are what make a lock
 * survive a restart without blocking the directory forever. A lock without
 * them cannot be checked for liveness, so it is treated as stale: the guard
 * shipped together with the identity, and the alternative — refusing
 * forever — would lose exactly the telemetry the spool protects.
 */
const LOCK_VERSION = 2;

/** Owner of a spool directory. */
interface SpoolOwner {
  /** Format version of this lock. */
  v?: number;
  pid: number;
  token: string;
  startedAt: string;
  /**
   * Start time of the process, in clock ticks since boot (`/proc/<pid>/stat`
   * field 22). Together with `bootId` this identifies a process **instance**,
   * not just a pid: a pid is recycled, and inside a container the worker is
   * almost always pid 1 — so after a restart `kill(pid, 0)` happily reports
   * the *new* process as alive and the lock would never be released.
   */
  startTicks?: number | null;
  /** Kernel boot id, so a reboot invalidates every lock. */
  bootId?: string | null;
  /**
   * Pid namespace the owner lives in.
   *
   * A pid only means something inside its own namespace: in container B,
   * `kill(pid, 0)` answers about container B's process, not about the one
   * that wrote this lock in container A. A different namespace means the
   * pid cannot be verified at all.
   */
  pidNs?: string | null;
  /** Hostname of the owner, a human-readable companion to `pidNs`. */
  hostname?: string | null;
  /** Last time the owner refreshed the lock, in epoch milliseconds. */
  heartbeatAt?: number | null;
}

/**
 * Whether a pid is still running.
 *
 * `kill(pid, 0)` does not signal anything; it only asks the kernel. EPERM
 * means the process exists but belongs to another user, which still counts
 * as alive. It cannot tell a pid from the process that held it before, so it
 * is only the fallback when `/proc` is not available.
 */
function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Start time of a process, in clock ticks since boot.
 *
 * Returns null when `/proc` cannot answer: the process is gone, or the
 * platform has no `/proc` at all (macOS).
 */
function readStartTicks(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // The command name is in parentheses and may contain spaces, so the
    // fields are counted from the closing parenthesis: field 3 is index 0,
    // and start time is field 22.
    const rest = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ticks = Number.parseInt(rest[19] ?? '', 10);
    return Number.isFinite(ticks) ? ticks : null;
  } catch {
    return null;
  }
}

/**
 * Identifier of the pid table this process lives in.
 *
 * Two processes in different pid namespaces (two containers) can share a pid
 * and a start time by coincidence, and a pid means nothing outside its own
 * namespace: `kill(pid, 0)` in container B answers about container B's pid,
 * not about the process that wrote the lock in container A.
 */
function readPidNamespace(): string | null {
  try {
    return readlinkSync('/proc/self/ns/pid');
  } catch {
    return null;
  }
}

/** Kernel boot id, or null when it cannot be read. */
function readBootId(): string | null {
  try {
    return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() || null;
  } catch {
    return null;
  }
}

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

  /** Identifies this instance as the owner of the directory. */
  private readonly token = randomUUID();

  /** Path of the lock file, while this instance owns the directory. */
  private lockPath: string | null = null;

  /** Period of the lock heartbeat, in milliseconds. */
  private readonly heartbeatMs: number;

  /** Age at which a foreign lock is considered abandoned, in milliseconds. */
  private readonly foreignOwnerStaleMs: number;

  /** Timer that keeps the lock fresh while this instance owns it. */
  private heartbeat: ReturnType<typeof setInterval> | null = null;

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
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.foreignOwnerStaleMs =
      options.foreignOwnerStaleMs ?? DEFAULT_FOREIGN_OWNER_STALE_MS;

    mkdirSync(this.dir, { recursive: true });
    this.claimDirectory();
    this.size = this.currentSize();
    this.offset = this.readOffset();
  }

  /**
   * Takes the ownership of the directory.
   *
   * A spool directory belongs to ONE process. Two processes would keep their
   * own copy of the offset in memory, both would advance the same
   * `events.offset` file, and either of them could rotate `events.jsonl`
   * while the other was still writing into it: events would be lost or
   * ingested twice. That is exactly what the domain rule forbids.
   *
   * The ownership is a lock file. The second process to open the directory
   * fails loudly instead of corrupting it; a lock whose owner is gone (the
   * process died) is taken over, so a crash never blocks the next boot.
   */
  private claimDirectory(): void {
    const lockPath = join(this.dir, LOCK_FILE);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const owner = this.ownerRecord();
      try {
        // `wx` fails when the file exists: the claim is atomic.
        writeFileSync(lockPath, JSON.stringify(owner), { flag: 'wx' });
        this.lockPath = lockPath;
        this.startHeartbeat();
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;

        const current = this.readOwner(lockPath);
        if (current !== null && this.isOwnerAlive(current)) {
          throw new Error(
            `the spool directory ${this.dir} is already owned by process ${current.pid}` +
              `${current.hostname ? ` on ${current.hostname}` : ''}. ` +
              'Two processes must never share a spool: they would advance the same offset ' +
              'and rotate the same file. Give each process its own directory ' +
              '(for example .../spool/web and .../spool/worker).',
          );
        }

        // The owner is gone: the lock is stale, take it over.
        rmSync(lockPath, { force: true });
      }
    }

    throw new Error(`could not claim the spool directory ${this.dir}`);
  }

  /** Reads the owner of the directory, or null when it cannot be read. */
  private readOwner(lockPath: string): SpoolOwner | null {
    try {
      const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as Partial<SpoolOwner>;
      if (typeof parsed.pid !== 'number' || typeof parsed.token !== 'string') return null;
      return {
        v: typeof parsed.v === 'number' ? parsed.v : undefined,
        pid: parsed.pid,
        token: parsed.token,
        startedAt: parsed.startedAt ?? '',
        startTicks: typeof parsed.startTicks === 'number' ? parsed.startTicks : null,
        bootId: typeof parsed.bootId === 'string' ? parsed.bootId : null,
        pidNs: typeof parsed.pidNs === 'string' ? parsed.pidNs : null,
        hostname: typeof parsed.hostname === 'string' ? parsed.hostname : null,
        heartbeatAt: typeof parsed.heartbeatAt === 'number' ? parsed.heartbeatAt : null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Whether the recorded owner is still the process that took the lock.
   *
   * A pid alone is not an identity: the kernel recycles it, and inside a
   * container this process is almost always pid 1, so a lock left behind by
   * a previous container would look "alive" forever and block the spool on
   * every restart. The instance is identified by pid **plus** its start time
   * (and the boot id, so a reboot invalidates everything).
   */
  private isOwnerAlive(owner: SpoolOwner): boolean {
    if (owner.v !== LOCK_VERSION) {
      // Written by a version that could not record the identity of the
      // process. It cannot be checked, so it is taken over — with a warning,
      // because the operator should know the directory was reclaimed.
      console.warn(
        `[spool] taking over ${this.dir}: its lock was written by an older version and cannot be verified`,
      );
      return false;
    }

    const bootId = readBootId();
    if (owner.bootId !== null && bootId !== null && owner.bootId !== bootId) {
      // The machine rebooted: whoever held this lock is gone.
      return false;
    }

    // A pid only means something inside its own process table. When the
    // owner lived in another one (another container), its pid cannot be
    // checked from here: the pid in THIS table may be an unrelated process
    // — in a container it is almost always pid 1 — so `kill(pid, 0)` would
    // answer the wrong question. Freshness is the only signal left: a live
    // owner keeps refreshing the lock.
    if (!this.sameProcessTable(owner)) {
      return this.foreignOwnerIsFresh(owner);
    }

    if (owner.startTicks === null || owner.startTicks === undefined) {
      // A lock from an older version, or a platform without `/proc`.
      return isProcessAlive(owner.pid);
    }

    const currentTicks = readStartTicks(owner.pid);
    if (currentTicks === null) {
      // No such process, or `/proc` cannot answer: nothing to protect.
      return isProcessAlive(owner.pid) && readStartTicks(process.pid) === null;
    }

    // Same pid and same start time means the very same process instance.
    // A different start time means the pid was recycled by a new process.
    return currentTicks === owner.startTicks;
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

    const ingestId = `${BOOT_ID}-${(ingestSequence++).toString(36)}`;
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

  /** The record written into the lock file. */
  private ownerRecord(): SpoolOwner {
    return {
      v: LOCK_VERSION,
      pid: process.pid,
      token: this.token,
      startedAt: new Date().toISOString(),
      startTicks: readStartTicks(process.pid),
      bootId: readBootId(),
      pidNs: readPidNamespace(),
      hostname: hostname(),
      heartbeatAt: Date.now(),
    };
  }

  /**
   * Whether the owner lives in the same process table as this process.
   *
   * Both signals are needed. The pid namespace alone is not enough: measured
   * with Docker 29.9.2, two freshly created containers can report the *same*
   * pid namespace id, so a pid from one would look inspectable from the
   * other. The hostname alone is not enough either: it is a deployment
   * choice and two containers can be given the same one.
   *
   * When a signal is unavailable on either side (a platform without `/proc`)
   * it does not count against the match — otherwise a lock written before
   * hostnames were recorded would never be recognised as our own.
   */
  private sameProcessTable(owner: SpoolOwner): boolean {
    const mine = readPidNamespace();
    if (mine !== null && owner.pidNs !== null && owner.pidNs !== undefined) {
      if (mine !== owner.pidNs) return false;
    }

    if (owner.hostname !== null && owner.hostname !== undefined) {
      if (hostname() !== owner.hostname) return false;
    }

    return true;
  }

  /**
   * Whether a lock from another pid namespace is still being refreshed.
   *
   * A live owner refreshes the lock every `heartbeatMs`; a container that was
   * killed stops refreshing it. Treating a fresh foreign lock as occupied is
   * what stops two containers from sharing a directory by mistake; treating a
   * stale one as abandoned is what stops a killed container from blocking the
   * directory forever.
   */
  private foreignOwnerIsFresh(owner: SpoolOwner): boolean {
    const beat = owner.heartbeatAt;
    if (typeof beat !== 'number' || !Number.isFinite(beat)) {
      // No heartbeat recorded: it cannot be verified, and it is not from this
      // container (the namespace differs). Refuse rather than steal.
      return true;
    }
    return Date.now() - beat < this.foreignOwnerStaleMs;
  }

  /** Keeps the lock fresh while this instance owns the directory. */
  private startHeartbeat(): void {
    if (this.heartbeatMs <= 0 || this.lockPath === null) return;

    this.heartbeat = setInterval(() => {
      if (this.lockPath === null) return;
      try {
        // Rewrite only if this instance still owns the lock: a taken-over
        // directory must not be overwritten by its previous owner.
        const current = this.readOwner(this.lockPath);
        if (current === null || current.token !== this.token) {
          this.stopHeartbeat();
          return;
        }
        writeFileSync(this.lockPath, JSON.stringify(this.ownerRecord()));
      } catch {
        // A failed refresh is not fatal: the next tick retries, and the worst
        // case is that another container considers this lock abandoned.
      }
    }, this.heartbeatMs);

    // The heartbeat must never keep the process alive on its own.
    this.heartbeat.unref?.();
  }

  /** Stops the heartbeat. */
  private stopHeartbeat(): void {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  close(): void {
    this.stopHeartbeat();

    if (this.fd !== null) {
      closeSync(this.fd);
      this.fd = null;
    }

    // Release the directory, but only if this instance is still its owner:
    // a process that took over a stale lock must not remove the new owner's.
    if (this.lockPath !== null) {
      const owner = this.readOwner(this.lockPath);
      if (owner !== null && owner.token === this.token) {
        rmSync(this.lockPath, { force: true });
      }
      this.lockPath = null;
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