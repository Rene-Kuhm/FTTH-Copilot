/**
 * Phase F-5.1 — verdict-log-writer tests (pure TS).
 *
 * Contract under test (F-5.1 spec, design.md §File Changes):
 *   1. `buildVerdictLogEntries(verdicts, opts)` emits ONE `VerdictLogEntryInput`
 *      row per verdict, carrying the `tenantId` + optional `messageId` /
 *      `conversationId` correlation keys.
 *   2. `injectionSuspicion` defaults to `true` when the verdict code is in
 *      `{'stale', 'low_confidence'}` and `false` otherwise (per design AD-11 —
 *      the denormalized fast-filter bit used to derive the nightly
 *      `injection_suspicion_total` metric).
 *   3. `serializeVerdictLogEntries(entries)` returns a JSON string that
 *      round-trips through `JSON.parse` and equals the structural shape of
 *      the entries (used as the `agentActionLog.parameters` JSON column
 *      fallback path when Prisma is unavailable).
 *   4. Empty verdicts → empty entries array (no synthetic rows).
 *   5. `incomplete` verdicts (the F-3 abstain trigger) emit
 *      `injectionSuspicion: false` — they are not injection markers, they
 *      are evidence-gaps.
 *
 * RED proof: before `src/verdict-log-writer.ts` exists, every named export
 * below resolves to `undefined` and the assertions fail.
 *
 * GREEN proof: after the module ships, the suite passes with the exact
 * `injectionSuspicion` semantics from design.md §Architecture Decisions #11.
 *
 * No DB dependency — the writer is pure TS so the Phase F-3 finalize branch
 * and the nightly leg can both call it without a Prisma connection.
 */
import { describe, expect, it } from 'vitest';
import {
  buildVerdictLogEntries,
  serializeVerdictLogEntries,
  type VerdictLogEntryInput,
} from '../src/verdict-log-writer';
import type { Verdict } from '@ftth-copilot/evidence';

