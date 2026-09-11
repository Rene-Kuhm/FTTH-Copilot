/**
 * Golden File Generator for Conformance Testing (Roadmap Fase 7).
 *
 * Generates reference golden snapshots of raw evidence envelopes
 * and normalized telemetry events for all Level L2 vendors and RFC Standard.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  createRawEvidenceEnvelope,
  defaultAdapterRegistry,
  type DecodedSnmpNotification,
  type ResolvedDeviceIdentity,
} from '../packages/monitoring/src';

interface VendorGoldenConfig {
  vendor: string;
  filename: string;
  identity: ResolvedDeviceIdentity;
  notification: DecodedSnmpNotification;
}

const GOLDEN_DIR = path.resolve(__dirname, '../packages/monitoring/tests/conformance/golden');

const CONFIGS: VendorGoldenConfig[] = [
  // 1. Huawei
  {
    vendor: 'Huawei',
    filename: 'huawei.golden.json',
    identity: {
      tenantId: 'tenant-test',
      connectionId: 'conn-hw-1',
      oltId: 'HW-OLT-01',
      vendor: 'Huawei',
      pen: 2011,
      isStandardTrap: false,
      isAmbiguous: false,
    },
    notification: {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.1.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14',
      sysUpTime: 345600,
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1',
          type: 'OctetString',
          value: 'HWTC12345678',
          rawHex: '485754433132333435363738',
        },
      ],
    },
  },

  // 2. ZTE
  {
    vendor: 'ZTE',
    filename: 'zte.golden.json',
    identity: {
      tenantId: 'tenant-test',
      connectionId: 'conn-zte-1',
      oltId: 'ZTE-OLT-01',
      vendor: 'ZTE',
      pen: 3902,
      isStandardTrap: false,
      isAmbiguous: false,
    },
    notification: {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.2.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1.1.1.3.2.5',
      sysUpTime: 500120,
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1.1.1',
          type: 'OctetString',
          value: 'ZTEGC8765432',
        },
      ],
    },
  },

  // 3. Nokia
  {
    vendor: 'Nokia',
    filename: 'nokia.golden.json',
    identity: {
      tenantId: 'tenant-test',
      connectionId: 'conn-nokia-1',
      oltId: 'NOKIA-ISAM-01',
      vendor: 'Nokia',
      pen: 637,
      isStandardTrap: false,
      isAmbiguous: false,
    },
    notification: {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.3.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.637.61.1.36.1.1.1.1.1.2.4.10',
      sysUpTime: 120000,
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.637.61.1.36.1.2.1',
          type: 'OctetString',
          value: 'ALCL12345678',
        },
      ],
    },
  },

  // 4. FiberHome
  {
    vendor: 'FiberHome',
    filename: 'fiberhome.golden.json',
    identity: {
      tenantId: 'tenant-test',
      connectionId: 'conn-fh-1',
      oltId: 'FH-AN5516-01',
      vendor: 'FiberHome',
      pen: 3807,
      isStandardTrap: false,
      isAmbiguous: false,
    },
    notification: {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.4.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3807.1.3.1.1.2.2.4.12',
      sysUpTime: 789000,
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.3807.1.3.1.1.2.1',
          type: 'OctetString',
          value: 'FHTT12345678',
        },
      ],
    },
  },

  // 5. Calix
  {
    vendor: 'Calix',
    filename: 'calix.golden.json',
    identity: {
      tenantId: 'tenant-test',
      connectionId: 'conn-calix-1',
      oltId: 'CALIX-E7-01',
      vendor: 'Calix',
      pen: 6321,
      isStandardTrap: false,
      isAmbiguous: false,
    },
    notification: {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.5.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.6321.1.2.2.4.2.1',
      sysUpTime: 998000,
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.6321.1.2.2.4.1.1.6',
          type: 'OctetString',
          value: 'ont 1/1/2/4',
        },
        {
          oid: '1.3.6.1.4.1.6321.1.2.2.4.1.1.1',
          type: 'OctetString',
          value: 'loss-of-signal',
        },
        {
          oid: '1.3.6.1.4.1.6321.1.2.2.4.1.1.2',
          type: 'OctetString',
          value: 'CXNK00123456',
        },
      ],
    },
  },

  // 6. Adtran
  {
    vendor: 'Adtran',
    filename: 'adtran.golden.json',
    identity: {
      tenantId: 'tenant-test',
      connectionId: 'conn-adtran-1',
      oltId: 'ADTRAN-TA5000-01',
      vendor: 'Adtran',
      pen: 664,
      isStandardTrap: false,
      isAmbiguous: false,
    },
    notification: {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.6.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.664.5.53.1.4.1',
      sysUpTime: 654000,
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.664.5.53.1.1.1.1',
          type: 'OctetString',
          value: '1.2.8',
        },
        {
          oid: '1.3.6.1.4.1.664.5.53.1.1.1.2',
          type: 'OctetString',
          value: 'ADTN12345678',
        },
      ],
    },
  },

  // 7. VSOL
  {
    vendor: 'VSOL',
    filename: 'vsol.golden.json',
    identity: {
      tenantId: 'tenant-test',
      connectionId: 'conn-vsol-1',
      oltId: 'VSOL-V1600-01',
      vendor: 'VSOL',
      pen: 37950,
      isStandardTrap: false,
      isAmbiguous: false,
    },
    notification: {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.7.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.37950.1.1.5.10.1.2.1.2.5',
      sysUpTime: 432100,
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.37950.1.1.5.10.1.1.1',
          type: 'OctetString',
          value: 'VSOL12345678',
        },
      ],
    },
  },

  // 8. BDCOM
  {
    vendor: 'BDCOM',
    filename: 'bdcom.golden.json',
    identity: {
      tenantId: 'tenant-test',
      connectionId: 'conn-bdcom-1',
      oltId: 'BDCOM-P3600-01',
      vendor: 'BDCOM',
      pen: 3320,
      isStandardTrap: false,
      isAmbiguous: false,
    },
    notification: {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.8.10',
      senderPort: 162,
      trapOid: '1.3.6.1.4.1.3320.10.3.1.1.2.1.4.12',
      sysUpTime: 234500,
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.4.1.3320.10.3.1.1.1.1',
          type: 'OctetString',
          value: 'BDCM12345678',
        },
      ],
    },
  },

  // 9. RFC Standard
  {
    vendor: 'Standard RFC',
    filename: 'rfc-standard.golden.json',
    identity: {
      tenantId: 'tenant-test',
      connectionId: 'conn-rfc-1',
      oltId: 'RFC-OLT-01',
      vendor: 'RFC',
      pen: null,
      isStandardTrap: true,
      isAmbiguous: false,
    },
    notification: {
      version: 'v2c',
      pduType: 'TrapV2',
      senderIp: '10.100.9.10',
      senderPort: 162,
      trapOid: '1.3.6.1.6.3.1.1.5.3', // linkDown
      sysUpTime: 112233,
      receivedAtMs: 1773316800000,
      varbinds: [
        {
          oid: '1.3.6.1.2.1.2.2.1.1.1',
          type: 'Integer',
          value: 1,
        },
        {
          oid: '1.3.6.1.2.1.2.2.1.2.1',
          type: 'OctetString',
          value: 'ge-0/0/1',
        },
      ],
    },
  },
];

async function generate(): Promise<void> {
  if (!fs.existsSync(GOLDEN_DIR)) {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
  }

  for (const cfg of CONFIGS) {
    const evidence = createRawEvidenceEnvelope(cfg.notification);
    const adapter = defaultAdapterRegistry.resolve(cfg.notification, cfg.identity);
    const telemetry = adapter.normalize(cfg.notification, cfg.identity, evidence);

    const snapshot = {
      vendor: cfg.vendor,
      trapOid: cfg.notification.trapOid,
      identity: cfg.identity,
      input: {
        version: cfg.notification.version,
        senderIp: cfg.notification.senderIp,
        senderPort: cfg.notification.senderPort,
        trapOid: cfg.notification.trapOid,
        sysUpTime: cfg.notification.sysUpTime,
        varbinds: cfg.notification.varbinds,
      },
      rawEvidence: {
        senderIp: evidence.senderIp,
        senderPort: evidence.senderPort,
        snmpVersion: evidence.snmpVersion,
        pduType: evidence.pduType,
        trapOid: evidence.trapOid,
        sysUpTime: evidence.sysUpTime,
        credentialsRedacted: evidence.credentialsRedacted,
        varbindCount: evidence.varbinds.length,
        varbinds: evidence.varbinds,
      },
      expectedTelemetry: {
        deviceKind: telemetry.deviceKind,
        deviceId: telemetry.deviceId,
        eventType: telemetry.eventType,
        severity: telemetry.severity,
        metrics: telemetry.metrics,
        tags: telemetry.tags,
      },
    };

    const outPath = path.join(GOLDEN_DIR, cfg.filename);
    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
    console.log(`Generated: ${cfg.filename}`);
  }

  console.log(`✅ All ${CONFIGS.length} golden snapshots generated in ${GOLDEN_DIR}`);
}

generate().catch((err) => {
  console.error('Failed to generate golden files:', err);
  process.exit(1);
});
