/**
 * La guía de staging tiene que contar lo que el staging necesita.
 *
 * Por qué: la guía es lo que alguien copia para levantar un staging. Si el
 * compose declara el mock NMS detrás de un profile y la guía no lo dice, el
 * stack levanta sin NMS y el poll no consulta nada; y si la guía manda a
 * buscar los contenedores por el nombre de producción, el que la sigue no
 * encuentra los suyos.
 *
 * El compose ya tiene sus propias reglas (`staging-compose.test.ts`). Estas
 * son las del lado del documento: que la guía no se quede atrás del compose.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

function stagingGuide(): string {
  return fs.readFileSync(path.join(REPO_ROOT, 'docs/how-to/desplegar-en-staging.md'), 'utf8');
}

/**
 * El texto del documento con los saltos de línea aplastados.
 *
 * Por qué: una frase puede partirse entre dos líneas sin que cambie lo que
 * dice. Un test de documento que depende del ajuste de línea falla cuando
 * alguien reescribe el párrafo, y ese fallo no dice nada del contenido.
 */
function flatGuide(): string {
  return stagingGuide().replace(/\s+/g, ' ');
}

test('la guía de staging levanta el mock NMS detrás de su profile', () => {
  assert.match(
    flatGuide(),
    /--profile mock-nms up -d mock-nms/,
    'la guía tiene que decir cómo se levanta el mock NMS: sin él la conexión del seed no se puede consultar',
  );
});

test('la guía de staging dice contra qué NMS apunta la conexión del seed', () => {
  assert.match(
    flatGuide(),
    /DEMO_NMS_BASE_URL/,
    'la guía tiene que nombrar la variable que le da su URL base a la conexión del seed',
  );
});

test('la guía de staging declara las excepciones de la política SSRF y avisa que no van a producción', () => {
  const guide = flatGuide();

  for (const name of [
    'NMS_ALLOW_HTTP',
    'NMS_ALLOW_PRIVATE_NETWORKS',
    'NMS_ALLOWED_HOSTS',
    'NMS_ALLOWED_PORTS',
  ]) {
    assert.ok(guide.includes(name), `la guía tiene que declarar ${name}`);
  }

  assert.match(
    guide,
    /Nunca van a producción/,
    'la guía tiene que avisar que las excepciones de la política SSRF no van a producción',
  );
});

test('la guía de staging dice en qué puerto responde el mock NMS', () => {
  assert.match(
    flatGuide(),
    /18080/,
    'la guía tiene que decir el puerto del mock NMS: la conexión del seed lo apunta',
  );
});

test('la guía de staging no manda a buscar los contenedores por el nombre de producción', () => {
  const guide = flatGuide();

  assert.doesNotMatch(
    guide,
    /ftth_prod_/,
    'los contenedores del staging ya no se llaman como los de producción',
  );
  assert.match(
    guide,
    /ftth-staging/,
    'la guía tiene que decir con qué prefijo quedan los contenedores del staging',
  );
});

test('la guía de staging enciende los receptores syslog y SNMP', () => {
  const guide = flatGuide();

  assert.match(
    guide,
    /SYSLOG_RECEIVER_ENABLED=true/,
    'sin el receptor syslog encendido no hay nada que validar del plano syslog',
  );
  assert.match(
    guide,
    /SNMP_RECEIVER_ENABLED=true/,
    'sin el receptor SNMP encendido no hay nada que validar del plano SNMP',
  );
});
