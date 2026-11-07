/**
 * Addresses and lab credentials of the virtual test bench.
 *
 * The Docker Compose file (`docker-compose.lab.yml`) publishes these ports on
 * the loopback and the scripts reach the bench through them. When a port moves
 * in the compose file it has to move here too — `docker-compose.lab.yml` is the
 * single owner of the mapping, this module mirrors it for the host-side tools.
 *
 * Every default is a lab default: a published port on 127.0.0.1, a non
 * production password and a read-only SNMP community. Nothing here is reused by
 * the application.
 */

/** Loopback-only ports the bench publishes on the host. */
export interface LabPorts {
  /** BBSim REST API (`GET /v1/olt`). */
  readonly bbsimRest: number;
  /** BBSim OpenOLT gRPC endpoint. */
  readonly bbsimGrpc: number;
  /** snmpsim UDP agent (every capture is a community). */
  readonly snmpsim: number;
  /** MikroTik CHR REST API over HTTP. */
  readonly chrRest: number;
  /** MikroTik CHR SNMP agent. */
  readonly chrSnmp: number;
}

export interface LabConfig {
  readonly host: string;
  readonly ports: LabPorts;
  readonly bbsim: {
    /** PON ports the simulated OLT exposes. */
    readonly ponPorts: number;
    /** ONUs the simulator creates per PON port. */
    readonly onusPerPon: number;
  };
  readonly chr: {
    readonly restUrl: string;
    readonly adminUser: string;
    /** Lab-only credential, never a production one. */
    readonly adminPassword: string;
    readonly snmpCommunity: string;
  };
}

export const LAB_DEFAULTS = {
  host: '127.0.0.1',
  ports: {
    bbsimRest: 15071,
    bbsimGrpc: 15060,
    snmpsim: 16100,
    chrRest: 15080,
    chrSnmp: 16101,
  },
  bbsim: { ponPorts: 4, onusPerPon: 2 },
  chr: {
    adminUser: 'admin',
    adminPassword: 'ftth-lab-not-prod',
    snmpCommunity: 'ftthlab',
  },
} as const;

function port(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`${name} must be a TCP/UDP port, got "${value}"`);
  }
  return parsed;
}

/** The lab configuration, with `LAB_*` environment overrides applied. */
export function labConfig(env: NodeJS.ProcessEnv = process.env): LabConfig {
  const host = env.LAB_HOST || LAB_DEFAULTS.host;
  const ports: LabPorts = {
    bbsimRest: port(env.LAB_BBSIM_REST_PORT, LAB_DEFAULTS.ports.bbsimRest, 'LAB_BBSIM_REST_PORT'),
    bbsimGrpc: port(env.LAB_BBSIM_GRPC_PORT, LAB_DEFAULTS.ports.bbsimGrpc, 'LAB_BBSIM_GRPC_PORT'),
    snmpsim: port(env.LAB_SNMPSIM_PORT, LAB_DEFAULTS.ports.snmpsim, 'LAB_SNMPSIM_PORT'),
    chrRest: port(env.LAB_CHR_REST_PORT, LAB_DEFAULTS.ports.chrRest, 'LAB_CHR_REST_PORT'),
    chrSnmp: port(env.LAB_CHR_SNMP_PORT, LAB_DEFAULTS.ports.chrSnmp, 'LAB_CHR_SNMP_PORT'),
  };
  return {
    host,
    ports,
    bbsim: { ...LAB_DEFAULTS.bbsim },
    chr: {
      restUrl: env.LAB_CHR_REST_URL || `http://${host}:${ports.chrRest}`,
      adminUser: env.LAB_CHR_ADMIN_USER || LAB_DEFAULTS.chr.adminUser,
      adminPassword: env.LAB_CHR_ADMIN_PASSWORD || LAB_DEFAULTS.chr.adminPassword,
      snmpCommunity: env.LAB_CHR_SNMP_COMMUNITY || LAB_DEFAULTS.chr.snmpCommunity,
    },
  };
}

/** BBSim REST base URL. */
export function bbsimRestUrl(config: LabConfig): string {
  return `http://${config.host}:${config.ports.bbsimRest}`;
}
