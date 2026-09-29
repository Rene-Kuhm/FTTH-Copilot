/**
 * INmsConnector — interfaz común para adapters de NMS.
 *
 * Cada NMS (SmartOLT, NetSense, Mikrowisp) implementa esta interfaz.
 * El agente solo conoce esta interfaz, no el NMS específico.
 */

/**
 * PON technology types supported by OLTs and ONTs.
 * See research/olt/ directory for vendor-specific compatibility matrices.
 */
export type PonTechnology =
  | 'GPON'       /* 2.5 Gbps downstream, 1.25 Gbps upstream */
  | 'XG-PON'     /* 10 Gbps downstream, 2.5 Gbps upstream */
  | 'XGS-PON'    /* 10 Gbps symmetric */
  | '25G-PON'    /* 25 Gbps downstream, 10/25 Gbps upstream (MSA) */
  | '50G-PON'    /* 50 Gbps symmetric (ITU-T G.HSP) */
  | 'NG-PON2'    /* TWDM-PON, 4 wavelengths x 10 Gbps */
  | 'Combo-GPON-XGS-PON'; /* Mixed GPON + XGS-PON on same port (Flex-PON) */

/**
 * Optical power budget classes per ITU-T G.984.2 / G.9807.1.
 * Determines maximum PON reach and split ratio.
 */
export type OpticalClass = 'B+' | 'C+' | 'C++' | 'N1' | 'N2';

/**
 * Standards compliance for ONT management and access architecture.
 * - OMCI: ITU-T G.988 (standard GPON/XGS-PON ONT management)
 * - vOMCI: Broadband Forum TR-451 (virtualized OMCI)
 * - TR-069: legacy CPE management (CWMP)
 * - TR-369 (USP): User Services Platform, TR-069 successor
 * - SDX/vOLT: Broadband Forum TR-142/TR-385 (disaggregated OLT)
 */
export interface StandardsCompliance {
  omciVersion?: string;
  vOMCIReady?: boolean;
  tr069Supported?: boolean;
  tr369UspSupported?: boolean;
  disaggregatedVlt?: boolean; // TR-142/TR-385
}

/**
 * ODN passive component kinds.
 * Used to model the physical fiber plant from OLT to subscriber.
 */
export type OdnComponentKind =
  | 'OLT'
  | 'FDH'         // Fiber Distribution Hub
  | 'SPLITTER'    // Passive optical splitter
  | 'NAP'         // Network Access Point (mikrotik-style outdoor cabinet)
  | 'FAT'         // Fiber Access Terminal (Huawei-style outdoor closure)
  | 'CTO'         // Caja Terminal Óptica
  | 'DROP_CABLE'  // Last-mile drop cable
  | 'ONU';

/**
 * Passive ODN component with attenuation and physical metadata.
 * These are detected/confirmed from operator-provided topology, NOT inferred.
 */
export interface OdnComponent {
  kind: OdnComponentKind;
  id: string;
  label?: string;
  parentId?: string;
  /** Total attenuation introduced by this component (dB) */
  attenuationDb?: number;
  /** Splitter split ratio (1xN) — only meaningful for SPLITTER kind */
  splitRatio?: number;
  /** Maximum fiber length downstream of this component (meters) */
  downstreamLengthM?: number;
  /** Installed firmware/serial when relevant */
  serialNumber?: string;
  /** Geographic location if known */
  location?: { latitude?: number; longitude?: number; address?: string };
  /** Source of truth for this component */
  sourceId: string;
}

/**
 * OLT form factor types.
 */
export type OltFormFactor =
  | 'chassis'    // Large chassis (11U-16U)
  | '2U'         // 2U rackmount
  | '1U'         // 1U compact
  | 'outdoor';   // Outdoor cabinet deployment

/**
 * Uplink interface type.
 */
export interface UplinkInterface {
  type: 'GE' | '10GE' | '40GE' | '100GE';
  count: number;
  /** SFP+ / QSFP28 / etc */
  transceiverType?: string;
}

export interface OltSummary {
  id: string;
  name: string;
  ip: string;
  status: 'online' | 'offline' | 'degraded';
  uptimeSeconds?: number;
  temperatureCelsius?: number;
  /** Vendor/family identifier (e.g., 'Huawei MA5800', 'Nokia Lightspan FX-16') */
  model?: string;
  /** IANA PEN if available */
  vendorId?: string;
}

