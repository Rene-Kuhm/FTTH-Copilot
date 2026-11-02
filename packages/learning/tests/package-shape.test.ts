/**
 * T0.1 — `packages/learning` es un workspace member **puro**.
 *
 * El paquete implementa el núcleo del learning loop (resolución de
 * etiquetas, agrupación en eventos, split temporal, suficiencia). Es
 * lógica determinista: sin Prisma, sin Redis, sin red, sin reloj
 * implícito. La persistencia la pone el worker; la web solo lee
 * artefactos ya publicados.
 *
 * Estos tests son la forma del paquete: si mañana alguien le mete una
 * dependencia de la base de datos, el paquete deja de ser puro y el
 * learning se vuelve imposible de testear y de reproducir.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import vitestConfig from '../vitest.config';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const PACKAGE_DIR = path.join(REPO_ROOT, 'packages', 'learning');
const PACKAGE_JSON = path.join(PACKAGE_DIR, 'package.json');
const SRC_DIR = path.join(PACKAGE_DIR, 'src');

interface PackageManifest {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

function readManifest(): PackageManifest {
  return JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as PackageManifest;
}

/** Todas las fuentes del paquete, para poder escanear sus imports. */
function listSources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSources(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out.sort();
}

function importSpecifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  for (const match of source.matchAll(/(?:from|import)\s*['"]([^'"]+)['"]/g)) {
    if (match[1]) specifiers.push(match[1]);
  }
  return specifiers;
}

describe('T0.1 — packages/learning es puro', () => {
  it('existe como workspace member con su entry point', () => {
    expect(existsSync(PACKAGE_JSON)).toBe(true);
    expect(readManifest().name).toBe('@ftth-copilot/learning');
    expect(existsSync(path.join(SRC_DIR, 'index.ts'))).toBe(true);
  });

  it('no depende de la base de datos ni del paquete de evidencia', () => {
    const manifest = readManifest();
    const deps = Object.keys(manifest.dependencies ?? {});
    expect(deps).not.toContain('@ftth-copilot/db');
    expect(deps).not.toContain('@ftth-copilot/evidence');
    expect(deps).toContain('@ftth-copilot/shared');
  });

  it('ninguna fuente importa Prisma ni la base de datos', () => {
    const sources = listSources(SRC_DIR);
    expect(sources.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of sources) {
      for (const specifier of importSpecifiers(file)) {
        if (
          specifier === '@ftth-copilot/db' ||
          specifier === '@prisma/client' ||
          specifier.startsWith('prisma/')
        ) {
          offenders.push(`${path.relative(REPO_ROOT, file)} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('es TypeScript estricto', () => {
    const tsconfig = JSON.parse(
      readFileSync(path.join(PACKAGE_DIR, 'tsconfig.json'), 'utf8'),
    ) as { compilerOptions?: { strict?: boolean; noImplicitAny?: boolean } };
    expect(tsconfig.compilerOptions?.strict).toBe(true);
    expect(tsconfig.compilerOptions?.noImplicitAny).toBe(true);
  });

  it('exige la cobertura mínima del núcleo (80/80/70/80)', () => {
    const thresholds = (
      vitestConfig as {
        test?: { coverage?: { thresholds?: Record<string, number> } };
      }
    ).test?.coverage?.thresholds;
    expect(thresholds).toMatchObject({
      lines: 80,
      functions: 80,
      branches: 70,
      statements: 80,
    });
  });
});
