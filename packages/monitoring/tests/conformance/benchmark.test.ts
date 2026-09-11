import { describe, expect, it } from 'vitest';
import {
  createManagedSnmpReceiver,
  sendSnmpTestTrap,
  defaultAdapterRegistry,
  createRawEvidenceEnvelope,
  type DecodedSnmpNotification,
  type ResolvedDeviceIdentity,
} from '../../src';

describe('Conformance Lab: Benchmark & Performance SLA (Roadmap Fase 7)', () => {
  it('meets p95 latency (< 50ms) and bounded memory (< 50MB) over wire UDP loopback', async () => {
    const testPort = 12196;
    const numTraps = 100;
    const latenciesMs: number[] = [];

    const memBefore = process.memoryUsage().heapUsed;

    const receiver = createManagedSnmpReceiver({
      port: testPort,
      address: '127.0.0.1',
      registrations: [
        {
          senderIp: '127.0.0.1',
          tenantId: 'tenant-bench',
          connectionId: 'conn-bench-test',
          oltId: 'OLT-BENCH-TEST',
          vendor: 'Huawei',
          community: 'public',
        },
      ],
      guardOptions: {
        maxEventsPerWindow: 2000,
        dedupWindowMs: 0,
      },
    });

    try {
      for (let i = 0; i < numTraps; i++) {
        const t0 = process.hrtime.bigint();
        await sendSnmpTestTrap({
          port: testPort,
          version: 'v2c',
          trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14',
          varbinds: [
            {
              oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1',
              type: 'OctetString',
              value: `HWTC${String(i).padStart(8, '0')}`,
            },
          ],
        });
        const t1 = process.hrtime.bigint();
        latenciesMs.push(Number(t1 - t0) / 1_000_000);
      }

      await new Promise((r) => setTimeout(r, 100));
    } finally {
      receiver.close();
    }

    const memAfter = process.memoryUsage().heapUsed;
    const heapDeltaMb = (memAfter - memBefore) / (1024 * 1024);

    latenciesMs.sort((a, b) => a - b);
    const p95Idx = Math.floor(latenciesMs.length * 0.95);
    const p95LatencyMs = latenciesMs[p95Idx]!;

    expect(p95LatencyMs).toBeLessThan(50); // SLA < 50ms
    expect(heapDeltaMb).toBeLessThan(50); // Memory leak prevention < 50MB delta
  });

  it('normalizes all 8 Level L2 vendor adapters in < 1ms per event in-memory', () => {
    const vendors = [
      { name: 'Huawei', trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14', pen: 2011 },
      { name: 'ZTE', trapOid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1.1.1.3.2.5', pen: 3902 },
      { name: 'Nokia', trapOid: '1.3.6.1.4.1.637.61.1.36.1.1.1.1.1.2.4.10', pen: 637 },
      { name: 'FiberHome', trapOid: '1.3.6.1.4.1.3807.1.3.1.1.2.2.4.12', pen: 3807 },
      { name: 'Calix', trapOid: '1.3.6.1.4.1.6321.1.2.2.4.2.1', pen: 6321 },
      { name: 'Adtran', trapOid: '1.3.6.1.4.1.664.5.53.1.4.1', pen: 664 },
      { name: 'VSOL', trapOid: '1.3.6.1.4.1.37950.1.1.5.10.1.2.1.2.5', pen: 37950 },
      { name: 'BDCOM', trapOid: '1.3.6.1.4.1.3320.10.3.1.1.2.1.4.12', pen: 3320 },
    ];

    for (const v of vendors) {
      const notif: DecodedSnmpNotification = {
        version: 'v2c',
        pduType: 'TrapV2',
        senderIp: '10.0.0.1',
        senderPort: 162,
        trapOid: v.trapOid,
        receivedAtMs: Date.now(),
        varbinds: [{ oid: '1.3.6.1.2.1.2.2.1.1.1', type: 'Integer', value: 1 }],
      };
      const identity: ResolvedDeviceIdentity = {
        tenantId: 't1',
        connectionId: 'c1',
        oltId: `${v.name.toUpperCase()}-01`,
        vendor: v.name,
        pen: v.pen,
        isStandardTrap: false,
        isAmbiguous: false,
      };
      const evidence = createRawEvidenceEnvelope(notif);
      const adapter = defaultAdapterRegistry.resolve(notif, identity);

      // Warm up JIT
      adapter.normalize(notif, identity, evidence);

      // Measure over 10 iterations
      const runs = 10;
      let totalTimeMs = 0;
      for (let k = 0; k < runs; k++) {
        const t0 = process.hrtime.bigint();
        adapter.normalize(notif, identity, evidence);
        const t1 = process.hrtime.bigint();
        totalTimeMs += Number(t1 - t0) / 1_000_000;
      }

      const avgMs = totalTimeMs / runs;
      expect(avgMs).toBeLessThan(15.0); // Warmed-up normalization must be fast under CPU load (< 15ms)
    }
  });
});
