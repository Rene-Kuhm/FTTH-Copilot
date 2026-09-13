/**
 * Types for MikroTik RouterOS v7 REST API connector.
 */

export interface MikrotikSystemResource {
  uptime: string;
  version: string;
  buildTime: string;
  freeMemory: number;
  totalMemory: number;
  cpu: string;
  cpuCount: number;
  cpuFrequency: number;
  cpuLoad: number;
  freeHddSpace: number;
  totalHddSpace: number;
  architectureName: string;
  boardName: string;
  platform: string;
  temperatureCelsius?: number;
  voltageVolts?: number;
}

export interface MikrotikInterface {
  id: string;
  name: string;
  type: string;
  running: boolean;
  disabled: boolean;
  comment?: string;
  macAddress?: string;
  mtu: number;
  rxByte: number;
  txByte: number;
  rxPacket: number;
  txPacket: number;
  rxError?: number;
  txError?: number;
  rxDrop?: number;
  txDrop?: number;
  linkDowns?: number;
}

export interface MikrotikSfpOpticalMetrics {
  interfaceName: string;
  sfpRxPowerDbm?: number;
  sfpTxPowerDbm?: number;
  sfpTemperatureCelsius?: number;
  sfpVoltageVolts?: number;
  sfpCurrentMa?: number;
  sfpWavelengthNm?: number;
  vendorName?: string;
  vendorPartNumber?: string;
  vendorSerial?: string;
}

export interface MikrotikPppoeSession {
  id: string;
  name: string;
  service: string;
  callerId: string;
  address: string;
  uptime: string;
  encoding?: string;
  sessionId: string;
  radius?: boolean;
}

export interface MikrotikBgpSession {
  id: string;
  name: string;
  remoteAddress: string;
  remoteAs: number;
  localAddress?: string;
  localAs?: number;
  state: 'established' | 'idle' | 'connect' | 'active' | 'open-sent' | 'open-confirm' | string;
  uptime?: string;
  prefixCount?: number;
  holdTime?: string;
  keepaliveTime?: string;
}

export interface IMikrotikConnector {
  readonly providerName: string;

  /** Pings the RouterOS REST API to validate reachability and credentials. */
  ping(): Promise<{ ok: boolean; latencyMs?: number; error?: string }>;

  /** Retrieves system resource utilization and hardware health. */
  getSystemResource(): Promise<MikrotikSystemResource>;

  /** Lists physical, VLAN, and bridge interfaces with status and traffic stats. */
  listInterfaces(filter?: { runningOnly?: boolean; type?: string }): Promise<MikrotikInterface[]>;

  /** Retrieves DDM optical diagnostics from an SFP / SFP+ transceiver. */
  getSfpOpticalMetrics(interfaceName: string): Promise<MikrotikSfpOpticalMetrics | null>;

  /** Lists active PPPoE subscriber sessions with assigned IP and MAC. */
  listPppoeSessions(filter?: { username?: string }): Promise<MikrotikPppoeSession[]>;

  /** Lists BGP peer sessions, state, and prefix counts. */
  listBgpSessions(): Promise<MikrotikBgpSession[]>;
}
