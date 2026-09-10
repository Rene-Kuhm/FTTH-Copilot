import { describe, expect, it } from 'vitest';
import * as snmp from 'net-snmp';
import { createManagedSnmpReceiver } from '../../src/snmp/receiver';

describe('Managed SNMP Receiver (Roadmap Fase 0)', () => {
  it('receives and decodes real binary SNMPv2c TrapV2 with real OID and varbinds (Gate 0)', async () => {
    const port = 12162;
    const receivedNotifs: any[] = [];
    const receivedEvidences: any[] = [];

    const receiver = createManagedSnmpReceiver({
      port,
      address: '127.0.0.1',
      registrations: [
        {
          senderIp: '127.0.0.1',
          tenantId: 'tenant-test',
          connectionId: 'conn-1',
          oltId: 'OLT-HUAWEI-01',
          vendor: 'Huawei',
          community: 'public',
        },
      ],
      onNotification: (notif, senderContext, evidence) => {
        receivedNotifs.push({ notif, senderContext });
        receivedEvidences.push(evidence);
      },
    });

    try {
      // Send real binary SNMPv2c trap
      const session = snmp.createSession('127.0.0.1', 'public', {
        trapPort: port,
        version: snmp.Version2c,
      });

      await new Promise<void>((resolve, reject) => {
        session.trap(
          '1.3.6.1.6.3.1.1.5.3', // linkDown
          [
            {
              oid: '1.3.6.1.2.1.2.2.1.1.1',
              type: snmp.ObjectType.Integer,
              value: 10,
            },
          ],
          (err) => {
            session.close();
            if (err) reject(err);
            else resolve();
          },
        );
      });

      // Wait for receiver to process
      await new Promise((r) => setTimeout(r, 200));

      expect(receivedNotifs).toHaveLength(1);
      const { notif, senderContext } = receivedNotifs[0];
      expect(notif.trapOid).toBe('1.3.6.1.6.3.1.1.5.3');
      expect(notif.version).toBe('v2c');
      expect(notif.varbinds).toHaveLength(1);
      expect(notif.varbinds[0].oid).toBe('1.3.6.1.2.1.2.2.1.1.1');
      expect(notif.varbinds[0].value).toBe(10);
      expect(senderContext.oltId).toBe('OLT-HUAWEI-01');

      expect(receivedEvidences).toHaveLength(1);
      expect(receivedEvidences[0].fingerprint).toBeDefined();
      expect(receivedEvidences[0].credentialsRedacted).toBe(true);
    } finally {
      receiver.close();
    }
  });

  it('receives SNMPv2c InformRequest and acknowledges sender with ResponsePDU (Gate 0)', async () => {
    const port = 12163;
    let informReceived = false;

    const receiver = createManagedSnmpReceiver({
      port,
      address: '127.0.0.1',
      registrations: [
        {
          senderIp: '127.0.0.1',
          tenantId: 'tenant-test',
          connectionId: 'conn-1',
          oltId: 'OLT-ZTE-01',
          community: 'public',
        },
      ],
      onNotification: (notif) => {
        if (notif.pduType === 'InformRequest') {
          informReceived = true;
        }
      },
    });

    try {
      const session = snmp.createSession('127.0.0.1', 'public', {
        trapPort: port,
        version: snmp.Version2c,
      });

      let acked = false;
      await new Promise<void>((resolve, reject) => {
        session.inform(
          '1.3.6.1.6.3.1.1.5.4', // linkUp
          [
            {
              oid: '1.3.6.1.2.1.2.2.1.1.1',
              type: snmp.ObjectType.Integer,
              value: 12,
            },
          ],
          (err) => {
            session.close();
            if (err) {
              reject(err);
            } else {
              acked = true;
              resolve();
            }
          },
        );
      });

      await new Promise((r) => setTimeout(r, 200));

      expect(informReceived).toBe(true);
      expect(acked).toBe(true);
    } finally {
      receiver.close();
    }
  });

  it('receives real binary SNMPv1 trap with generic trap conversion', async () => {
    const port = 12164;
    const received: any[] = [];

    const receiver = createManagedSnmpReceiver({
      port,
      address: '127.0.0.1',
      registrations: [
        {
          senderIp: '127.0.0.1',
          tenantId: 'tenant-test',
          connectionId: 'conn-1',
          oltId: 'OLT-V1',
          community: 'public',
        },
      ],
      onNotification: (notif) => {
        received.push(notif);
      },
    });

    try {
      const session = snmp.createSession('127.0.0.1', 'public', {
        trapPort: port,
        version: snmp.Version1,
      });

      await new Promise<void>((resolve, reject) => {
        session.trap(
          '1.3.6.1.4.1.2011',
          [
            {
              oid: '1.3.6.1.4.1.2011.6.1',
              type: snmp.ObjectType.Integer,
              value: 99,
            },
          ],
          (err) => {
            session.close();
            if (err) reject(err);
            else resolve();
          },
        );
      });

      await new Promise((r) => setTimeout(r, 200));

      expect(received).toHaveLength(1);
      expect(received[0].version).toBe('v1');
      expect(received[0].pduType).toBe('Trap');
    } finally {
      receiver.close();
    }
  });

  it('receives and decrypts real binary SNMPv3 authPriv datagram (RFC 3414)', async () => {
    const port = 12165;
    const received: any[] = [];

    const receiver = createManagedSnmpReceiver({
      port,
      address: '127.0.0.1',
      registrations: [
        {
          senderIp: '127.0.0.1',
          tenantId: 'tenant-test',
          connectionId: 'conn-1',
          oltId: 'OLT-V3',
          v3User: {
            name: 'admin-noc',
            level: 'authPriv',
            authProtocol: 'sha',
            authKey: 'AuthSecretKey123',
            privProtocol: 'aes',
            privKey: 'PrivSecretKey123',
          },
        },
      ],
      onNotification: (notif) => {
        received.push(notif);
      },
    });

    try {
      const user = {
        name: 'admin-noc',
        level: snmp.SecurityLevel.authPriv,
        authProtocol: snmp.AuthProtocols.sha,
        authKey: 'AuthSecretKey123',
        privProtocol: snmp.PrivProtocols.aes,
        privKey: 'PrivSecretKey123',
      };

      const session = snmp.createV3Session('127.0.0.1', user, {
        trapPort: port,
        engineID: '800000090300000000000002',
      });

      await new Promise<void>((resolve, reject) => {
        session.trap(
          '1.3.6.1.6.3.1.1.5.3',
          [
            {
              oid: '1.3.6.1.2.1.2.2.1.1.1',
              type: snmp.ObjectType.Integer,
              value: 77,
            },
          ],
          (err) => {
            session.close();
            if (err) reject(err);
            else resolve();
          },
        );
      });

      await new Promise((r) => setTimeout(r, 200));

      expect(received).toHaveLength(1);
      expect(received[0].version).toBe('v3');
      expect(received[0].trapOid).toBe('1.3.6.1.6.3.1.1.5.3');
    } finally {
      receiver.close();
    }
  });

  it('drops packets from unregistered sender IPs without mutation', async () => {
    const port = 12166;
    const received: any[] = [];

    // Receiver registers ONLY 10.99.99.99 (not 127.0.0.1)
    const receiver = createManagedSnmpReceiver({
      port,
      address: '127.0.0.1',
      registrations: [
        {
          senderIp: '10.99.99.99',
          tenantId: 'tenant-test',
          connectionId: 'conn-1',
          oltId: 'OLT-REMOTE',
          community: 'public',
        },
      ],
      onNotification: (notif) => {
        received.push(notif);
      },
    });

    try {
      const session = snmp.createSession('127.0.0.1', 'public', {
        trapPort: port,
        version: snmp.Version2c,
      });

      await new Promise<void>((resolve, reject) => {
        session.trap('1.3.6.1.6.3.1.1.5.3', [], (err) => {
          session.close();
          if (err) reject(err);
          else resolve();
        });
      });

      await new Promise((r) => setTimeout(r, 200));

      expect(received).toHaveLength(0);
    } finally {
      receiver.close();
    }
  });

  it('drops packets exceeding maxPayloadBytes at raw UDP guard', async () => {
    const port = 12167;
    const received: any[] = [];

    const receiver = createManagedSnmpReceiver({
      port,
      address: '127.0.0.1',
      guardOptions: { maxPayloadBytes: 20 }, // Artificially small limit
      registrations: [
        {
          senderIp: '127.0.0.1',
          tenantId: 'tenant-test',
          connectionId: 'conn-1',
          oltId: 'OLT-01',
          community: 'public',
        },
      ],
      onNotification: (notif) => {
        received.push(notif);
      },
    });

    try {
      const session = snmp.createSession('127.0.0.1', 'public', {
        trapPort: port,
        version: snmp.Version2c,
      });

      await new Promise<void>((resolve, reject) => {
        session.trap('1.3.6.1.6.3.1.1.5.3', [], (err) => {
          session.close();
          if (err) reject(err);
          else resolve();
        });
      });

      await new Promise((r) => setTimeout(r, 200));

      expect(received).toHaveLength(0);
      expect(receiver.getGuardMetrics().droppedByReason.payload_oversized).toBeGreaterThanOrEqual(1);
    } finally {
      receiver.close();
    }
  });

  it('emits security notice when plaintext v1 or v2c is configured', () => {
    const notices: string[] = [];

    const receiver = createManagedSnmpReceiver({
      port: 12168,
      address: '127.0.0.1',
      registrations: [
        {
          senderIp: '127.0.0.1',
          tenantId: 'tenant-test',
          connectionId: 'conn-1',
          oltId: 'OLT-01',
          version: 'v2c',
          community: 'public',
        },
      ],
      onSecurityNotice: (msg) => notices.push(msg),
    });

    receiver.close();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain('[SECURITY] Sender 127.0.0.1 uses SNMP v2c');
    expect(notices[0]).toContain('segmentation is strongly required');
  });
});