/**
 * Extended OLT detail with capacity and PON information.
 * Populated when the NMS exposes detailed OLT inventory.
 */
export interface OltDetail extends OltSummary {
  /** Number of PON ports currently active */
  ponPortsActive?: number;
  /** Maximum PON ports supported by the chassis */
  ponPortsMax?: number;
  /** Primary PON technology deployed */
  ponTechnology?: PonTechnology;
  /** All PON technologies supported (for Combo PON OLTs) */
  ponTechnologiesSupported?: PonTechnology[];
  /** Whether the OLT supports Flex-PON combo (GPON+XGS-PON on same port) */
  comboPonSupported?: boolean;
  /** Maximum subscribers supported by the OLT */
  maxSubscribers?: number;
  /** Number of subscribers currently connected */
  subscribersConnected?: number;
  /** OLT form factor */
  formFactor?: OltFormFactor;
  /** Uplink interfaces available */
  uplinkInterfaces?: UplinkInterface[];
  /** Chassis slots total */
  slotsTotal?: number;
  /** Chassis slots occupied */
  slotsOccupied?: number;
  /** Firmware/software version */
  firmwareVersion?: string;
  /** Optical budget in dB */
  opticalBudgetDb?: number;
  /** Optical class for PON reach calculation */
  opticalClass?: OpticalClass;
  /** Maximum PON reach in km (typical for the configured class) */
  maxDistanceKm?: number;
  /** Standards compliance (OMCI, vOMCI, TR-069, USP, vOLT) */
  standardsCompliance?: StandardsCompliance;
  /** Disaggregated white-box hardware (TIP, OCP) when applicable */
  disaggregatedHardware?: boolean;
  /** Built-in OTDR availability */
  builtInOtdr?: boolean;
}

export interface OnuSummary {
  id: string;
  serial: string;
  oltId: string;
  customerName?: string;
  status: 'online' | 'offline' | 'degraded';
  rxPowerDbm?: number;
  txPowerDbm?: number;
  uptimeSeconds?: number;
  lastSeenAt?: string;
  /** Optical-health telemetry (optional; only populated when the NMS exposes it). */
  fecCorrected?: number;
  fecUncorrected?: number;
  biasCurrentMa?: number;
  ontTemperatureCelsius?: number;
  /**
   * Per-ONU LOS (loss-of-signal) monotonic counter — total seconds without
   * optical signal since the ONU last booted. Absence means "the NMS does
   * not expose LOS for this ONU" (e.g. Mikrowisp). When present, this is a
   * monotonically non-decreasing counter; `detectLosEvents` (PR #89 / detector
   * slice) consumes its delta over a 24 h window to flag fiber-cuts vs.
   * link/power-down.
   */
  losSecondsTotal?: number;
}

/**
 * WiFi standard types for ONTs with wireless capability.
 */
export type WifiStandard = 'WiFi4' | 'WiFi5' | 'WiFi6' | 'WiFi6E' | 'WiFi7';

/**
 * ONT form factor types.
 */
export type OntFormFactor =
  | 'gateway'      // Indoor gateway (typical FTTH)
  | 'ont'          // Standalone ONT (no WiFi)
  | 'stick'        // SFP GPON stick (plugged into switch/router)
  | 'ont_wifi';   // ONT with WiFi (e.g., Huawei HG8245)

export interface OnuDetail extends OnuSummary {
  /** Hardware model (e.g., 'HG8245H', 'F680', 'G-240G-A') */
  model?: string;
  /** Manufacturer (e.g., 'Huawei', 'ZTE', 'Nokia') */
  vendor?: string;
  /** OLT PON port identifier (e.g., '0/1/4') */
  oltPort?: string;
  firmwareVersion?: string;
  signalHistory?: Array<{
    timestamp: string;
    rxPowerDbm: number;
  }>;

  // Extended capabilities (populated when NMS exposes them)