describe('@ftth-copilot/eval — verdict-log-writer (F-5.1)', () => {
  describe('buildVerdictLogEntries', () => {
    it('emits one entry per verdict with the tenant + message correlation keys', () => {
      const verdicts: Verdict[] = [
        { toolName: 'list_onus', code: 'ok', reason: 'fresh', severity: 'info' },
        { toolName: 'get_onu_detail', code: 'stale', reason: 'expired-ttl', severity: 'warning' },
      ];
      const entries = buildVerdictLogEntries(verdicts, {
        tenantId: 'tenant-1',
        messageId: 'msg-1',
        conversationId: 'conv-1',
      });
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({
        tenantId: 'tenant-1',
        messageId: 'msg-1',
        conversationId: 'conv-1',
        toolName: 'list_onus',
        code: 'ok',
        severity: 'info',
        injectionSuspicion: false,
      });
      expect(entries[1]).toMatchObject({
        tenantId: 'tenant-1',
        messageId: 'msg-1',
        conversationId: 'conv-1',
        toolName: 'get_onu_detail',
        code: 'stale',
        severity: 'warning',
        injectionSuspicion: true,
      });
    });

    it('flags injectionSuspicion=true for low_confidence verdicts', () => {
      const verdicts: Verdict[] = [
        {
          toolName: 'list_olts',
          code: 'low_confidence',
          reason: 'low-confidence-value',
          severity: 'warning',
        },
      ];
      const entries = buildVerdictLogEntries(verdicts, { tenantId: 'tenant-1' });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        tenantId: 'tenant-1',
        toolName: 'list_olts',
        code: 'low_confidence',
        injectionSuspicion: true,
      });
    });

    it('flags injectionSuspicion=false for incomplete verdicts (NOT an injection marker)', () => {
      const verdicts: Verdict[] = [
        { toolName: 'get_onu_detail', code: 'incomplete', reason: 'no-envelope', severity: 'critical' },
      ];
      const entries = buildVerdictLogEntries(verdicts, { tenantId: 'tenant-1' });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        tenantId: 'tenant-1',
        toolName: 'get_onu_detail',
        code: 'incomplete',
        injectionSuspicion: false,
      });
    });

    it('flags injectionSuspicion=false for ok verdicts', () => {
      const verdicts: Verdict[] = [
        { toolName: 'list_olts', code: 'ok', reason: 'fresh-evidence', severity: 'info' },
      ];
      const entries = buildVerdictLogEntries(verdicts, { tenantId: 'tenant-1' });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        toolName: 'list_olts',
        code: 'ok',
        injectionSuspicion: false,
      });
    });

    it('respects an explicit injectionSuspicion override when the caller provides one', () => {
      // Spec leaves `injectionSuspicion` open on the input — callers may
      // pre-compute the bit. The writer must prefer the explicit value
      // over the code-derived default so future recompute / backfill
      // jobs don't silently flip the bit.
      const verdicts: Verdict[] = [
        { toolName: 'list_onus', code: 'ok', reason: 'fresh', severity: 'info' },
      ];
      const entries = buildVerdictLogEntries(verdicts, {
        tenantId: 'tenant-1',
        injectionSuspicion: true,
      });
      expect(entries[0]).toMatchObject({ injectionSuspicion: true });
    });

    it('omits messageId / conversationId from the entry when the caller does not provide them', () => {
      // The chat route passes both; the F-4 nightly metrics path may not
      // have a correlation key (recompute backfill job). The writer MUST
      // allow absent `messageId` / `conversationId` without synthesizing
      // empty strings — the Prisma model allows both to be null.
      const verdicts: Verdict[] = [
        { toolName: 'list_onus', code: 'ok', reason: 'fresh', severity: 'info' },
      ];
      const entries = buildVerdictLogEntries(verdicts, { tenantId: 'tenant-1' });
      expect(entries[0]).toMatchObject({
        tenantId: 'tenant-1',
      });
      expect((entries[0] as unknown as Record<string, unknown>)['messageId']).toBeUndefined();
      expect((entries[0] as unknown as Record<string, unknown>)['conversationId']).toBeUndefined();
    });

    it('returns an empty array when the verdicts array is empty', () => {
      const entries = buildVerdictLogEntries([], { tenantId: 'tenant-1' });
      expect(entries).toEqual([]);
    });

    it('preserves the observedAt timestamp when the verdict carries one (future recompute use)', () => {
      const verdicts: Verdict[] = [
        { toolName: 'list_onus', code: 'ok', reason: 'fresh', severity: 'info' },
      ];
      const iso = '2026-09-03T10:00:00.000Z';
      const entries = buildVerdictLogEntries(verdicts, {
        tenantId: 'tenant-1',
        observedAt: iso,
      });
      expect(entries[0].observedAt).toBe(iso);
    });

    it('preserves per-verdict order without dedup (one row per verdict, no collapse)', () => {
      const verdicts: Verdict[] = [
        { toolName: 'list_onus', code: 'ok', reason: 'fresh', severity: 'info' },
        { toolName: 'list_olts', code: 'ok', reason: 'fresh', severity: 'info' },
        { toolName: 'get_onu_detail', code: 'stale', reason: 'expired-ttl', severity: 'warning' },
      ];
      const entries = buildVerdictLogEntries(verdicts, { tenantId: 'tenant-1' });
      expect(entries.map((e) => e.toolName)).toEqual([
        'list_onus',
        'list_olts',
        'get_onu_detail',
      ]);
    });
  });

  describe('serializeVerdictLogEntries', () => {
    it('returns valid JSON that round-trips through JSON.parse', () => {
      const entries: VerdictLogEntryInput[] = [
        {
          tenantId: 'tenant-1',
          messageId: 'msg-1',
          conversationId: 'conv-1',
          toolName: 'list_onus',
          code: 'ok',
          severity: 'info',
          injectionSuspicion: false,
        },
      ];
      const json = serializeVerdictLogEntries(entries);
      expect(typeof json).toBe('string');
      const roundTrip = JSON.parse(json) as VerdictLogEntryInput[];
      expect(roundTrip).toEqual(entries);
    });

    it('returns the literal "[]" string when the entries array is empty', () => {
      const json = serializeVerdictLogEntries([]);
      expect(json).toBe('[]');
      expect(JSON.parse(json)).toEqual([]);
    });

    it('preserves injectionSuspicion as a JSON boolean when set explicitly', () => {
      const entries: VerdictLogEntryInput[] = [
        {
          tenantId: 'tenant-1',
          toolName: 'list_onus',
          code: 'stale',
          severity: 'warning',
          injectionSuspicion: true,
        },
      ];
      const json = serializeVerdictLogEntries(entries);
      const roundTrip = JSON.parse(json) as Array<{ injectionSuspicion: boolean }>;
      expect(roundTrip[0].injectionSuspicion).toBe(true);
    });
  });
});
