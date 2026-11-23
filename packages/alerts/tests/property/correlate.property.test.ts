/**
 * Property-based invariants for `correlateAlerts` (`packages/alerts/src/correlate.ts`).
 *
 * Seed & bounds:
 *   - SEED = 20260923
 *   - RUNS = 200
 *
 * Note on pinned defect A-1:
 *   Candidate invariant A-1 ("correlateAlerts never mixes alerts of different tenants into one
 *   incident") is FALSE against the current source (`src/correlate.ts:27` groups solely by
 *   `${alert.deviceKind}:${alert.deviceId}` without `tenantId`, and `src/correlate.ts:48-51`
 *   copies `tenantId`/`connectionId` from `group[0]`). It is pinned below with `it.fails` so
 *   the suite stays green today and fails automatically once the defect is fixed.
 *
 * Refinements confirmed against source:
 *   - A-2..A-4 are evaluated on single-tenant alert streams so A-1's cross-tenant merging bug
 *     is not masked, and explicitly reflect `src/correlate.ts:26` skipping `status === 'resolved'`.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { correlateAlerts } from '../../src/correlate';
import type { AlertRecord } from '../../src/types';
import { NOW, alertRecordArb, deviceIdArb, deviceKindArb, findingKindArb } from './arbitraries';

const SEED = 20260923;
const RUNS = 200;

const singleTenantAlertsArb: fc.Arbitrary<AlertRecord[]> = fc.array(
  alertRecordArb({
    tenantId: fc.constant('tenant-a'),
    connectionId: fc.constant('conn-1'),
  }),
  { minLength: 0, maxLength: 30 },
);

function deviceKey(a: { deviceKind: string; deviceId: string }): string {
  return `${a.deviceKind}:${a.deviceId}`;
}

describe('correlateAlerts property-based invariants', () => {
  // Law A-1: correlateAlerts never merges alerts of two tenants sharing the same (deviceKind, deviceId) key.
  // Source defect: packages/alerts/src/correlate.ts:27 groups solely by `${alert.deviceKind}:${alert.deviceId}`
  // without tenantId, and :48-51 copies tenantId/connectionId from group[0].
  // Shrunk counterexample: two non-resolved alerts from 'tenant-a' and 'tenant-b' with distinct kinds
  // on the same device key (e.g. OLT:onu-1) merge into 1 incident instead of 0 under minKinds=2.
  it.fails(
    'A-1 (known defect, src/correlate.ts:27): correlateAlerts never mixes alerts of different tenants into one incident',
    () => {
      const crossTenantSameDeviceArb = fc
        .tuple(
          deviceKindArb,
          deviceIdArb,
          fc
            .tuple(findingKindArb, findingKindArb)
            .filter(([kindA, kindB]) => kindA !== kindB),
        )
        .chain(([deviceKind, deviceId, [kindA, kindB]]) =>
          fc.tuple(
            alertRecordArb({
              tenantId: fc.constant('tenant-a'),
              deviceKind: fc.constant(deviceKind),
              deviceId: fc.constant(deviceId),
              kind: fc.constant(kindA),
              status: fc.constantFrom('open', 'acknowledged'),
            }),
            alertRecordArb({
              tenantId: fc.constant('tenant-b'),
              deviceKind: fc.constant(deviceKind),
              deviceId: fc.constant(deviceId),
              kind: fc.constant(kindB),
              status: fc.constantFrom('open', 'acknowledged'),
            }),
          ),
        );

      fc.assert(
        fc.property(crossTenantSameDeviceArb, ([alertA, alertB]) => {
          // Each tenant only has 1 distinct finding kind, so under tenant isolation no incident can form.
          const incidents = correlateAlerts([alertA, alertB], { now: NOW, minKinds: 2 });
          expect(incidents).toHaveLength(0);
        }),
        { seed: SEED, numRuns: RUNS },
      );
    },
  );

  it('A-2: correlateAlerts requires minKinds distinct non-resolved finding kinds on a device and otherwise emits no incident', () => {
    fc.assert(
      fc.property(
        singleTenantAlertsArb,
        fc.option(fc.integer({ min: 1, max: 6 }), { nil: undefined }),
        (alerts, minKindsOpt) => {
          const effectiveMinKinds = minKindsOpt ?? 2;
          const incidents = correlateAlerts(
            alerts,
            minKindsOpt === undefined ? { now: NOW } : { now: NOW, minKinds: minKindsOpt },
          );

          const activeKindsByDevice = new Map<string, Set<string>>();
          for (const alert of alerts) {
            if (alert.status === 'resolved') continue;
            const key = deviceKey(alert);
            const kinds = activeKindsByDevice.get(key) ?? new Set<string>();
            kinds.add(alert.kind);
            activeKindsByDevice.set(key, kinds);
          }

          const expectedDeviceKeys = new Set(
            [...activeKindsByDevice.entries()]
              .filter(([, kinds]) => kinds.size >= effectiveMinKinds)
              .map(([key]) => key),
          );

          const actualDeviceKeys = incidents.map((inc) => deviceKey(inc));
          expect(incidents).toHaveLength(expectedDeviceKeys.size);
          expect(new Set(actualDeviceKeys)).toEqual(expectedDeviceKeys);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('A-3: incident severity equals the maximum severity among its non-resolved alerts', () => {
    fc.assert(
      fc.property(
        singleTenantAlertsArb,
        fc.integer({ min: 1, max: 4 }),
        (alerts, minKinds) => {
          const incidents = correlateAlerts(alerts, { now: NOW, minKinds });

          for (const incident of incidents) {
            const group = alerts.filter(
              (a) =>
                a.status !== 'resolved' &&
                a.deviceKind === incident.deviceKind &&
                a.deviceId === incident.deviceId,
            );
            const expectedSeverity = group.some((a) => a.severity === 'critical')
              ? 'critical'
              : 'warning';
            expect(incident.severity).toBe(expectedSeverity);
          }
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('A-4: incident firstSeenAt and lastSeenAt equal the minimum firstSeenAt and maximum lastSeenAt of its non-resolved alerts', () => {
    fc.assert(
      fc.property(
        singleTenantAlertsArb,
        fc.integer({ min: 1, max: 4 }),
        (alerts, minKinds) => {
          const incidents = correlateAlerts(alerts, { now: NOW, minKinds });

          for (const incident of incidents) {
            const group = alerts.filter(
              (a) =>
                a.status !== 'resolved' &&
                a.deviceKind === incident.deviceKind &&
                a.deviceId === incident.deviceId,
            );
            const expectedFirstMs = Math.min(...group.map((a) => a.firstSeenAt.getTime()));
            const expectedLastMs = Math.max(...group.map((a) => a.lastSeenAt.getTime()));

            expect(incident.firstSeenAt.getTime()).toBe(expectedFirstMs);
            expect(incident.lastSeenAt.getTime()).toBe(expectedLastMs);
            expect(incident.firstSeenAt.getTime()).toBeLessThanOrEqual(
              incident.lastSeenAt.getTime(),
            );
          }
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });
});
