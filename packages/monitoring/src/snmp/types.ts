/**
 * Core SNMP Types for Multi-Vendor OLT Ingestion (Roadmap Fase 0).
 */

export type SnmpVersion = 'v1' | 'v2c' | 'v3';

export type SnmpPduType = 'Trap' | 'TrapV2' | 'InformRequest';

export type SnmpSecurityLevel = 'noAuthNoPriv' | 'authNoPriv' | 'authPriv';

export type SnmpAuthProtocol = 'md5' | 'sha' | 'sha224' | 'sha256' | 'sha384' | 'sha512';

export type SnmpPrivProtocol = 'des' | 'aes' | 'aes256b' | 'aes256r';

export interface SnmpV3UserConfig {
  name: string;
  level: SnmpSecurityLevel;
  authProtocol?: SnmpAuthProtocol;
  authKey?: string;
  privProtocol?: SnmpPrivProtocol;
  privKey?: string;
}

export interface SnmpVarbindDetail {
  oid: string;
  type: string;
  value: string | number | boolean | null;
  rawHex?: string;
}

export interface DecodedSnmpNotification {
  version: SnmpVersion;
  pduType: SnmpPduType;
  senderIp: string;
  senderPort: number;
  trapOid: string;
  sysUpTime?: number;
  eventTime?: string;
  receivedAtMs: number;
  varbinds: SnmpVarbindDetail[];
  requestId?: number;
  securityName?: string;
  securityLevel?: SnmpSecurityLevel;
}

export interface RawSnmpEvidenceEnvelope {
  evidenceId: string;
  receivedAt: string;
  senderIp: string;
  senderPort: number;
  snmpVersion: SnmpVersion;
  pduType: SnmpPduType;
  trapOid: string;
  sysUpTime: number | null;
  eventTime: string | null;
  varbinds: ReadonlyArray<SnmpVarbindDetail>;
  credentialsRedacted: true;
  fingerprint: string;
}
