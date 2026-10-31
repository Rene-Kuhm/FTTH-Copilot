import { describe, expect, it } from 'vitest';
import {
  JOB_NAMES,
  QUEUE_NAMES,
  ingestDrainJobId,
  investigationJobId,
  recurringSchedulerId,
  sanitizeJobScope,
  windowJobId,
} from '../src/definitions';

describe('queue and job vocabulary', () => {
  it('gives every logical queue a physical name', () => {
    expect(Object.keys(QUEUE_NAMES).sort()).toEqual([
      'fec',
      'firmware',
      'ingest',
      'investigation',
      'investigationSweep',
      'poll',
    ]);
    expect(new Set(Object.values(QUEUE_NAMES)).size).toBe(6);
  });

  it('names every queue after the work it carries', () => {
    expect(QUEUE_NAMES.poll).toBe('ftth-poll');
    expect(QUEUE_NAMES.firmware).toBe('ftth-firmware');
    expect(QUEUE_NAMES.fec).toBe('ftth-fec');
    expect(QUEUE_NAMES.ingest).toBe('ftth-ingest');
  });

  it('uses queue names BullMQ accepts', () => {
    // BullMQ rejects a queue name containing ':' — it is its own key
    // separator — so a colon would throw at runtime, not at compile time.
    for (const name of Object.values(QUEUE_NAMES)) {
      expect(name).not.toContain(':');
    }
  });

  it('gives every job a name BullMQ accepts', () => {
    for (const name of Object.values(JOB_NAMES)) {
      expect(name).not.toContain(':');
      expect(name.length).toBeGreaterThan(0);
    }
  });
});

describe('sanitizeJobScope', () => {
  it('replaces every character BullMQ would reject', () => {
    expect(sanitizeJobScope('poll:tenant-1:minute')).toBe('poll-tenant-1-minute');
    expect(sanitizeJobScope('a b/c')).toBe('a-b-c');
    expect(sanitizeJobScope('keep-These_1')).toBe('keep-These_1');
  });
});

describe('windowJobId', () => {
  it('is stable for the same window', () => {
    const id = windowJobId('poll', 60_000, 1_760_000_000_000);
    expect(id).toBe(windowJobId('poll', 60_000, 1_760_000_000_000));
  });

  it('changes when the window changes', () => {
    const first = windowJobId('poll', 60_000, 1_760_000_000_000);
    const next = windowJobId('poll', 60_000, 1_760_000_060_000);
    expect(first).not.toBe(next);
  });

  it('puts every id inside a window in the same bucket', () => {
    const start = 29_333_333 * 60_000; // aligned to the window boundary
    const inside = windowJobId('poll', 60_000, start + 59_999);
    expect(inside).toBe(windowJobId('poll', 60_000, start));
  });

  it('never produces an id BullMQ rejects', () => {
    const id = windowJobId('poll:tenant-1', 60_000, 1_760_000_000_000);
    expect(id).not.toContain(':');
  });

  it('rejects a window that cannot divide time', () => {
    expect(() => windowJobId('poll', 0)).toThrow(/positive window/);
    expect(() => windowJobId('poll', -1)).toThrow(/positive window/);
  });
});

describe('ingestDrainJobId', () => {
  it('is derived from the source and the ingest id', () => {
    expect(ingestDrainJobId('syslog', 'ing_abc')).toBe('ingest-drain-syslog-ing_abc');
  });

  it('is different for different events', () => {
    expect(ingestDrainJobId('syslog', 'ing_a')).not.toBe(ingestDrainJobId('syslog', 'ing_b'));
  });

  it('never produces an id BullMQ rejects', () => {
    expect(ingestDrainJobId('syslog', 'ing:1')).not.toContain(':');
  });

  it('rejects an empty ingest id', () => {
    expect(() => ingestDrainJobId('syslog', '   ')).toThrow(/non-empty ingest id/);
  });
});

describe('recurringSchedulerId', () => {
  it('is stable and free of separators BullMQ reserves', () => {
    const id = recurringSchedulerId('poll:connections');
    expect(id).toBe(recurringSchedulerId('poll:connections'));
    expect(id).not.toContain(':');
  });
});

describe('investigationJobId', () => {
  it('derives one id per attempt, without the ":" BullMQ rejects', () => {
    const id = investigationJobId('r_abc', 'v_def');
    expect(id).toBe('investigation-r_abc-v_def');
    expect(id).not.toContain(':');
  });

  it('is stable for the same attempt and distinct across attempts', () => {
    expect(investigationJobId('r_abc', 'v_1')).toBe(investigationJobId('r_abc', 'v_1'));
    expect(investigationJobId('r_abc', 'v_1')).not.toBe(investigationJobId('r_abc', 'v_2'));
  });

  it('refuses an empty run or version id', () => {
    expect(() => investigationJobId('', 'v_1')).toThrow();
    expect(() => investigationJobId('r_abc', ' ')).toThrow();
  });
});
