/**
 * SNMP Automated Trap & Inform Verification Script (Roadmap Fase 0).
 *
 * Runs end-to-end verification of binary SNMPv1, SNMPv2c (TrapV2 & Inform),
 * and SNMPv3 (RFC 3414 authPriv) reception and parsing in CI/local lab.
 */

import {
  createManagedSnmpReceiver,
  sendSnmpTestTrap,
  type DecodedSnmpNotification,
  type RawSnmpEvidenceEnvelope,
} from '../packages/monitoring/src';

async function run(): Promise<void> {
  const testPort = 12180;
  const received: Array<{ notif: DecodedSnmpNotification; evidence: RawSnmpEvidenceEnvelope }> = [];

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
        vendor: 'Huawei',
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
    console.log('[test:snmp] Sending binary SNMPv2c TrapV2...');
    await sendSnmpTestTrap({
      port: testPort,
      version: 'v2c',
      trapOid: '1.3.6.1.6.3.1.1.5.3', // linkDown
      varbinds: [
        { oid: '1.3.6.1.2.1.2.2.1.1.1', type: 'Integer', value: 1 },
        { oid: '1.3.6.1.4.1.2011.6.128.1.1.2.43.1', type: 'OctetString', value: 'HWTC12345678' },
      ],
    });
    await new Promise((r) => setTimeout(r, 150));

    // 3. Send SNMPv2c InformRequest (asserts automatic ResponsePDU acknowledgement)
    console.log('[test:snmp] Sending binary SNMPv2c InformRequest...');
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

    // Validations
    console.log(`[test:snmp] Total notifications received: ${received.length}`);
    if (received.length < 4) {
      throw new Error(`Expected 4 notifications (v1, v2c, Inform, v3), but received ${received.length}`);
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

    console.log('[test:snmp] ✅ Gate 0 SNMP verification passed: v1, v2c, Inform, v3, raw evidence & redaction 100% OK.');
  } finally {
    receiver.close();
  }
}

run().catch((err) => {
  console.error('[test:snmp] ❌ Failed:', err);
  process.exit(1);
});
