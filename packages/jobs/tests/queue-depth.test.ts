import { describe, expect, it } from 'vitest';
import {
  QUEUE_DEPTH_STATES,
  emptyQueueDepth,
  readQueueDepth,
  type QueueDepthSource,
} from '../src/queue-depth';

/**
 * The depth of the queues is read from Redis through BullMQ, but the module
 * takes anything that can count jobs. These fakes are the whole contract:
 * the test never needs a Redis instance, and the production code is free to
 * change how it reaches BullMQ.
 */

/** A source that answers with the given counts. */
function sourceWith(counts: Record<string, number>): QueueDepthSource {
  return {
    async getJobCounts(): Promise<{ [index: string]: number }> {
      return counts;
    },
  };
}

/** A source that always fails, like Redis does when it goes down. */
function failingSource(error: Error): QueueDepthSource {
  return {
    async getJobCounts(): Promise<{ [index: string]: number }> {
      throw error;
    },
  };
}

describe('queue depth', () => {
  it('reports the states that tell whether the background work keeps up', () => {
    expect([...QUEUE_DEPTH_STATES]).toEqual([
      'waiting',
      'active',
      'delayed',
      'prioritized',
      'waiting-children',
      'completed',
      'failed',
    ]);
  });

  it('starts every state at zero', () => {
    const depth = emptyQueueDepth();

    for (const state of QUEUE_DEPTH_STATES) {
      expect(depth[state]).toBe(0);
    }
  });

  it('reads the counts of every queue', async () => {
    const report = await readQueueDepth(
      new Map([
        ['ftth-poll', sourceWith({ waiting: 3, active: 1, completed: 12 })],
        ['ftth-ingest', sourceWith({ waiting: 40, failed: 2 })],
      ]),
    );

    expect(report.unavailable).toEqual([]);
    expect(report.depths.get('ftth-poll')).toEqual({
      waiting: 3,
      active: 1,
      delayed: 0,
      prioritized: 0,
      'waiting-children': 0,
      completed: 12,
      failed: 0,
    });
    expect(report.depths.get('ftth-ingest')?.waiting).toBe(40);
    expect(report.depths.get('ftth-ingest')?.failed).toBe(2);
  });

  it('asks for the states it reports, so the answer has a known shape', async () => {
    const asked: string[][] = [];
    const source: QueueDepthSource = {
      async getJobCounts(...types: string[]): Promise<{ [index: string]: number }> {
        asked.push(types as string[]);
        return {};
      },
    };

    await readQueueDepth(new Map([['ftth-poll', source]]));

    expect(asked[0]).toEqual([...QUEUE_DEPTH_STATES]);
  });

  it('keeps the queues it could read when one of them fails', async () => {
    const report = await readQueueDepth(
      new Map([
        ['ftth-poll', sourceWith({ waiting: 2 })],
        ['ftth-ingest', failingSource(new Error('ECONNREFUSED'))],
      ]),
    );

    expect(report.unavailable).toEqual(['ftth-ingest']);
    expect(report.depths.get('ftth-poll')?.waiting).toBe(2);
    // A queue that could not be read is absent, not zeroed: a zeroed depth
    // would say "the queue is empty" when the truth is "we do not know".
    expect(report.depths.has('ftth-ingest')).toBe(false);
  });

  it('reports an empty fleet without inventing queues', async () => {
    const report = await readQueueDepth(new Map());

    expect(report.depths.size).toBe(0);
    expect(report.unavailable).toEqual([]);
  });
});
