import type { OltSummary, OnuSummary, OnuDetail, NetworkOverview } from '@ftth-copilot/connectors-core';

export interface MikrowispRouter {
  id: string;
  nombre: string;
  ip: string;
  coordenadas: string;
  version: string;
  estado: string;
  modelo: string;
  serial: string;
}

export interface MikrowispEquipo {
  id: string;
  nombre: string;
  equipo: string;
  ip: string;
  estado: number;
}

export interface MikrowispCliente {
  id: string;
  nombre: string;
  estado: 'ACTIVO' | 'SUSPENDIDO' | 'RETIRADO';
  correo: string;
  telefono: string;
  movil: string;
  cedula: string;
  direccion_principal: string;
  servicios: string;
}

export interface MikrowispOdb {
  id: string;
  nombre_odb: string;
}

export const FIXTURE_ROUTERS: MikrowispRouter[] = [
  {
    id: 'RT-BSAS-01',
    nombre: 'MikroTik-RB3011-Centro',
    ip: '192.168.10.1',
    coordenadas: '-34.6037,-58.3816',
    version: '6.48.6',
    estado: 'activo',
    modelo: 'RB3011UiAS-RM',
    serial: 'SNMKRB3011001',
  },
  {
    id: 'RT-CBA-01',
    nombre: 'MikroTik-CCR1009-Norte',
    ip: '192.168.20.1',
    coordenadas: '-31.4201,-64.1888',
    version: '7.12.1',
    estado: 'activo',
    modelo: 'CCR1009-7G-1C-1S+',
    serial: 'SNMKCCR1009001',
  },
  {
    id: 'RT-MZA-01',
    nombre: 'MikroTik-hAPac2-Sur',
    ip: '192.168.30.1',
    coordenadas: '-32.8895,-68.8458',
    version: '7.11.2',
    estado: 'activo',
    modelo: 'hAP ac²',
    serial: 'SNMKHAPAC20001',
  },
  {
    id: 'RT-BSAS-02',
    nombre: 'MikroTik-RB4011-Este',
    ip: '192.168.11.1',
    coordenadas: '-34.6278,-58.3710',
    version: '7.13.5',
    estado: 'inactivo',
    modelo: 'RB4011iGS+5HacQ2HnD-IN',
    serial: 'SNMKRB40110001',
  },
];

export const FIXTURE_EQUIPOS: MikrowispEquipo[] = [
  { id: 'EQ-01', nombre: 'OLT-Huawei-BSAS-01', equipo: 'Huawei MA5600T', ip: '10.10.1.1', estado: 1 },
  { id: 'EQ-02', nombre: 'OLT-ZTE-CBA-01', equipo: 'ZTE C300', ip: '10.20.1.1', estado: 1 },
  { id: 'EQ-03', nombre: 'OLT-Fiberhome-MZA-01', equipo: 'Fiberhome AN5516-04', ip: '10.30.1.1', estado: 1 },
  { id: 'EQ-04', nombre: 'OLT-Huawei-BSAS-02', equipo: 'Huawei MA5600T', ip: '10.10.2.1', estado: 0 },
  { id: 'EQ-05', nombre: 'Switch-Core-BSAS', equipo: 'MikroTik CRS326', ip: '10.10.0.1', estado: 1 },
  { id: 'EQ-06', nombre: 'Switch-Distrib-CBA', equipo: 'MikroTik CRS328', ip: '10.20.0.1', estado: 1 },
  { id: 'EQ-07', nombre: 'OLT-ZTE-BSAS-03', equipo: 'ZTE C300', ip: '10.10.3.1', estado: 0 },
  { id: 'EQ-08', nombre: 'Router-Backbone-MZA', equipo: 'MikroTik CCR1036', ip: '10.30.0.1', estado: 1 },
];

