/**
 * SNMP Ingestion Guard (Roadmap Fase 6 — 6.5).
 *
 * 6.5: "Controlar tasa, concurrencia, cola acotada, duplicados y pérdida de eventos;
 *      exponer descartes y salud. Documentar las limitaciones de entrega UDP."
 */

export interface SnmpGuardOptions {
  maxPayloadBytes?: number;
  maxEventsPerWindow?: number;
  windowMs?: number;
  dedupWindowMs?: number;
}

export type SnmpDropReason = 'payload_oversized' | 'rate_exceeded' | 'duplicate';

export interface SnmpEvaluationResult {
  allow: boolean;
  dropReason?: SnmpDropReason;
}

export interface SnmpGuardMetrics {
  accepted: number;
  dropped: number;
  droppedByReason: Record<SnmpDropReason, number>;
}

export interface SnmpIngestionGuard {
  evaluate: (bytesLength: number, signature: string, nowMs?: number) => SnmpEvaluationResult;
  getMetrics: () => SnmpGuardMetrics;
  reset: () => void;
}

export function createSnmpIngestionGuard(options: SnmpGuardOptions = {}): SnmpIngestionGuard {
  const maxPayloadBytes = options.maxPayloadBytes ?? 2048;
  const maxEvents = options.maxEventsPerWindow ?? 1000;
  const windowMs = options.windowMs ?? 60000;
  const dedupWindowMs = options.dedupWindowMs ?? 5000;

  let accepted = 0;
  let dropped = 0;
  const droppedByReason: Record<SnmpDropReason, number> = {
    payload_oversized: 0,
    rate_exceeded: 0,
    duplicate: 0,
  };

  // Sliding window timestamps for rate limiting
  const timestamps: number[] = [];

  // Deduplication cache: signature -> timestamp
  const dedupCache = new Map<string, number>();

  function evaluate(bytesLength: number, signature: string, nowMs = Date.now()): SnmpEvaluationResult {
    // 1. Check maximum payload size
    if (bytesLength > maxPayloadBytes) {
      dropped += 1;
      droppedByReason.payload_oversized += 1;
      return { allow: false, dropReason: 'payload_oversized' };
    }

    // 2. Check deduplication window
    const lastSeen = dedupCache.get(signature);
    if (lastSeen !== undefined && nowMs - lastSeen < dedupWindowMs) {
      dropped += 1;
      droppedByReason.duplicate += 1;
      return { allow: false, dropReason: 'duplicate' };
    }

    // 3. Clean up sliding rate window
    const windowStart = nowMs - windowMs;
    while (timestamps.length > 0 && timestamps[0]! < windowStart) {
      timestamps.shift();
    }

    // 4. Check rate limit
    if (timestamps.length >= maxEvents) {
      dropped += 1;
      droppedByReason.rate_exceeded += 1;
      return { allow: false, dropReason: 'rate_exceeded' };
    }

    // Admitted
    accepted += 1;
    timestamps.push(nowMs);
    dedupCache.set(signature, nowMs);

    // Prune dedup cache periodically
    if (dedupCache.size > 2000) {
      for (const [sig, ts] of dedupCache.entries()) {
        if (nowMs - ts >= dedupWindowMs) {
          dedupCache.delete(sig);
        }
      }
    }

    return { allow: true };
  }

  function getMetrics(): SnmpGuardMetrics {
    return {
      accepted,
      dropped,
      droppedByReason: { ...droppedByReason },
    };
  }

  function reset(): void {
    accepted = 0;
    dropped = 0;
    droppedByReason.payload_oversized = 0;
    droppedByReason.rate_exceeded = 0;
    droppedByReason.duplicate = 0;
    timestamps.length = 0;
    dedupCache.clear();
  }

  return {
    evaluate,
    getMetrics,
    reset,
  };
}
