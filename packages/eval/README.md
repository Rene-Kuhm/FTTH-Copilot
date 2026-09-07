# `@ftth-copilot/eval`

Keyless, mocked-LLM evaluation harness for the FTTH agent. This package ships
the corpus schema, the committable pink/red fixture JSON, and the runtime
surface that drives `runAgent` against it. The PR leg enforces a hard gate on
every pull request; the nightly leg runs the same harness against real models
to surface mock-vs-real divergence in `attack-pass-rate`, abstention rate, and
gate false-positives.

## Quick path

1. `pnpm install` — registers the package in the pnpm workspace.
2. `pnpm --filter @ftth-copilot/eval test` — runs the PR-leg harness (no
   LLM keys needed).
3. Read the legs table below to learn what the nightly leg does and when it
   fires.

## Legs

| Leg | Runner | Trigger | LLM keys? | Failure mode |
|-----|--------|---------|-----------|--------------|
| PR | vitest in-process | `.github/workflows/ci.yml` `eval` job | **No** | Hard fail when `attack-pass-rate < 1.0` or a mapped surface is missing red coverage |
| Nightly | vitest in-process | `.github/workflows/eval-nightly.yml` cron + `workflow_dispatch` | `MINIMAX_API_KEY` | Metrics report only; never fails the job |

The PR leg is intentionally **mocked** so that the gate is reproducible in CI
without secrets: it reuses the `vi.mock('../src/llm')` and `withToolResults`
seams already proven by `packages/agent-core/tests/runtime.test.ts`. The
nightly leg runs the same harness against the same corpus on real models to
surface mock-vs-real divergence.

## Shipped surface

The package ships today, on `main`, as the following files. Roles describe
what each file actually does in the working tree, not what a roadmap said it
would do.

| File | Role |
|------|------|
| `src/index.ts` | Public barrel. Re-exports `EvalCase`, `EvalCorpus`, `EvalSurface`, `InjectionKind`, `ExpectedGate`, the corpus loaders, the assertions, the metrics, and the `runEvalHarness` runner. |
| `src/corpus-schema.ts` | `ftth.eval-corpus.v1` zod envelope (`evalCaseSchema`, `evalCorpusSchema`); strict, literal-versioned, types the public surface used by every other file in this package. |
| `src/labels-schema.ts` | Label schema for the eval harness output; declares the canonical taxonomy the runner emits and the metrics report consumes. |
| `src/corpus-loader.ts` | Loads + zod-validates the JSON corpus with stable-ID dedup. Shared by tests, scripts, and the harness. |
| `src/runner.ts` | Drives `runAgent` per corpus entry with the mocked LLM seam and the `withToolResults` helper from `packages/agent-core/tests/runtime.test.ts`. The gate the PR leg enforces. |
| `src/assertions.ts` | Per-`expected` gate (allow / warn / abstain) plus surface-coverage report. The function the runner calls to know whether a corpus entry passed. |
| `src/metrics.ts` | Nightly report builder over DB rows. Counts cases by gate, surface, and injection kind; consumed by `scripts/metrics-report.ts`. |
| `src/verdict-log-writer.ts` | Writes the per-pr chat-route verdict log entries that the truth-gate and injection-defense pipelines gate on. Bridge between the eval harness and the chat route. |
| `corpus/pink.json` | Benign traffic covering each of the 7 mapped untrusted-input surfaces; `expectedGate: 'allow'` or `'warn'`. |
| `corpus/red.json` | Attack traffic covering each of the 7 `InjectionKind`s; `expectedGate: 'warn'` or `'abstain'`. |
| `scripts/backfill-verdict-log.ts` | Backfills the verdict log from the corpus for historical ranges; used by the P1.4 backfill job. |
| `scripts/metrics-report.ts` | Renders the nightly report to stdout; consumed by the `eval-nightly` job artifact upload. |

## Owning `precision` as the NOC

`precision` is `TBD` until a NOC tech lead labels `docs/validation/labels.csv` with the agent's factual claims against operator records. The wiring (zod schema, parser, metrics contract, nightly leg) is already shipped; the bottleneck is the CSV itself. See [`docs/validation/noc-labels-runbook.md`](../../docs/validation/noc-labels-runbook.md) for the format, the worked example, and the pre-commit sanity check.

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

## Next step

- **Out of scope.** This doc describes files only. No source, schema, gate
  threshold, corpus fixture, CI workflow file (`.github/workflows/ci.yml`,
  `.github/workflows/eval-nightly.yml`), spec, design document, or
  other-package README is touched by this doc-only change. If you want any
  of those changed, open a new SDD change.

- **Verify.** Confirm the shipped-surface table matches `ls packages/eval/src/`.
  If a file is renamed inside the package, this README needs a follow-up
  PR; the table is the source of truth the doc points reviewers at.
