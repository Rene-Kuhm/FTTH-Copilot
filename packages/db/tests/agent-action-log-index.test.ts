/**
 * Golden test for the AgentActionLog dedupe index.
 *
 * The maintenance re-evaluation reads the audit log by (tenantId, toolName)
 * to find which incidents of a window were already notified. The only usable
 * index was (tenantId, createdAt), which cannot serve the toolName filter:
 * Postgres had to read every audit row of the tenant. The audit log has no
 * retention, so that scan grew with the tenant's whole history.
 *
 * Reads the source files directly so the assertion runs without invoking
 * `prisma generate` — the schema is the single source of truth that the
 * generated client is regenerated from.
 *
 * RED → GREEN contract:
 *   RED: schema.prisma lacks `@@index([tenantId, toolName, createdAt])`.
 *   GREEN: the index is declared and its migration creates it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SCHEMA_PATH = resolve(__dirname, '..', 'prisma', 'schema.prisma');
const MIGRATION_DIR = resolve(
  __dirname,
  '..',
  'prisma',
  'migrations',
  '20261102160000_agent_action_log_tool_index',
);

describe('AgentActionLog — el índice que la deduplicación necesita', () => {
  it('declara el índice (tenantId, toolName, createdAt)', () => {
    const schema = readFileSync(SCHEMA_PATH, 'utf-8');
    expect(schema).toMatch(/@@index\(\[tenantId,\s*toolName,\s*createdAt\]\)/);
  });

  it('la migración crea ese índice sobre la tabla mapeada', () => {
    const sql = readFileSync(resolve(MIGRATION_DIR, 'migration.sql'), 'utf-8');
    expect(sql).toMatch(
      /CREATE INDEX "agent_action_log_tenantId_toolName_createdAt_idx"\s+ON "agent_action_log"\("tenantId",\s*"toolName",\s*"createdAt"\)/,
    );
  });

  it('la migración no toca los datos: sólo crea el índice', () => {
    const sql = readFileSync(resolve(MIGRATION_DIR, 'migration.sql'), 'utf-8');
    const statements = sql
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('--'));

    for (const statement of statements) {
      expect(statement).toMatch(/^CREATE INDEX /);
    }
  });
});
