import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableSpool } from '../src/spool';

/**
 * A spool directory belongs to one process.
 *
 * Two processes would keep their own copy of the offset in memory, both
 * would advance the same `events.offset` file, and either of them could
 * rotate `events.jsonl` while the other was still writing into it. Events
 * would be lost or ingested twice — the exact loss the durable path exists
 * to prevent.
 */
describe('spool directory ownership', () => {
  it('refuses a second live instance on the same directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spool-owner-'));
    try {
      const first = new DurableSpool<{ n: number }>({ dir });
      expect(() => new DurableSpool<{ n: number }>({ dir })).toThrow(/already owned by process/);
      first.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('says which directory and which process are in conflict', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spool-owner-'));
    try {
      const first = new DurableSpool<{ n: number }>({ dir });
      expect(() => new DurableSpool<{ n: number }>({ dir })).toThrow(dir);
      expect(() => new DurableSpool<{ n: number }>({ dir })).toThrow(
        /spool\/web|spool\/worker/,
      );
      first.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('releases the directory when the instance is closed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spool-owner-'));
    try {
      const first = new DurableSpool<{ n: number }>({ dir });
      first.close();

      // The same process may open the directory again — for example after a
      // receiver restart. The new instance resumes from the offset on disk.
      const second = new DurableSpool<{ n: number }>({ dir });
      expect(second.append({ n: 1 })).not.toBeNull();
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('takes over a lock whose process id was recycled by another process', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spool-owner-'));
    try {
      // The failure this pins: inside a container the worker is pid 1, so
      // after a restart there IS a live process with the pid of the lock.
      // `kill(pid, 0)` says "alive" and the spool would be blocked forever.
      // The lock records the start time of the process that took it, so a
      // pid with a different start time is a different process.
      const selfStat = readFileSync('/proc/self/stat', 'utf8');
      const selfTicks = Number.parseInt(
        selfStat.slice(selfStat.lastIndexOf(')') + 2).split(' ')[19] ?? '',
        10,
      );
      const bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();

      writeFileSync(
        join(dir, 'owner.lock'),
        JSON.stringify({
          v: 2,
          pid: process.pid,
          token: 'previous-container',
          startedAt: new Date().toISOString(),
          // Same pid, different instance.
          startTicks: selfTicks - 1,
          bootId,
        }),
      );

      const spool = new DurableSpool<{ n: number }>({ dir });
      expect(spool.append({ n: 1 })).not.toBeNull();
      spool.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('takes over a lock left by a previous boot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spool-owner-'));
    try {
      writeFileSync(
        join(dir, 'owner.lock'),
        JSON.stringify({
          v: 2,
          pid: process.pid,
          token: 'before-the-reboot',
          startedAt: new Date().toISOString(),
          startTicks: 1,
          bootId: 'a-boot-that-is-not-this-one',
        }),
      );

      const spool = new DurableSpool<{ n: number }>({ dir });
      expect(spool.append({ n: 1 })).not.toBeNull();
      spool.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('takes over a lock from an older format that cannot be verified', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spool-owner-'));
    try {
      // No version, no identity: there is no way to know whether the process
      // is gone. Refusing would lose the telemetry the spool protects, so
      // the lock is reclaimed with a warning.
      writeFileSync(
        join(dir, 'owner.lock'),
        JSON.stringify({
          pid: process.pid,
          token: 'legacy',
          startedAt: new Date().toISOString(),
        }),
      );

      const spool = new DurableSpool<{ n: number }>({ dir });
      expect(spool.append({ n: 1 })).not.toBeNull();
      spool.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('takes over a directory whose owner is gone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spool-owner-'));
    try {
      // A lock left behind by a process that died. The pid does not exist,
      // so the directory must be usable again — otherwise a crash would
      // block every future boot.
      writeFileSync(
        join(dir, 'owner.lock'),
        JSON.stringify({ v: 2, pid: 2 ** 30, token: 'stale', startedAt: new Date().toISOString() }),
      );

      const spool = new DurableSpool<{ n: number }>({ dir });
      expect(spool.append({ n: 1 })).not.toBeNull();
      spool.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
