import { describe, expect, it } from 'vitest';
import {
  BM25_B,
  BM25_K1,
  BM25_STOPWORDS,
  BM25_STOPWORDS_FULL,
  TOKEN_REGEX,
  scoreBM25,
  scoreCorpus,
  tokenize,
} from '../src/bm25-lite';
import golden from './fixtures/bm25-golden.json';

describe('BM25Lite — constants', () => {
  it('locks k1 = 1.5 and b = 0.75 (design-locked ranking parameters)', () => {
    expect(BM25_K1).toBe(1.5);
    expect(BM25_B).toBe(0.75);
  });

  it('locks the trimmed Spanish stop-word list byte-identically', () => {
    expect(BM25_STOPWORDS).toEqual([
      'a', 'al', 'con', 'de', 'del', 'el', 'en', 'es', 'la', 'las', 'le',
      'les', 'lo', 'los', 'más', 'me', 'mi', 'mis', 'no', 'nos', 'o', 'para',
      'pero', 'por', 'que', 'se', 'sin', 'sobre', 'su', 'un', 'una', 'y',
    ]);
  });

  it('exposes the Phase-2 full stop-word list as a superset of the trimmed one', () => {
    expect(BM25_STOPWORDS_FULL.length).toBeGreaterThan(BM25_STOPWORDS.length);
    for (const word of BM25_STOPWORDS) {
      expect(BM25_STOPWORDS_FULL).toContain(word);
    }
  });
});

describe('BM25Lite — tokenize', () => {
  it('drops stop-words and lowercases', () => {
    expect(tokenize('La ONU caída')).toEqual(['onu', 'caída']);
  });

  it('preserves accented characters and ñ', () => {
    expect(tokenize('Señal áéíóú del ONU')).toEqual(['señal', 'áéíóú', 'onu']);
  });

  it('splits on punctuation and keeps digits', () => {
    expect(tokenize('ONU-1234, rx=-27.5 dBm')).toEqual([
      'onu', '1234', 'rx', '27', '5', 'dbm',
    ]);
  });

  it('returns [] for text made only of stop-words', () => {
    expect(tokenize('de la el y')).toEqual([]);
  });

  it('TOKEN_REGEX accepts a valid token and rejects punctuation', () => {
    expect(TOKEN_REGEX.test('caída')).toBe(true);
    expect(TOKEN_REGEX.test('rx-1')).toBe(false);
  });
});

describe('BM25Lite — scoreBM25', () => {
  it('returns 0 for an empty query', () => {
    expect(scoreBM25([], ['rx', 'bajo'], 4)).toBe(0);
  });

  it('returns 0 for an empty document', () => {
    expect(scoreBM25(['rx'], [], 4)).toBe(0);
  });

  it('returns 0 when the query/document intersection is empty', () => {
    expect(scoreBM25(['corte'], ['rx', 'bajo', 'onu'], 4)).toBe(0);
  });

  it('scores a matching term with the locked saturation formula', () => {
    // tf = 1, dl = 4, avgDocLen = 4 -> 1*2.5/(1 + 1.5*1) = 1.0
    expect(scoreBM25(['rx'], ['rx', 'bajo', 'onu', 'fibra'], 4)).toBeCloseTo(1.0, 6);
  });

  it('saturates repeated term frequency (tf=2 scores less than 2x tf=1)', () => {
    const once = scoreBM25(['rx'], ['rx', 'a', 'b', 'c'], 4);
    const twice = scoreBM25(['rx'], ['rx', 'rx', 'b', 'c'], 4);
    expect(twice).toBeGreaterThan(once);
    expect(twice).toBeLessThan(2 * once);
  });

  it('counts a duplicated query term only once', () => {
    const doc = ['rx', 'bajo', 'onu', 'fibra'];
    expect(scoreBM25(['rx', 'rx'], doc, 4)).toBeCloseTo(scoreBM25(['rx'], doc, 4), 6);
  });
});

describe('BM25Lite — golden corpus', () => {
  const docs = golden.docs.map((d) => ({ tokens: d.tokens }));

  for (const query of golden.queries) {
    it(`matches golden scores for query [${query.tokens.join(', ')}]`, () => {
      const scores = scoreCorpus(query.tokens, docs);
      expect(scores).toHaveLength(golden.docs.length);
      scores.forEach((score, i) => {
        expect(score).toBeCloseTo(query.scores[i]!, 6);
      });
    });

    it(`matches golden ranking for query [${query.tokens.join(', ')}]`, () => {
      const scores = scoreCorpus(query.tokens, docs);
      const ranking = golden.docs
        .map((d, i) => ({ id: d.id, score: scores[i]! }))
        .sort((a, b) => b.score - a.score)
        .map((r) => r.id);
      expect(ranking).toEqual(query.ranking);
    });
  }

  it('returns one score per document, including zero-overlap documents', () => {
    const scores = scoreCorpus(['rx', 'bajo'], docs);
    expect(scores).toHaveLength(4);
    expect(scores[3]).toBe(0);
  });

  it('returns [] for an empty corpus', () => {
    expect(scoreCorpus(['rx'], [])).toEqual([]);
  });
});
