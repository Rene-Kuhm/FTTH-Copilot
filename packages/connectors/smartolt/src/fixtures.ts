/**
 * Fixtures for the SmartOLT mock connector.
 *
 * Models a typical mid-sized Argentine ISP FTTH network.
 * Shape and values derived from public sources:
 *   - SmartOLT Public API documentation (Postman workspace):
 *     https://www.postman.com/smartolt/smartolt-s-public-workspace/
 *   - SmartOLT setup guides for real OLT models (Huawei MA5680T, ZTE C600):
 *     https://www.smartolt.com/huawei-olt-initial-setup.html
 *     https://www.smartolt.com/zte-c6xx-olt-initial-setup.html
 *   - Real-world ODB naming convention (F401-055-5) from sample responses
 *   - Real-world signal ranges and ONT models (Huawei HG8145V5, ZTE F600)
 *
 * Customer names are fictional Argentine names, not real customers.
 *
 * ## Topology overview
 * 5 OLTs across 4 Argentine localities + 42 ONUs distributed realistically.
 * Intentional scenarios embedded:
 *   - OLT-Este: 2 ONUs offline in same time window (planta externa event)
 *   - OLT-Oeste: 2 ONUs offline (degraded OLT with high temp)
 *   - 1 ONU with 10-day uptime (long-running stable connection)
 *   - 1 degraded ONU with borderline signal (-26.5 dBm)
 *
 * To regenerate with different scenarios, edit the OLT/ONU definitions below
 * and run `pnpm test:unit` to verify.
 */
import type { OltSummary, OnuSummary, OnuDetail, NetworkOverview } from '@ftth-copilot/connectors-core';

/**
 * 5 OLTs covering a typical Argentine ISP scale.
 * Mix of Huawei (most common in the region), ZTE, and Fiberhome.
 */
export const FIXTURE_OLTS: (OltSummary & {
  vendor: string;
  olt_hardware_version: string;
  firmware: string;
  location: string;
  telnet_port: number;
  snmp_port: number;
})[] = [
  {
    "id": "OLT-Norte-01",
    "name": "OLT-Norte-Principal",
    "ip": "10.0.1.10",
    "vendor": "Huawei",
    "olt_hardware_version": "MA5680T",
    "firmware": "V800R018C10",
    "status": "online",
    "uptimeSeconds": 1234567,
    "temperatureCelsius": 42,
    "location": "POP Norte - BsAs",
    "telnet_port": 2333,
    "snmp_port": 2161
  },
  {
    "id": "OLT-Sur-01",
    "name": "OLT-Sur-Respaldo",
    "ip": "10.0.1.11",
    "vendor": "ZTE",
    "olt_hardware_version": "C600",
    "firmware": "V1.2.5P3",
    "status": "online",
    "uptimeSeconds": 9876543,
    "temperatureCelsius": 38,
    "location": "POP Sur - Lanus",
    "telnet_port": 2333,
    "snmp_port": 2161
  },
  {
    "id": "OLT-Este-01",
    "name": "OLT-Este-Cobertura",
    "ip": "10.0.1.12",
    "vendor": "Huawei",
    "olt_hardware_version": "MA5800-X7",
    "firmware": "V100R019C10",
    "status": "online",
    "uptimeSeconds": 86400,
    "temperatureCelsius": 68,
    "location": "POP Este - Quilmes",
    "telnet_port": 2333,
    "snmp_port": 2161
  },
  {
    "id": "OLT-Centro-01",
    "name": "OLT-Centro-Central",
    "ip": "10.0.1.13",
    "vendor": "ZTE",
    "olt_hardware_version": "C320",
    "firmware": "V1.2.0P2",
    "status": "online",
    "uptimeSeconds": 5242880,
    "temperatureCelsius": 41,
    "location": "POP Centro - CABA",
    "telnet_port": 2333,
    "snmp_port": 2161
  },
  {
    "id": "OLT-Oeste-01",
    "name": "OLT-Oeste-Cobertura",
    "ip": "10.0.1.14",
    "vendor": "Fiberhome",
    "olt_hardware_version": "AN5516-04",
    "firmware": "RP0200",
    "status": "degraded",
    "uptimeSeconds": 432000,
    "temperatureCelsius": 72,
    "location": "POP Oeste - Moron",
    "telnet_port": 2333,
    "snmp_port": 2161
  }
];

