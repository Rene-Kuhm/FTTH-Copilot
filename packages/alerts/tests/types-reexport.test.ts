import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  DeviceKind as SharedDeviceKind,
  DeviceStatus as SharedDeviceStatus,
  MetricKind as SharedMetricKind,
} from '@ftth-copilot/shared';
import * as Alerts from '../src/index';

describe('alerts domain type re-exports', () => {
  it('re-exports DeviceKind, MetricKind, and DeviceStatus identically to shared', () => {
    expectTypeOf<Alerts.DeviceKind>().toEqualTypeOf<SharedDeviceKind>();
    expectTypeOf<Alerts.MetricKind>().toEqualTypeOf<SharedMetricKind>();
    expectTypeOf<Alerts.DeviceStatus>().toEqualTypeOf<SharedDeviceStatus>();
  });

  it('does not expose SampleMeta in alerts public API', () => {
    expect(Object.keys(Alerts)).not.toContain('SampleMeta');
    expect(typeof Alerts.groupRows).toBe('function');
  });
});
