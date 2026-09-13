import { describe, expect, it } from 'vitest';
import { classifyChatError } from '../../../lib/chat/error-classifier';

function makeError(message: string): Error {
  return new Error(message);
}

describe('classifyChatError — no LLM configured', () => {
  it('matches the standard Spanish message from createLlmClient', () => {
    const r = classifyChatError(
      makeError(
        'No hay proveedor LLM configurado. Definí LLM_PROVIDER (minimax|deepseek|qwen) o LLM_FALLBACK=minimax,deepseek,qwen en el .env con sus API keys.',
      ),
    );
    expect(r.kind).toBe('no-llm-configured');
    expect(r.status).toBe(503);
    expect(r.userMessage).toContain('No hay proveedor de IA configurado');
    expect(r.userMessage).toContain('LLM_PROVIDER');
  });

  it('matches English variants (case-insensitive)', () => {
    const r = classifyChatError(makeError('No LLM provider configured.'));
    expect(r.kind).toBe('no-llm-configured');
    expect(r.status).toBe(503);
  });

  it('matches the placeholder hint', () => {
    expect(classifyChatError(makeError('configure llm provider')).kind).toBe(
      'no-llm-configured',
    );
  });
});

describe('classifyChatError — LLM upstream failure', () => {
  it('maps rate limit to llm-upstream-failure', () => {
    const r = classifyChatError(makeError('anthropic rate limit exceeded'));
    expect(r.kind).toBe('llm-upstream-failure');
    expect(r.status).toBe(502);
  });

  it('maps auth failures to llm-upstream-failure', () => {
    const r = classifyChatError(
      makeError('401 unauthorized: api key invalid'),
    );
    expect(r.kind).toBe('llm-upstream-failure');
  });

  it('maps network errors to llm-upstream-failure', () => {
    expect(classifyChatError(makeError('fetch failed: ECONNRESET')).kind).toBe(
      'llm-upstream-failure',
    );
    expect(classifyChatError(makeError('request timeout after 30s')).kind).toBe(
      'llm-upstream-failure',
    );
  });
});

describe('classifyChatError — agent aborted', () => {
  it('maps TruthGate abstention to agent-aborted', () => {
    const r = classifyChatError(
      makeError('TruthGate tripped in strict mode: incomplete verdict'),
    );
    expect(r.kind).toBe('agent-aborted');
    expect(r.status).toBe(422);
  });

  it('maps iteration budget exhaustion to agent-aborted', () => {
    const r = classifyChatError(makeError('iteration budget exhausted'));
    expect(r.kind).toBe('agent-aborted');
    expect(r.status).toBe(422);
  });
});

describe('classifyChatError — fallback', () => {
  it('returns unexpected for unclassified messages', () => {
    const r = classifyChatError(makeError('something completely unrelated'));
    expect(r.kind).toBe('unexpected');
    expect(r.status).toBe(502);
  });

  it('handles non-Error throws', () => {
    expect(classifyChatError('a string error').kind).toBe('unexpected');
    expect(classifyChatError({ code: 500 }).kind).toBe('unexpected');
    expect(classifyChatError(null).kind).toBe('unexpected');
  });

  it('is case-insensitive', () => {
    expect(
      classifyChatError(makeError('RATE LIMIT EXCEEDED')).kind,
    ).toBe('llm-upstream-failure');
  });

  it('is pure — same input yields the same classification', () => {
    const e = makeError('rate limit');
    expect(classifyChatError(e)).toEqual(classifyChatError(e));
  });

  it('preserves the original message in the user-facing string', () => {
    const r = classifyChatError(makeError('rate limit exceeded'));
    expect(r.userMessage).toContain('proveedor de IA rechazó');
  });
});
