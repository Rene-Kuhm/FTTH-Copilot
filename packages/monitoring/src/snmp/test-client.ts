/**
 * SNMP Test Sender Helper (Roadmap Fase 0).
 *
 * Provides a portable test client capable of generating real binary
 * SNMP v1, v2c (Trap, Inform), and v3 datagrams for CI and automated tests.
 */

import * as snmp from 'net-snmp';
import type { SnmpV3UserConfig, SnmpVersion } from './types';

export interface SendSnmpTrapOptions {
  port: number;
  host?: string;
  version?: SnmpVersion;
  pduType?: 'Trap' | 'TrapV2' | 'InformRequest';
  trapOid: string;
  varbinds?: Array<{ oid: string; type?: number | string; value: unknown }>;
  community?: string;
  v3User?: SnmpV3UserConfig;
  enterprise?: string;
}

export async function sendSnmpTestTrap(options: SendSnmpTrapOptions): Promise<void> {
  const host = options.host ?? '127.0.0.1';
  const version = options.version ?? (options.v3User ? 'v3' : 'v2c');
  const pduType = options.pduType ?? (version === 'v1' ? 'Trap' : 'TrapV2');
  const community = options.community ?? 'public';

  const mappedVarbinds: snmp.Varbind[] = (options.varbinds ?? []).map((vb) => {
    let typeNum = snmp.ObjectType.OctetString;
    const objectTypeMap = snmp.ObjectType as unknown as Record<string, number>;
    if (typeof vb.type === 'number') {
      typeNum = vb.type;
    } else if (typeof vb.type === 'string' && vb.type in objectTypeMap) {
      typeNum = objectTypeMap[vb.type]!;
    } else if (typeof vb.value === 'number') {
      typeNum = snmp.ObjectType.Integer;
    }
    return {
      oid: vb.oid,
      type: typeNum,
      value: (vb.value ?? '') as string | number | Buffer,
    };
  });

  if (version === 'v3' && options.v3User) {
    const u = options.v3User;
    const securityLevelMap = snmp.SecurityLevel as unknown as Record<string, number>;
    const authProtocolMap = snmp.AuthProtocols as unknown as Record<string, number>;
    const privProtocolMap = snmp.PrivProtocols as unknown as Record<string, number>;

    const user = {
      name: u.name,
      level: securityLevelMap[u.level] ?? snmp.SecurityLevel.authPriv,
      authProtocol: u.authProtocol ? authProtocolMap[u.authProtocol] : undefined,
      authKey: u.authKey,
      privProtocol: u.privProtocol ? privProtocolMap[u.privProtocol] : undefined,
      privKey: u.privKey,
    };
    const createV3Session = (snmp as unknown as { createV3Session: (...args: unknown[]) => snmp.Session }).createV3Session;
    const session = createV3Session(host, user, {
      trapPort: options.port,
      engineID: '800000090300000000000001',
    });
    return new Promise<void>((resolve, reject) => {
      session.trap(options.trapOid, mappedVarbinds, (err: Error | null) => {
        session.close();
        if (err) reject(err);
        else resolve();
      });
    });
  }

  const snmpVersion = version === 'v1' ? snmp.Version1 : snmp.Version2c;
  const session = snmp.createSession(host, community, {
    trapPort: options.port,
    version: snmpVersion,
  });

  const sessionDispatch = session as unknown as {
    inform: (oid: string, vbs: snmp.Varbind[], cb: (err: Error | null) => void) => void;
    trap: (oid: string, vbs: snmp.Varbind[], cb: (err: Error | null) => void) => void;
  };

  return new Promise<void>((resolve, reject) => {
    const cb = (err: Error | null) => {
      session.close();
      if (err) reject(err);
      else resolve();
    };

    if (pduType === 'InformRequest') {
      sessionDispatch.inform(options.trapOid, mappedVarbinds, cb);
    } else if (version === 'v1') {
      sessionDispatch.trap(options.enterprise ?? options.trapOid, mappedVarbinds, cb);
    } else {
      sessionDispatch.trap(options.trapOid, mappedVarbinds, cb);
    }
  });
}