export const FIXTURE_CLIENTES: MikrowispCliente[] = [
  { id: 'CLI-001', nombre: 'Juan Perez', estado: 'ACTIVO', correo: 'juan.perez@email.com', telefono: '011-4567-8901', movil: '11-5555-0101', cedula: '30123456', direccion_principal: 'Av. Corrientes 1234, Piso 1, BsAs', servicios: 'FTTH-100M' },
  { id: 'CLI-002', nombre: 'Maria Garcia', estado: 'ACTIVO', correo: 'maria.garcia@email.com', telefono: '011-4567-8902', movil: '11-5555-0102', cedula: '30234567', direccion_principal: 'Av. Rivadavia 5678, Depto 3A, BsAs', servicios: 'FTTH-300M' },
  { id: 'CLI-003', nombre: 'Carlos Lopez', estado: 'ACTIVO', correo: 'carlos.lopez@email.com', telefono: '0351-456-7890', movil: '351-555-0103', cedula: '30345678', direccion_principal: 'San Martin 901, Piso 2, Cordoba', servicios: 'FTTH-100M' },
  { id: 'CLI-004', nombre: 'Ana Martinez', estado: 'SUSPENDIDO', correo: 'ana.martinez@email.com', telefono: '011-4567-8904', movil: '11-5555-0104', cedula: '30456789', direccion_principal: 'Av. Callao 234, BsAs', servicios: 'FTTH-50M' },
  { id: 'CLI-005', nombre: 'Roberto Fernandez', estado: 'ACTIVO', correo: 'roberto.fernandez@email.com', telefono: '0351-456-7891', movil: '351-555-0105', cedula: '30567890', direccion_principal: 'Belgrano 678, Cordoba', servicios: 'FTTH-300M' },
  { id: 'CLI-006', nombre: 'Laura Diaz', estado: 'ACTIVO', correo: 'laura.diaz@email.com', telefono: '0261-456-7892', movil: '261-555-0106', cedula: '30678901', direccion_principal: 'Av. San Martin 456, Mendoza', servicios: 'FTTH-100M' },
  { id: 'CLI-007', nombre: 'Pedro Sanchez', estado: 'RETIRADO', correo: 'pedro.sanchez@email.com', telefono: '011-4567-8907', movil: '11-5555-0107', cedula: '30789012', direccion_principal: 'Alsina 1234, BsAs', servicios: 'FTTH-50M' },
  { id: 'CLI-008', nombre: 'Sofia Gonzalez', estado: 'ACTIVO', correo: 'sofia.gonzalez@email.com', telefono: '011-4567-8908', movil: '11-5555-0108', cedula: '30890123', direccion_principal: 'Av. Santa Fe 3456, Piso 5, BsAs', servicios: 'FTTH-500M' },
  { id: 'CLI-009', nombre: 'Miguel Torres', estado: 'ACTIVO', correo: 'miguel.torres@email.com', telefono: '0351-456-7893', movil: '351-555-0109', cedula: '30901234', direccion_principal: 'Entre Rios 789, Cordoba', servicios: 'FTTH-100M' },
  { id: 'CLI-010', nombre: 'Luciana Romero', estado: 'SUSPENDIDO', correo: 'luciana.romero@email.com', telefono: '0261-456-7894', movil: '261-555-0110', cedula: '31012345', direccion_principal: 'Av. Mendoza 234, Mendoza', servicios: 'FTTH-100M' },
  { id: 'CLI-011', nombre: 'Diego Alvarez', estado: 'ACTIVO', correo: 'diego.alvarez@email.com', telefono: '011-4567-8911', movil: '11-5555-0111', cedula: '31123456', direccion_principal: 'Defensa 567, BsAs', servicios: 'FTTH-300M' },
  { id: 'CLI-012', nombre: 'Valentina Rios', estado: 'ACTIVO', correo: 'valentina.rios@email.com', telefono: '0351-456-7895', movil: '351-555-0112', cedula: '31234567', direccion_principal: 'Velez Sarsfield 890, Cordoba', servicios: 'FTTH-100M' },
  { id: 'CLI-013', nombre: 'Fernando Castillo', estado: 'RETIRADO', correo: 'fernando.castillo@email.com', telefono: '0261-456-7896', movil: '261-555-0113', cedula: '31345678', direccion_principal: 'Prov. Unida 567, Mendoza', servicios: 'FTTH-50M' },
  { id: 'CLI-014', nombre: 'Camila Medina', estado: 'ACTIVO', correo: 'camila.medina@email.com', telefono: '011-4567-8914', movil: '11-5555-0114', cedula: '31456789', direccion_principal: 'Av. Rivadavia 7890, BsAs', servicios: 'FTTH-500M' },
  { id: 'CLI-015', nombre: 'Andres Herrera', estado: 'ACTIVO', correo: 'andres.herrera@email.com', telefono: '0351-456-7897', movil: '351-555-0115', cedula: '31567890', direccion_principal: 'Caseros 123, Piso 4, Cordoba', servicios: 'FTTH-300M' },
  { id: 'CLI-016', nombre: 'Isabella Vargas', estado: 'ACTIVO', correo: 'isabella.vargas@email.com', telefono: '0261-456-7898', movil: '261-555-0116', cedula: '31678901', direccion_principal: 'Arturo Illia 890, Mendoza', servicios: 'FTTH-100M' },
  { id: 'CLI-017', nombre: 'Mateo Rivera', estado: 'SUSPENDIDO', correo: 'mateo.rivera@email.com', telefono: '011-4567-8917', movil: '11-5555-0117', cedula: '31789012', direccion_principal: 'Sarmiento 2345, BsAs', servicios: 'FTTH-100M' },
  { id: 'CLI-018', nombre: 'Daniela Moreno', estado: 'ACTIVO', correo: 'daniela.moreno@email.com', telefono: '011-4567-8918', movil: '11-5555-0118', cedula: '31890123', direccion_principal: 'Av. Belgrano 6789, Depto 2B, BsAs', servicios: 'FTTH-300M' },
  { id: 'CLI-019', nombre: 'Nicolas Silva', estado: 'ACTIVO', correo: 'nicolas.silva@email.com', telefono: '0351-456-7899', movil: '351-555-0119', cedula: '31901234', direccion_principal: 'Maestro Lopez 456, Cordoba', servicios: 'FTTH-100M' },
  { id: 'CLI-020', nombre: 'Paula Cortez', estado: 'RETIRADO', correo: 'paula.cortez@email.com', telefono: '0261-456-7800', movil: '261-555-0120', cedula: '32012345', direccion_principal: 'San Juan 123, Mendoza', servicios: 'FTTH-50M' },
  { id: 'CLI-021', nombre: 'Gabriel Navarro', estado: 'ACTIVO', correo: 'gabriel.navarro@email.com', telefono: '011-4567-8921', movil: '11-5555-0121', cedula: '32123456', direccion_principal: 'Av. Corrientes 4567, Piso 8, BsAs', servicios: 'FTTH-500M' },
  { id: 'CLI-022', nombre: 'Lucia Morales', estado: 'ACTIVO', correo: 'lucia.morales@email.com', telefono: '0351-456-7801', movil: '351-555-0122', cedula: '32234567', direccion_principal: 'Avenida Velez Sarsfield 1234, Cordoba', servicios: 'FTTH-100M' },
  { id: 'CLI-023', nombre: 'Joaquin Gutierrez', estado: 'SUSPENDIDO', correo: 'joaquin.gutierrez@email.com', telefono: '0261-456-7802', movil: '261-555-0123', cedula: '32345678', direccion_principal: 'Libertador 789, Mendoza', servicios: 'FTTH-100M' },
  { id: 'CLI-024', nombre: 'MariaJose Ramos', estado: 'ACTIVO', correo: 'mariajose.ramos@email.com', telefono: '011-4567-8924', movil: '11-5555-0124', cedula: '32456789', direccion_principal: 'Av. de Mayo 3456, BsAs', servicios: 'FTTH-300M' },
  { id: 'CLI-025', nombre: 'Tomas Delgado', estado: 'ACTIVO', correo: 'tomas.delgado@email.com', telefono: '0351-456-7803', movil: '351-555-0125', cedula: '32567890', direccion_principal: 'Rosales 789, Cordoba', servicios: 'FTTH-100M' },
];

