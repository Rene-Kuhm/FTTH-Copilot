import { describe, expect, it } from 'vitest';
import { classifyUnwrapped } from '../src/truth-gate';

describe('classifyUnwrapped', () => {
  it.each(['list_olts', 'get_olt_detail', 'list_onus', 'unknown_tool'])(
    'returns no-envelope incomplete verdict for tool %s',
    (toolName) => {
      const verdict = classifyUnwrapped(toolName);
      expect(verdict).toEqual({
        toolName,
        code: 'incomplete',
        reason: 'no-envelope',
        severity: 'critical',
      });
    },
  );

  it('does not throw when toolName is empty', () => {
    const verdict = classifyUnwrapped('');
    expect(verdict.toolName).toBe('');
    expect(verdict.code).toBe('incomplete');
    expect(verdict.reason).toBe('no-envelope');
    expect(verdict.severity).toBe('critical');
  });
});