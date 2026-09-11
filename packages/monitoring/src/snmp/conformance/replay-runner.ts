/**
 * SNMP Replay Runner for Hardwareless Conformance Testing (Roadmap Fase 7).
 *
 * Provides execution harness to replay vendor fixture traps over UDP loopback
 * into the managed SNMP receiver, supporting rate control, burst modes, and metrics.
 */

import { sendSnmpTestTrap, type SendSnmpTrapOptions } from '../test-client';
import { fixtureTrapToSendOptions, type FixtureTrapItem } from './packet-generator';

export interface ReplayOptions {
  port: number;
  host?: string;
  delayBetweenMs?: number;
  community?: string;
}

export interface BurstOptions {
  port: number;
  host?: string;
  concurrency?: number;
  community?: string;
}

export interface ReplaySummary {
  total: number;
  successful: number;
  failed: number;
  durationMs: number;
  eventsPerSec: number;
  errors: string[];
}

export class SnmpReplayRunner {
  /**
   * Replays a list of fixture traps sequentially with optional inter-packet delay.
   */
  public async replayItems(
    items: FixtureTrapItem[],
    options: ReplayOptions,
  ): Promise<ReplaySummary> {
    const startTime = Date.now();
    let successful = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const item of items) {
      const sendOptions: SendSnmpTrapOptions = fixtureTrapToSendOptions(
        item,
        options.port,
        options.host,
      );
      if (options.community) {
        sendOptions.community = options.community;
      }

      try {
        await sendSnmpTestTrap(sendOptions);
        successful++;
      } catch (err: unknown) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`[${item.trapOid}] ${msg}`);
      }

      if (options.delayBetweenMs && options.delayBetweenMs > 0) {
        await new Promise((r) => setTimeout(r, options.delayBetweenMs));
      }
    }

    const durationMs = Math.max(1, Date.now() - startTime);
    const eventsPerSec = Number(((items.length / durationMs) * 1000).toFixed(2));

    return {
      total: items.length,
      successful,
      failed,
      durationMs,
      eventsPerSec,
      errors,
    };
  }

  /**
   * Replays a single trap template in high-volume burst to test queue bounding and throughput.
   */
  public async replayBurst(
    template: FixtureTrapItem,
    count: number,
    options: BurstOptions,
  ): Promise<ReplaySummary> {
    const startTime = Date.now();
    let successful = 0;
    let failed = 0;
    const errors: string[] = [];
    const concurrency = Math.max(1, options.concurrency ?? 25);

    const baseOptions = fixtureTrapToSendOptions(template, options.port, options.host);
    if (options.community) {
      baseOptions.community = options.community;
    }

    // Execute in chunks matching concurrency
    for (let i = 0; i < count; i += concurrency) {
      const chunkSize = Math.min(concurrency, count - i);
      const chunkPromises = Array.from({ length: chunkSize }, async (_, idx) => {
        try {
          await sendSnmpTestTrap({
            ...baseOptions,
            varbinds: [
              ...(baseOptions.varbinds ?? []),
              { oid: '1.3.6.1.2.1.2.2.1.1.1', type: 'Integer', value: i + idx },
            ],
          });
          successful++;
        } catch (err: unknown) {
          failed++;
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(msg);
        }
      });
      await Promise.all(chunkPromises);
    }

    const durationMs = Math.max(1, Date.now() - startTime);
    const eventsPerSec = Number(((count / durationMs) * 1000).toFixed(2));

    return {
      total: count,
      successful,
      failed,
      durationMs,
      eventsPerSec,
      errors,
    };
  }
}