export const FIXTURE_ODBS: MikrowispOdb[] = [
  { id: 'ODB-01', nombre_odb: 'NAP-CENTRO-01' },
  { id: 'ODB-02', nombre_odb: 'NAP-NORTE-02' },
  { id: 'ODB-03', nombre_odb: 'NAP-SUR-03' },
  { id: 'ODB-04', nombre_odb: 'NAP-ESTE-04' },
  { id: 'ODB-05', nombre_odb: 'NAP-OESTE-05' },
  { id: 'ODB-06', nombre_odb: 'NAP-INDUSTRIAL-06' },
];

/**
 * Build fixture ONUs by associating each ACTIVO/RETIRADO client with a router
 * and an equipment piece. This gives us realistic OnuSummary data.
 */
function buildFixtureOnus(): OnuSummary[] {
  const onus: OnuSummary[] = [];
  const activos = FIXTURE_CLIENTES.filter((c) => c.estado === 'ACTIVO');

  for (let i = 0; i < activos.length; i++) {
    const cliente = activos[i]!;
    const routerIdx = i % FIXTURE_ROUTERS.length;
    const router = FIXTURE_ROUTERS[routerIdx]!;
    const isOffline = i === 5 || i === 12;
    const isDegraded = i === 9;

    onus.push({
      id: `ONU-${router.id}-${String(i + 1).padStart(3, '0')}`,
      serial: `SNMW${String(i + 1).padStart(8, '0')}`,
      oltId: `EQ-0${(i % 3) + 1}`,
      customerName: cliente.nombre,
      status: isOffline ? 'offline' : isDegraded ? 'degraded' : 'online',
      rxPowerDbm: isOffline ? -30.0 : isDegraded ? -27.5 : -(18 + Math.random() * 6),
      txPowerDbm: isOffline ? 0 : 2.0,
      uptimeSeconds: isOffline ? 0 : 86400 + i * 10000,
      lastSeenAt: isOffline ? '2026-08-19T12:00:00+00:00' : '2026-08-20T10:00:00+00:00',
    });
  }

  return onus;
}

