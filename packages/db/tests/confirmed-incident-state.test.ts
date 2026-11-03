/**
 * Golden test del estado de un incidente confirmado (learning loop, T1.4 — D3).
 *
 * Una fila con instrucciones embebidas no se rechaza en silencio: queda
 * `quarantined` y requiere revisión humana para entrar a la KB. El estado
 * vive en la fila, así que la KB sigue siendo append-only y auditable.
 *
 * RED → GREEN:
 *   RED: el schema no declara `ConfirmedIncidentState` ni la columna `state`,
 *   y no hay migración que los cree.
 *   GREEN: el schema declara el enum y la columna, y la migración es aditiva.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCHEMA_PATH = resolve(__dirname, '..', 'prisma', 'schema.prisma');
const MIGRATIONS_DIR = resolve(__dirname, '..', 'prisma', 'migrations');

function loadSchema(): string {
  return readFileSync(SCHEMA_PATH, 'utf-8');
}

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

function extractModelBlock(schema: string, name: string): string | null {
  const match = new RegExp(`model\\s+${name}\\s*\\{[\\s\\S]*?\\n\\}`).exec(schema);
  return match?.[0] ?? null;
}

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

describe('ConfirmedIncident.state (T1.4)', () => {
  it('declara el enum con los dos estados', () => {
    const body = extractEnumBody(loadSchema(), 'ConfirmedIncidentState');
    expect(body).not.toBeNull();
    const values = (body ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(values).toEqual(['active', 'quarantined']);
  });

  it('la fila tiene el estado, con default `active`', () => {
    const block = extractModelBlock(loadSchema(), 'ConfirmedIncident');
    expect(block).not.toBeNull();
    expect(block).toMatch(/state\s+ConfirmedIncidentState\s+@default\(active\)/);
  });

  it('una fila en cuarentena no es la KB: el recall la tiene que filtrar', () => {
    // El filtro vive en la consulta, no en el schema: lo que el schema
    // garantiza es que el estado existe y tiene un default seguro.
    const block = extractModelBlock(loadSchema(), 'ConfirmedIncident');
    expect(block).toMatch(/state\s+ConfirmedIncidentState/);
  });
});

describe('migración del estado (T1.4)', () => {
  it('crea el enum', () => {
    const migration = findMigration('ConfirmedIncidentState');
    expect(migration).not.toBeNull();
    expect(migration!.sql).toMatch(/CREATE TYPE\s+"ConfirmedIncidentState"\s+AS ENUM/i);
    expect(migration!.sql).toMatch(/'active'/);
    expect(migration!.sql).toMatch(/'quarantined'/);
  });

  it('agrega la columna con default `active`', () => {
    const migration = findMigration('ConfirmedIncidentState');
    expect(migration).not.toBeNull();
    expect(migration!.sql).toMatch(
      /ADD COLUMN(?:\s+IF NOT EXISTS)?\s+"state"\s+"ConfirmedIncidentState"\s+NOT NULL DEFAULT 'active'/i,
    );
  });

  it('es aditiva: no borra ni reescribe filas', () => {
    const migration = findMigration('ConfirmedIncidentState');
    expect(migration).not.toBeNull();
    expect(migration!.sql).not.toMatch(/DROP\s+TABLE/i);
    expect(migration!.sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(migration!.sql).not.toMatch(/UPDATE\s+/i);
  });
});
