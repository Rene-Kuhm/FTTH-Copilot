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
 *
 * Las reglas miran el **código**, no una lista de nombres: comprueban los
 * imports que hay, estáticos y dinámicos, y los símbolos que se importan.
 * El código que se borró usaba `await import('...')`, así que una regla
 * que sólo mirara `from '...'` no habría visto nada.
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

/** Módulos que sólo tenían sentido con los loops dentro de la web. */
const MODULOS_EN_PROCESO = [
  'apps/web/lib/monitoring/syslog.ts',
  'apps/web/lib/monitoring/snmp.ts',
  'apps/web/lib/monitoring/snmp-ingest.ts',
  'apps/web/lib/monitoring/snmp-evidence.ts',
  'apps/web/lib/monitoring/event-drainer.ts',
  'apps/web/lib/monitoring/event-spool.ts',
  'apps/web/lib/monitoring/scheduler.ts',
  'apps/web/lib/investigations/sweep.ts',
];

/**
 * Lo que la web no puede tener en su bundle.
 *
 * Cada uno es una capacidad que, en la web, significa trabajo de fondo en
 * proceso: correr el poll, recibir traps, escribir en el spool o drainear.
 */
const SIMBOLOS_EN_PROCESO = [
  // Los loops recurrentes.
  'startPollingLoop',
  'startFirmwareAuditLoop',
  'startFecCollectionLoop',
  'runScheduledPoll',
  'runScheduledFirmwareAudit',
  'runScheduledFecCollection',
  // Los receptores y el spool.
  'startSyslogReceiver',
  'startSnmpReceiver',
  'startInProcessDrainer',
  'startEventDrainer',
  'stopEventDrainer',
  'spoolEvent',
  'recordDroppedEvent',
  // El pipeline de investigación: lo corre el worker.
  'runInvestigationPipeline',
  'completeInvestigation',
  'executeInvestigationAttempt',
  'expireStaleRuns',
];

interface ComposeFile {
  services: Record<string, { profiles?: string[]; environment?: Record<string, unknown> }>;
}

function leerCompose(archivo: string): ComposeFile {
  const contenido = fs.readFileSync(path.join(REPO_ROOT, archivo), 'utf8');
  return YAML.parse(contenido) as ComposeFile;
}

/** Todos los ficheros TypeScript de un directorio, recursivamente. */
function ficherosTs(directorio: string): string[] {
  const raiz = path.join(REPO_ROOT, directorio);
  const salida: string[] = [];

  for (const entrada of fs.readdirSync(raiz, { withFileTypes: true })) {
    const completo = path.join(raiz, entrada.name);
    if (entrada.isDirectory()) {
      salida.push(...ficherosTs(path.relative(REPO_ROOT, completo)));
    } else if (entrada.name.endsWith('.ts') || entrada.name.endsWith('.tsx')) {
      salida.push(completo);
    }
  }

  return salida;
}

/** Los nombres que trae una cláusula de import (`{ a, b }`, `x`, `* as x`). */
function nombresDe(clause: string): string[] {
  const limpio = clause.trim();
  // Un import de espacio de nombres trae todo el módulo: no se puede acotar.
  if (limpio.startsWith('*')) return [];

  const nombres: string[] = [];
  const entreLlaves = limpio.match(/\{([\s\S]*)\}/);
  if (entreLlaves) {
    for (const parte of entreLlaves[1]!.split(',')) {
      // `type X` importa el tipo, no el valor: el nombre es `X`.
      const nombre = parte
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]!
        .trim();
      if (nombre) nombres.push(nombre);
    }
  }

  const porDefecto = limpio.replace(/\{[\s\S]*\}/, '').replace(/,/g, ' ').trim();
  // `import type X from 'y'` no trae un nombre de valor.
  if (porDefecto && porDefecto !== 'type' && !porDefecto.startsWith('type ')) {
    nombres.push(porDefecto);
  }

  return nombres;
}

