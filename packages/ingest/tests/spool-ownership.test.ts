import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  it('takes over a directory whose owner is gone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spool-owner-'));
    try {
      // A lock left behind by a process that died. The pid does not exist,
      // so the directory must be usable again — otherwise a crash would
      // block every future boot.
      writeFileSync(
        join(dir, 'owner.lock'),
        JSON.stringify({ pid: 2 ** 30, token: 'stale', startedAt: new Date().toISOString() }),
      );

      const spool = new DurableSpool<{ n: number }>({ dir });
      expect(spool.append({ n: 1 })).not.toBeNull();
      spool.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
