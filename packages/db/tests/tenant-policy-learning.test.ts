/**
 * Golden test de las salvaguardas de la Fase 1 del learning loop sobre el
 * schema Prisma (tarea T1.1 — `odd/tasks/learning-loop.md`).
 *
 * La Fase 1 pone dos knobs en `TenantPolicy`: `learningMode` (el interruptor
 * `off → shadow → active`, default `off`) y `learningArtifactPins` (qué
 * versión de cada artefacto aprendida usa el tenant).
 *
 * El test lee el archivo del schema y el SQL de la migración: no invoca
 * `prisma generate` ni una base, así que corre en cualquier entorno. Es el
 * patrón que ya usa `packages/db/tests/schema.test.ts`.
 *
 * RED → GREEN:
 *   RED: el schema no declara `LearningMode` ni las dos columnas, y no hay
 *   migración que las cree.
 *   GREEN: el schema declara el enum y las columnas, y la migración las crea
 *   de forma aditiva.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCHEMA_PATH = resolve(__dirname, '..', 'prisma', 'schema.prisma');
const MIGRATIONS_DIR = resolve(__dirname, '..', 'prisma', 'migrations');

function loadSchema(): string {
  return readFileSync(SCHEMA_PATH, 'utf-8');
}

/** El cuerpo de `enum Name { ... }`, sin las llaves. */
function extractEnumBody(schema: string, name: string): string | null {
  const startMatch = new RegExp(`enum\\s+${name}\\s*\\{`).exec(schema);
  if (!startMatch) return null;
  const openIdx = schema.indexOf('{', startMatch.index);
  let depth = 1;
  let closeIdx = openIdx + 1;
  while (closeIdx < schema.length && depth > 0) {
    const ch = schema[closeIdx];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (depth === 0) break;
    closeIdx += 1;
  }
  if (depth !== 0) return null;
  return schema.slice(openIdx + 1, closeIdx);
}

/** El bloque de `model Name { ... }`. */
function extractModelBlock(schema: string, name: string): string | null {
  const match = new RegExp(`model\\s+${name}\\s*\\{[\\s\\S]*?\\n\\}`).exec(schema);
  return match?.[0] ?? null;
}

/** La primera migración cuyo SQL menciona el termino buscado. */
function findMigration(term: string): { path: string; sql: string } | null {
  for (const entry of readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = resolve(MIGRATIONS_DIR, entry.name, 'migration.sql');
    if (!existsSync(file)) continue;
    const sql = readFileSync(file, 'utf-8');
    if (sql.includes(term)) return { path: file, sql };
  }
  return null;
}

describe('TenantPolicy — interruptor del learning loop (T1.1)', () => {
  it('declara el enum LearningMode con off, shadow y active', () => {
    const body = extractEnumBody(loadSchema(), 'LearningMode');
    expect(body).not.toBeNull();
    expect(body).toContain('off');
    expect(body).toContain('shadow');
    expect(body).toContain('active');
  });

  it('el enum LearningMode declara exactamente los tres modos del diseño', () => {
    const body = extractEnumBody(loadSchema(), 'LearningMode') ?? '';
    const values = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(values).toEqual(['off', 'shadow', 'active']);
  });

  it('TenantPolicy declara `learningMode` con default `off`', () => {
    const block = extractModelBlock(loadSchema(), 'TenantPolicy');
    expect(block).not.toBeNull();
    expect(block).toMatch(/learningMode\s+LearningMode\s+@default\(off\)/);
  });

  it('TenantPolicy declara `learningArtifactPins` como JSON opcional', () => {
    const block = extractModelBlock(loadSchema(), 'TenantPolicy');
    expect(block).not.toBeNull();
    expect(block).toMatch(/learningArtifactPins\s+Json\?/);
  });
});

describe('migración de las salvaguardas de la Fase 1 (T1.1)', () => {
  it('hay una migración que crea el enum LearningMode', () => {
    const migration = findMigration('LearningMode');
    expect(migration).not.toBeNull();
    expect(migration!.sql).toMatch(/CREATE TYPE\s+"LearningMode"\s+AS ENUM/i);
  });

  it('la migración crea el enum con los tres modos', () => {
    const migration = findMigration('LearningMode');
    expect(migration).not.toBeNull();
    expect(migration!.sql).toMatch(/'off'/);
    expect(migration!.sql).toMatch(/'shadow'/);
    expect(migration!.sql).toMatch(/'active'/);
  });

  it('la migración agrega la columna `learningMode` con default `off`', () => {
    const migration = findMigration('LearningMode');
    expect(migration).not.toBeNull();
    expect(migration!.sql).toMatch(/ADD COLUMN(?:\s+IF NOT EXISTS)?\s+"learningMode"/i);
    expect(migration!.sql).toMatch(/DEFAULT\s+'off'/i);
  });

  it('la migración agrega la columna `learningArtifactPins` como JSON', () => {
    const migration = findMigration('LearningMode');
    expect(migration).not.toBeNull();
    expect(migration!.sql).toMatch(/ADD COLUMN(?:\s+IF NOT EXISTS)?\s+"learningArtifactPins"/i);
    expect(migration!.sql).toMatch(/JSONB/i);
  });

  it('la migración es aditiva: no borra ni reescribe la tabla de políticas', () => {
    const migration = findMigration('LearningMode');
    expect(migration).not.toBeNull();
    expect(migration!.sql).not.toMatch(/DROP\s+TABLE/i);
    expect(migration!.sql).not.toMatch(/DROP\s+COLUMN/i);
  });
});