export const FIXTURE_ONUS: OnuSummary[] = buildFixtureOnus();

/**
 * Detailed view for some ONUs with signal history or interesting cases.
 */
export const FIXTURE_ONU_DETAILS: Record<string, OnuDetail> = {
  [FIXTURE_ONUS[5]!.id]: {
    ...FIXTURE_ONUS[5]!,
    model: 'HG8145V5',
    vendor: 'Huawei',
    oltPort: '1/2/3',
    firmwareVersion: 'V3R019C10S135',
    signalHistory: [
      { timestamp: '2026-08-19T06:00:00+00:00', rxPowerDbm: -22.0 },
      { timestamp: '2026-08-19T09:00:00+00:00', rxPowerDbm: -26.5 },
      { timestamp: '2026-08-19T12:00:00+00:00', rxPowerDbm: -30.0 },
    ],
  },
  [FIXTURE_ONUS[9]!.id]: {
    ...FIXTURE_ONUS[9]!,
    model: 'F670G',
    vendor: 'ZTE',
    oltPort: '1/1/8',
    firmwareVersion: 'V2.0.0P3',
    signalHistory: [
      { timestamp: '2026-08-18T12:00:00+00:00', rxPowerDbm: -20.0 },
      { timestamp: '2026-08-19T12:00:00+00:00', rxPowerDbm: -24.5 },
      { timestamp: '2026-08-20T10:00:00+00:00', rxPowerDbm: -27.5 },
    ],
  },
  [FIXTURE_ONUS[0]!.id]: {
    ...FIXTURE_ONUS[0]!,
    model: 'HG8145V5',
    vendor: 'Huawei',
    oltPort: '1/1/1',
    firmwareVersion: 'V3R019C10S135',
  },
};

export function computeOverview(): NetworkOverview {
  const onlineRouters = FIXTURE_ROUTERS.filter((r) => r.estado === 'activo').length;
  const offlineRouters = FIXTURE_ROUTERS.filter((r) => r.estado !== 'activo').length;
  const onlineEquipos = FIXTURE_EQUIPOS.filter((e) => e.estado === 1).length;
  const offlineEquipos = FIXTURE_EQUIPOS.filter((e) => e.estado === 0).length;
  const totalEquipoEquipos = FIXTURE_EQUIPOS.length;
  const onlineOnus = FIXTURE_ONUS.filter((o) => o.status === 'online').length;
  const offlineOnus = FIXTURE_ONUS.filter((o) => o.status === 'offline').length;
  const avgUptime =
    FIXTURE_ONUS.reduce((acc, o) => acc + (o.uptimeSeconds ?? 0), 0) /
    Math.max(FIXTURE_ONUS.length, 1);

  return {
    totalOlts: FIXTURE_ROUTERS.length + totalEquipoEquipos,
    oltsOnline: onlineRouters + onlineEquipos,
    totalOnus: FIXTURE_ONUS.length,
    onusOnline: onlineOnus,
    onusOffline: offlineOnus,
    averageUptimeSeconds: Math.round(avgUptime),
    oltsWithHighTemperature: offlineRouters + offlineEquipos,
  };
}
