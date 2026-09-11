import { describe, expect, it } from 'vitest';
import {
  computeSnmpNotificationFingerprint,
  createRawEvidenceEnvelope,
  createSnmpIngestionGuard,
  defaultAdapterRegistry,
  isClearingTrap,
  type DecodedSnmpNotification,
  type ResolvedDeviceIdentity,
} from '../../src';

describe('Conformance Lab: Fault & Resilience Scenarios (Roadmap Fase 7)', () => {
  const baseIdentity: ResolvedDeviceIdentity = {
    tenantId: 'tenant-test',
    connectionId: 'conn-lab-01',
    oltId: 'HW-MA5800-01',
    vendor: 'Huawei',
    pen: 2011,
    isStandardTrap: false,
    isAmbiguous: false,
  };

  // 4.1 Alarm / Clear Pair Correlation
  describe('4.1 Alarm / Clear Pair Correlation', () => {
    it('accurately correlates and resolves alarm/clear pairs', () => {
      const alarmNotification: DecodedSnmpNotification = {
        version: 'v2c',
        pduType: 'TrapV2',
        senderIp: '10.100.1.10',
        senderPort: 162,
        trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14', // Dying gasp
        sysUpTime: 100000,
        receivedAtMs: Date.now(),
        varbinds: [
          { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1', type: 'OctetString', value: 'HWTC12345678' },
        ],
      };

      const clearNotification: DecodedSnmpNotification = {
        version: 'v2c',
        pduType: 'TrapV2',
        senderIp: '10.100.1.10',
        senderPort: 162,
        trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.11.0.2.1.14', // ONT Online (Recovery)
        sysUpTime: 100500,
        receivedAtMs: Date.now() + 5000,
        varbinds: [
          { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1', type: 'OctetString', value: 'HWTC12345678' },
        ],
      };

      const adapter = defaultAdapterRegistry.resolve(alarmNotification, baseIdentity);
      const alarmEv = createRawEvidenceEnvelope(alarmNotification);
      const clearEv = createRawEvidenceEnvelope(clearNotification);

      const alarmTelemetry = adapter.normalize(alarmNotification, baseIdentity, alarmEv);
      const clearTelemetry = adapter.normalize(clearNotification, baseIdentity, clearEv);

      expect(alarmTelemetry.metrics['severity']).toBe('critical');
      expect(alarmTelemetry.metrics['isClear']).toBeUndefined();

      expect(clearTelemetry.metrics['isClear']).toBe(true);
      expect(clearTelemetry.metrics['clearsCategory']).toBe('onu_offline');
      expect(isClearingTrap('link_up')).toBe(true);
    });
  });

  // 4.2 Duplicate Trap Suppression Window
  describe('4.2 Duplicate Trap Suppression Window', () => {
    it('suppresses identical traps arriving within the deduplication window', () => {
      const guard = createSnmpIngestionGuard({
        dedupWindowMs: 5000,
        maxEventsPerWindow: 1000,
        windowMs: 60000,
      });

      const fingerprint = computeSnmpNotificationFingerprint({
        senderIp: '10.100.1.10',
        version: 'v2c',
        requestId: 42,
        trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14',
        sysUpTime: 123456,
        varbinds: [{ oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1', type: 'OctetString', value: 'HWTC12345678' }],
      });

      const firstEval = guard.evaluate(120, fingerprint);
      expect(firstEval.allow).toBe(true);

      const secondEval = guard.evaluate(120, fingerprint);
      expect(secondEval.allow).toBe(false);
      expect(secondEval.dropReason).toBe('duplicate');

      const metrics = guard.getMetrics();
      expect(metrics.accepted).toBe(1);
      expect(metrics.dropped).toBe(1);
      expect(metrics.droppedByReason['duplicate']).toBe(1);
    });
  });

  // 4.3 Replay Protection & Fingerprint Determinism
  describe('4.3 Replay Protection & Fingerprint Determinism', () => {
    it('computes identical canonical fingerprints for replayed payloads', () => {
      const notificationA: DecodedSnmpNotification = {
        version: 'v2c',
        pduType: 'TrapV2',
        senderIp: '10.100.1.10',
        senderPort: 162,
        trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14',
        sysUpTime: 123456,
        receivedAtMs: 1000,
        varbinds: [{ oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1', type: 'OctetString', value: 'HWTC12345678' }],
      };

      const notificationB: DecodedSnmpNotification = {
        ...notificationA,
        receivedAtMs: 2000, // Arrived later, replayed
      };

      const envA = createRawEvidenceEnvelope(notificationA);
      const envB = createRawEvidenceEnvelope(notificationB);

      expect(envA.fingerprint).toBe(envB.fingerprint);
      expect(envA.credentialsRedacted).toBe(true);
      expect(envB.credentialsRedacted).toBe(true);
    });
  });

  // 4.4 Out-of-Order Delivery
  describe('4.4 Out-of-Order Delivery', () => {
    it('handles inverted alarm/clear sequence without throwing or invalid states', () => {
      const clearNotification: DecodedSnmpNotification = {
        version: 'v2c',
        pduType: 'TrapV2',
        senderIp: '10.100.1.10',
        senderPort: 162,
        trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.11.0.2.1.14', // Clear arrives first
        sysUpTime: 100500,
        receivedAtMs: Date.now(),
        varbinds: [
          { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1', type: 'OctetString', value: 'HWTC12345678' },
        ],
      };

      const alarmNotification: DecodedSnmpNotification = {
        version: 'v2c',
        pduType: 'TrapV2',
        senderIp: '10.100.1.10',
        senderPort: 162,
        trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14', // Alarm arrives second
        sysUpTime: 100000,
        receivedAtMs: Date.now() + 50,
        varbinds: [
          { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1', type: 'OctetString', value: 'HWTC12345678' },
        ],
      };

      const adapter = defaultAdapterRegistry.resolve(clearNotification, baseIdentity);

      const clearEv = createRawEvidenceEnvelope(clearNotification);
      const clearTelemetry = adapter.normalize(clearNotification, baseIdentity, clearEv);
      expect(clearTelemetry.metrics['isClear']).toBe(true);

      const alarmEv = createRawEvidenceEnvelope(alarmNotification);
      const alarmTelemetry = adapter.normalize(alarmNotification, baseIdentity, alarmEv);
      expect(alarmTelemetry.metrics['severity']).toBe('critical');
    });
  });

  // 4.5 Clock Skew & SysUpTime Anomalies
  describe('4.5 Clock Skew & SysUpTime Anomalies', () => {
    it('handles sysUpTime wrap-around and past timestamps safely', () => {
      const wrappedNotification: DecodedSnmpNotification = {
        version: 'v2c',
        pduType: 'TrapV2',
        senderIp: '10.100.1.10',
        senderPort: 162,
        trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14',
        sysUpTime: 10, // Wrapped around after counter overflow (reboot)
        receivedAtMs: Date.now(),
        varbinds: [
          { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1', type: 'OctetString', value: 'HWTC12345678' },
        ],
      };

      const adapter = defaultAdapterRegistry.resolve(wrappedNotification, baseIdentity);
      const evidence = createRawEvidenceEnvelope(wrappedNotification);
      const telemetry = adapter.normalize(wrappedNotification, baseIdentity, evidence);

      expect(telemetry.metrics['sysUpTime']).toBe(10);
      expect(telemetry.ts).toBeDefined();
      expect(new Date(telemetry.ts).getTime()).toBeGreaterThan(0);
    });
  });

  // 4.6 Trap Storm & Ingestion Guard Queue Boundedness
  describe('4.6 Trap Storm & Queue Boundedness', () => {
    it('bounds processing during a 500-trap burst and accounts for drops accurately', () => {
      const maxBurst = 50;
      const guard = createSnmpIngestionGuard({
        dedupWindowMs: 0, // Disable dedup so rate limit is isolated
        maxEventsPerWindow: maxBurst,
        windowMs: 60000,
      });

      const burstSize = 500;
      let accepted = 0;
      let dropped = 0;
      const nowMs = 1700000000000;

      for (let i = 0; i < burstSize; i++) {
        const fingerprint = `sig-${i}`;
        const res = guard.evaluate(100, fingerprint, nowMs);

        if (res.allow) {
          accepted++;
        } else {
          dropped++;
          expect(res.dropReason).toBe('rate_exceeded');
        }
      }

      expect(accepted + dropped).toBe(burstSize);
      expect(accepted).toBe(maxBurst);
      expect(dropped).toBe(burstSize - maxBurst);

      const metrics = guard.getMetrics();
      expect(metrics.accepted).toBe(accepted);
      expect(metrics.dropped).toBe(dropped);
      expect(metrics.droppedByReason['rate_exceeded']).toBe(dropped);
    });
  });
});
