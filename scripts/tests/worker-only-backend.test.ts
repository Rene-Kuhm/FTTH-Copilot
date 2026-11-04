import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/**
 * Reglas del corte de T15: el worker es el único dueño del trabajo de fondo.
 *
 * El camino embedded —los loops, los receptores UDP y el barrido de
 * investigaciones dentro del proceso de la web— se borró. Estas reglas
 * existen para que no vuelva: si alguien reintroduce un receptor en la
 * web, el CI lo dice antes de que dos procesos se peleen por el mismo
 * socket UDP o el mismo tick.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

/** Módulos que sólo tenían sentido con los loops dentro de la web. */
const MODULOS_EN_PROCESO = [
  'apps/web/lib/monitoring/syslog.ts',
  'apps/web/lib/monitoring/snmp.ts',
  'apps/web/lib/monitoring/snmp-ingest.ts',
  'apps/web/lib/monitoring/snmp-evidence.ts',
  'apps/web/lib/monitoring/event-drainer.ts',
  'apps/web/lib/monitoring/event-spool.ts',
  'apps/web/lib/investigations/sweep.ts',
];

test('la web no tiene los receptores ni el barrido en proceso', () => {
  for (const modulo of MODULOS_EN_PROCESO) {
    assert.equal(
      fs.existsSync(path.join(REPO_ROOT, modulo)),
      false,
      `${modulo} es el camino embedded: el worker es el único dueño del trabajo de fondo`,
    );
  }
});

test('la instrumentación no importa nada del camino en proceso', () => {
  const fuente = fs.readFileSync(path.join(REPO_ROOT, 'apps/web/instrumentation.ts'), 'utf8');

  const imports = [...fuente.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
  const prohibidos = [
    '@/lib/monitoring/scheduler',
    '@/lib/monitoring/syslog',
    '@/lib/monitoring/snmp',
    '@/lib/monitoring/snmp-ingest',
    '@/lib/monitoring/snmp-evidence',
    '@/lib/monitoring/event-ingest',
    '@/lib/investigations/sweep',
  ];

  for (const modulo of prohibidos) {
    assert.equal(
      imports.includes(modulo),
      false,
      `la instrumentación no puede importar ${modulo}: el worker es el único dueño`,
    );
  }
});

test('la web sólo lee los contadores del ingest, no los escribe', () => {
  const fuente = fs.readFileSync(
    path.join(REPO_ROOT, 'apps/web/lib/monitoring/event-ingest.ts'),
    'utf8',
  );

  // Los contadores le dicen al operador qué backlog hay y qué se perdió.
  assert.match(fuente, /eventIngestStats/);

  // Escribir el spool y drenarlo es del worker: dos drenadores avanzarían
  // el mismo offset.
  for (const simbolo of ['startEventDrainer', 'stopEventDrainer', 'spoolEvent', 'recordDroppedEvent']) {
    assert.equal(
      fuente.includes(simbolo),
      false,
      `la web no drena ni spoolea: ${simbolo} es del worker`,
    );
  }
});
