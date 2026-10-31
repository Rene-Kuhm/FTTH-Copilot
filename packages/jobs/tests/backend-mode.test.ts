import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BACKEND_MODES,
  DEFAULT_BACKEND_MODE,
  backendMode,
  workerOwnsBackgroundWork,
} from '../src/backend-mode';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('backendMode', () => {
  it('defaults to embedded, the behavior of today', () => {
    expect(DEFAULT_BACKEND_MODE).toBe(BACKEND_MODES.embedded);
    expect(backendMode({})).toBe(BACKEND_MODES.embedded);
  });

  it('reads the flag', () => {
    expect(backendMode({ BACKEND_MODE: 'worker' })).toBe(BACKEND_MODES.worker);
    expect(backendMode({ BACKEND_MODE: 'embedded' })).toBe(BACKEND_MODES.embedded);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(backendMode({ BACKEND_MODE: '  WORKER ' })).toBe(BACKEND_MODES.worker);
  });

  it('falls back to embedded for an unknown value and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(backendMode({ BACKEND_MODE: 'distributed' })).toBe(BACKEND_MODES.embedded);
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe('workerOwnsBackgroundWork', () => {
  it('is false in embedded mode and true in worker mode', () => {
    expect(workerOwnsBackgroundWork({ BACKEND_MODE: 'embedded' })).toBe(false);
    expect(workerOwnsBackgroundWork({ BACKEND_MODE: 'worker' })).toBe(true);
  });

  it('is false when the flag is not set', () => {
    expect(workerOwnsBackgroundWork({})).toBe(false);
  });
});
