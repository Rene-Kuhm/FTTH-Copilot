/**
 * Phase F-4.1 — corpus loader tests (keyless, file-system).
 *
 * RED proof: before `src/corpus-loader.ts` exists, the test file's import
 * resolves to `undefined` and every assertion below fails with
 * `Cannot read properties of undefined`. GREEN proof: after the loader
 * ships, the typed `loadCorpus` / `loadPinkCorpus` / `loadRedCorpus`
 * surface round-trips the committable JSON fixtures and rejects malformed
 * input with a `CorpusLoadError` carrying the offending path + the first
 * zod issue.
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evalCorpusSchema } from '../src/corpus-schema';
import {
  CorpusLoadError,
  loadCorpus,
  loadPinkCorpus,
  loadRedCorpus,
} from '../src/corpus-loader';

describe('@ftth-copilot/eval — corpus loader (F-4.1)', () => {
  describe('loadPinkCorpus', () => {
    it('returns a valid pink EvalCorpus', () => {
      const corpus = loadPinkCorpus();
      const result = evalCorpusSchema.safeParse(corpus);
      expect(result.success).toBe(true);
      expect(corpus.schema).toBe('ftth.eval-corpus.v1');
    });

    it('contains at least 7 cases', () => {
      const corpus = loadPinkCorpus();
      expect(corpus.cases.length).toBeGreaterThanOrEqual(7);
    });
  });

  describe('loadRedCorpus', () => {
    it('returns a valid red EvalCorpus', () => {
      const corpus = loadRedCorpus();
      const result = evalCorpusSchema.safeParse(corpus);
      expect(result.success).toBe(true);
      expect(corpus.schema).toBe('ftth.eval-corpus.v1');
    });

    it('contains at least 7 cases', () => {
      const corpus = loadRedCorpus();
      expect(corpus.cases.length).toBeGreaterThanOrEqual(7);
    });
  });

  describe('loadCorpus', () => {
    it('rejects with CorpusLoadError when the file is missing', async () => {
      const err = await loadCorpus('does-not-exist-1234567890.json').catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(CorpusLoadError);
      const error = err as CorpusLoadError;
      expect(error.path).toBe('does-not-exist-1234567890.json');
      expect(error.message).toContain('does-not-exist-1234567890.json');
    });

    it('rejects with CorpusLoadError carrying the path AND the first zod issue when the file is malformed', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'eval-loader-'));
      const malformedPath = join(dir, 'malformed.json');
      // Intentionally broken: top-level `cases` is a string instead of an
      // array; the schema MUST reject it on the first issue.
      writeFileSync(
        malformedPath,
        JSON.stringify({ schema: 'ftth.eval-corpus.v1', version: 1, cases: 'not-an-array' }),
      );
      try {
        const err = await loadCorpus(malformedPath).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(CorpusLoadError);
        const error = err as CorpusLoadError;
        expect(error.path).toBe(malformedPath);
        expect(error.issue).toBeDefined();
        expect(typeof error.issue).toBe('object');
        // The zod issue carries a `path` array; the first issue MUST point
        // at the malformed `cases` field.
        const issuePath = (error.issue as { path?: ReadonlyArray<unknown> }).path;
        expect(issuePath).toEqual(['cases']);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('succeeds for the committable pink.json fixture (round-trip)', async () => {
      // Resolve the repo-root path to the committable fixture; the loader
      // is intentionally path-flexible (relative paths allowed) so this
      // round-trip is part of the contract.
      const repoRoot = join(import.meta.dirname, '..', '..', '..');
      const fixturePath = join(repoRoot, 'packages', 'eval', 'corpus', 'pink.json');
      const corpus = await loadCorpus(fixturePath);
      expect(corpus.cases.length).toBeGreaterThanOrEqual(7);
    });

    it('exposes a typed signature usable from async consumers', async () => {
      // The function MUST be async (Promise<EvalCorpus>) so future swap
      // to S3/HTTP does not break the call site.
      const result = await loadCorpus('some-path.json').catch((e: unknown) => e);
      // We do not assert success here — the path is bogus on purpose —
      // we only assert the resolved/rejected shape and that the rejection
      // is a `CorpusLoadError`.
      expect(result).toBeInstanceOf(CorpusLoadError);
    });
  });

  describe('CorpusLoadError', () => {
    it('is an Error subclass with path + optional issue fields', () => {
      const err = new CorpusLoadError({ path: 'foo.json', message: 'broken' });
      expect(err).toBeInstanceOf(Error);
      expect(err.path).toBe('foo.json');
      expect(err.message).toBe('broken');
      expect(err.issue).toBeUndefined();
    });

    it('carries a zod issue when constructed with one', () => {
      const issue = { code: 'invalid_type', path: ['cases'], message: 'expected array' };
      const err = new CorpusLoadError({ path: 'foo.json', message: 'bad', issue });
      expect(err.issue).toEqual(issue);
    });

    it('lives in the package barrel so downstream consumers import it', async () => {
      const barrel = await import('../src/index');
      expect(barrel.CorpusLoadError).toBeDefined();
      expect(barrel.loadCorpus).toBeDefined();
      expect(barrel.loadPinkCorpus).toBeDefined();
      expect(barrel.loadRedCorpus).toBeDefined();
    });
  });
});
