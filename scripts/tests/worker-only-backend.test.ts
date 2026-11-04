import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import YAML from 'yaml';

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

/** Los compose que declaran servicios: el worker va siempre en todos. */
const COMPOSES = [
  'docker-compose.yml',
  'docker-compose.prod.yml',
  'docker-compose.demo.yml',
  'docker-compose.staging.yml',
];

/** Plantillas de entorno: el valor de `BACKEND_MODE` que se entrega. */
const PLANTILLAS = ['.env.example', '.env.staging.example', 'docs/demo-env-template.md'];

interface ComposeFile {
  services: Record<string, { profiles?: string[]; environment?: Record<string, unknown> }>;
}

function leerCompose(archivo: string): ComposeFile {
  const contenido = fs.readFileSync(path.join(REPO_ROOT, archivo), 'utf8');
  return YAML.parse(contenido) as ComposeFile;
}

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

test('el worker no está detrás de un profile: es parte del stack', () => {
  // Un worker opcional es un worker que nadie levanta: la web no corre los
  // loops y nadie los corre por ella.
  for (const compose of COMPOSES) {
    const servicios = leerCompose(compose).services;
    assert.ok(servicios['worker'], `${compose} tiene que declarar el servicio worker`);

    const profiles = servicios['worker'].profiles ?? [];
    assert.deepEqual(
      profiles,
      [],
      `${compose}: el worker no puede estar detrás de un profile (${profiles.join(', ')})`,
    );
  }
});

test('ningún compose pide el modo embedded', () => {
  for (const compose of COMPOSES) {
    const contenido = fs.readFileSync(path.join(REPO_ROOT, compose), 'utf8');
    assert.equal(
      /BACKEND_MODE:\s*["']?embedded/.test(contenido),
      false,
      `${compose}: el modo embedded no existe más`,
    );
  }
});

test('ninguna plantilla entrega el modo embedded', () => {
  for (const plantilla of PLANTILLAS) {
    const contenido = fs.readFileSync(path.join(REPO_ROOT, plantilla), 'utf8');
    assert.equal(
      /^BACKEND_MODE=embedded$/m.test(contenido),
      false,
      `${plantilla}: el modo embedded no existe más`,
    );
  }
});

test('el compose le dice al web que el worker es el dueño', () => {
  // El compose es la fuente de la verdad del despliegue: si el web arranca
  // sin el flag, arranca igual, pero nadie polo.
  for (const compose of ['docker-compose.prod.yml', 'docker-compose.demo.yml', 'docker-compose.staging.yml']) {
    const app = leerCompose(compose).services['app'];
    assert.ok(app, `${compose} tiene que declarar el servicio app`);
    assert.equal(
      app.environment?.['BACKEND_MODE'],
      'worker',
      `${compose}: el web tiene que arrancar con BACKEND_MODE=worker`,
    );
  }
});

test('el web de un compose llega a Redis por el nombre del servicio', () => {
  // El web vive en la red del compose, así que su loopback es su propio
  // loopback: no llega al host. Redis se publica en el loopback del host
  // (porque un puerto publicado no pasa por el firewall), así que desde el
  // web hay que llegar por el nombre del servicio.
  //
  // El worker corre en la red del host, así que ése sí va por 127.0.0.1.
  for (const compose of ['docker-compose.prod.yml', 'docker-compose.demo.yml']) {
    const app = leerCompose(compose).services['app'];
    assert.ok(app, `${compose} tiene que declarar el servicio app`);

    const redisUrl = String(app.environment?.['REDIS_URL'] ?? '');
    assert.doesNotMatch(
      redisUrl,
      /@(127\.0\.0\.1|localhost)(:|\/|$)/,
      `${compose}: el web tiene que llegar a Redis por el nombre del servicio, no por el loopback`,
    );
  }
});

test('el paquete de ingest no tiene drainer en proceso', () => {
  // El drainer en proceso era del camino embedded. El worker drena desde el
  // job de la cola: dos drainers avanzarían el mismo offset del spool.
  const indice = fs.readFileSync(path.join(REPO_ROOT, 'packages/ingest/src/index.ts'), 'utf8');
  for (const simbolo of ['startEventDrainer', 'stopEventDrainer']) {
    assert.equal(
      indice.includes(simbolo),
      false,
      `el drainer en proceso se fue: ${simbolo} no se exporta más`,
    );
  }

  // Y los receptores no lo pueden volver a encender.
  for (const receptor of ['syslog-receiver.ts', 'snmp-receiver.ts']) {
    const fuente = fs.readFileSync(
      path.join(REPO_ROOT, 'packages/ingest/src', receptor),
      'utf8',
    );
    assert.equal(
      fuente.includes('startInProcessDrainer'),
      false,
      `${receptor}: el receptor no puede arrancar el drainer en proceso`,
    );
  }
});
