import crypto from 'node:crypto';
import { prisma, hashPassword, encryptApiKey } from '../src/index.js';
import type { MetricKind, DeviceKind, AlertKind, AlertSeverity } from '../src/index.js';

export const DEFAULT_TENANT_ID = 'demo-tenant';
export const DEFAULT_TENANT_NAME = 'Demo ISP';
export const DEFAULT_TENANT_SLUG = 'demo';

export const DEFAULT_ADMIN_EMAIL = 'admin@ftth-copilot.local';
export const DEFAULT_ADMIN_NAME = 'Admin User';

export interface SeedResult {
  tenantId: string;
  adminEmail: string;
  adminPassword?: string;
  connectionId: string;
}

// ── Synthetic demo data ─────────────────────────────────────────────────────────
// Mirrors the scenarios in packages/connectors/smartolt/src/fixtures.ts
// for use in the demo dashboard without real NMS credentials.
// Populated only when DEMO_DATA_ENABLED=true or --demo-data flag is passed.

interface SyntheticOnu {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'degraded';
  rxPowerDbm: number;
  txPowerDbm: number;
  temperatureCelsius: number;
  uptimeSeconds: number;
}

interface SyntheticOlt {
  id: string;
  name: string;
  temperatureCelsius: number;
  status: string;
}

const DEMO_OLTS: SyntheticOlt[] = [
  { id: 'OLT-Norte-01', name: 'OLT-Norte-Principal', temperatureCelsius: 42, status: 'online' },
  { id: 'OLT-Sur-01', name: 'OLT-Sur-Respaldo', temperatureCelsius: 38, status: 'online' },
  { id: 'OLT-Este-01', name: 'OLT-Este-Cobertura', temperatureCelsius: 68, status: 'online' },
  { id: 'OLT-Centro-01', name: 'OLT-Centro-Central', temperatureCelsius: 41, status: 'online' },
  { id: 'OLT-Oeste-01', name: 'OLT-Oeste-Cobertura', temperatureCelsius: 72, status: 'degraded' },
];

const DEMO_ONUS: SyntheticOnu[] = [
  // Offline ONUs — OLT-Este (fiber cut / planta externa event)
  { id: 'ONU-001', name: 'Martinez, Juan — Alsina 342', status: 'offline', rxPowerDbm: -999, txPowerDbm: 3.2, temperatureCelsius: 0, uptimeSeconds: 0 },
  { id: 'ONU-002', name: 'Garcia, Maria — Alsina 458', status: 'offline', rxPowerDbm: -999, txPowerDbm: 3.1, temperatureCelsius: 0, uptimeSeconds: 0 },
  // Offline ONUs — OLT-Oeste (degraded OLT)
  { id: 'ONU-003', name: 'Lopez, Carlos — Rawson 112', status: 'offline', rxPowerDbm: -999, txPowerDbm: 2.9, temperatureCelsius: 0, uptimeSeconds: 0 },
  { id: 'ONU-004', name: 'Rodriguez, Ana — Rawson 234', status: 'offline', rxPowerDbm: -999, txPowerDbm: 3.0, temperatureCelsius: 0, uptimeSeconds: 0 },
  // Degraded ONU — borderline signal
  { id: 'ONU-005', name: 'Fernandez, Pedro — Rivadavia 1800', status: 'degraded', rxPowerDbm: -26.5, txPowerDbm: 2.8, temperatureCelsius: 48, uptimeSeconds: 864000 },
  // Online stable — 10-day uptime
  { id: 'ONU-006', name: 'Diaz, Sofia — Corrientes 1200', status: 'online', rxPowerDbm: -20.3, txPowerDbm: 2.5, temperatureCelsius: 38, uptimeSeconds: 864000 },
  // Online ONUs (remaining 36)
  { id: 'ONU-007', name: 'Perez, Lucas — Lavalle 500', status: 'online', rxPowerDbm: -18.8, txPowerDbm: 2.4, temperatureCelsius: 36, uptimeSeconds: 2592000 },
  { id: 'ONU-008', name: 'Gomez, Lucia — Maipu 210', status: 'online', rxPowerDbm: -19.2, txPowerDbm: 2.6, temperatureCelsius: 39, uptimeSeconds: 1728000 },
  { id: 'ONU-009', name: 'Torres, Martin — Sarmiento 800', status: 'online', rxPowerDbm: -21.1, txPowerDbm: 2.7, temperatureCelsius: 40, uptimeSeconds: 5184000 },
  { id: 'ONU-010', name: 'Ruiz, Camila — 9 de Julio 445', status: 'online', rxPowerDbm: -17.6, txPowerDbm: 2.3, temperatureCelsius: 35, uptimeSeconds: 3456000 },
];

