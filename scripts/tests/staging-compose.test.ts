import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  envFileVariables,
  loadStagingCompose,
  mergeCompose,
  requiredEnvVariables,
  serviceEnvironment,
  servicePorts,
} from '../lib/staging-compose.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

function stagingEnvExample(): string {
  return fs.readFileSync(path.join(REPO_ROOT, '.env.staging.example'), 'utf8');
}

test("mergeCompose mezcla los environment por clave y respeta !reset en los puertos", () => {
  const base = [
    'services:',
    '  app:',
    '    environment:',
    '      NODE_ENV: production',
    '      PORT: "3001"',
    '    ports:',
    '      - "3001:3001"',
    '',
  ].join('\n');
  const override = [
    'services:',
    '  app:',
    '    environment:',
    '      BACKEND_MODE: worker',
    '    ports: !reset []',
    '',
  ].join('\n');

  const merged = mergeCompose(base, override);
  const app = merged.services.app;

  assert.deepEqual(serviceEnvironment(app), {
    NODE_ENV: 'production',
    PORT: '3001',
    BACKEND_MODE: 'worker',
  });
  assert.deepEqual(servicePorts(app), []);
});

test("mergeCompose concatena las listas que no llevan tag", () => {
  const base = ['services:', '  app:', '    ports:', '      - "3001:3001"', ''].join('\n');
  const override = ['services:', '  app:', '    ports:', '      - "8080:8080"', ''].join('\n');

  const merged = mergeCompose(base, override);
  assert.deepEqual(servicePorts(merged.services.app), ['3001:3001', '8080:8080']);
});

test("el db-migrate del staging recibe su DATABASE_URL", () => {
  const staging = loadStagingCompose(REPO_ROOT);
  const environment = serviceEnvironment(staging.services['db-migrate']);

  assert.ok(
    environment['DATABASE_URL'],
    'db-migrate necesita DATABASE_URL: sin ella prisma migrate deploy falla y el stack no levanta',
  );
  assert.match(
    environment['DATABASE_URL'] ?? '',
    /@postgres:5432\//,
    'el db-migrate corre en la red de Compose: tiene que llegar a Postgres por el nombre del servicio',
  );
});

test("la web y el worker llegan a Postgres por caminos distintos", () => {
  const staging = loadStagingCompose(REPO_ROOT);

  const web = serviceEnvironment(staging.services.app)['DATABASE_URL'] ?? '';
  const worker = serviceEnvironment(staging.services.worker)['DATABASE_URL'] ?? '';

  assert.match(web, /@postgres:5432\//, 'la web corre en la red de Compose');
  assert.match(
    worker,
    /@127\.0\.0\.1:\$\{POSTGRES_PORT/,
    'el worker corre en la red del host: llega a Postgres por el puerto publicado en el loopback',
  );
});

test("la web no publica puerto: sin eso no se puede escalar a dos réplicas", () => {
  const staging = loadStagingCompose(REPO_ROOT);

  assert.deepEqual(
    servicePorts(staging.services.app),
    [],
    'con el puerto publicado la segunda réplica no puede tomarlo y --scale app=2 no arranca',
  );
});

test("el worker del staging corre en la red del host y sin profile", () => {
  const staging = loadStagingCompose(REPO_ROOT);
  const worker = staging.services.worker;

  assert.equal(
    worker?.network_mode,
    'host',
    'el worker necesita la red del host para conservar la IP de origen del datagrama syslog',
  );
  assert.deepEqual(
    worker?.profiles ?? [],
    [],
    'en staging el worker no puede quedar detrás de un profile: es el dueño del trabajo de fondo',
  );
});

test("la web del staging arranca en modo worker", () => {
  const staging = loadStagingCompose(REPO_ROOT);

  assert.equal(
    serviceEnvironment(staging.services.app)['BACKEND_MODE'],
    'worker',
    'en modo embedded la web arrancaría los loops y el worker los repetiría',
  );
});

test("el compose de staging no exige variables que la plantilla no define", () => {
  const staging = loadStagingCompose(REPO_ROOT);
  const defined = envFileVariables(stagingEnvExample());

  const missing = requiredEnvVariables(staging.services).filter((name) => !defined.has(name));

  assert.deepEqual(
    missing,
    [],
    `variables que el compose exige y .env.staging.example no define: ${missing.join(', ')}`,
  );
});

test("la plantilla de staging define las variables que el compose exige", () => {
  const staging = loadStagingCompose(REPO_ROOT);
  const defined = envFileVariables(stagingEnvExample());

  for (const name of requiredEnvVariables(staging.services)) {
    assert.ok(defined.has(name), `${name} la exige el compose y la plantilla no la define`);
  }
});

test("el staging declara el mock NMS como servicio, detrás de un profile", () => {
  const staging = loadStagingCompose(REPO_ROOT);
  const mock = staging.services['mock-nms'];

  assert.ok(mock, 'el staging no declara el servicio del mock NMS');
  assert.deepEqual(
    mock.profiles ?? [],
    ['mock-nms'],
    'el mock NMS va detrás de un profile: un staging con un NMS real no lo tiene que levantar',
  );
  assert.equal(
    mock.network_mode,
    'host',
    'el worker corre en la red del host: el mock tiene que estar en el loopback del host',
  );
});

test("el mock NMS corre el mock del repo, no una reimplementación", () => {
  const staging = loadStagingCompose(REPO_ROOT);
  const command = (staging.services['mock-nms']?.command ?? []).map(String);

  assert.ok(
    command.some((part) => part.includes('mock-nms-server.ts')),
    'el servicio tiene que correr el servidor del mock que está en el repo',
  );
});

test("la plantilla de staging declara las excepciones de la política SSRF", () => {
  // El staging apunta al mock NMS, que vive en el loopback: la política
  // SSRF tiene que exceptuarse. Las excepciones se declaran acá y en ningún
  // otro lado: el arranque de producción las rechaza.
  const defined = envFileVariables(stagingEnvExample());

  for (const name of [
    'NMS_ALLOW_HTTP',
    'NMS_ALLOW_PRIVATE_NETWORKS',
    'NMS_ALLOWED_HOSTS',
    'NMS_ALLOWED_PORTS',
  ]) {
    assert.ok(defined.has(name), `${name} la necesita el staging para apuntar al mock NMS`);
  }
});

test("ningún servicio del compose de producción tiene un container_name fijo", () => {
  // Con un nombre fijo, dos despliegues en el mismo host se pisan: el
  // staging levantaría un contenedor llamado `ftth_prod_victoriametrics`, que
  // es el nombre que quiere producción. Compose ya genera un nombre único
  // por proyecto, así que el nombre fijo no aporta nada.
  const prod = fs.readFileSync(path.join(REPO_ROOT, 'docker-compose.prod.yml'), 'utf8');
  const fixed = [...prod.matchAll(/^\s*container_name:\s*(\S+)/gm)].map((match) => match[1]);

  assert.deepEqual(
    fixed,
    [],
    `container_name fijos en el compose de producción: ${fixed.join(', ')}`,
  );
});

test("el staging declara su propio nombre de proyecto", () => {
  // Los nombres de los contenedores los genera Compose a partir del nombre
  // del proyecto. Si el staging compartiera el proyecto de producción, sus
  // contenedores se llamarían igual que los de producción y no podrían
  // convivir en el mismo host.
  const staging = fs.readFileSync(path.join(REPO_ROOT, 'docker-compose.staging.yml'), 'utf8');
  const name = /^name:\s*(\S+)/m.exec(staging)?.[1];

  assert.equal(name, 'ftth-staging', 'el staging tiene que declarar su propio nombre de proyecto');
});
