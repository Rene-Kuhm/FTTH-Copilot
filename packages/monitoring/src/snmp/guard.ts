/**
 * SNMP Ingestion Guard & Canonical Fingerprinting (Roadmap Fase 6 — 6.5 & Roadmap Fase 0).
 *
 * 6.5: "Controlar tasa, concurrencia, cola acotada, duplicados y pérdida de eventos;
 *      exponer descartes y salud. Documentar las limitaciones de entrega UDP."
 * Fase 0: "Reemplazar la deduplicación IP:tamaño por una huella de remitente, versión,
 *          request ID, OID y varbinds canónicos."
 */

import crypto from 'node:crypto';

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

export interface SnmpNotificationComponents {
  senderIp: string;
  version: 'v1' | 'v2c' | 'v3';
  requestId?: number | null;
  trapOid: string;
  varbinds: ReadonlyArray<{ oid: string; value: unknown; type?: string }>;
  sysUpTime?: number | null;
}

/**
 * Computes a deterministic SHA-256 fingerprint for an SNMP notification.
 * Resolves the issue where different traps with identical byte length previously collided.
 */
export function computeSnmpNotificationFingerprint(components: SnmpNotificationComponents): string {
  const sortedVarbinds = [...components.varbinds]
    .sort((a, b) => a.oid.localeCompare(b.oid))
    .map((vb) => `${vb.oid}=${String(vb.value)}`)
    .join(';');

  const content = [
    components.senderIp.trim(),
    components.version,
    components.requestId != null ? String(components.requestId) : '',
    components.trapOid.trim(),
    sortedVarbinds,
    components.sysUpTime != null ? String(components.sysUpTime) : '',
  ].join('|');

  return crypto.createHash('sha256').update(content).digest('hex');
}

export interface SnmpIngestionGuard {
  /**
   * Evaluates size, rate, and deduplication signature in one step (backward-compatible).
   */
  evaluate: (bytesLength: number, signature: string, nowMs?: number) => SnmpEvaluationResult;

  /**
   * Step 1: Pre-parse guard checking raw payload size and rate limits.
   * Discards oversized or flooding packets before parsing ASN.1 BER.
   */
  evaluatePreParse: (bytesLength: number, senderIp: string, nowMs?: number) => SnmpEvaluationResult;

  /**
   * Step 2: Canonical deduplication based on cryptographic notification fingerprint.
   */
  evaluateDeduplication: (fingerprint: string, nowMs?: number) => SnmpEvaluationResult;

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

  // Deduplication cache: fingerprint -> timestamp
  const dedupCache = new Map<string, number>();

  function pruneDedupCache(nowMs: number) {
    if (dedupCache.size > 2000) {
      for (const [sig, ts] of dedupCache.entries()) {
        if (nowMs - ts >= dedupWindowMs) {
          dedupCache.delete(sig);
        }
      }
    }
  }

  function evaluatePreParse(bytesLength: number, _senderIp: string, nowMs = Date.now()): SnmpEvaluationResult {
    // 1. Check maximum payload size
    if (bytesLength > maxPayloadBytes) {
      dropped += 1;
      droppedByReason.payload_oversized += 1;
      return { allow: false, dropReason: 'payload_oversized' };
    }

    // 2. Clean up sliding rate window
    const windowStart = nowMs - windowMs;
    while (timestamps.length > 0 && timestamps[0]! < windowStart) {
      timestamps.shift();
    }

    // 3. Check rate limit
    if (timestamps.length >= maxEvents) {
      dropped += 1;
      droppedByReason.rate_exceeded += 1;
      return { allow: false, dropReason: 'rate_exceeded' };
    }

    timestamps.push(nowMs);
    return { allow: true };
  }

  function evaluateDeduplication(fingerprint: string, nowMs = Date.now()): SnmpEvaluationResult {
    const lastSeen = dedupCache.get(fingerprint);
    if (lastSeen !== undefined && nowMs - lastSeen < dedupWindowMs) {
      dropped += 1;
      droppedByReason.duplicate += 1;
      return { allow: false, dropReason: 'duplicate' };
    }

    dedupCache.set(fingerprint, nowMs);
    accepted += 1;
    pruneDedupCache(nowMs);

    return { allow: true };
  }

  function evaluate(bytesLength: number, signature: string, nowMs = Date.now()): SnmpEvaluationResult {
    const pre = evaluatePreParse(bytesLength, signature, nowMs);
    if (!pre.allow) return pre;
    return evaluateDeduplication(signature, nowMs);
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
    evaluatePreParse,
    evaluateDeduplication,
    getMetrics,
    reset,
  };
}
