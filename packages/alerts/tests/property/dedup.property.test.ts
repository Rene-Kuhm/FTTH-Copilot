/**
 * Property-based invariants for `reconcile` and `findingKey` (`packages/alerts/src/dedup.ts`).
 *
 * Seed & bounds:
 *   - SEED = 20260923
 *   - RUNS = 200
 *
 * Note on pinned defect A-5:
 *   Candidate invariant A-5 ("reconcile never emits a record whose tenantId differs from
 *   meta.tenantId") is FALSE against the current source (`src/dedup.ts:74,100,108,138`):
 *   `reconcile` matches `existing` by tenantless `findingKey` and spreads `{ ...prior, ... }`
 *   without verifying or stamping `meta.tenantId` / `meta.connectionId`. It is pinned below with
 *   `it.fails` so the suite stays green today and fails automatically once the defect is fixed.
 *
 * Refinements confirmed against source (`src/dedup.ts:9-11`):
 *   - `findingKey` is injective under the domain preconditions that `kind` is a `FindingKind`
 *     (none contain `:`) and `deviceKind` is a `DeviceKind` (`'OLT' | 'ONU'`, neither contains `:`),
 *     even when `deviceId` itself contains `:`.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { findingKey, reconcile } from '../../src/dedup';
import type { AlertRecord } from '../../src/types';
import {
  NOW,
  alertRecordArb,
  deviceKindArb,
  findingArb,
  findingKindArb,
} from './arbitraries';

const SEED = 20260923;
const RUNS = 200;

const deviceIdWithColonsArb = fc.string({ minLength: 1, maxLength: 24 });

const tripleArb = fc.record({
  kind: findingKindArb,
  deviceKind: deviceKindArb,
  deviceId: deviceIdWithColonsArb,
});

describe('dedup reconcile & findingKey property-based invariants', () => {
  // Law A-5: reconcile never emits a record whose tenantId differs from meta.tenantId.
  // Source defect: packages/alerts/src/dedup.ts:74 looks up existing.get(key) by tenantless findingKey,
  // and :100,108,138 spread prior/alert without verifying or overwriting tenantId from meta.
  // Shrunk counterexample: reconciling a Finding with meta.tenantId='tenant-a' against an existing Map
  // containing a 'tenant-b' AlertRecord on the same findingKey emits a record with tenantId='tenant-b'.
  it.fails(
    'A-5 (known defect, src/dedup.ts:74): reconcile never emits a record whose tenantId differs from meta.tenantId',
    () => {
      const crossTenantReconcileArb = fc.tuple(
        findingArb(),
        alertRecordArb({
          tenantId: fc.constant('tenant-b'),
          connectionId: fc.constant('conn-2'),
          status: fc.constantFrom('open', 'acknowledged'),
        }),
      );

      fc.assert(
        fc.property(crossTenantReconcileArb, ([finding, foreignAlert]) => {
          const collidingAlert: AlertRecord = {
            ...foreignAlert,
            kind: finding.kind,
            deviceKind: finding.deviceKind,
            deviceId: finding.deviceId,
          };
          const existing = new Map<string, AlertRecord>([[findingKey(finding), collidingAlert]]);

          const result = reconcile(
            [finding],
            existing,
            { tenantId: 'tenant-a', connectionId: 'conn-1' },
            { now: NOW, cooldownMs: 60_000 },
          );

          for (const record of [...result.toUpsert, ...result.toNotify]) {
            expect(record.tenantId).toBe('tenant-a');
          }
        }),
        { seed: SEED, numRuns: RUNS },
      );
    },
  );

  it('A-7: findingKey is stable and injective over distinct (kind, deviceKind, deviceId) triples', () => {
    fc.assert(
      fc.property(tripleArb, tripleArb, (a, b) => {
        // Stability (determinism)
        expect(findingKey(a)).toBe(findingKey({ ...a }));

        // Injectivity over valid FindingKind / DeviceKind triples, even with colons in deviceId
        const sameTriple =
          a.kind === b.kind && a.deviceKind === b.deviceKind && a.deviceId === b.deviceId;
        expect(findingKey(a) === findingKey(b)).toBe(sameTriple);
      }),
      { seed: SEED, numRuns: RUNS },
    );
  });
});