/**
 * Quita los comentarios.
 *
 * Sin esto, un `export` que se menciona en un comentario ("every export it
 * had before is still exported here") se lee como un re-export, y la regla
 * ve Imports que no existen.
 */
function sinComentarios(fuente: string): string {
  return fuente
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((linea) => {
      const limpia = linea.trim();
      return !limpia.startsWith('//') && !limpia.startsWith('*');
    })
    .join('\n');
}

/** Los imports de un fichero: estáticos, re-exports y dinámicos. */
function importsDe(fuente: string): Array<{ modulo: string; nombres: string[] }> {
  const salida: Array<{ modulo: string; nombres: string[] }> = [];
  const codigo = sinComentarios(fuente);

  for (const m of codigo.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    salida.push({ modulo: m[2]!, nombres: nombresDe(m[1]!) });
  }
  for (const m of codigo.matchAll(/export\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    salida.push({ modulo: m[2]!, nombres: nombresDe(m[1]!) });
  }
  // `await import('...')`: es como estaba escrito el camino embedded.
  for (const m of codigo.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    salida.push({ modulo: m[1]!, nombres: [] });
  }

  return salida;
}

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
  const importados = importsDe(fuente).map((i) => i.modulo);

  const prohibidos = [
    '@/lib/monitoring/scheduler',
    '@/lib/monitoring/syslog',
    '@/lib/monitoring/snmp',
    '@/lib/monitoring/snmp-ingest',
    '@/lib/monitoring/snmp-evidence',
    '@/lib/monitoring/event-ingest',
    '@/lib/monitoring/event-drainer',
    '@/lib/monitoring/event-spool',
    '@/lib/investigations/sweep',
  ];

  for (const modulo of prohibidos) {
    assert.equal(
      importados.includes(modulo),
      false,
      `la instrumentación no puede importar ${modulo}: el worker es el único dueño`,
    );
  }
});

test('la web no importa ninguna capacidad de trabajo en proceso', () => {
  // No basta con que los módulos no existan: lo que se protege es que la web
  // no pueda *llamar* al trabajo de fondo, ni aunque alguien lo re-exporte.
  //
  // Hay tres clases de módulos:
  //
  //   - los que la web no puede importar de ninguna manera (el pipeline de
  //     investigaciones: lo corre el worker);
  //   - los que la web puede importar, pero sólo por sus piezas sanas (el
  //     registro de salud del scheduler, los contadores del ingest);
  //   - los shims, que exponen exactamente las piezas que la web necesita.
  const simbolosDeSalud = [
    'markExpected',
    'markNotExpected',
    'recordSuccess',
    'recordError',
    'recordSyslogBound',
    'recordSnmpBound',
    'serviceStatus',
    'setNextRun',
    'withServiceStatus',
    'snapshotHealth',
    'detectHangedLoops',
    'overallHealthy',
    '__resetSchedulerHealth',
    'TICK_GRACE_MS',
    'WORKER_HEALTH_KEY',
    'WORKER_HEALTH_TTL_SECONDS',
    'buildWorkerHealthSnapshot',
    'parseWorkerHealthSnapshot',
    'SchedulerName',
    'ServiceHealth',
    'ServiceStatus',
    'WorkerHealthSnapshot',
  ];

  const modulosAcotados: Record<string, string[]> = {
    '@ftth-copilot/scheduler': simbolosDeSalud,
    '@ftth-copilot/ingest': ['eventIngestStats', 'EventIngestStats'],
  };

  const shims: Record<string, string[]> = {
    'apps/web/lib/investigations/pipeline.ts': [
      'awaitAttemptOutcome',
      'claimInvestigationAttempt',
      'failInvestigation',
      'AwaitAttemptArgs',
      'AwaitedAttempt',
    ],
    'apps/web/lib/investigations/quota.ts': ['consumeInvestigationQuota'],
  };

  for (const fichero of [...ficherosTs('apps/web/app'), ...ficherosTs('apps/web/lib')]) {
    const fuente = fs.readFileSync(fichero, 'utf8');
    const relativos = path.relative(REPO_ROOT, fichero);

    for (const importacion of importsDe(fuente)) {
      for (const simbolo of importacion.nombres) {
        assert.equal(
          SIMBOLOS_EN_PROCESO.includes(simbolo),
          false,
          `${relativos} importa ${simbolo}: el trabajo de fondo es del worker`,
        );
      }

      const acotado = modulosAcotados[importacion.modulo];
      if (acotado) {
        assert.ok(
          importacion.nombres.length > 0,
          `${relativos} importa ${importacion.modulo} entero: un import de espacio de nombres se lleva el módulo`,
        );
        for (const simbolo of importacion.nombres) {
          assert.ok(
            acotado.includes(simbolo),
            `${relativos}: de ${importacion.modulo} la web sólo puede usar ${acotado.join(', ')}`,
          );
        }
      }

      if (importacion.modulo === '@ftth-copilot/investigations') {
        const permitidos = shims[relativos];
        assert.ok(
          permitidos,
          `${relativos} importa @ftth-copilot/investigations: el pipeline es del worker`,
        );
        for (const simbolo of importacion.nombres) {
          assert.ok(
            permitidos.includes(simbolo),
            `${relativos}: de @ftth-copilot/investigations la web sólo puede usar ${permitidos.join(', ')}`,
          );
        }
      }
    }
  }

  // Y cada shim expone exactamente lo que dice: ni una cosa más.
  for (const [fichero, permitidos] of Object.entries(shims)) {
    const fuente = fs.readFileSync(path.join(REPO_ROOT, fichero), 'utf8');
    const exportados = importsDe(fuente)
      .filter((i) => i.modulo === '@ftth-copilot/investigations')
      .flatMap((i) => i.nombres);

    assert.deepEqual(
      exportados.sort(),
      [...permitidos].sort(),
      `${fichero} sólo puede re-exportar ${permitidos.join(', ')}`,
    );
  }
});

