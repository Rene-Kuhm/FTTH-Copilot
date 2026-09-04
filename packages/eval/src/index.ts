// Phase F-2: skeleton + corpus schema. Phase F-4 adds the corpus-loader /
// runner / assertions / metrics modules. The barrel re-exports the schema
// and its inferred types so downstream consumers (F-4 runner, F-5 writer,
// nightly metrics) can pin to a single import path.
export {
  EVAL_CORPUS_SCHEMA,
  EVAL_CORPUS_VERSION,
  evalCaseSchema,
  evalCorpusSchema,
  evalSurfaceSchema,
  expectedGateSchema,
  injectionKindSchema,
  toolMockSchema,
  type EvalCase,
  type EvalCorpus,
  type EvalSurface,
  type ExpectedGate,
  type InjectionKind,
  type ToolMock,
} from './corpus-schema';

// Phase F-4.1 — corpus loader. Read paths are async (Promise<EvalCorpus>)
// for forward-compatibility with S3/HTTP; pink/red convenience wrappers
// stay synchronous because their backing store is the in-memory JSON
// import.
export {
  CorpusLoadError,
  loadCorpus,
  loadPinkCorpus,
  loadRedCorpus,
} from './corpus-loader';

// Phase F-4.2 — runner + assertions. The runner drives `runAgent` per
// corpus entry with mocked deps; the assertions layer computes the
// attack-pass-rate + surface coverage + injection-kind coverage and
// throws a typed `AssertionFailure` when the strict contract is
// breached. The nightly leg consumes the same primitives.
export {
  runCase,
  runCorpus,
  caseToRunAgentOptions,
  computeGateDecision,
  type GateDecision,
  type EvalRunResult,
  type EvalRunSummary,
  type RunnerDeps,
} from './runner';
export {
  AssertionFailure,
  attackPassRate,
  assertAttackPassRateIsOne,
  assertCoverage,
  assertInjectionKindsCovered,
  injectionKindsCoverage,
  surfaceCoverage,
} from './assertions';

// Phase F-4.3 — nightly metrics. Pure functions over EvalRunSummary /
// EvalCorpus. Precision returns `null` until the NOC tech lead labels
// `docs/validation/agent-qa-log.md` (decision #6: precision TBD).
// `computeInjectionSuspicionTotal` counts `injectionSuspicion === true`
// verdict-log entries per tenant and code (AD-11).
export {
  computeAbstentionRate,
  computeCoverage,
  computeGateFalsePositives,
  computeInjectionSuspicionTotal,
  computePrecision,
  type InjectionSuspicionTotal,
  type PrecisionLabel,
  type PrecisionLabels,
  type VerdictLogEntry,
} from './metrics';

// Phase F-5.1 — verdict-log writer (pure TS, no DB). Builds
// `VerdictLogEntryInput` rows from `Verdict[]` (one per verdict) with the
// `injectionSuspicion` denormalized fast-filter bit pre-stamped. The
// chat route (F-5.2) consumes the builder; the F-4 nightly leg consumes
// the same builder for recompute / metrics. `serializeVerdictLogEntries`
// is the JSON fallback path for the `agentActionLog.parameters` JSON
// column when Prisma is unavailable.
export {
  buildVerdictLogEntries,
  isInjectionSuspicionCode,
  serializeVerdictLogEntries,
  type BuildVerdictLogEntriesOpts,
  type VerdictLogEntryInput,
} from './verdict-log-writer';

// Phase F-7.1 — labels CSV schema + parser. The NOC tech lead fills in
// `docs/validation/labels.csv` row-by-row (one row per QA question /
// corpus case). The schema is strict so the wire format can never drift
// across the CSV ↔ parser ↔ metrics-report boundary. `parseLabelsCsv`
// is pure (string → rows); `loadLabelsFromFile` is the async I/O wrapper
// the nightly leg consumes. `LabelsParseError` carries the offending
// `rowIndex` (0 = header, 1..N = data rows) so PR logs can grep on it.
export {
  LABELS_CSV_HEADER,
  LabelsParseError,
  labelsCsvSchema,
  loadLabelsFromFile,
  parseLabelsCsv,
  type LabelRow,
} from './labels-schema';