const NOW = new Date();
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

async function seedDemoData(connectionId: string): Promise<void> {
  const demoDataEnabled =
    process.env.DEMO_DATA_ENABLED === 'true' ||
    process.argv.includes('--demo-data');
  if (!demoDataEnabled) return;

  // ── OLT Metric Samples ─────────────────────────────────────────────────────
  const oltSamples = DEMO_OLTS.flatMap((olt) =>
    [0, -6, -24].map((hoursAgo) => ({
      tenantId: DEFAULT_TENANT_ID,
      connectionId,
      deviceKind: 'OLT' as DeviceKind,
      deviceId: olt.id,
      kind: 'TEMPERATURE_CELSIUS' as MetricKind,
      value: olt.temperatureCelsius + (Math.random() - 0.5) * 2,
      sampledAt: new Date(NOW.getTime() - hoursAgo * HOUR_MS),
    })),
  );

  // ── ONU Metric Samples ──────────────────────────────────────────────────────
  const onuSamples = DEMO_ONUS.flatMap((onu) => {
    const samples: Array<{
      tenantId: string;
      connectionId: string;
      deviceKind: DeviceKind;
      deviceId: string;
      kind: MetricKind;
      value: number;
      sampledAt: Date;
    }> = [];

    // Generate 7-day history (hourly samples, every 6th for brevity)
    for (let h = 0; h <= 168; h += 6) {
      const ts = new Date(NOW.getTime() - h * HOUR_MS);
      const noise = (Math.random() - 0.5) * 0.5;

      if (onu.status === 'offline') {
        // LOS growing before offline
        const losHours = Math.min(h, 18);
        samples.push({
          tenantId: DEFAULT_TENANT_ID,
          connectionId,
          deviceKind: 'ONU' as DeviceKind,
          deviceId: onu.id,
          kind: 'LOS_SECONDS_TOTAL' as MetricKind,
          value: h <= 18 ? losHours * 3600 : 18 * 3600,
          sampledAt: ts,
        });
        if (h < 18) {
          samples.push({
            tenantId: DEFAULT_TENANT_ID,
            connectionId,
            deviceKind: 'ONU' as DeviceKind,
            deviceId: onu.id,
            kind: 'RX_POWER_DBM' as MetricKind,
            value: -25 + noise,
            sampledAt: ts,
          });
        }
      } else if (onu.status === 'degraded') {
        // Signal drifting down
        const drift = (h / 168) * 3.5; // 3.5 dB drop over 7 days
        samples.push({
          tenantId: DEFAULT_TENANT_ID,
          connectionId,
          deviceKind: 'ONU' as DeviceKind,
          deviceId: onu.id,
          kind: 'RX_POWER_DBM' as MetricKind,
          value: -23.0 + drift + noise,
          sampledAt: ts,
        });
        samples.push({
          tenantId: DEFAULT_TENANT_ID,
          connectionId,
          deviceKind: 'ONU' as DeviceKind,
          deviceId: onu.id,
          kind: 'ONT_TEMPERATURE_CELSIUS' as MetricKind,
          value: onu.temperatureCelsius + noise * 5,
          sampledAt: ts,
        });
        samples.push({
          tenantId: DEFAULT_TENANT_ID,
          connectionId,
          deviceKind: 'ONU' as DeviceKind,
          deviceId: onu.id,
          kind: 'UPTIME_SECONDS' as MetricKind,
          value: onu.uptimeSeconds - h * 3600,
          sampledAt: ts,
        });
      } else {
        // Online stable
        samples.push({
          tenantId: DEFAULT_TENANT_ID,
          connectionId,
          deviceKind: 'ONU' as DeviceKind,
          deviceId: onu.id,
          kind: 'RX_POWER_DBM' as MetricKind,
          value: onu.rxPowerDbm + noise,
          sampledAt: ts,
        });
        samples.push({
          tenantId: DEFAULT_TENANT_ID,
          connectionId,
          deviceKind: 'ONU' as DeviceKind,
          deviceId: onu.id,
          kind: 'TX_POWER_DBM' as MetricKind,
          value: onu.txPowerDbm + noise,
          sampledAt: ts,
        });
        samples.push({
          tenantId: DEFAULT_TENANT_ID,
          connectionId,
          deviceKind: 'ONU' as DeviceKind,
          deviceId: onu.id,
          kind: 'ONT_TEMPERATURE_CELSIUS' as MetricKind,
          value: onu.temperatureCelsius + noise * 5,
          sampledAt: ts,
        });
        samples.push({
          tenantId: DEFAULT_TENANT_ID,
          connectionId,
          deviceKind: 'ONU' as DeviceKind,
          deviceId: onu.id,
          kind: 'UPTIME_SECONDS' as MetricKind,
          value: Math.max(0, onu.uptimeSeconds - h * 3600),
          sampledAt: ts,
        });
      }
    }
    return samples;
  });

  const allSamples = [...oltSamples, ...onuSamples];
  if (allSamples.length > 0) {
    // Batch insert in chunks of 500
    for (let i = 0; i < allSamples.length; i += 500) {
      await prisma.metricSample.createMany({ data: allSamples.slice(i, i + 500), skipDuplicates: true });
    }
  }

  // ── Detected Alerts ──────────────────────────────────────────────────────────
  const alerts = [
    {
      tenantId: DEFAULT_TENANT_ID,
      connectionId,
      kind: 'optical_degradation' as AlertKind,
      severity: 'critical' as AlertSeverity,
      deviceKind: 'ONU' as DeviceKind,
      deviceId: 'ONU-001',
      title: 'ONU offline: Martinez, Juan',
      description: 'ONU offline detectada. Pérdida de señal (LOS) acumulada 18h en ventana de 24h — corte o pérdida óptica sostenida.',
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      connectionId,
      kind: 'optical_degradation' as AlertKind,
      severity: 'critical' as AlertSeverity,
      deviceKind: 'ONU' as DeviceKind,
      deviceId: 'ONU-002',
      title: 'ONU offline: Garcia, Maria',
      description: 'ONU offline detectada en la misma ventana que ONU-001 — patrón de corte de planta externa.',
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      connectionId,
      kind: 'predicted_low_signal' as AlertKind,
      severity: 'warning' as AlertSeverity,
      deviceKind: 'ONU' as DeviceKind,
      deviceId: 'ONU-005',
      title: 'Señal degradada: Fernandez, Pedro',
      description: 'Potencia RX en -26.5 dBm (límite -27 dBm). Señal en caída: alcanzaría el umbral en ~3 días.',
      etaMs: 3 * DAY_MS,
      confidence: 0.72,
    },
    {
      tenantId: DEFAULT_TENANT_ID,
      connectionId,
      kind: 'predicted_high_temperature' as AlertKind,
      severity: 'warning' as AlertSeverity,
      deviceKind: 'OLT' as DeviceKind,
      deviceId: 'OLT-Este-01',
      title: 'OLT con temperatura elevada: OLT-Este-Cobertura',
      description: 'OLT-Este a 68 °C (límite 60 °C). Temperatura en ascenso — riesgo de degradación térmica si continúa.',
      etaMs: 7 * DAY_MS,
      confidence: 0.65,
    },
  ];

  for (const alert of alerts) {
    await prisma.detectedAlert.upsert({
      where: {
        tenantId_connectionId_kind_deviceKind_deviceId: {
          tenantId: alert.tenantId,
          connectionId: alert.connectionId,
          kind: alert.kind,
          deviceKind: alert.deviceKind,
          deviceId: alert.deviceId,
        },
      },
      update: {
        severity: alert.severity,
        title: alert.title,
        description: alert.description,
        etaMs: alert.etaMs ?? null,
        confidence: alert.confidence ?? null,
        lastSeenAt: NOW,
        status: 'open',
      },
      create: alert,
    });
  }

  console.log(`✓ Demo data seeded: ${allSamples.length} metric samples, ${alerts.length} alerts`);
}