/**
 * 42 ONUs distributed across the 5 OLTs.
 * Status distribution: 37 online, 4 offline, 1 degraded.
 *
 * Optical-health telemetry (FEC, bias, ONT temperature) is populated when
 * the connector runs with `includeOnuDetail: true`, so it lives on the
 * `FIXTURE_ONU_DETAILS` map rather than here. Real SmartOLT bulk responses
 * rarely carry these fields; the fan-out to the per-ONU endpoint is what
 * surfaces them.
 */
export const FIXTURE_ONUS: OnuSummary[] = [
  {
    "id": "ONU-OLT-Norte-01-1/1/1",
    "serial": "SNHUA00000001",
    "oltId": "OLT-Norte-01",
    "customerName": "Juan Perez",
    "status": "online",
    "rxPowerDbm": -20.5,
    "txPowerDbm": 2.1,
    "uptimeSeconds": 432000,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Norte-01-1/1/2",
    "serial": "SNHUA00000002",
    "oltId": "OLT-Norte-01",
    "customerName": "Maria Garcia",
    "status": "online",
    "rxPowerDbm": -21.5,
    "txPowerDbm": 2.1,
    "uptimeSeconds": 432000,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Norte-01-1/1/3",
    "serial": "SNZTE00000003",
    "oltId": "OLT-Norte-01",
    "customerName": "Carlos Lopez",
    "status": "online",
    "rxPowerDbm": -19.5,
    "txPowerDbm": 2.1,
    "uptimeSeconds": 432000,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Norte-01-1/1/4",
    "serial": "SNZTE00000004",
    "oltId": "OLT-Norte-01",
    "customerName": "Ana Martinez",
    "status": "online",
    "rxPowerDbm": -20.5,
    "txPowerDbm": 2.1,
    "uptimeSeconds": 432000,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Norte-01-1/1/5",
    "serial": "SNFIB00000005",
    "oltId": "OLT-Norte-01",
    "customerName": "Roberto Rodriguez",
    "status": "online",
    "rxPowerDbm": -21.5,
    "txPowerDbm": 2.1,
    "uptimeSeconds": 432000,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Norte-01-1/1/6",
    "serial": "SNHUA00000006",
    "oltId": "OLT-Norte-01",
    "customerName": "Laura Fernandez",
    "status": "online",
    "rxPowerDbm": -19.5,
    "txPowerDbm": 2.1,
    "uptimeSeconds": 432000,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Norte-01-1/1/7",
    "serial": "SNHUA00000007",
    "oltId": "OLT-Norte-01",
    "customerName": "Diego Sanchez",
    "status": "online",
    "rxPowerDbm": -20.5,
    "txPowerDbm": 2.1,
    "uptimeSeconds": 432000,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Norte-01-1/1/8",
    "serial": "SNZTE00000008",
    "oltId": "OLT-Norte-01",
    "customerName": "Valeria Gimenez",
    "status": "online",
    "rxPowerDbm": -21.5,
    "txPowerDbm": 2.1,
    "uptimeSeconds": 432000,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Norte-01-1/1/9",
    "serial": "SNZTE00000009",
    "oltId": "OLT-Norte-01",
    "customerName": "Martin Alvarez",
    "status": "online",
    "rxPowerDbm": -19.5,
    "txPowerDbm": 2.1,
    "uptimeSeconds": 432000,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Norte-01-1/1/10",
    "serial": "SNFIB00000010",
    "oltId": "OLT-Norte-01",
    "customerName": "Sofia Torres",
    "status": "online",
    "rxPowerDbm": -20.5,
    "txPowerDbm": 2.1,
    "uptimeSeconds": 432000,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Sur-01-1/1/1",
    "serial": "SNHUA00000011",
    "oltId": "OLT-Sur-01",
    "customerName": "Pablo Romero",
    "status": "online",
    "rxPowerDbm": -21.0,
    "txPowerDbm": 2.3,
    "uptimeSeconds": 604800,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Sur-01-1/1/2",
    "serial": "SNHUA00000012",
    "oltId": "OLT-Sur-01",
    "customerName": "Camila Herrera",
    "status": "online",
    "rxPowerDbm": -22.0,
    "txPowerDbm": 2.3,
    "uptimeSeconds": 604800,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Sur-01-1/1/3",
    "serial": "SNZTE00000013",
    "oltId": "OLT-Sur-01",
    "customerName": "Lucas Morales",
    "status": "online",
    "rxPowerDbm": -23.0,
    "txPowerDbm": 2.3,
    "uptimeSeconds": 604800,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Sur-01-1/1/4",
    "serial": "SNZTE00000014",
    "oltId": "OLT-Sur-01",
    "customerName": "Isabel Diaz",
    "status": "online",
    "rxPowerDbm": -20.0,
    "txPowerDbm": 2.3,
    "uptimeSeconds": 604800,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Sur-01-1/1/5",
    "serial": "SNFIB00000015",
    "oltId": "OLT-Sur-01",
    "customerName": "Fernando Castro",
    "status": "online",
    "rxPowerDbm": -21.0,
    "txPowerDbm": 2.3,
    "uptimeSeconds": 604800,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Sur-01-1/1/6",
    "serial": "SNHUA00000016",
    "oltId": "OLT-Sur-01",
    "customerName": "Paula Vargas",
    "status": "online",
    "rxPowerDbm": -22.0,
    "txPowerDbm": 2.3,
    "uptimeSeconds": 604800,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Sur-01-1/1/7",
    "serial": "SNHUA00000017",
    "oltId": "OLT-Sur-01",
    "customerName": "Andres Mendoza",
    "status": "online",
    "rxPowerDbm": -23.0,
    "txPowerDbm": 2.3,
    "uptimeSeconds": 604800,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Sur-01-1/1/8",
    "serial": "SNZTE00000018",
    "oltId": "OLT-Sur-01",
    "customerName": "Lucia Ramos",
    "status": "online",
    "rxPowerDbm": -20.0,
    "txPowerDbm": 2.3,
    "uptimeSeconds": 604800,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Sur-01-1/1/9",
    "serial": "SNZTE00000019",
    "oltId": "OLT-Sur-01",
    "customerName": "Mateo Ortiz",
    "status": "online",
    "rxPowerDbm": -21.0,
    "txPowerDbm": 2.3,
    "uptimeSeconds": 604800,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Sur-01-1/1/10",
    "serial": "SNFIB00000020",
    "oltId": "OLT-Sur-01",
    "customerName": "Carla Medina",
    "status": "online",
    "rxPowerDbm": -22.0,
    "txPowerDbm": 2.3,
    "uptimeSeconds": 604800,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Sur-01-1/1/11",
    "serial": "SNHUA00000021",
    "oltId": "OLT-Sur-01",
    "customerName": "Nicolas Aguilar",
    "status": "online",
    "rxPowerDbm": -23.0,
    "txPowerDbm": 2.3,
    "uptimeSeconds": 604800,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Sur-01-1/1/12",
    "serial": "SNHUA00000022",
    "oltId": "OLT-Sur-01",
    "customerName": "Julieta Rios",
    "status": "online",
    "rxPowerDbm": -20.0,
    "txPowerDbm": 2.3,
    "uptimeSeconds": 604800,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Este-01-1/1/1",
    "serial": "SNZTE00000023",
    "oltId": "OLT-Este-01",
    "customerName": "Juan Perez",
    "status": "online",
    "rxPowerDbm": -22.0,
    "txPowerDbm": 2.0,
    "uptimeSeconds": 259200,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Este-01-1/1/2",
    "serial": "SNZTE00000024",
    "oltId": "OLT-Este-01",
    "customerName": "Maria Garcia",
    "status": "online",
    "rxPowerDbm": -23.0,
    "txPowerDbm": 2.0,
    "uptimeSeconds": 259200,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Este-01-1/1/3",
    "serial": "SNFIB00000025",
    "oltId": "OLT-Este-01",
    "customerName": "Carlos Lopez",
    "status": "online",
    "rxPowerDbm": -21.0,
    "txPowerDbm": 2.0,
    "uptimeSeconds": 259200,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Este-01-1/1/4",
    "serial": "SNHUA00000026",
    "oltId": "OLT-Este-01",
    "customerName": "Ana Martinez",
    "status": "online",
    "rxPowerDbm": -22.0,
    "txPowerDbm": 2.0,
    "uptimeSeconds": 259200,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Este-01-1/1/5",
    "serial": "SNHUA00000027",
    "oltId": "OLT-Este-01",
    "customerName": "Roberto Rodriguez",
    "status": "online",
    "rxPowerDbm": -23.0,
    "txPowerDbm": 2.0,
    "uptimeSeconds": 259200,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Este-01-1/1/6",
    "serial": "SNZTE00000028",
    "oltId": "OLT-Este-01",
    "customerName": "Laura Fernandez",
    "status": "online",
    "rxPowerDbm": -21.0,
    "txPowerDbm": 2.0,
    "uptimeSeconds": 259200,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Este-01-1/7/4",
    "serial": "SNZTE00000029",
    "oltId": "OLT-Este-01",
    "customerName": "Diego Sanchez",
    "status": "offline",
    "rxPowerDbm": -30.0,
    "txPowerDbm": 0,
    "uptimeSeconds": 0,
    "lastSeenAt": "2026-08-19T19:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Este-01-1/7/5",
    "serial": "SNFIB00000030",
    "oltId": "OLT-Este-01",
    "customerName": "Valeria Gimenez",
    "status": "offline",
    "rxPowerDbm": -30.0,
    "txPowerDbm": 0,
    "uptimeSeconds": 0,
    "lastSeenAt": "2026-08-19T19:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Este-01-1/8/1",
    "serial": "SNHUA00000031",
    "oltId": "OLT-Este-01",
    "customerName": "Martin Alvarez",
    "status": "degraded",
    "rxPowerDbm": -26.5,
    "txPowerDbm": 2.0,
    "uptimeSeconds": 1209600,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Centro-01-1/1/1",
    "serial": "SNHUA00000032",
    "oltId": "OLT-Centro-01",
    "customerName": "Sofia Torres",
    "status": "online",
    "rxPowerDbm": -23.0,
    "txPowerDbm": 2.2,
    "uptimeSeconds": 345600,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Centro-01-1/1/2",
    "serial": "SNZTE00000033",
    "oltId": "OLT-Centro-01",
    "customerName": "Pablo Romero",
    "status": "online",
    "rxPowerDbm": -24.0,
    "txPowerDbm": 2.2,
    "uptimeSeconds": 345600,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Centro-01-1/1/3",
    "serial": "SNZTE00000034",
    "oltId": "OLT-Centro-01",
    "customerName": "Camila Herrera",
    "status": "online",
    "rxPowerDbm": -22.0,
    "txPowerDbm": 2.2,
    "uptimeSeconds": 345600,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Centro-01-1/1/4",
    "serial": "SNFIB00000035",
    "oltId": "OLT-Centro-01",
    "customerName": "Lucas Morales",
    "status": "online",
    "rxPowerDbm": -23.0,
    "txPowerDbm": 2.2,
    "uptimeSeconds": 345600,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Centro-01-1/1/5",
    "serial": "SNHUA00000036",
    "oltId": "OLT-Centro-01",
    "customerName": "Isabel Diaz",
    "status": "online",
    "rxPowerDbm": -24.0,
    "txPowerDbm": 2.2,
    "uptimeSeconds": 345600,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Centro-01-1/1/6",
    "serial": "SNHUA00000037",
    "oltId": "OLT-Centro-01",
    "customerName": "Fernando Castro",
    "status": "online",
    "rxPowerDbm": -22.0,
    "txPowerDbm": 2.2,
    "uptimeSeconds": 345600,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Oeste-01-1/1/1",
    "serial": "SNZTE00000038",
    "oltId": "OLT-Oeste-01",
    "customerName": "Paula Vargas",
    "status": "online",
    "rxPowerDbm": -23.0,
    "txPowerDbm": 2.1,
    "uptimeSeconds": 86400,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Oeste-01-1/1/2",
    "serial": "SNZTE00000039",
    "oltId": "OLT-Oeste-01",
    "customerName": "Andres Mendoza",
    "status": "online",
    "rxPowerDbm": -23.0,
    "txPowerDbm": 2.1,
    "uptimeSeconds": 86400,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Oeste-01-1/1/3",
    "serial": "SNFIB00000040",
    "oltId": "OLT-Oeste-01",
    "customerName": "Lucia Ramos",
    "status": "offline",
    "rxPowerDbm": -29.0,
    "txPowerDbm": 0,
    "uptimeSeconds": 0,
    "lastSeenAt": "2026-08-18T19:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Oeste-01-1/1/4",
    "serial": "SNHUA00000041",
    "oltId": "OLT-Oeste-01",
    "customerName": "Mateo Ortiz",
    "status": "offline",
    "rxPowerDbm": -29.0,
    "txPowerDbm": 0,
    "uptimeSeconds": 0,
    "lastSeenAt": "2026-08-18T19:30:00+00:00"
  },
  {
    "id": "ONU-OLT-Norte-01-1/9/9",
    "serial": "HUA1234567890",
    "oltId": "OLT-Norte-01",
    "customerName": "CLI-0999",
    "status": "online",
    "rxPowerDbm": -20.5,
    "txPowerDbm": 2.1,
    "uptimeSeconds": 864000,
    "lastSeenAt": "2026-08-20T01:30:00+00:00"
  }
];

