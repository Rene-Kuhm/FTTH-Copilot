import { describe, expect, it } from 'vitest';
import * as Shared from '../src/index';

describe('shared canonical optical constants', () => {
  it('exports DEFAULT_DEGRADED_RX_THRESHOLD_DBM as -27', () => {
    expect(Shared.DEFAULT_DEGRADED_RX_THRESHOLD_DBM).toBe(-27);
    expect(String(Shared.DEFAULT_DEGRADED_RX_THRESHOLD_DBM)).toBe('-27');
  });
});
