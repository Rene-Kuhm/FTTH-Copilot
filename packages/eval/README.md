# `@ftth-copilot/eval`

Keyless, mocked-LLM evaluation harness for the FTTH agent. This package
ships the corpus schema, the committable pink/red fixture JSON, and the
runtime surface that drives `runAgent` against it. Two legs share the
corpus:

| Leg | Runner | Trigger | LLM keys? | Failure mode |
|-----|--------|---------|-----------|--------------|
| PR  | vitest in-process | `.github/workflows/ci.yml` `eval` job | **No** | Hard fail when `attack-pass-rate < 1.0` or a mapped surface is missing red coverage |
| Nightly | vitest in-process | `.github/workflows/eval-nightly.yml` cron + `workflow_dispatch` | `MINIMAX_API_KEY` | Metrics report only; never fails the job |

The PR leg is intentionally **mocked** so that the gate is reproducible
in CI without secrets: it reuses the `vi.mock('../src/llm')` and
`withToolResults` seams already proven by
`packages/agent-core/tests/runtime.test.ts`. The nightly leg runs the
same harness against the same corpus on real models to surface
mock-vs-real divergence in `attack-pass-rate`, abstention rate, and gate
false-positives.

## Phase F-2 — current scope

This is the Phase F-2 skeleton. It only registers the package in the
pnpm workspace and proves the barrel wiring is sound:

- `package.json` — name, scripts (`test`, `test:coverage`, `lint`,
  `typecheck`), workspace deps on `@ftth-copilot/agent-core`,
  `@ftth-copilot/evidence`, `@ftth-copilot/shared`, plus `zod`,
  `vitest`, `@vitest/coverage-v8`.
- `tsconfig.json` — strict, ESNext, NodeNext, `resolveJsonModule` on so
  the corpus fixtures can be imported via `import corpus from './corpus/pink.json' assert { type: 'json' }` (Node 22 JSON imports).
- `vitest.config.ts` — `globals: false`, `environment: 'node'`,
  `include: ['tests/**/*.test.ts']`, coverage thresholds
  `lines/functions/statements 80, branches 70`.
- `src/index.ts` — empty barrel; placeholder for F-4 re-exports.
- `tests/skeleton.test.ts` — proves the barrel resolves from a vitest
  run inside the monorepo.
- `src/corpus-schema.ts` — `ftth.eval-corpus.v1` zod envelope
  (`evalCaseSchema`, `evalCorpusSchema`) with strict, literal-versioned
  shape; types `EvalCase`, `EvalCorpus`, `EvalSurface`, `InjectionKind`,
  `ExpectedGate`.
- `corpus/pink.json` — benign traffic covering each of the 7 mapped
  untrusted-input surfaces; `expectedGate: 'allow'` or `'warn'`.
- `corpus/red.json` — attack traffic covering each of the 7
  `InjectionKind`s; `expectedGate: 'warn'` or `'abstain'`.

Phase F-4 will add:

- `src/runner.ts` — drives `runAgent` per corpus entry with the mocked
  LLM seam and the `withToolResults` helper from
  `packages/agent-core/tests/runtime.test.ts`.
- `src/corpus-loader.ts` — loads + zod-validates the JSON corpus with
  stable-ID dedup.
- `src/assertions.ts` — per-`expected` gate (allow / warn / abstain)
  plus surface-coverage report.
- `src/metrics.ts` — nightly report builder over DB rows.

Phase F-5 will add the `verdict-log-writer.ts` and the chat-route write
gate. Phase F-6 will wire `ci.yml` and `eval-nightly.yml`.

## Local commands

```bash
# register the package after pulling
pnpm install

# run the harness
pnpm --filter @ftth-copilot/eval test

# with coverage
pnpm --filter @ftth-copilot/eval test:coverage

# typecheck only
pnpm --filter @ftth-copilot/eval typecheck
```
