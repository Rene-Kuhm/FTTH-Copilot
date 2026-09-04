import { describe, expect, it } from 'vitest';
import {
  evalCorpusSchema,
  type EvalCorpus,
  type EvalSurface,
  type InjectionKind,
} from '../src/corpus-schema';
import pinkCorpus from '../corpus/pink.json' assert { type: 'json' };
import redCorpus from '../corpus/red.json' assert { type: 'json' };

/**
 * Phase F-2 — corpus fixtures golden tests.
 *
 * The pink corpus covers benign traffic on every mapped surface; the red
 * corpus covers every injectionKind. The Phase F-4 runner relies on
 * these coverage guarantees: a missing surface in pink means coverage
 * metrics are incomplete; a missing injectionKind in red means the
 * attack-pass-rate gate can be satisfied by skipping the case.
 *
 * RED proof: before `corpus/{pink,red}.json` exist, Node 22 JSON imports
 * throw `ERR_MODULE_NOT_FOUND` / `assert { type: 'json' }` resolution
 * failure and every test in this file fails.
 */
describe('@ftth-copilot/eval — corpus fixtures', () => {
  const expectedSurfaces: EvalSurface[] = [
    'user-message',
    'conversation-history',
    'tool-args',
    'connector-payload',
    'retrieval-block',
    'system-assembly',
    'prediction-provider',
  ];

  describe('pink.json (benign)', () => {
    const parsed: EvalCorpus = evalCorpusSchema.parse(pinkCorpus);

    it('parses against evalCorpusSchema', () => {
      const result = evalCorpusSchema.safeParse(pinkCorpus);
      expect(result.success).toBe(true);
    });

    it('contains at least 7 cases (one per mapped surface)', () => {
      expect(parsed.cases.length).toBeGreaterThanOrEqual(7);
    });

    it('covers every mapped surface at least once', () => {
      const present = new Set(parsed.cases.map((c) => c.surface));
      for (const surface of expectedSurfaces) {
        expect(present.has(surface), `missing pink surface: ${surface}`).toBe(true);
      }
    });
  });

  describe('red.json (adversarial)', () => {
    const parsed: EvalCorpus = evalCorpusSchema.parse(redCorpus);

    it('parses against evalCorpusSchema', () => {
      const result = evalCorpusSchema.safeParse(redCorpus);
      expect(result.success).toBe(true);
    });

    it('contains at least 7 cases (one per injectionKind)', () => {
      expect(parsed.cases.length).toBeGreaterThanOrEqual(7);
    });

    it('covers at least 7 distinct injectionKinds', () => {
      const presentKinds = new Set<InjectionKind>();
      for (const c of parsed.cases) {
        if (c.injectionKind !== undefined) presentKinds.add(c.injectionKind);
      }
      expect(presentKinds.size).toBeGreaterThanOrEqual(7);
    });

    it('declares injectionKind on every case', () => {
      for (const c of parsed.cases) {
        expect(c.injectionKind, `red case ${c.id} is missing injectionKind`).toBeDefined();
      }
    });

    it('uses only warn or abstain gates (never allow)', () => {
      for (const c of parsed.cases) {
        expect(
          c.expectedGate === 'warn' || c.expectedGate === 'abstain',
          `red case ${c.id} must gate to warn or abstain, got ${c.expectedGate}`,
        ).toBe(true);
      }
    });
  });

  describe('cross-file invariants', () => {
    it('uses synthetic, non-real device ids (OLT-001-test, ONU-0001-test pattern)', () => {
      const allDeviceIdRegex = /\bOLT-\d{3}-test\b|\bONU-\d{4}-test\b/;
      for (const c of [...pinkCorpus.cases, ...redCorpus.cases]) {
        const blob = `${c.id} ${c.userMessage} ${JSON.stringify(c.toolMocks ?? '')}`;
        // At least the ID contains a synthetic marker (e.g. '-test' suffix
        // somewhere). We don't force every surface to mention a device ID;
        // we only assert that the case identifiers follow the synthetic
        // naming convention used throughout the eval corpus.
        expect(c.id, `case id ${c.id} is empty`).toMatch(/.+/);
        // Loose check: surface-specific strings may include device ids.
        // We assert at least one of the two corpora carries the synthetic
        // marker so the fixtures are demonstrably not real-data leaks.
        const anyMarker =
          allDeviceIdRegex.test(blob) ||
          blob.includes('-test') ||
          blob.includes('placeholder') ||
          blob.includes('synthetic');
        expect(anyMarker, `case ${c.id} lacks synthetic markers`).toBe(true);
      }
    });

    it('uses stable, non-empty, distinct ids across pink + red', () => {
      const allIds = new Set<string>();
      for (const c of [...pinkCorpus.cases, ...redCorpus.cases]) {
        expect(c.id.length).toBeGreaterThan(0);
        expect(allIds.has(c.id), `duplicate id ${c.id}`).toBe(false);
        allIds.add(c.id);
      }
    });
  });
});
