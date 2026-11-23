import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  DeviceKind as PrismaDeviceKind,
  MetricKind as PrismaMetricKind,
} from '@ftth-copilot/db';
import {
  DEVICE_KINDS,
  METRIC_KINDS,
  type DeviceKind as SharedDeviceKind,
  type DeviceStatus as SharedDeviceStatus,
  type MetricKind as SharedMetricKind,
  type SampleMeta as SharedSampleMeta,
  type StatusSample as SharedStatusSample,
} from '@ftth-copilot/shared';
import type {
  DeviceKind as AnalyticsDeviceKind,
  DeviceStatus as AnalyticsDeviceStatus,
  MetricKind as AnalyticsMetricKind,
  SampleMeta as AnalyticsSampleMeta,
  StatusSample as AnalyticsStatusSample,
} from '../src/index';

describe('canonical domain contracts — Prisma enum anti-drift guard', () => {
  it('keeps Shared DeviceKind in exact runtime sync with Prisma DeviceKind enum', () => {
    const sharedValues = new Set<string>(DEVICE_KINDS);
    const prismaValues = new Set<string>(Object.values(PrismaDeviceKind));

    expect(DEVICE_KINDS).toHaveLength(sharedValues.size);
    expect(sharedValues).toEqual(prismaValues);
  });

  it('keeps Shared MetricKind in exact runtime sync with Prisma MetricKind enum', () => {
    const sharedValues = new Set<string>(METRIC_KINDS);
    const prismaValues = new Set<string>(Object.values(PrismaMetricKind));

    expect(METRIC_KINDS).toHaveLength(sharedValues.size);
    expect(sharedValues).toEqual(prismaValues);
  });

  it('keeps Shared union types identical to Prisma enum types at the type level', () => {
    expectTypeOf<SharedDeviceKind>().toEqualTypeOf<`${PrismaDeviceKind}`>();
    expectTypeOf<SharedMetricKind>().toEqualTypeOf<`${PrismaMetricKind}`>();
  });

  it('re-exports DeviceKind, MetricKind, DeviceStatus, SampleMeta, and StatusSample from analytics without changing types', () => {
    expectTypeOf<AnalyticsDeviceKind>().toEqualTypeOf<SharedDeviceKind>();
    expectTypeOf<AnalyticsMetricKind>().toEqualTypeOf<SharedMetricKind>();
    expectTypeOf<AnalyticsDeviceStatus>().toEqualTypeOf<SharedDeviceStatus>();
    expectTypeOf<AnalyticsSampleMeta>().toEqualTypeOf<SharedSampleMeta>();
    expectTypeOf<AnalyticsStatusSample>().toEqualTypeOf<SharedStatusSample>();
  });
});