export async function seed(options?: {
  adminPassword?: string;
  forceAllowProduction?: boolean;
}): Promise<SeedResult> {
  const allowProd =
    Boolean(options?.forceAllowProduction) ||
    process.env.ALLOW_PRODUCTION_SEED === 'true' ||
    process.env.SEED_FORCE_ALLOW_PRODUCTION === 'true' ||
    process.argv.includes('--force');

  if (process.env.NODE_ENV === 'production' && !allowProd) {
    throw new Error(
      'Refusing to seed database in production environment (NODE_ENV=production). ' +
      'To allow initial bootstrap, pass ALLOW_PRODUCTION_SEED=true or --force.'
    );
  }

  const generatedPassword =
    options?.adminPassword ??
    process.env.SEED_ADMIN_PASSWORD ??
    crypto.randomBytes(12).toString('base64url');

  // 1. Ensure default tenant exists
  const tenant = await prisma.tenant.upsert({
    where: { slug: DEFAULT_TENANT_SLUG },
    update: { name: DEFAULT_TENANT_NAME },
    create: {
      id: DEFAULT_TENANT_ID,
      name: DEFAULT_TENANT_NAME,
      slug: DEFAULT_TENANT_SLUG,
    },
  });

  // 2. Ensure default admin user exists
  const existingUser = await prisma.user.findUnique({
    where: { email: DEFAULT_ADMIN_EMAIL },
  });

  let returnPassword: string | undefined;

  if (!existingUser) {
    const passwordHash = await hashPassword(generatedPassword);
    await prisma.user.create({
      data: {
        email: DEFAULT_ADMIN_EMAIL,
        name: DEFAULT_ADMIN_NAME,
        passwordHash,
        role: 'ADMIN',
        tenantId: tenant.id,
      },
    });
    returnPassword = generatedPassword;
  } else if (options?.adminPassword || process.env.SEED_ADMIN_PASSWORD) {
    const passwordHash = await hashPassword(generatedPassword);
    await prisma.user.update({
      where: { id: existingUser.id },
      data: { passwordHash, role: 'ADMIN', tenantId: tenant.id },
    });
    returnPassword = generatedPassword;
  }

  // 3. Ensure demo NMS connection exists with properly encrypted key
  const existingConn = await prisma.nmsConnection.findFirst({
    where: { tenantId: tenant.id, provider: 'SMARTOLT' },
  });

  let connectionId = existingConn?.id ?? 'demo-smartolt-connection';

  if (!existingConn) {
    const { encryptedKey } = encryptApiKey('mock-api-key');
    const conn = await prisma.nmsConnection.create({
      data: {
        id: connectionId,
        tenantId: tenant.id,
        provider: 'SMARTOLT',
        label: 'Demo SmartOLT (Mock)',
        encryptedKey,
        status: 'connected',
      },
    });
    connectionId = conn.id;
  }

  // 4. Seed demo synthetic data (ONU metrics + alerts for the dashboard)
  await seedDemoData(connectionId);

  return {
    tenantId: tenant.id,
    adminEmail: DEFAULT_ADMIN_EMAIL,
    adminPassword: returnPassword,
    connectionId,
  };
}

async function main(): Promise<void> {
  console.log('🌱 Starting database seed...');
  const force =
    process.argv.includes('--force') ||
    process.env.ALLOW_PRODUCTION_SEED === 'true' ||
    process.env.SEED_FORCE_ALLOW_PRODUCTION === 'true';
  const result = await seed({ forceAllowProduction: force });
  console.log(`✓ Tenant ready: ${DEFAULT_TENANT_NAME} (${result.tenantId})`);
  console.log(`✓ Admin user ready: ${result.adminEmail}`);
  if (result.adminPassword) {
    console.log(`🔑 One-time admin password: ${result.adminPassword}`);
  } else {
    console.log(`✓ Admin user already exists (password preserved)`);
  }
  console.log(`✓ Connection ready: Demo SmartOLT (Mock) (${result.connectionId})`);
  console.log('🎉 Seed completed successfully!');
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  main()
    .catch((e) => {
      console.error('❌ Seed failed:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
