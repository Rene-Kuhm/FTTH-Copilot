import { describe, expect, it } from 'vitest';
import { JOB_NAMES } from '@ftth-copilot/jobs';
import { JOB_HANDLERS, registeredJobNames } from '../src/registry';

/**
 * The registry is empty on purpose (the worker ships before the work does),
 * but it must stay *explicit*: a handler map that silently grows by accident
 * is a wiring bug nobody can see.
 */
describe('job handler registry', () => {
  it('starts empty — no job is wired yet', () => {
    expect(registeredJobNames()).toEqual([]);
  });

  it('has no handler for any known job name', () => {
    for (const name of Object.values(JOB_NAMES)) {
      expect(Object.prototype.hasOwnProperty.call(JOB_HANDLERS, name)).toBe(false);
    }
  });

  it('only exposes keys that are known job names', () => {
    const known = new Set<string>(Object.values(JOB_NAMES));

    for (const name of registeredJobNames()) {
      expect(known.has(name)).toBe(true);
    }
  });
});
