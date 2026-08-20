/**
 * Compile-time smoke test for the INmsConnector interface.
 * This file doesn't exercise implementations — it just ensures the
 * shared interface compiles and is structurally usable from tests.
 */
import { describe, it, expect } from 'vitest';
import type {
  INmsConnector,
  OltSummary,
  OnuSummary,
  NetworkOverview,
} from '../src';

describe('INmsConnector interface shape', () => {
  it('declares the required methods', () => {
    // This is a TypeScript-only assertion at compile time. At runtime we
    // just verify the type symbols exist by importing them.
    const requiredKeys: Array<keyof INmsConnector> = [
      'providerName',
      'ping',
      'listOlts',
      'getOltDetail',
      'getNetworkOverview',
      'listOnus',
      'getOnuDetail',
      'getOnusWithLowSignal',
    ];
    expect(requiredKeys).toHaveLength(8);
  });

  it('OltSummary has the expected fields', () => {
    const olt: OltSummary = {
      id: 'OLT-X',
      name: 'Test OLT',
      ip: '10.0.0.1',
      status: 'online',
    };
    expect(olt.id).toBe('OLT-X');
    expect(olt.status).toBe('online');
  });

  it('OnuSummary can be marked offline', () => {
    const onu: OnuSummary = {
      id: 'ONU-X',
      serial: 'SN-X',
      oltId: 'OLT-X',
      status: 'offline',
    };
    expect(onu.status).toBe('offline');
  });

  it('NetworkOverview numeric fields are integers', () => {
    const overview: NetworkOverview = {
      totalOlts: 1,
      oltsOnline: 1,
      totalOnus: 1,
      onusOnline: 1,
      onusOffline: 0,
      averageUptimeSeconds: 0,
      oltsWithHighTemperature: 0,
    };
    expect(Number.isInteger(overview.totalOlts)).toBe(true);
  });
});
