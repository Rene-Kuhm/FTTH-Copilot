/**
 * Phase F-4.1 — corpus loader.
 *
 * The loader is the single entry point through which every F-4 consumer
 * reads the committable corpus fixtures (`packages/eval/corpus/{pink,red}.json`).
 *
 * Design constraints (locked in the F-4 design.md + AD-1):
 *   - JSON parsing goes through `evalCorpusSchema`; anything that fails
 *     validation surfaces as a typed `CorpusLoadError` carrying the file
 *     path AND the first zod issue (so PR logs can grep on `path`).
 *   - The async signature (`Promise<EvalCorpus>`) is intentional: today's
 *     load uses `node:fs/promises`, tomorrow's swap to S3/HTTP keeps the
 *     call site unchanged.
 *   - `loadPinkCorpus` / `loadRedCorpus` are convenience wrappers around
 *     `loadCorpus` that point at the committable fixtures via Node 22 JSON
 *     imports. The wrappers exist so the runner can `import { loadPinkCorpus,
 *     loadRedCorpus } from '@ftth-copilot/eval'` without hard-coding paths.
 *
 * The class-based `CorpusLoadError` is the F-4 wire surface for the
 * loader's failure mode; downstream assertions catch it by `instanceof`
 * and surface the `path` + `issue` to the operator.
 */

import { readFile } from 'node:fs/promises';
import { evalCorpusSchema, type EvalCorpus } from './corpus-schema';
// Node 22 `import ... assert { type: 'json' }` is the same syntax the
// existing fixture tests use (see `corpus-fixtures.test.ts`); keeping the
// loader aligned with the rest of the package makes the JSON-import path
// canonical.
import pinkJson from '../corpus/pink.json' with { type: 'json' };
import redJson from '../corpus/red.json' with { type: 'json' };

/**
 * Typed error for the loader. Carries the offending path + (when the
 * failure is a zod rejection) the first issue so PR logs can grep on
 * `error.path` and the runner can show the schema field that broke.
 */
export class CorpusLoadError extends Error {
  public readonly path: string;
  public readonly issue?: unknown;

  constructor(args: { path: string; message: string; issue?: unknown }) {
    super(args.message);
    this.name = 'CorpusLoadError';
    this.path = args.path;
    this.issue = args.issue;
    // Restore the prototype chain for `instanceof` after extending Error.
    Object.setPrototypeOf(this, CorpusLoadError.prototype);
  }
}

/**
 * Reads + zod-validates the corpus JSON at `path`. Throws `CorpusLoadError`
 * when the file is missing, unreadable, or fails schema validation.
 *
 * Async by design: `node:fs/promises` is the v1 backing store; the same
 * signature will accept S3/HTTP without breaking the runner.
 */
export async function loadCorpus(path: string): Promise<EvalCorpus> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (cause) {
    throw new CorpusLoadError({
      path,
      message: `CorpusLoadError: failed to read corpus at '${path}': ${(cause as Error).message}`,
      issue: cause,
    });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (cause) {
    throw new CorpusLoadError({
      path,
      message: `CorpusLoadError: corpus at '${path}' is not valid JSON: ${(cause as Error).message}`,
      issue: cause,
    });
  }

  const result = evalCorpusSchema.safeParse(parsedJson);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    throw new CorpusLoadError({
      path,
      message: `CorpusLoadError: corpus at '${path}' failed schema validation: ${firstIssue?.message ?? 'unknown'}`,
      issue: firstIssue,
    });
  }
  return result.data;
}

/**
 * Loads the committable pink corpus from `packages/eval/corpus/pink.json`.
 * Synchronous wrapper because the JSON-import backing store is in-memory
 * after the module is loaded — no `await` needed. The function still
 * returns `EvalCorpus` to keep the type contract identical to `loadCorpus`.
 */
export function loadPinkCorpus(): EvalCorpus {
  const result = evalCorpusSchema.safeParse(pinkJson);
  if (!result.success) {
    throw new CorpusLoadError({
      path: 'corpus/pink.json',
      message: `CorpusLoadError: corpus at 'corpus/pink.json' failed schema validation: ${result.error.issues[0]?.message ?? 'unknown'}`,
      issue: result.error.issues[0],
    });
  }
  return result.data;
}

/**
 * Loads the committable red corpus from `packages/eval/corpus/red.json`.
 * Synchronous wrapper around the in-memory JSON import — same rationale
 * as `loadPinkCorpus`.
 */
export function loadRedCorpus(): EvalCorpus {
  const result = evalCorpusSchema.safeParse(redJson);
  if (!result.success) {
    throw new CorpusLoadError({
      path: 'corpus/red.json',
      message: `CorpusLoadError: corpus at 'corpus/red.json' failed schema validation: ${result.error.issues[0]?.message ?? 'unknown'}`,
      issue: result.error.issues[0],
    });
  }
  return result.data;
}
