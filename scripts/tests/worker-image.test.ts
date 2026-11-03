import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  dependencyClosure,
  findUncopiedPackages,
  readWorkspacePackages,
} from '../lib/worker-image.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const DOCKERFILE = path.join(REPO_ROOT, 'services', 'worker', 'Dockerfile');

function loadDockerfile(): string {
  return fs.readFileSync(DOCKERFILE, 'utf8');
}

test('la imagen del worker copia TODOS los paquetes de su cierre de dependencias', () => {
  const packages = readWorkspacePackages(REPO_ROOT);
  const closure = dependencyClosure(packages, '@ftth-copilot/worker');

  assert.ok(closure.length > 1, 'el worker tiene que depender de algo más que de sí mismo');

  const missing = findUncopiedPackages(loadDockerfile(), packages, closure);

  assert.deepEqual(
    missing,
    [],
    `la imagen del worker no copia estos paquetes del cierre: ${missing.join(', ')}. ` +
      'La imagen arranca y se cae al importar: el síntoma sólo aparece en el despliegue.',
  );
});

test('el cierre del worker incluye el paquete de learning', () => {
  // El paquete entró con la Fase 0 del learning loop y su ausencia en la
  // imagen rompía al worker en crash-loop.
  const packages = readWorkspacePackages(REPO_ROOT);
  const closure = dependencyClosure(packages, '@ftth-copilot/worker');

  assert.ok(
    closure.includes('@ftth-copilot/learning'),
    'el worker importa el job de snapshot del learning loop: el paquete tiene que estar en el cierre',
  );
});

test('el Dockerfile copia el código fuente de cada paquete, no sólo el manifiesto', () => {
  const packages = readWorkspacePackages(REPO_ROOT);
  const closure = dependencyClosure(packages, '@ftth-copilot/worker');
  const dockerfile = loadDockerfile();

  for (const name of closure) {
    const pkg = packages.get(name);
    if (!pkg) continue;
    // El paquete sin `src` (por ejemplo `packages/db`, que se copia de otra
    // forma) queda fuera de esta aserción.
    const srcDir = path.join(REPO_ROOT, pkg.dir, 'src');
    if (!fs.existsSync(srcDir)) continue;
    assert.ok(
      dockerfile.includes(`COPY ${pkg.dir}/src`),
      `el Dockerfile no copia el src de ${pkg.dir}: el paquete viaja sin código`,
    );
  }
});

test('findUncopiedPackages detecta un paquete ausente', () => {
  const packages = new Map([
    [
      'pkg-a',
      { name: 'pkg-a', dir: 'packages/a', dependencies: {} },
    ],
    [
      'pkg-b',
      { name: 'pkg-b', dir: 'packages/b', dependencies: {} },
    ],
  ]);

  const dockerfile = ['COPY packages/a/package.json ./packages/a/package.json', 'COPY packages/a/src ./packages/a/src'].join(
    '\n',
  );

  assert.deepEqual(findUncopiedPackages(dockerfile, packages, ['pkg-a', 'pkg-b']), [
    'pkg-b (packages/b)',
  ]);
});

test('findUncopiedPackages acepta el prefijo ./ y tolera espacios', () => {
  const packages = new Map([['pkg-a', { name: 'pkg-a', dir: 'packages/a', dependencies: {} }]]);
  const dockerfile = 'COPY   ./packages/a/src   ./packages/a/src';

  assert.deepEqual(findUncopiedPackages(dockerfile, packages, ['pkg-a']), []);
});
