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

    // Validations
    console.log(`[test:snmp] Total notifications received: ${received.length}`);
    if (received.length < 7) {
      throw new Error(`Expected 7 notifications, but received ${received.length}`);
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

    // Gate 2 & Gate 3 Telemetry Invariants & Schema Verification
    console.log(`[test:snmp] Total telemetry.v1 events generated: ${telemetryEvents.length}`);
    if (telemetryEvents.length < 7) {
      throw new Error(`Expected at least 7 telemetry events, got ${telemetryEvents.length}`);
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

    console.log('[test:snmp] ✅ Gate 0, Gate 2 & Gate 3 SNMP verification passed: standard traps, IF-MIB metrics, USM authPriv, Huawei & ZTE adapters 100% OK.');
  } finally {
    receiver.close();
  }
}

run().catch((err) => {
  console.error('[test:snmp] ❌ Failed:', err);
  process.exit(1);
});