  /** PON technology the ONT is using */
  ponTechnology?: PonTechnology;
  /** ONT form factor */
  formFactor?: OntFormFactor;
  /** WiFi standard (if wireless capable) */
  wifiStandard?: WifiStandard;
  /** WiFi bands available */
  wifiBands?: Array<'2.4GHz' | '5GHz' | '6GHz'>;
  /** Maximum WiFi speed in Mbps */
  wifiMaxSpeedMbps?: number;
  /** Number of Ethernet ports */
  ethernetPorts?: number;
  /** Number of POTS (voice) ports */
  potsPorts?: number;
  /** USB ports count */
  usbPorts?: number;
  /** Maximum downstream speed in Mbps (from service profile) */
  maxDownstreamMbps?: number;
  /** Maximum upstream speed in Mbps (from service profile) */
  maxUpstreamMbps?: number;
  /** CATV port present */
  hasCatv?: boolean;
  /** Optical class (B+, C+, N1/N2 for 50G-PON) */
  opticalClass?: OpticalClass;
  /** WPA3 personal/enterprise support */
  wpa3Supported?: boolean;
  /** Supports 160 MHz WiFi channels */
  wifi160Mhz?: boolean;
  /** Supports MLO (Multi-Link Operation, WiFi 7 feature) */
  wifiMloSupported?: boolean;
  /** Maximum number of SSIDs */
  maxSsids?: number;
  /** OMCI management channel active */
  omciActive?: boolean;
  /** OMCI version when known */
  omciVersion?: string;
  /** ONT serial number (formatted) */
  formattedSerial?: string;
}

export interface NetworkOverview {
  totalOlts: number;
  oltsOnline: number;
  totalOnus: number;
  onusOnline: number;
  onusOffline: number;
  averageUptimeSeconds: number;
  oltsWithHighTemperature: number;
}

export interface RateLimitError extends Error {
  code: 'RATE_LIMIT';
  retryAfterSeconds?: number;
}

/**
 * ODN topology graph — physical fiber plant from OLT to subscriber.
 *
 * This model is built from operator-provided topology or SNMP-derived hints.
 * It is NOT inferred: per the evidence-first principle, components only enter
 * the graph when there is a registered edge or varbind confirming them.
 */
export interface OdnTopologyGraph {
  oltId: string;
  components: OdnComponent[];
  edges: Array<{
    parentId: string;
    childId: string;
    /** Loss introduced by the upstream segment (dB) */
    segmentLossDb?: number;
    /** Physical fiber length of this segment (meters) */
    fiberLengthM?: number;
  }>;
  /** Total optical budget from OLT to deepest ONU (dB) */
  totalBudgetDb?: number;
  /** Source that produced this graph */
  sourceId: string;
}

/**
 * Detected hint from an SNMP trap that suggests an ODN component is reachable.
 * Adapters emit these when varbinds reference splitter/CTO identifiers.
 * The system only uses them to enrich existing topology, never to invent it.
 */
export interface OdnComponentHint {
  kind: OdnComponentKind;
  candidateId: string;
  sourceTrapOid: string;
  confidence: 'low' | 'medium' | 'high';
  evidence: Record<string, string>;
}

export interface INmsConnector {
  readonly providerName: string;

  /** Ping al NMS para validar credenciales. */
  ping(): Promise<{ ok: boolean; latencyMs?: number; error?: string }>;

  /** Lista de todos los OLTs. */
  listOlts(): Promise<OltSummary[]>;

  /**
   * Detalle de un OLT específico.
   * Retorna información extendida cuando el NMS la expone.
   */
  getOltDetail(oltId: string): Promise<OltDetail>;

  /** Resumen de la red entera. */
  getNetworkOverview(): Promise<NetworkOverview>;

  /** Lista de ONUs, opcionalmente filtradas por OLT. */
  listOnus(filter?: { oltId?: string; status?: OnuSummary['status'] }): Promise<OnuSummary[]>;

  /** Detalle completo de una ONU por serial o por id. */
  getOnuDetail(identifier: string): Promise<OnuDetail | null>;

  /** ONUs con señal RX por debajo del umbral (en dBm). */
  getOnusWithLowSignal(thresholdDbm: number): Promise<OnuSummary[]>;

  /** Busca ONUs por nombre del cliente (búsqueda parcial, case-insensitive). */
  searchByCustomerName(name: string): Promise<OnuSummary[]>;

  /**
   * Lista de ONUs conectadas a un OLT específico con detalles extendidos.
   * Retorna información detallada cuando el NMS la expone.
   * @experimental - NMS may not support this method
   */
  listOnusByOlt?(oltId: string): Promise<OnuDetail[]>;
}

export function isRateLimitError(err: unknown): err is RateLimitError {
  return err instanceof Error && 'code' in err && (err as { code: unknown }).code === 'RATE_LIMIT';
}

export {
  NMS_REQUEST_TIMEOUT_MS,
  UnsafeNmsUrlError,
  assertSafeNmsBaseUrl,
  assertSafeNmsRequestUrl,
} from './security';
