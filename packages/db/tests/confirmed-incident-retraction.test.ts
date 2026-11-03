/**
 * Golden test de la tabla de retracciones (learning loop, tarea T1.2 — D2).
 *
 * `ConfirmedIncident` es inmutable por diseño: para corregirla sin romper esa
 * garantía, la retracción es una fila aparte y append-only. La fila
 * retractada queda fuera del recall, del entrenamiento y del índice, pero
 * sigue en la base para auditoría (D2).
 *
 * El test lee el schema y el SQL de la migración: no invoca `prisma generate`
 * ni una base, así que corre en cualquier entorno.
 *
 * RED → GREEN:
 *   RED: el schema no declara `ConfirmedIncidentRetraction` y no hay
 *   migración que cree la tabla.
 *   GREEN: el schema declara el modelo con su unicidad por tenant, y la
 *   migración crea la tabla de forma aditiva.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCHEMA_PATH = resolve(__dirname, '..', 'prisma', 'schema.prisma');
const MIGRATIONS_DIR = resolve(__dirname, '..', 'prisma', 'migrations');

function loadSchema(): string {
  return readFileSync(SCHEMA_PATH, 'utf-8');
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

describe('ConfirmedIncidentRetraction (T1.2)', () => {
  it('declara el modelo', () => {
    expect(extractModelBlock(loadSchema(), 'ConfirmedIncidentRetraction')).not.toBeNull();
  });

  it('declara las columnas del append-only de D2', () => {
    const body = extractModelBlock(loadSchema(), 'ConfirmedIncidentRetraction') ?? '';
    expect(body).toMatch(/\btenantId\b/);
    expect(body).toMatch(/\bincidentId\b/);
    expect(body).toMatch(/\breason\b/);
    expect(body).toMatch(/\bretractedByUserId\b/);
    expect(body).toMatch(/\bcreatedAt\b/);
  });

  it('el incidente es una referencia blanda: la KB sigue siendo inmutable', () => {
    const body = extractModelBlock(loadSchema(), 'ConfirmedIncidentRetraction') ?? '';
    // Sin FK a `confirmed_incidents`: la retraction es una fila aparte, y
    // borrar el incidenteConfirmado no tiene que arrastrar la auditoria.
    expect(body).not.toMatch(/ConfirmedIncident\s+@relation/);
  });

  it('una retraccion por incidente y por tenant', () => {
    const body = extractModelBlock(loadSchema(), 'ConfirmedIncidentRetraction') ?? '';
    expect(body).toMatch(/@@unique\(\[tenantId, incidentId\]\)/);
  });

  it('mapea la tabla a snake_case', () => {
    const body = extractModelBlock(loadSchema(), 'ConfirmedIncidentRetraction') ?? '';
    expect(body).toMatch(/@@map\("confirmed_incident_retractions"\)/);
  });

  it('declara la relacion inversa en Tenant', () => {
    const schema = loadSchema();
    const tenant = extractModelBlock(schema, 'Tenant') ?? '';
    expect(tenant).toMatch(/confirmedIncidentRetractions\s+ConfirmedIncidentRetraction\[\]/);
  });

  it('declara la relacion inversa en User', () => {
    const schema = loadSchema();
    const user = extractModelBlock(schema, 'User') ?? '';
    expect(user).toMatch(/confirmedIncidentRetractions\s+ConfirmedIncidentRetraction\[\]/);
  });
});

describe('migración de las retracciones (T1.2)', () => {
  it('hay una migración que crea la tabla', () => {
    const migration = findMigration('confirmed_incident_retractions');
    expect(migration).not.toBeNull();
    expect(migration!.sql).toMatch(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"confirmed_incident_retractions"/i);
  });

  it('la migración declara las columnas del append-only', () => {
    const migration = findMigration('confirmed_incident_retractions');
    expect(migration).not.toBeNull();
    for (const column of [
      '"tenantId"',
      '"incidentId"',
      '"reason"',
      '"retractedByUserId"',
      '"createdAt"',
    ]) {
      expect(migration!.sql).toContain(column);
    }
  });

  it('la migración declara el indice unico por tenant e incidente', () => {
    const migration = findMigration('confirmed_incident_retractions');
    expect(migration).not.toBeNull();
    expect(migration!.sql).toMatch(
      /CREATE UNIQUE INDEX(?:\s+IF NOT EXISTS)?\s+"confirmed_incident_retractions_tenantId_incidentId_key"/i,
    );
  });

  it('la migración agrega la FK al tenant', () => {
    const migration = findMigration('confirmed_incident_retractions');
    expect(migration).not.toBeNull();
    expect(migration!.sql).toMatch(/FOREIGN KEY\s*\("tenantId"\)\s*REFERENCES\s+"tenants"/i);
  });

  it('la migración es aditiva: no borra nada', () => {
    const migration = findMigration('confirmed_incident_retractions');
    expect(migration).not.toBeNull();
    expect(migration!.sql).not.toMatch(/DROP\s+TABLE/i);
    expect(migration!.sql).not.toMatch(/DROP\s+COLUMN/i);
  });
});
