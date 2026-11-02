/**
 * Depth of the durable job queues.
 *
 * The depth is the operator's answer to "is the background work keeping up?".
 * BullMQ keeps the jobs of every state in its own list, and `getJobCounts`
 * counts them in a single round trip, so the whole fleet is readable with one
 * command per queue.
 *
 * The module takes the counter as an argument instead of building the BullMQ
 * queue itself: the caller owns the connection and the lifecycle, and the
 * test never needs a Redis instance.
 */

import type { JobType } from 'bullmq';

/**
 * Job states the depth report breaks down.
 *
 * `waiting`, `active`, `delayed` and `prioritized` are the pending work; the
 * other three are the history of the queue, and the `failed` set is the
 * queue's own dead-letter.
 */
export const QUEUE_DEPTH_STATES = [
  'waiting',
  'active',
  'delayed',
  'prioritized',
  'waiting-children',
  'completed',
  'failed',
] as const;

/** A job state of the depth report. */
export type QueueDepthState = (typeof QUEUE_DEPTH_STATES)[number];

/** Number of jobs of a queue, by state. */
export type QueueDepth = Record<QueueDepthState, number>;

/**
 * Anything that can count the jobs of a queue.
 *
 * BullMQ's `Queue` satisfies it; the test uses a plain object.
 */
export interface QueueDepthSource {
  getJobCounts(...types: JobType[]): Promise<{ [index: string]: number }>;
}

/**
 * Depth of every queue, plus the queues that could not be read.
 *
 * A queue that could not be read is **absent** from `depths`, not zeroed: a
 * zeroed depth would claim the queue is empty when the truth is that nobody
 * knows, and an empty queue is the one state an operator must never be told
 * by accident.
 */
export interface QueueDepthReport {
  /** Depth by physical queue name. */
  readonly depths: ReadonlyMap<string, QueueDepth>;
  /** Queues whose counts could not be read, in the order they were read. */
  readonly unavailable: readonly string[];
}

/** A depth where nothing has ever run. */
export function emptyQueueDepth(): QueueDepth {
  const depth = {} as QueueDepth;
  for (const state of QUEUE_DEPTH_STATES) depth[state] = 0;
  return depth;
}

/**
 * Reads the depth of every queue.
 *
 * One queue that fails does not sink the report: Redis being unreachable
 * affects all of them at once, and the caller still gets to know which
 * queues could not be read.
 */
export async function readQueueDepth(
  sources: ReadonlyMap<string, QueueDepthSource>,
): Promise<QueueDepthReport> {
  const depths = new Map<string, QueueDepth>();
  const unavailable: string[] = [];

  for (const [queue, source] of sources) {
    try {
      const counts = await source.getJobCounts(...QUEUE_DEPTH_STATES);
      const depth = emptyQueueDepth();
      for (const state of QUEUE_DEPTH_STATES) {
        const value = counts[state];
        if (typeof value === 'number' && Number.isFinite(value)) depth[state] = value;
      }
      depths.set(queue, depth);
    } catch {
      unavailable.push(queue);
    }
  }

  return { depths, unavailable };
}
