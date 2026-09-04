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
