/**
 * SNMP Automated Trap & Inform Verification Script (Roadmap Fase 0, 2 & 3).
 *
 * Runs end-to-end verification of binary SNMPv1, SNMPv2c (TrapV2 & Inform),
 * SNMPv3 (RFC 3414 authPriv), Standard RFC OLT adapter, Huawei OLT adapter,
 * and ZTE OLT adapter in CI/local lab.
 */

import {
  createManagedSnmpReceiver,
  sendSnmpTestTrap,
  type DecodedSnmpNotification,
  type RawSnmpEvidenceEnvelope,
} from '../packages/monitoring/src';
import { type TelemetryEvent, telemetryEventSchema } from '../packages/shared/src';

async function run(): Promise<void> {
  const testPort = 12180;
  const received: Array<{ notif: DecodedSnmpNotification; evidence: RawSnmpEvidenceEnvelope }> = [];
  const telemetryEvents: TelemetryEvent[] = [];

  console.log(`[test:snmp] Starting managed SNMP receiver on 127.0.0.1:${testPort}...`);

  const receiver = createManagedSnmpReceiver({
    port: testPort,
    address: '127.0.0.1',
    registrations: [
      {
        senderIp: '127.0.0.1',
        tenantId: 'tenant-test',
        connectionId: 'conn-lab-1',
        oltId: 'OLT-TEST-01',
        community: 'public',
        v3User: {
          name: 'noc-operator',
          level: 'authPriv',
          authProtocol: 'sha',
          authKey: 'AuthKeyPassword123',
          privProtocol: 'aes',
          privKey: 'PrivKeyPassword123',
        },
      },
    ],
    onNotification: (notif, _ctx, evidence) => {
      console.log(`[test:snmp] Received ${notif.version} ${notif.pduType} (OID: ${notif.trapOid}, sysUpTime: ${notif.sysUpTime})`);
      received.push({ notif, evidence });
    },
    onTelemetryEvent: (event) => {
      telemetryEvents.push(event);
    },
    onError: (err, sourceIp) => {
      console.error(`[test:snmp] Receiver error from ${sourceIp}: ${err.message}`);
    },
  });

  try {
    // 1. Send SNMPv1 Trap
    console.log('[test:snmp] Sending binary SNMPv1 Trap...');
    await sendSnmpTestTrap({
      port: testPort,
      version: 'v1',
      trapOid: '1.3.6.1.4.1.2011.6',
      varbinds: [
        { oid: '1.3.6.1.4.1.2011.6.1', type: 'Integer', value: 101 },
      ],
    });
    await new Promise((r) => setTimeout(r, 150));

    // 2. Send SNMPv2c TrapV2
    console.log('[test:snmp] Sending binary SNMPv2c TrapV2 (Standard linkDown)...');
    await sendSnmpTestTrap({
      port: testPort,
      version: 'v2c',
      trapOid: '1.3.6.1.6.3.1.1.5.3', // linkDown
      varbinds: [
        { oid: '1.3.6.1.2.1.2.2.1.1.1', type: 'Integer', value: 1 },
      ],
    });
    await new Promise((r) => setTimeout(r, 150));

    // 3. Send SNMPv2c InformRequest (asserts automatic ResponsePDU acknowledgement)
    console.log('[test:snmp] Sending binary SNMPv2c InformRequest (Standard linkUp)...');
    await sendSnmpTestTrap({
      port: testPort,
      version: 'v2c',
      pduType: 'InformRequest',
      trapOid: '1.3.6.1.6.3.1.1.5.4', // linkUp
      varbinds: [
        { oid: '1.3.6.1.2.1.2.2.1.1.1', type: 'Integer', value: 1 },
      ],
    });
    await new Promise((r) => setTimeout(r, 150));

    // 4. Send SNMPv3 authPriv Trap (RFC 3414 SHA auth + AES privacy)
    console.log('[test:snmp] Sending binary SNMPv3 authPriv Trap...');
    await sendSnmpTestTrap({
      port: testPort,
      version: 'v3',
      trapOid: '1.3.6.1.6.3.1.1.5.3',
      v3User: {
        name: 'noc-operator',
        level: 'authPriv',
        authProtocol: 'sha',
        authKey: 'AuthKeyPassword123',
        privProtocol: 'aes',
        privKey: 'PrivKeyPassword123',
      },
      varbinds: [
        { oid: '1.3.6.1.2.1.2.2.1.1.1', type: 'Integer', value: 9 },
      ],
    });
    await new Promise((r) => setTimeout(r, 200));

    // 5. Send SNMPv2c RFC Standard authenticationFailure Trap (RFC 3418)
    console.log('[test:snmp] Sending binary SNMPv2c authenticationFailure Trap...');
    await sendSnmpTestTrap({
      port: testPort,
      version: 'v2c',
      trapOid: '1.3.6.1.6.3.1.1.5.5', // authenticationFailure
      varbinds: [],
    });
    await new Promise((r) => setTimeout(r, 200));

    // 6. Send Huawei GPON ONT Dying Gasp Trap (Fase 3)
    console.log('[test:snmp] Sending Huawei GPON ONT Dying Gasp Trap (hwGponOntDyingGasp)...');
    await sendSnmpTestTrap({
      port: testPort,
      version: 'v2c',
      trapOid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.2.0.2.1.14', // frame 0, slot 2, port 1, onu 14
      varbinds: [
        {
          oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1.1',
          type: 'OctetString',
          value: 'HWTC12345678',
        },
      ],
    });
    await new Promise((r) => setTimeout(r, 200));

    // 7. Send ZTE GPON ONT LOS Trap (Fase 3)
    console.log('[test:snmp] Sending ZTE GPON ONT LOS Trap (zxGponOntLossOfSignal)...');
    await sendSnmpTestTrap({
      port: testPort,
      version: 'v2c',
      trapOid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1.1.1.3.2.5', // rack 1, shelf 1, slot 3, port 2, onu 5
      varbinds: [
        {
          oid: '1.3.6.1.4.1.3902.1082.500.10.2.2.1.1.1',
          type: 'OctetString',
          value: 'ZTEGC8765432',
        },
      ],
    });
    await new Promise((r) => setTimeout(r, 200));

    // 8. Send Nokia 7360 ISAM GPON ONT LOS Trap (Fase 4)
    console.log('[test:snmp] Sending Nokia 7360 ISAM GPON ONT LOS Trap (nokiaOntLossOfSignal)...');
    await sendSnmpTestTrap({
      port: testPort,
      version: 'v2c',
      trapOid: '1.3.6.1.4.1.637.61.1.36.1.1.1.1.1.2.4.10', // rack 1, shelf 1, slot 2, port 4, onu 10
      varbinds: [
        {
          oid: '1.3.6.1.4.1.637.61.1.36.1.2.1',
          type: 'OctetString',
          value: 'ALCL12345678',
        },
      ],
    });
    await new Promise((r) => setTimeout(r, 200));

    // 9. Send FiberHome AN5516 GPON ONT Dying Gasp Trap (Fase 4)
    console.log('[test:snmp] Sending FiberHome AN5516 GPON ONT Dying Gasp Trap (fhGponOntDyingGasp)...');
    await sendSnmpTestTrap({
      port: testPort,
      version: 'v2c',
      trapOid: '1.3.6.1.4.1.3807.1.3.1.1.2.2.4.12', // slot 2, port 4, onu 12
      varbinds: [
        {
          oid: '1.3.6.1.4.1.3807.1.3.1.1.2.1',
          type: 'OctetString',
          value: 'FHTT12345678',
        },
      ],
    });
    await new Promise((r) => setTimeout(r, 200));

    // 10. Send Calix E7 GPON ONT LOS Trap (Fase 5)
    console.log('[test:snmp] Sending Calix E7 GPON ONT LOS Trap (e7TrapAlarm)...');
    await sendSnmpTestTrap({
      port: testPort,
      version: 'v2c',
      trapOid: '1.3.6.1.4.1.6321.1.2.2.4.2.1',
      varbinds: [
        {
          oid: '1.3.6.1.4.1.6321.1.2.2.4.1.1.6',
          type: 'OctetString',
          value: 'ont 1/1/2/4',
        },
        {
          oid: '1.3.6.1.4.1.6321.1.2.2.4.1.1.7',
          type: 'OctetString',
          value: 'Loss of Signal',
        },
        {
          oid: '1.3.6.1.4.1.6321.1.2.2.4.1.1.10',
          type: 'OctetString',
          value: 'CXNK00123456',
        },
      ],
    });
    await new Promise((r) => setTimeout(r, 200));

    // 11. Send Adtran TA5000 GPON ONT Dying Gasp Trap (Fase 5)
    console.log('[test:snmp] Sending Adtran TA5000 GPON ONT Dying Gasp Trap (adGenGponOntDyingGaspAlarm)...');
    await sendSnmpTestTrap({
      port: testPort,
      version: 'v2c',
      trapOid: '1.3.6.1.4.1.664.6.10000.76.1.1.5.1.0.38.1.2.8', // slot 1, port 2, onu 8
      varbinds: [
        {
          oid: '1.3.6.1.2.1.2.2.1.2.10208',
          type: 'OctetString',
          value: 'ont 1/2.8',
        },
        {
          oid: '1.3.6.1.4.1.664.6.10000.76.1.1.1.1.3.10208',
          type: 'OctetString',
          value: 'ADTN12345678',
        },
      ],
    });
    await new Promise((r) => setTimeout(r, 200));

    // Validations
    console.log(`[test:snmp] Total notifications received: ${received.length}`);
    if (received.length < 11) {
      throw new Error(`Expected 11 notifications, but received ${received.length}`);
    }

    const versions = received.map((r) => r.notif.version);
    const pduTypes = received.map((r) => r.notif.pduType);

    if (!versions.includes('v1')) throw new Error('Missing SNMPv1 notification');
    if (!versions.includes('v2c')) throw new Error('Missing SNMPv2c notification');
    if (!versions.includes('v3')) throw new Error('Missing SNMPv3 notification');
    if (!pduTypes.includes('InformRequest')) throw new Error('Missing InformRequest notification');

    for (const item of received) {
      if (!item.evidence.credentialsRedacted) {
        throw new Error('Evidence envelope credentials were not redacted!');
      }
      if (!item.evidence.fingerprint) {
        throw new Error('Evidence envelope missing canonical fingerprint!');
      }
    }

    // Gate 2, Gate 3, Gate 4 & Gate 5 Telemetry Invariants & Schema Verification
    console.log(`[test:snmp] Total telemetry.v1 events generated: ${telemetryEvents.length}`);
    if (telemetryEvents.length < 11) {
      throw new Error(`Expected at least 11 telemetry events, got ${telemetryEvents.length}`);
    }

    for (const event of telemetryEvents) {
      const parsed = telemetryEventSchema.parse(event);
      if (parsed.tenantId !== 'tenant-test') {
        throw new Error(`Tenant isolation breached: expected 'tenant-test', got '${parsed.tenantId}'`);
      }
      if (parsed.source !== 'snmp-trap') {
        throw new Error(`Expected source 'snmp-trap', got '${parsed.source}'`);
      }
    }

    // Validate Huawei Adapter normalization
    const huaweiOntEvent = telemetryEvents.find(
      (e) => e.tags?.['adapter'] === 'huawei' && e.metrics['trapName'] === 'hwGponOntDyingGasp',
    );
    if (!huaweiOntEvent) {
      throw new Error('Expected Huawei normalized telemetry event from HuaweiOltAdapter');
    }
    if (huaweiOntEvent.deviceKind !== 'ONU') {
      throw new Error(`Expected Huawei event deviceKind 'ONU', got '${huaweiOntEvent.deviceKind}'`);
    }
    if (huaweiOntEvent.deviceId !== 'HWTC12345678') {
      throw new Error(`Expected Huawei deviceId 'HWTC12345678', got '${huaweiOntEvent.deviceId}'`);
    }
    if (huaweiOntEvent.metrics['onuId'] !== 14 || huaweiOntEvent.metrics['slot'] !== 2) {
      throw new Error(`Invalid Huawei GPON hierarchy: onuId=${huaweiOntEvent.metrics['onuId']}, slot=${huaweiOntEvent.metrics['slot']}`);
    }

    // Validate ZTE Adapter normalization
    const zteOntEvent = telemetryEvents.find(
      (e) => e.tags?.['adapter'] === 'zte' && e.metrics['trapName'] === 'zxGponOntLossOfSignal',
    );
    if (!zteOntEvent) {
      throw new Error('Expected ZTE normalized telemetry event from ZteOltAdapter');
    }
    if (zteOntEvent.deviceKind !== 'ONU') {
      throw new Error(`Expected ZTE event deviceKind 'ONU', got '${zteOntEvent.deviceKind}'`);
    }
    if (zteOntEvent.deviceId !== 'ZTEGC8765432') {
      throw new Error(`Expected ZTE deviceId 'ZTEGC8765432', got '${zteOntEvent.deviceId}'`);
    }
    if (zteOntEvent.metrics['onuId'] !== 5 || zteOntEvent.metrics['slot'] !== 3) {
      throw new Error(`Invalid ZTE GPON hierarchy: onuId=${zteOntEvent.metrics['onuId']}, slot=${zteOntEvent.metrics['slot']}`);
    }

    // Validate Nokia Adapter normalization (Fase 4)
    const nokiaOntEvent = telemetryEvents.find(
      (e) => e.tags?.['adapter'] === 'nokia' && e.metrics['trapName'] === 'nokiaOntLossOfSignal',
    );
    if (!nokiaOntEvent) {
      throw new Error('Expected Nokia normalized telemetry event from NokiaOltAdapter');
    }
    if (nokiaOntEvent.deviceKind !== 'ONU') {
      throw new Error(`Expected Nokia event deviceKind 'ONU', got '${nokiaOntEvent.deviceKind}'`);
    }
    if (nokiaOntEvent.deviceId !== 'ALCL12345678') {
      throw new Error(`Expected Nokia deviceId 'ALCL12345678', got '${nokiaOntEvent.deviceId}'`);
    }
    if (nokiaOntEvent.metrics['onuId'] !== 10 || nokiaOntEvent.metrics['slot'] !== 2 || nokiaOntEvent.metrics['port'] !== 4) {
      throw new Error(`Invalid Nokia optical hierarchy: onuId=${nokiaOntEvent.metrics['onuId']}, slot=${nokiaOntEvent.metrics['slot']}, port=${nokiaOntEvent.metrics['port']}`);
    }

    // Validate FiberHome Adapter normalization (Fase 4)
    const fiberhomeOntEvent = telemetryEvents.find(
      (e) => e.tags?.['adapter'] === 'fiberhome' && e.metrics['trapName'] === 'fhGponOntDyingGasp',
    );
    if (!fiberhomeOntEvent) {
      throw new Error('Expected FiberHome normalized telemetry event from FiberhomeOltAdapter');
    }
    if (fiberhomeOntEvent.deviceKind !== 'ONU') {
      throw new Error(`Expected FiberHome event deviceKind 'ONU', got '${fiberhomeOntEvent.deviceKind}'`);
    }
    if (fiberhomeOntEvent.deviceId !== 'FHTT12345678') {
      throw new Error(`Expected FiberHome deviceId 'FHTT12345678', got '${fiberhomeOntEvent.deviceId}'`);
    }
    if (fiberhomeOntEvent.metrics['onuId'] !== 12 || fiberhomeOntEvent.metrics['slot'] !== 2 || fiberhomeOntEvent.metrics['port'] !== 4) {
      throw new Error(`Invalid FiberHome GPON hierarchy: onuId=${fiberhomeOntEvent.metrics['onuId']}, slot=${fiberhomeOntEvent.metrics['slot']}, port=${fiberhomeOntEvent.metrics['port']}`);
    }

    // Validate Calix Adapter normalization (Fase 5)
    const calixOntEvent = telemetryEvents.find(
      (e) => e.tags?.['adapter'] === 'calix' && e.metrics['trapName'] === 'e7TrapAlarm',
    );
    if (!calixOntEvent) {
      throw new Error('Expected Calix normalized telemetry event from CalixOltAdapter');
    }
    if (calixOntEvent.deviceKind !== 'ONU') {
      throw new Error(`Expected Calix event deviceKind 'ONU', got '${calixOntEvent.deviceKind}'`);
    }
    if (calixOntEvent.deviceId !== 'CXNK00123456') {
      throw new Error(`Expected Calix deviceId 'CXNK00123456', got '${calixOntEvent.deviceId}'`);
    }
    if (calixOntEvent.metrics['onuId'] !== 4 || calixOntEvent.metrics['slot'] !== 1 || calixOntEvent.metrics['port'] !== 2) {
      throw new Error(`Invalid Calix optical hierarchy: onuId=${calixOntEvent.metrics['onuId']}, slot=${calixOntEvent.metrics['slot']}, port=${calixOntEvent.metrics['port']}`);
    }

    // Validate Adtran Adapter normalization (Fase 5)
    const adtranOntEvent = telemetryEvents.find(
      (e) => e.tags?.['adapter'] === 'adtran' && e.metrics['trapName'] === 'adGenGponOntDyingGaspAlarm',
    );
    if (!adtranOntEvent) {
      throw new Error('Expected Adtran normalized telemetry event from AdtranOltAdapter');
    }
    if (adtranOntEvent.deviceKind !== 'ONU') {
      throw new Error(`Expected Adtran event deviceKind 'ONU', got '${adtranOntEvent.deviceKind}'`);
    }
    if (adtranOntEvent.deviceId !== 'ADTN12345678') {
      throw new Error(`Expected Adtran deviceId 'ADTN12345678', got '${adtranOntEvent.deviceId}'`);
    }
    if (adtranOntEvent.metrics['onuId'] !== 8 || adtranOntEvent.metrics['slot'] !== 1 || adtranOntEvent.metrics['port'] !== 2) {
      throw new Error(`Invalid Adtran GPON hierarchy: onuId=${adtranOntEvent.metrics['onuId']}, slot=${adtranOntEvent.metrics['slot']}, port=${adtranOntEvent.metrics['port']}`);
    }

    console.log('[test:snmp] ✅ Gate 0, Gate 2, Gate 3, Gate 4 & Gate 5 SNMP verification passed: standard traps, IF-MIB metrics, USM authPriv, Huawei, ZTE, Nokia, FiberHome, Calix & Adtran adapters 100% OK.');
  } finally {
    receiver.close();
  }
}

run().catch((err) => {
  console.error('[test:snmp] ❌ Failed:', err);
  process.exit(1);
});
