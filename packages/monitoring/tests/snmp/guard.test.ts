import { describe, expect, it } from 'vitest';
import {
  createSnmpIngestionGuard,
  computeSnmpNotificationFingerprint,
} from '../../src/snmp/guard';

describe('SNMP Ingestion Guard (Roadmap Fase 6 — 6.5 & Roadmap Fase 0)', () => {
  it('allows packets within payload size and rate limits', () => {
    const guard = createSnmpIngestionGuard({
      maxPayloadBytes: 2048,
      maxEventsPerWindow: 10,
      windowMs: 60000,
    });

    const res = guard.evaluate(500, 'sig-1', 1000);
    expect(res.allow).toBe(true);
    expect(res.dropReason).toBeUndefined();
    expect(guard.getMetrics().accepted).toBe(1);
    expect(guard.getMetrics().dropped).toBe(0);
  });

  it('rejects packets exceeding maximum payload size', () => {
    const guard = createSnmpIngestionGuard({ maxPayloadBytes: 1024 });

    const res = guard.evaluate(2048, 'sig-big', 1000);
    expect(res.allow).toBe(false);
    expect(res.dropReason).toBe('payload_oversized');
    expect(guard.getMetrics().dropped).toBe(1);
  });

  it('enforces rate limit window (burst protection)', () => {
    const guard = createSnmpIngestionGuard({
      maxEventsPerWindow: 2,
      windowMs: 1000,
    });

    expect(guard.evaluate(100, 'sig-1', 1000).allow).toBe(true);
    expect(guard.evaluate(100, 'sig-2', 1100).allow).toBe(true);

    const blocked = guard.evaluate(100, 'sig-3', 1200);
    expect(blocked.allow).toBe(false);
    expect(blocked.dropReason).toBe('rate_exceeded');
  });

  it('deduplicates identical traps within sliding deduplication window', () => {
    const guard = createSnmpIngestionGuard({
      dedupWindowMs: 5000,
      maxEventsPerWindow: 100,
    });

    // First arrival allows
    expect(guard.evaluate(100, 'olt-1:hwOntDyingGasp:onu-12', 1000).allow).toBe(true);

    // Immediate duplicate arrival within 5s is dropped
    const dup = guard.evaluate(100, 'olt-1:hwOntDyingGasp:onu-12', 2000);
    expect(dup.allow).toBe(false);
    expect(dup.dropReason).toBe('duplicate');

    // After deduplication window expires, arrival is allowed
    expect(guard.evaluate(100, 'olt-1:hwOntDyingGasp:onu-12', 7000).allow).toBe(true);
  });

  it('verifies two distinct traps with the identical byte length do not collide (Gate 0)', () => {
    const guard = createSnmpIngestionGuard({ dedupWindowMs: 5000 });

    const trapA = {
      senderIp: '192.168.10.1',
      version: 'v2c' as const,
      requestId: 101,
      trapOid: '1.3.6.1.6.3.1.1.5.3', // linkDown
      varbinds: [{ oid: '1.3.6.1.2.1.2.2.1.1.1', value: 1 }],
      sysUpTime: 1000,
    };

    const trapB = {
      senderIp: '192.168.10.1',
      version: 'v2c' as const,
      requestId: 102,
      trapOid: '1.3.6.1.6.3.1.1.5.4', // linkUp (different alarm, same byte size)
      varbinds: [{ oid: '1.3.6.1.2.1.2.2.1.1.1', value: 1 }],
      sysUpTime: 1000,
    };

    const fpA = computeSnmpNotificationFingerprint(trapA);
    const fpB = computeSnmpNotificationFingerprint(trapB);

    expect(fpA).not.toBe(fpB);

    // Pre-parse allows both packets of same length (e.g. 150 bytes)
    const byteSize = 150;
    expect(guard.evaluatePreParse(byteSize, trapA.senderIp, 1000).allow).toBe(true);
    expect(guard.evaluatePreParse(byteSize, trapB.senderIp, 1000).allow).toBe(true);

    // Fingerprint deduplication evaluates both independently
    expect(guard.evaluateDeduplication(fpA, 1000).allow).toBe(true);
    expect(guard.evaluateDeduplication(fpB, 1000).allow).toBe(true);

    // True duplicate of Trap A within dedup window is rejected
    expect(guard.evaluateDeduplication(fpA, 2000).allow).toBe(false);
  });
});
