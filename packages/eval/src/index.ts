// Phase F-2: skeleton + corpus schema. Phase F-4 adds the runner /
// assertions / metrics modules. The barrel re-exports the schema and
// its inferred types so downstream consumers (F-4 runner, F-5 writer,
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
