import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  DeviceKind as SharedDeviceKind,
  StatusSample as SharedStatusSample,
} from '@ftth-copilot/shared';
import * as Detection from '../src/index';

describe('detection domain type re-exports', () => {
  it('re-exports DeviceKind and StatusSample identically to @ftth-copilot/shared', () => {
    expectTypeOf<Detection.DeviceKind>().toEqualTypeOf<SharedDeviceKind>();
    expectTypeOf<Detection.StatusSample>().toEqualTypeOf<SharedStatusSample>();

    const sample: Detection.StatusSample = { t: 1_752_000_000_000, status: 'online' };
    const sharedSample: SharedStatusSample = sample;
    expect(sharedSample).toEqual({ t: 1_752_000_000_000, status: 'online' });
  });
});
