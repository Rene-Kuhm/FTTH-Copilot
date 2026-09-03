/**
 * BM25Lite — Fase D sparse-first scorer (pure TypeScript, no Prisma).
 *
 * Ranks confirmed incidents against an operator query using BM25 term
 * saturation with the design-locked parameters `k1 = 1.5`, `b = 0.75`.
 * Tokenization is locked at write time (`ConfirmedIncident.searchTokens`)
 * so later parameter changes never retroactively re-rank history.
 *
 * The scorer is intentionally IDF-free: the corpus is a per-tenant top-5
 * window (≤ a few hundred rows), so document-frequency weighting adds
 * variance without improving the ranking the spec asks for. Phase 2 merges
 * a dense list through RRF instead of changing this function.
 */

/** Design-locked term-frequency saturation parameter. */
export const BM25_K1 = 1.5;

/** Design-locked length-normalization parameter. */
export const BM25_B = 0.75;

/** A candidate substring is a token only when it matches this regex. */
export const TOKEN_REGEX = /^[a-záéíóúñ0-9]+$/;

/** Everything that is not a token character is a separator. */
const SPLIT_REGEX = /[^a-záéíóúñ0-9]+/;

/**
 * Locked trimmed Spanish stop-word list dropped by `tokenize()` today.
 *
 * Source: `design.md` "Trimmed ~30-word core", plus `le` and `les`, which
 * the spec's `BM25Lite scorer` requirement enumerates explicitly as
 * MUST-drop words. Sorted, lowercase, no duplicates — the array order is
 * snapshot-locked by `tests/bm25-lite.test.ts`.
 */
export const BM25_STOPWORDS: readonly string[] = [
  'a', 'al', 'con', 'de', 'del', 'el', 'en', 'es', 'la', 'las', 'le',
  'les', 'lo', 'los', 'más', 'me', 'mi', 'mis', 'no', 'nos', 'o', 'para',
  'pero', 'por', 'que', 'se', 'sin', 'sobre', 'su', 'un', 'una', 'y',
];

/**
 * Full Spanish stop-word list reserved for the Phase 2 tokenizer swap.
 * Exported so Phase 2 can widen the filter without re-locking the trimmed
 * set that historical `searchTokens` were written with.
 */
export const BM25_STOPWORDS_FULL: readonly string[] = [
  ...BM25_STOPWORDS,
  'algo', 'ante', 'antes', 'como', 'contra', 'desde', 'donde', 'durante',
  'entre', 'esa', 'ese', 'esta', 'este', 'fue', 'ha', 'hasta', 'mucho',
  'muy', 'nada', 'ni', 'nuestra', 'nuestras', 'nuestro', 'nuestros', 'os',
  'otra', 'otro', 'otros', 'poco', 'porque', 'quien', 'sea', 'ser', 'si',
  'sido', 'son', 'sus', 'también', 'tanto', 'te', 'tu', 'tus', 'unas',
  'unos', 'vosotras', 'vosotros', 'vuestro', 'ya', 'yo',
];

const STOPWORD_SET = new Set(BM25_STOPWORDS);

/**
 * Lowercases, splits on non-token characters, and drops stop-words.
 * Deterministic: same text always yields the same token stream.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(SPLIT_REGEX)
    .filter((token) => TOKEN_REGEX.test(token) && !STOPWORD_SET.has(token));
}

/**
 * BM25 score of one document against one query.
 *
 * `score = Σ_{t ∈ distinct(q)} tf(t,d) * (k1 + 1) / (tf(t,d) + k1 * (1 - b + b * |d| / avgDocLen))`
 *
 * Returns `0` when either side is empty or the intersection is empty.
 */
export function scoreBM25(
  queryTokens: string[],
  docTokens: string[],
  avgDocLen: number,
  k1: number = BM25_K1,
  b: number = BM25_B,
): number {
  if (queryTokens.length === 0 || docTokens.length === 0) return 0;

  const docLen = docTokens.length;
  const avgLen = avgDocLen > 0 ? avgDocLen : docLen;
  const norm = k1 * (1 - b + (b * docLen) / avgLen);

  const frequencies = new Map<string, number>();
  for (const token of docTokens) {
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }

  let score = 0;
  for (const term of new Set(queryTokens)) {
    const tf = frequencies.get(term) ?? 0;
    if (tf === 0) continue;
    score += (tf * (k1 + 1)) / (tf + norm);
  }
  return score;
}

/**
 * Scores a whole corpus of pre-tokenized documents against one query,
 * deriving `avgDocLen` from the corpus itself. Returns one score per
 * document, in input order (index-aligned with `docs`).
 */
export function scoreCorpus(
  queryTokens: string[],
  docs: { tokens: string[] }[],
): number[] {
  if (docs.length === 0) return [];
  const totalLen = docs.reduce((sum, doc) => sum + doc.tokens.length, 0);
  const avgDocLen = totalLen / docs.length;
  return docs.map((doc) => scoreBM25(queryTokens, doc.tokens, avgDocLen));
}