test('el paquete de ingest no tiene drainer en proceso', () => {
  // El drainer en proceso era del camino embedded. El worker drena desde el
  // job de la cola: dos drainers avanzarían el mismo offset del spool.
  for (const fichero of ficherosTs('packages/ingest/src')) {
    const fuente = fs.readFileSync(fichero, 'utf8');
    const relativos = path.relative(REPO_ROOT, fichero);

    for (const simbolo of ['startEventDrainer', 'stopEventDrainer', 'startInProcessDrainer']) {
      assert.equal(
        fuente.includes(simbolo),
        false,
        `${relativos}: el drainer en proceso se fue (${simbolo})`,
      );
    }
  }
});

test('el paquete de jobs ya no ofrece un selector de modo', () => {
  for (const fichero of ficherosTs('packages/jobs/src')) {
    const fuente = fs.readFileSync(fichero, 'utf8');
    const relativos = path.relative(REPO_ROOT, fichero);

    for (const simbolo of ['workerOwnsBackgroundWork', 'backendMode(']) {
      assert.equal(
        fuente.includes(simbolo),
        false,
        `${relativos}: el flag ya no elige entre dos caminos (${simbolo})`,
      );
    }
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

test('ningún compose ni plantilla pide el modo embedded', () => {
  // El patrón cubre `BACKEND_MODE: embedded`, `BACKEND_MODE: "embedded"` y
  // `BACKEND_MODE: ${BACKEND_MODE:-embedded}`.
  const patron = /BACKEND_MODE[^\n]*embedded/;

  for (const compose of COMPOSES) {
    const contenido = fs.readFileSync(path.join(REPO_ROOT, compose), 'utf8');
    assert.equal(
      patron.test(contenido),
      false,
      `${compose}: el modo embedded no existe más`,
    );
  }

  for (const plantilla of PLANTILLAS) {
    const contenido = fs.readFileSync(path.join(REPO_ROOT, plantilla), 'utf8');
    assert.equal(
      patron.test(contenido),
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