/**
 * Detailed view for ONUs with signal history or interesting cases.
 * Keys are ONU IDs; values extend OnuSummary with the OnuDetail fields.
 *
 * Optical-health telemetry is included for the ONUs that should trigger the
 * `detectFecDegradation` / `detectOpticalDegradation` detectors when the
 * metrics poller runs with `includeOnuDetail: true` (see `seed-scenario.ts`
 * for an end-to-end exercise).
 *
 * Realistic values:
 *   - Healthy ONU (1/1/1 Norte): FEC corregido 0..5/día, bias ~15 mA, 48 °C.
 *   - Degraded ONU (1/8/1 Este): FEC corregido creciendo, bias alto,
 *     temperatura cerca del límite — pre-alerta antes del corte.
 *   - Vulnerable firmware (Norte 1/9/9): corre la versión marcada como
 *     vulnerable en el allowlist por defecto del firmware audit (ver
 *     `packages/soc/src/run.ts`).
 */
export const FIXTURE_ONU_DETAILS: Record<string, OnuDetail> = {
  "ONU-OLT-Norte-01-1/1/1": {
    "id": "ONU-OLT-Norte-01-1/1/1",
    "serial": "SNHUA00000001",
    "oltId": "OLT-Norte-01",
    "customerName": "Juan Perez",
    "status": "online",
    "rxPowerDbm": -20.5,
    "txPowerDbm": 2.1,
    "uptimeSeconds": 432000,
    "lastSeenAt": "2026-08-20T01:30:00+00:00",
    "model": "HG8145V5",
    "vendor": "Huawei",
    "oltPort": "1/1/1",
    "firmwareVersion": "V3R019C10S160",
    "fecCorrected": 3,
    "fecUncorrected": 0,
    "biasCurrentMa": 15.2,
    "ontTemperatureCelsius": 48,
  },
  "ONU-OLT-Este-01-1/7/4": {
    "id": "ONU-OLT-Este-01-1/7/4",
    "serial": "SNZTE00000029",
    "oltId": "OLT-Este-01",
    "customerName": "Diego Sanchez",
    "status": "offline",
    "rxPowerDbm": -30.0,
    "txPowerDbm": 0,
    "uptimeSeconds": 0,
    "lastSeenAt": "2026-08-19T19:30:00+00:00",
    "model": "F670G",
    "vendor": "ZTE",
    "oltPort": "1/7/4",
    "firmwareVersion": "V2.0.0P3",
    // Pre-failure state — fiber was degrading before the link dropped.
    "fecCorrected": 4820,
    "fecUncorrected": 17,
    "biasCurrentMa": 38.5,
    "ontTemperatureCelsius": 71,
    // P2.2 — high LOS counter: the link lost optical signal for 18 hours
    // inside the 24-hour window before the offline event (pre-failure
    // signal loss typical of a fiber cut in progress).
    "losSecondsTotal": 64800,
    "signalHistory": [
      {
        "timestamp": "2026-08-19T01:30:00+00:00",
        "rxPowerDbm": -24.0
      },
      {
        "timestamp": "2026-08-19T13:30:00+00:00",
        "rxPowerDbm": -27.5
      },
      {
        "timestamp": "2026-08-19T19:30:00+00:00",
        "rxPowerDbm": -30.0
      }
    ]
  },
  "ONU-OLT-Este-01-1/7/5": {
    "id": "ONU-OLT-Este-01-1/7/5",
    "serial": "SNFIB00000030",
    "oltId": "OLT-Este-01",
    "customerName": "Valeria Gimenez",
    "status": "offline",
    "rxPowerDbm": -30.0,
    "txPowerDbm": 0,
    "uptimeSeconds": 0,
    "lastSeenAt": "2026-08-19T19:30:00+00:00",
    "model": "HG680-L",
    "vendor": "Fiberhome",
    "oltPort": "1/7/5",
    "firmwareVersion": "V1.0.0",
    "fecCorrected": 0,
    "fecUncorrected": 0,
    "biasCurrentMa": 12.1,
    "ontTemperatureCelsius": 44,
    "signalHistory": [
      {
        "timestamp": "2026-08-19T01:30:00+00:00",
        "rxPowerDbm": -24.0
      },
      {
        "timestamp": "2026-08-19T13:30:00+00:00",
        "rxPowerDbm": -27.5
      },
      {
        "timestamp": "2026-08-19T19:30:00+00:00",
        "rxPowerDbm": -30.0
      }
    ]
  },
  "ONU-OLT-Este-01-1/8/1": {
    "id": "ONU-OLT-Este-01-1/8/1",
    "serial": "SNHUA00000031",
    "oltId": "OLT-Este-01",
    "customerName": "Martin Alvarez",
    "status": "degraded",
    "rxPowerDbm": -26.5,
    "txPowerDbm": 2.0,
    "uptimeSeconds": 1209600,
    "lastSeenAt": "2026-08-20T01:30:00+00:00",
    "model": "HG8145V5",
    "vendor": "Huawei",
    "oltPort": "1/8/1",
    "firmwareVersion": "V3R019C10S135",
    // Fiber degrading but not yet offline — pre-alerta del detector.
    "fecCorrected": 980,
    "fecUncorrected": 2,
    "biasCurrentMa": 32.8,
    "ontTemperatureCelsius": 66,
    // P2.2 — small but non-zero LOS counter: link flapped briefly during
    // fiber degradation (90 seconds of LOS across the 14-day uptime window),
    // enough to exercise the detector's Δ-bound calculation without
    // crossing into "this is a fiber cut yet".
    "losSecondsTotal": 90,
  },
  "ONU-OLT-Norte-01-1/9/9": {
    "id": "ONU-OLT-Norte-01-1/9/9",
    "serial": "HUA1234567890",
    "oltId": "OLT-Norte-01",
    "customerName": "CLI-0999",
    "status": "online",
    "rxPowerDbm": -20.5,
    "txPowerDbm": 2.1,
    "uptimeSeconds": 864000,
    "lastSeenAt": "2026-08-20T01:30:00+00:00",
    "model": "HG8145V5",
    "vendor": "Huawei",
    "oltPort": "1/9/9",
    "firmwareVersion": "V3R019C10S135",
    "fecCorrected": 5,
    "fecUncorrected": 0,
    "biasCurrentMa": 14.9,
    "ontTemperatureCelsius": 47,
  }
};

/**
 * Aggregated network-wide stats, computed once at module load.
 */
export function computeOverview(): NetworkOverview {
  const onlineOnus = FIXTURE_ONUS.filter((o) => o.status === 'online').length;
  const offlineOnus = FIXTURE_ONUS.filter((o) => o.status === 'offline').length;
  const oltsOnline = FIXTURE_OLTS.filter((o) => o.status === 'online').length;
  const oltsHighTemp = FIXTURE_OLTS.filter(
    (o) => (o.temperatureCelsius ?? 0) > 60,
  ).length;
  const avgUptime =
    FIXTURE_ONUS.reduce((acc, o) => acc + (o.uptimeSeconds ?? 0), 0) /
    FIXTURE_ONUS.length;

  return {
    totalOlts: FIXTURE_OLTS.length,
    oltsOnline,
    totalOnus: FIXTURE_ONUS.length,
    onusOnline: onlineOnus,
    onusOffline: offlineOnus,
    averageUptimeSeconds: Math.round(avgUptime),
    oltsWithHighTemperature: oltsHighTemp,
  };
}
