import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import {
  createRawEvidenceEnvelope,
  defaultAdapterRegistry,
  setSimulatorProvisionalTraps,
  lookupTrapDefinition,
  type DecodedSnmpNotification,
  type ResolvedDeviceIdentity,
} from '../../src';
import { telemetryEventSchema } from '@ftth-copilot/shared';

const GOLDEN_DIR = path.resolve(__dirname, './golden');

describe('Conformance Lab: Golden File Snapshots (Roadmap Fase 7)', () => {
  beforeAll(() => {
    setSimulatorProvisionalTraps(true);
  });

  afterAll(() => {
    setSimulatorProvisionalTraps(false);
  });

  it('suppresses provisional traps by default outside simulator mode', () => {
    setSimulatorProvisionalTraps(false);
    const def = lookupTrapDefinition('1.3.6.1.4.1.2011.6.128.1.1.2.43.1');
    expect(def.name).toBe('provisionalTrap');
    expect(def.category).toBe('unknown_trap');
    expect(def.severity).toBe('info');
    expect(def.catalogStatus).toBe('provisional');
    expect(def.candidateTrapName).toBe('hwGponOntLossOfSignal');
    setSimulatorProvisionalTraps(true);
  });
  const goldenFiles = fs
    .readdirSync(GOLDEN_DIR)
    .filter((file) => file.endsWith('.golden.json'));

  it('contains golden snapshots for all 8 L2 vendors plus RFC Standard', () => {
    expect(goldenFiles.length).toBeGreaterThanOrEqual(9);
    const expectedVendors = [
      'huawei.golden.json',
      'zte.golden.json',
      'nokia.golden.json',
      'fiberhome.golden.json',
      'calix.golden.json',
      'adtran.golden.json',
      'vsol.golden.json',
      'bdcom.golden.json',
      'rfc-standard.golden.json',
    ];
    for (const expected of expectedVendors) {
      expect(goldenFiles).toContain(expected);
    }
  });

  goldenFiles.forEach((file) => {
    const filePath = path.join(GOLDEN_DIR, file);
    const golden = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    it(`verifies golden snapshot conformance for ${golden.vendor} (${file})`, () => {
      const notification: DecodedSnmpNotification = {
        version: golden.input.version,
        pduType: 'TrapV2',
        senderIp: golden.input.senderIp,
        senderPort: golden.input.senderPort,
        trapOid: golden.input.trapOid,
        sysUpTime: golden.input.sysUpTime,
        receivedAtMs: 1773316800000,
        varbinds: golden.input.varbinds,
      };

      const identity: ResolvedDeviceIdentity = golden.identity;

      // 1. Evidence envelope verification
      const evidence = createRawEvidenceEnvelope(notification);
      expect(evidence.senderIp).toBe(golden.rawEvidence.senderIp);
      expect(evidence.senderPort).toBe(golden.rawEvidence.senderPort);
      expect(evidence.snmpVersion).toBe(golden.rawEvidence.snmpVersion);
      expect(evidence.pduType).toBe(golden.rawEvidence.pduType);
      expect(evidence.trapOid).toBe(golden.rawEvidence.trapOid);
      expect(evidence.sysUpTime).toBe(golden.rawEvidence.sysUpTime);
      expect(evidence.credentialsRedacted).toBe(true);
      expect(evidence.varbinds.length).toBe(golden.rawEvidence.varbindCount);

      // 2. Normalization verification
      const adapter = defaultAdapterRegistry.resolve(notification, identity);
      const telemetry = adapter.normalize(notification, identity, evidence);

      expect(telemetry.deviceKind).toBe(golden.expectedTelemetry.deviceKind);
      expect(telemetry.deviceId).toBe(golden.expectedTelemetry.deviceId);
      expect(telemetry.severity).toBe(golden.expectedTelemetry.severity);

      // Verify key metrics matching golden file
      for (const [key, value] of Object.entries(golden.expectedTelemetry.metrics)) {
        expect(telemetry.metrics[key]).toEqual(value);
      }

      // Verify key tags matching golden file
      for (const [key, value] of Object.entries(golden.expectedTelemetry.tags)) {
        expect(telemetry.tags?.[key]).toEqual(value);
      }

      // 3. Schema validation
      const parseResult = telemetryEventSchema.safeParse(telemetry);
      expect(parseResult.success).toBe(true);
    });
  });
});
