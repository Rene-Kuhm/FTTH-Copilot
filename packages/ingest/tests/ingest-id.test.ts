import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DurableSpool } from '../src/spool';

/**
 * The ingest id is the deduplication key of the durable path: it is unique
 * in the database and the events are written with `skipDuplicates`. Two
 * different events sharing an id would make Postgres drop the second one
 * without a word — the silent loss the durable path exists to prevent.
 */
describe('ingest ids', () => {
  it('never repeats an id when the spool is recreated in the same process', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spool-ingest-id-'));
    try {
      const first = new DurableSpool<{ n: number }>({ dir });
      const firstId = first.append({ n: 1 });
      first.close();

      // The sequence must not restart with the instance: the boot id is the
      // same (same process), so a per-instance counter would hand out the
      // same id again.
      const second = new DurableSpool<{ n: number }>({ dir });
      const secondId = second.append({ n: 2 });
      second.close();

      expect(firstId).not.toBeNull();
      expect(secondId).not.toBeNull();
      expect(secondId).not.toBe(firstId);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('gives every event of a single spool its own id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spool-ingest-id-'));
    try {
      const spool = new DurableSpool<{ n: number }>({ dir });
      const ids = [spool.append({ n: 1 }), spool.append({ n: 2 }), spool.append({ n: 3 })];
      spool.close();

      expect(new Set(ids).size).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
