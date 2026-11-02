/**
 * I1 — Pared del Truth Gate.
 *
 * Ningún artefacto aprendido entra al Truth Gate, a la política de
 * abstención ni al envelope de abstención. El learning vive *alrededor*
 * del modelo: ordena lo que se le muestra y cuándo avisa, nunca cambia
 * lo que el gate considera evidencia.
 *
 * El test es un grafo de imports: lee el código de `packages/evidence` y
 * falla si algo de ahí alcanza al paquete de learning. No confía en un
 * documento: mira lo que el código importa de verdad.
 *
 * El test también mira al revés: `packages/learning` no puede importar a
 * `packages/evidence`, porque `evidence` depende de `shared` y el learning
 * también — un import en esa dirección cerraría un ciclo en el grafo de
 * paquetes (AGENTS.md §4).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const EVIDENCE_SRC = path.join(REPO_ROOT, 'packages', 'evidence', 'src');
const LEARNING_SRC = path.join(REPO_ROOT, 'packages', 'learning', 'src');

/** Módulos de `evidence` que la invariante nombra de forma explícita. */
const GUARDED_FILES = ['truth-gate.ts', 'abstention-policy.ts'];

function listTypeScriptFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTypeScriptFiles(full));
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

/** ¿El specifier alcanza al paquete de learning? */
function reachesLearning(specifier: string): boolean {
  if (specifier === '@ftth-copilot/learning') return true;
  // Un import relativo que se sale del paquete hacia el learning.
  return /(?:^|\/)learning\//.test(specifier) && specifier.includes('..');
}

function reachesEvidence(specifier: string): boolean {
  return specifier === '@ftth-copilot/evidence';
}

describe('I1 — pared del Truth Gate', () => {
  it('el paquete de learning existe', () => {
    expect(existsSync(path.join(LEARNING_SRC, 'index.ts'))).toBe(true);
  });

  it('ningún módulo de evidence importa el paquete de learning', () => {
    const offenders: string[] = [];
    for (const file of listTypeScriptFiles(EVIDENCE_SRC)) {
      for (const specifier of importSpecifiers(file)) {
        if (reachesLearning(specifier)) {
          offenders.push(`${path.relative(REPO_ROOT, file)} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('el TruthGate y la política de abstención existen y no lo importan', () => {
    for (const name of GUARDED_FILES) {
      const file = path.join(EVIDENCE_SRC, name);
      expect(existsSync(file)).toBe(true);
      const specifiers = importSpecifiers(file);
      expect(specifiers.filter(reachesLearning)).toEqual([]);
    }
  });

  it('el learning no importa evidence: no hay ciclo en el grafo', () => {
    const offenders: string[] = [];
    for (const file of listTypeScriptFiles(LEARNING_SRC)) {
      for (const specifier of importSpecifiers(file)) {
        if (reachesEvidence(specifier)) {
          offenders.push(`${path.relative(REPO_ROOT, file)} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
