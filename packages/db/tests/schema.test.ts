/**
 * Golden test for the Fase F verdict_log Prisma model.
 *
 * Asserts the schema.prisma declares the model, the required indexes, the
 * foreign keys, and the supporting enums. Reads the source file directly so
 * the assertion runs without invoking `prisma generate` — the file is the
 * single source of truth that the generated client is regenerated from.
 *
 * RED → GREEN contract:
 *   RED: schema.prisma lacks `model VerdictLog`. All assertions fail.
 *   GREEN: add the model + enums + FKs to schema.prisma. Assertions pass.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCHEMA_PATH = resolve(__dirname, '..', 'prisma', 'schema.prisma');

function loadSchema(): string {
  return readFileSync(SCHEMA_PATH, 'utf-8');
}

/**
 * Extract the body of `enum Name { ... }` from a Prisma schema source. Uses
 * brace counting so it does not bleed across adjacent declarations that
 * share enum values (e.g. VerdictCode and VerdictSeverity both contain
 * `'ok'`). Returns the inner content without the surrounding `enum … { }`,
 * or null if the enum is missing.
 */
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

describe('verdict_log model (Fase F)', () => {
  it('declares a `model VerdictLog` block', () => {
    const schema = loadSchema();
    expect(schema).toMatch(/^model VerdictLog\s*\{/m);
  });

  it('declares VerdictLog with the required identity + correlation columns', () => {
    const schema = loadSchema();
    const block = schema.match(/model VerdictLog\s*\{[\s\S]*?\n\}/);
    expect(block).not.toBeNull();
    const body = block![0]!;
    for (const field of [
      'id',
      'tenantId',
      'messageId',
      'conversationId',
      'toolName',
      'code',
      'severity',
      'observedAt',
    ]) {
      expect(body, `missing field \`${field}\` on VerdictLog`).toContain(field);
    }
  });

  it('declares the id field as cuid() primary key', () => {
    const schema = loadSchema();
    const block = schema.match(/model VerdictLog\s*\{[\s\S]*?\n\}/)![0]!;
    expect(block).toMatch(/id\s+String\s+@id\s+@default\(cuid\(\)\)/);
  });

  it('declares the @@index([tenantId, observedAt]) index per AD-6', () => {
    const schema = loadSchema();
    expect(schema).toMatch(/@@index\(\[tenantId,\s*observedAt\]\)/);
  });

  it('declares the per-tenant code/observedAt composite index for fast-filter queries', () => {
    const schema = loadSchema();
    expect(schema).toMatch(/@@index\(\[tenantId,\s*code,\s*observedAt\]\)/);
  });

  it('declares the per-messageId index for recompute idempotency', () => {
    const schema = loadSchema();
    expect(schema).toMatch(/@@index\(\[messageId\]\)/);
  });

  it('maps the model to the snake_case `verdict_log` table', () => {
    const schema = loadSchema();
    const block = schema.match(/model VerdictLog\s*\{[\s\S]*?\n\}/)![0]!;
    expect(block).toMatch(/@@map\("verdict_log"\)/);
  });

  it('declares the VerdictCode enum with ok | low_confidence | stale | incomplete', () => {
    const schema = loadSchema();
    const body = extractEnumBody(schema, 'VerdictCode');
    expect(body).not.toBeNull();
    expect(body).toMatch(/\bok\b/);
    expect(body).toMatch(/\blow_confidence\b/);
    expect(body).toMatch(/\bstale\b/);
    expect(body).toMatch(/\bincomplete\b/);
    // Negative cross-check: should NOT contain severity-only tokens.
    expect(body).not.toMatch(/\binfo\b/);
    expect(body).not.toMatch(/\bwarning\b/);
    expect(body).not.toMatch(/\bcritical\b/);
  });

  it('declares the VerdictSeverity enum with ok | info | warning | critical', () => {
    const schema = loadSchema();
    const body = extractEnumBody(schema, 'VerdictSeverity');
    expect(body).not.toBeNull();
    expect(body).toMatch(/\bok\b/);
    expect(body).toMatch(/\binfo\b/);
    expect(body).toMatch(/\bwarning\b/);
    expect(body).toMatch(/\bcritical\b/);
    // Negative cross-check: should NOT contain code-only tokens.
    expect(body).not.toMatch(/\blow_confidence\b/);
    expect(body).not.toMatch(/\bstale\b/);
    expect(body).not.toMatch(/\bincomplete\b/);
  });

  it('declares Tenant.verdictLog reverse relation', () => {
    const schema = loadSchema();
    const tenantBlock = schema.match(/model Tenant\s*\{[\s\S]*?\n\}/)![0]!;
    expect(tenantBlock).toMatch(/verdictLog\s+VerdictLog\[\]/);
  });

  it('declares Message.verdictLog reverse relation', () => {
    const schema = loadSchema();
    const messageBlock = schema.match(/model Message\s*\{[\s\S]*?\n\}/)![0]!;
    expect(messageBlock).toMatch(/verdictLog\s+VerdictLog\[\]/);
  });
});

describe('verdict_log migration (Fase F)', () => {
  const MIGRATION_DIR = resolve(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260904002325_verdict_log',
  );

  it('ships a manual migration SQL mirroring the Fase E pattern', () => {
    expect(() => readFileSync(resolve(MIGRATION_DIR, 'migration.sql'), 'utf-8')).not.toThrow();
  });

  it('migration declares CREATE TYPE for VerdictCode + VerdictSeverity enums', () => {
    const sql = readFileSync(resolve(MIGRATION_DIR, 'migration.sql'), 'utf-8');
    expect(sql).toMatch(/CREATE TYPE "VerdictCode"/);
    expect(sql).toMatch(/CREATE TYPE "VerdictSeverity"/);
  });

  it('migration creates the verdict_log table with the documented columns', () => {
    const sql = readFileSync(resolve(MIGRATION_DIR, 'migration.sql'), 'utf-8');
    expect(sql).toMatch(/CREATE TABLE "verdict_log"/);
    for (const col of [
      '"id"',
      '"tenantId"',
      '"messageId"',
      '"conversationId"',
      '"toolName"',
      '"code"',
      '"severity"',
      '"observedAt"',
    ]) {
      expect(sql, `migration missing column ${col}`).toContain(col);
    }
  });

  it('migration declares the three required indexes', () => {
    const sql = readFileSync(resolve(MIGRATION_DIR, 'migration.sql'), 'utf-8');
    expect(sql).toMatch(/CREATE INDEX.*"verdict_log"[\s\S]*"tenantId"[\s\S]*"observedAt"/);
    expect(sql).toMatch(/CREATE INDEX.*"verdict_log"[\s\S]*"tenantId"[\s\S]*"code"[\s\S]*"observedAt"/);
    expect(sql).toMatch(/CREATE INDEX.*"verdict_log"[\s\S]*"messageId"/);
  });

  it('migration adds the FKs to tenants(id) and messages(id) with ON DELETE CASCADE', () => {
    const sql = readFileSync(resolve(MIGRATION_DIR, 'migration.sql'), 'utf-8');
    expect(sql).toMatch(/verdict_log_tenantId_fkey[\s\S]*REFERENCES "tenants"\("id"\)[\s\S]*ON DELETE CASCADE/);
    expect(sql).toMatch(/verdict_log_messageId_fkey[\s\S]*REFERENCES "messages"\("id"\)[\s\S]*ON DELETE CASCADE/);
  });
});