/**
 * Property-based invariants for `@ftth-copilot/detection` pure detectors.
 *
 * Reproducibility: every property uses an explicit fixed seed (`SEED = 20260923`)
 * and bounded run count (`RUNS = 200`). Override `PBT_SEED` only for local
 * debugging; default runs are strictly deterministic.
 *
 * All fixtures are 100% synthetic (`onu-prop-*`, `olt-prop-*`) and every
 * detector call injects an explicit `now` timestamp.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DAY_MS,
  detectBaselineAnomaly,
  detectFecDegradation,
  detectFlapping,
  detectLosEvents,
  detectOpticalDegradation,
  detectRebootStorm,
  detectSignalDrift,
  detectTemperatureDrift,
  detectTrafficAnomaly,
  type DeviceKind,
  type Finding,
  type FindingKind,
  type NumericSample,
  type StatusSample,
  type UptimeSample,
} from '../../src';

const VALID_FINDING_KINDS: readonly FindingKind[] = [
  'predicted_low_signal',
  'predicted_high_temperature',
  'intermittent_connection',
  'frequent_reboots',
  'metric_anomaly',
  'fec_degradation',
  'optical_degradation',
  'traffic_anomaly',
];

const SEED = Number(process.env.PBT_SEED ?? 20260923);
const RUNS = 200;

const MIN_NOW = 1_700_000_000_000;
const MAX_NOW = 1_800_000_000_000;

const deviceKindArb = fc.constantFrom<DeviceKind>('OLT', 'ONU');
const deviceIdArb = fc.constantFrom('onu-prop-01', 'onu-prop-02', 'olt-prop-01');
const injectedNowArb = fc.integer({ min: MIN_NOW, max: MAX_NOW });

const numericValueArb = fc
  .double({ min: -1e4, max: 1e4, noNaN: true })
  .map((v) => (Object.is(v, -0) ? 0 : v));

function numericSamplesForNowArb(
  now: number,
  minLength = 0,
  maxLength = 25,
): fc.Arbitrary<NumericSample[]> {
  return fc.array(
    fc.record({
      t: fc.integer({ min: now - 14 * DAY_MS, max: now + DAY_MS }),
      v: numericValueArb,
    }),
    { minLength, maxLength },
  );
}

function statusSamplesForNowArb(
  now: number,
  minLength = 0,
  maxLength = 25,
): fc.Arbitrary<StatusSample[]> {
  return fc.array(
    fc.record({
      t: fc.integer({ min: now - 3 * DAY_MS, max: now }),
      status: fc.constantFrom<'online' | 'offline' | 'degraded'>(
        'online',
        'offline',
        'degraded',
      ),
    }),
    { minLength, maxLength },
  );
}

function uptimeSamplesForNowArb(
  now: number,
  minLength = 0,
  maxLength = 25,
): fc.Arbitrary<UptimeSample[]> {
  return fc.array(
    fc.record({
      t: fc.integer({ min: now - 3 * DAY_MS, max: now }),
      uptimeSeconds: fc.integer({ min: 0, max: 10_000_000 }),
    }),
    { minLength, maxLength },
  );
}

function assertValidFinding(
  finding: Finding | null,
  deviceKind: DeviceKind,
  deviceId: string,
  now: number,
): void {
  if (finding === null) return;
  expect(typeof finding.id).toBe('string');
  expect(finding.id.length).toBeGreaterThan(0);
  expect(VALID_FINDING_KINDS).toContain(finding.kind);
  expect(['warning', 'critical']).toContain(finding.severity);
  expect(finding.deviceKind).toBe(deviceKind);
  expect(finding.deviceId).toBe(deviceId);
  expect(typeof finding.title).toBe('string');
  expect(finding.title.length).toBeGreaterThan(0);
  expect(typeof finding.description).toBe('string');
  expect(finding.description.length).toBeGreaterThan(0);
  expect(finding.detectedAt).toBe(new Date(now).toISOString());
  if (finding.etaMs !== undefined) {
    expect(Number.isFinite(finding.etaMs)).toBe(true);
    expect(finding.etaMs).toBeGreaterThan(0);
  }
  if (finding.confidence !== undefined) {
    expect(Number.isFinite(finding.confidence)).toBe(true);
    expect(finding.confidence).toBeGreaterThanOrEqual(0);
    expect(finding.confidence).toBeLessThanOrEqual(1);
  }
}

describe('pure detector properties', () => {
  it('D7: every detector returns null or a valid Finding and never throws for arbitrary, empty, and single-element sample arrays', () => {
    const inputArb = injectedNowArb.chain((now) =>
      fc.record({
        now: fc.constant(now),
        deviceKind: deviceKindArb,
        deviceId: deviceIdArb,
        numA: numericSamplesForNowArb(now, 0, 25),
        numB: numericSamplesForNowArb(now, 0, 25),
        statuses: statusSamplesForNowArb(now, 0, 25),
        uptimes: uptimeSamplesForNowArb(now, 0, 25),
      }),
    );

    fc.assert(
      fc.property(
        inputArb,
        ({ now, deviceKind, deviceId, numA, numB, statuses, uptimes }) => {
          const findings = [
            detectSignalDrift(deviceKind, deviceId, numA, { now }),
            detectTemperatureDrift(deviceKind, deviceId, numA, { now }),
            detectFlapping(deviceKind, deviceId, statuses, { now }),
            detectRebootStorm(deviceKind, deviceId, uptimes, { now }),
            detectBaselineAnomaly(deviceKind, deviceId, numA, { now }),
            detectFecDegradation(deviceKind, deviceId, numA, numB, { now }),
            detectOpticalDegradation(deviceKind, deviceId, numA, numB, { now }),
            detectLosEvents(deviceKind, deviceId, numA, { now }),
            detectTrafficAnomaly(deviceKind, deviceId, numA, { now }),
          ];

          for (const finding of findings) {
            assertValidFinding(finding, deviceKind, deviceId, now);
          }
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );

    // Explicit edge check for empty and single-element inputs across all detectors.
    fc.assert(
      fc.property(
        injectedNowArb,
        deviceKindArb,
        deviceIdArb,
        numericValueArb,
        (now, deviceKind, deviceId, value) => {
          const singleNum: NumericSample[] = [{ t: now, v: value }];
          const singleStatus: StatusSample[] = [{ t: now, status: 'offline' }];
          const singleUptime: UptimeSample[] = [{ t: now, uptimeSeconds: 100 }];

          const edgeFindings = [
            detectSignalDrift(deviceKind, deviceId, [], { now }),
            detectSignalDrift(deviceKind, deviceId, singleNum, { now }),
            detectTemperatureDrift(deviceKind, deviceId, [], { now }),
            detectTemperatureDrift(deviceKind, deviceId, singleNum, { now }),
            detectFlapping(deviceKind, deviceId, [], { now }),
            detectFlapping(deviceKind, deviceId, singleStatus, { now }),
            detectRebootStorm(deviceKind, deviceId, [], { now }),
            detectRebootStorm(deviceKind, deviceId, singleUptime, { now }),
            detectBaselineAnomaly(deviceKind, deviceId, [], { now }),
            detectBaselineAnomaly(deviceKind, deviceId, singleNum, { now }),
            detectFecDegradation(deviceKind, deviceId, [], [], { now }),
            detectFecDegradation(deviceKind, deviceId, singleNum, singleNum, { now }),
            detectOpticalDegradation(deviceKind, deviceId, [], [], { now }),
            detectOpticalDegradation(deviceKind, deviceId, singleNum, singleNum, { now }),
            detectLosEvents(deviceKind, deviceId, [], { now }),
            detectLosEvents(deviceKind, deviceId, singleNum, { now }),
            detectTrafficAnomaly(deviceKind, deviceId, [], { now }),
            detectTrafficAnomaly(deviceKind, deviceId, singleNum, { now }),
          ];

          for (const finding of edgeFindings) {
            expect(finding).toBeNull();
          }
        },
      ),
      { seed: SEED, numRuns: 50 },
    );
  });

  it('D8: every detector is deterministic when now is injected and does not mutate input arrays', () => {
    const inputArb = injectedNowArb.chain((now) =>
      fc.record({
        now: fc.constant(now),
        deviceKind: deviceKindArb,
        deviceId: deviceIdArb,
        numA: numericSamplesForNowArb(now, 0, 25),
        numB: numericSamplesForNowArb(now, 0, 25),
        statuses: statusSamplesForNowArb(now, 0, 25),
        uptimes: uptimeSamplesForNowArb(now, 0, 25),
      }),
    );

    fc.assert(
      fc.property(
        inputArb,
        ({ now, deviceKind, deviceId, numA, numB, statuses, uptimes }) => {
          const snapA = numA.map((s) => ({ ...s }));
          const snapB = numB.map((s) => ({ ...s }));
          const snapStatuses = statuses.map((s) => ({ ...s }));
          const snapUptimes = uptimes.map((s) => ({ ...s }));

          expect(detectSignalDrift(deviceKind, deviceId, numA, { now })).toEqual(
            detectSignalDrift(deviceKind, deviceId, numA, { now }),
          );
          expect(detectTemperatureDrift(deviceKind, deviceId, numA, { now })).toEqual(
            detectTemperatureDrift(deviceKind, deviceId, numA, { now }),
          );
          expect(detectFlapping(deviceKind, deviceId, statuses, { now })).toEqual(
            detectFlapping(deviceKind, deviceId, statuses, { now }),
          );
          expect(detectRebootStorm(deviceKind, deviceId, uptimes, { now })).toEqual(
            detectRebootStorm(deviceKind, deviceId, uptimes, { now }),
          );
          expect(detectBaselineAnomaly(deviceKind, deviceId, numA, { now })).toEqual(
            detectBaselineAnomaly(deviceKind, deviceId, numA, { now }),
          );
          expect(detectFecDegradation(deviceKind, deviceId, numA, numB, { now })).toEqual(
            detectFecDegradation(deviceKind, deviceId, numA, numB, { now }),
          );
          expect(detectOpticalDegradation(deviceKind, deviceId, numA, numB, { now })).toEqual(
            detectOpticalDegradation(deviceKind, deviceId, numA, numB, { now }),
          );
          expect(detectLosEvents(deviceKind, deviceId, numA, { now })).toEqual(
            detectLosEvents(deviceKind, deviceId, numA, { now }),
          );
          expect(detectTrafficAnomaly(deviceKind, deviceId, numA, { now })).toEqual(
            detectTrafficAnomaly(deviceKind, deviceId, numA, { now }),
          );

          expect(numA).toEqual(snapA);
          expect(numB).toEqual(snapB);
          expect(statuses).toEqual(snapStatuses);
          expect(uptimes).toEqual(snapUptimes);
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('D9: every detector that produces a finding stamps detectedAt from the injected now', () => {
    fc.assert(
      fc.property(
        injectedNowArb,
        injectedNowArb.filter((n) => n !== MIN_NOW),
        deviceKindArb,
        deviceIdArb,
        (nowA, offsetSeed, deviceKind, deviceId) => {
          const nowB = nowA === offsetSeed ? nowA + 60_000 : offsetSeed;
          const isoA = new Date(nowA).toISOString();
          const isoB = new Date(nowB).toISOString();

          // Construct synthetic triggering series anchored at nowA.
          const signalSamples: NumericSample[] = [0, 1, 2, 3, 4].map((d) => ({
            t: nowA - (4 - d) * DAY_MS,
            v: -22 - d,
          }));
          const tempSamples: NumericSample[] = [0, 1, 2, 3, 4].map((d) => ({
            t: nowA - (4 - d) * DAY_MS,
            v: 50 + d * 2,
          }));
          const baselineSamples: NumericSample[] = [
            -22, -22.5, -21.5, -22, -22.5, -21.5, -22, -22.5, -21.5, -22, -40,
          ].map((v, i) => ({ t: nowA - (10 - i) * 3_600_000, v }));
          const flapSamples: StatusSample[] = [
            'online',
            'offline',
            'online',
            'offline',
            'online',
          ].map((status, i) => ({ t: nowA - (4 - i) * 60_000, status }));
          const rebootSamples: UptimeSample[] = [500, 10, 400, 10, 300, 10].map(
            (uptimeSeconds, i) => ({ t: nowA - (5 - i) * 60_000, uptimeSeconds }),
          );
          const fecCorrected: NumericSample[] = [0, 50, 120, 250].map((v, i) => ({
            t: nowA - (3 - i) * 60_000,
            v,
          }));
          const fecUncorrected: NumericSample[] = [0, 0, 1, 5].map((v, i) => ({
            t: nowA - (3 - i) * 60_000,
            v,
          }));
          const biasSamples: NumericSample[] = [60, 62, 64].map((v, i) => ({
            t: nowA - (2 - i) * 60_000,
            v,
          }));
          const losSamples: NumericSample[] = [0, 0, 10, 40].map((v, i) => ({
            t: nowA - (3 - i) * 60_000,
            v,
          }));
          const trafficSamples: NumericSample[] = [150, 160, 170].map((v, i) => ({
            t: nowA - (2 - i) * 60_000,
            v,
          }));

          const findingsAtA = [
            detectSignalDrift(deviceKind, deviceId, signalSamples, { now: nowA }),
            detectTemperatureDrift(deviceKind, deviceId, tempSamples, { now: nowA }),
            detectBaselineAnomaly(deviceKind, deviceId, baselineSamples, { now: nowA }),
            detectFlapping(deviceKind, deviceId, flapSamples, { now: nowA }),
            detectRebootStorm(deviceKind, deviceId, rebootSamples, { now: nowA }),
            detectFecDegradation(deviceKind, deviceId, fecCorrected, fecUncorrected, { now: nowA }),
            detectOpticalDegradation(deviceKind, deviceId, biasSamples, [], { now: nowA }),
            detectLosEvents(deviceKind, deviceId, losSamples, { now: nowA }),
            detectTrafficAnomaly(deviceKind, deviceId, trafficSamples, { now: nowA }),
          ];

          for (const finding of findingsAtA) {
            expect(finding).not.toBeNull();
            expect(finding!.detectedAt).toBe(isoA);
          }

          // Clock-independent detectors must preserve all fields except detectedAt when now changes.
          const signalAtB = detectSignalDrift(deviceKind, deviceId, signalSamples, { now: nowB });
          const tempAtB = detectTemperatureDrift(deviceKind, deviceId, tempSamples, { now: nowB });
          const baselineAtB = detectBaselineAnomaly(deviceKind, deviceId, baselineSamples, {
            now: nowB,
          });

          expect(signalAtB).toEqual({ ...findingsAtA[0]!, detectedAt: isoB });
          expect(tempAtB).toEqual({ ...findingsAtA[1]!, detectedAt: isoB });
          expect(baselineAtB).toEqual({ ...findingsAtA[2]!, detectedAt: isoB });

          // Windowed detectors also stamp detectedAt from injected now when shifted slightly forward inside window.
          const nowShifted = nowA + 1_000;
          const isoShifted = new Date(nowShifted).toISOString();
          const findingsAtShifted = [
            detectSignalDrift(deviceKind, deviceId, signalSamples, { now: nowShifted }),
            detectTemperatureDrift(deviceKind, deviceId, tempSamples, { now: nowShifted }),
            detectBaselineAnomaly(deviceKind, deviceId, baselineSamples, { now: nowShifted }),
            detectFlapping(deviceKind, deviceId, flapSamples, { now: nowShifted }),
            detectRebootStorm(deviceKind, deviceId, rebootSamples, { now: nowShifted }),
            detectFecDegradation(deviceKind, deviceId, fecCorrected, fecUncorrected, {
              now: nowShifted,
            }),
            detectOpticalDegradation(deviceKind, deviceId, biasSamples, [], { now: nowShifted }),
            detectLosEvents(deviceKind, deviceId, losSamples, { now: nowShifted }),
            detectTrafficAnomaly(deviceKind, deviceId, trafficSamples, { now: nowShifted }),
          ];
          for (let i = 0; i < findingsAtA.length; i++) {
            expect(findingsAtShifted[i]).toEqual({
              ...findingsAtA[i]!,
              detectedAt: isoShifted,
            });
          }
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('D10 (baseline anomaly): detectBaselineAnomaly returns null for fewer than minSamples and for a flat history (MAD 0)', () => {
    fc.assert(
      fc.property(
        injectedNowArb,
        deviceKindArb,
        deviceIdArb,
        fc.integer({ min: 2, max: 15 }),
        (now, deviceKind, deviceId, minSamples) => {
          const tooFew: NumericSample[] = Array.from(
            { length: minSamples - 1 },
            (_, i) => ({
              t: now - (minSamples - i) * 3_600_000,
              v: i === minSamples - 2 ? 999 : 0,
            }),
          );
          expect(
            detectBaselineAnomaly(deviceKind, deviceId, tooFew, {
              now,
              minSamples,
            }),
          ).toBeNull();
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );

    fc.assert(
      fc.property(
        injectedNowArb,
        deviceKindArb,
        deviceIdArb,
        fc.integer({ min: 10, max: 30 }),
        numericValueArb,
        (now, deviceKind, deviceId, len, flatValue) => {
          const flatSeries: NumericSample[] = Array.from(
            { length: len },
            (_, i) => ({
              t: now - (len - i) * 3_600_000,
              v: flatValue,
            }),
          );
          expect(
            detectBaselineAnomaly(deviceKind, deviceId, flatSeries, {
              now,
              minSamples: 10,
            }),
          ).toBeNull();
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('D10 (traffic anomaly): detectTrafficAnomaly returns null at or below threshold and reports critical only at or above 2x threshold', () => {
    fc.assert(
      fc.property(
        injectedNowArb,
        deviceKindArb,
        deviceIdArb,
        fc.array(fc.double({ min: 0, max: 1000, noNaN: true }), {
          minLength: 3,
          maxLength: 20,
        }),
        fc.double({ min: 1, max: 500, noNaN: true }),
        (now, deviceKind, deviceId, values, thresholdMbps) => {
          const samples: NumericSample[] = values.map((v, i) => ({
            t: now - (values.length - 1 - i) * 60_000,
            v,
          }));
          const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
          const finding = detectTrafficAnomaly(deviceKind, deviceId, samples, {
            now,
            thresholdMbps,
            minSamples: 3,
          });

          if (avg <= thresholdMbps) {
            expect(finding).toBeNull();
          } else if (avg >= thresholdMbps * 2) {
            expect(finding).not.toBeNull();
            expect(finding!.severity).toBe('critical');
          } else {
            expect(finding).not.toBeNull();
            expect(finding!.severity).toBe('warning');
          }
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('D10 (LOS events): detectLosEvents severity ladder follows criticalDelta, warningDelta, and recent-spike rule', () => {
    fc.assert(
      fc.property(
        injectedNowArb,
        deviceKindArb,
        deviceIdArb,
        fc.integer({ min: 1, max: 50 }),
        fc.integer({ min: 51, max: 500 }),
        fc.array(fc.integer({ min: 0, max: 200 }), { minLength: 3, maxLength: 15 }),
        (now, deviceKind, deviceId, warningDelta, criticalDelta, increments) => {
          let total = 0;
          const values = increments.map((inc) => (total += inc));
          const samples: NumericSample[] = values.map((v, i) => ({
            t: now - (values.length - 1 - i) * 60_000,
            v,
          }));

          const delta = values[values.length - 1]! - values[0]!;
          const lastStep =
            values[values.length - 1]! - values[values.length - 2]!;

          const finding = detectLosEvents(deviceKind, deviceId, samples, {
            now,
            minSamples: 3,
            warningDelta,
            criticalDelta,
          });

          if (delta >= criticalDelta) {
            expect(finding).not.toBeNull();
            expect(finding!.severity).toBe('critical');
          } else if (delta >= warningDelta || lastStep > 0) {
            expect(finding).not.toBeNull();
            expect(finding!.severity).toBe('warning');
          } else {
            expect(finding).toBeNull();
          }
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('D10 (optical degradation): detectOpticalDegradation enforces bias band priority (warning) over temperature ceiling (critical) and returns null when healthy', () => {
    fc.assert(
      fc.property(
        injectedNowArb,
        deviceKindArb,
        deviceIdArb,
        fc.array(fc.double({ min: 0, max: 80, noNaN: true }), {
          minLength: 3,
          maxLength: 10,
        }),
        fc.array(fc.double({ min: 10, max: 100, noNaN: true }), {
          minLength: 3,
          maxLength: 10,
        }),
        (now, deviceKind, deviceId, biasVals, tempVals) => {
          const biasSamples: NumericSample[] = biasVals.map((v, i) => ({
            t: now - (biasVals.length - 1 - i) * 60_000,
            v,
          }));
          const tempSamples: NumericSample[] = tempVals.map((v, i) => ({
            t: now - (tempVals.length - 1 - i) * 60_000,
            v,
          }));
          const biasAvg = biasVals.reduce((s, v) => s + v, 0) / biasVals.length;
          const tempAvg = tempVals.reduce((s, v) => s + v, 0) / tempVals.length;

          const finding = detectOpticalDegradation(
            deviceKind,
            deviceId,
            biasSamples,
            tempSamples,
            { now, minSamples: 3, biasMinMa: 2, biasMaxMa: 40, tempMaxC: 70 },
          );

          if (biasAvg < 2 || biasAvg > 40) {
            expect(finding).not.toBeNull();
            expect(finding!.severity).toBe('warning');
          } else if (tempAvg > 70) {
            expect(finding).not.toBeNull();
            expect(finding!.severity).toBe('critical');
          } else {
            expect(finding).toBeNull();
          }
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('D10 (FEC degradation): detectFecDegradation prioritizes uncorrectable delta (critical) over corrected delta (warning)', () => {
    fc.assert(
      fc.property(
        injectedNowArb,
        deviceKindArb,
        deviceIdArb,
        fc.array(fc.integer({ min: 0, max: 100 }), { minLength: 3, maxLength: 10 }),
        fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 3, maxLength: 10 }),
        (now, deviceKind, deviceId, corrInc, uncorrInc) => {
          let corrSum = 0;
          const corrVals = corrInc.map((x) => (corrSum += x));
          let uncorrSum = 0;
          const uncorrVals = uncorrInc.map((x) => (uncorrSum += x));

          const corrected: NumericSample[] = corrVals.map((v, i) => ({
            t: now - (corrVals.length - 1 - i) * 60_000,
            v,
          }));
          const uncorrected: NumericSample[] = uncorrVals.map((v, i) => ({
            t: now - (uncorrVals.length - 1 - i) * 60_000,
            v,
          }));

          const corrDelta = corrVals[corrVals.length - 1]! - corrVals[0]!;
          const uncorrDelta = uncorrVals[uncorrVals.length - 1]! - uncorrVals[0]!;

          const finding = detectFecDegradation(
            deviceKind,
            deviceId,
            corrected,
            uncorrected,
            {
              now,
              minSamples: 3,
              uncorrectedThreshold: 0,
              correctedDeltaThreshold: 100,
            },
          );

          if (uncorrDelta > 0) {
            expect(finding).not.toBeNull();
            expect(finding!.severity).toBe('critical');
          } else if (corrDelta > 100) {
            expect(finding).not.toBeNull();
            expect(finding!.severity).toBe('warning');
          } else {
            expect(finding).toBeNull();
          }
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('D10 (flapping & reboot storm): detectFlapping and detectRebootStorm flag iff transitions/resets in window meet threshold', () => {
    fc.assert(
      fc.property(
        injectedNowArb,
        deviceKindArb,
        deviceIdArb,
        fc.array(fc.constantFrom<'online' | 'offline' | 'degraded'>('online', 'offline', 'degraded'), {
          minLength: 2,
          maxLength: 15,
        }),
        fc.integer({ min: 1, max: 6 }),
        (now, deviceKind, deviceId, statuses, minFlaps) => {
          const samples: StatusSample[] = statuses.map((status, i) => ({
            t: now - (statuses.length - 1 - i) * 60_000,
            status,
          }));
          let flaps = 0;
          for (let i = 1; i < statuses.length; i++) {
            if (statuses[i] !== statuses[i - 1]) flaps++;
          }

          const finding = detectFlapping(deviceKind, deviceId, samples, {
            now,
            minFlaps,
          });
          if (flaps >= minFlaps) {
            expect(finding).not.toBeNull();
            expect(finding!.severity).toBe('warning');
            expect(finding!.kind).toBe('intermittent_connection');
          } else {
            expect(finding).toBeNull();
          }
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );

    fc.assert(
      fc.property(
        injectedNowArb,
        deviceKindArb,
        deviceIdArb,
        fc.array(fc.integer({ min: 0, max: 1_000 }), { minLength: 2, maxLength: 15 }),
        fc.integer({ min: 1, max: 6 }),
        (now, deviceKind, deviceId, uptimes, minReboots) => {
          const samples: UptimeSample[] = uptimes.map((uptimeSeconds, i) => ({
            t: now - (uptimes.length - 1 - i) * 60_000,
            uptimeSeconds,
          }));
          let reboots = 0;
          for (let i = 1; i < uptimes.length; i++) {
            if (uptimes[i]! < uptimes[i - 1]!) reboots++;
          }

          const finding = detectRebootStorm(deviceKind, deviceId, samples, {
            now,
            minReboots,
          });
          if (reboots >= minReboots) {
            expect(finding).not.toBeNull();
            expect(finding!.severity).toBe('warning');
            expect(finding!.kind).toBe('frequent_reboots');
          } else {
            expect(finding).toBeNull();
          }
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });

  it('D10 (signal & temperature drift): detectSignalDrift and detectTemperatureDrift return null on wrong-direction or already-crossed trends and predict within horizon', () => {
    fc.assert(
      fc.property(
        injectedNowArb,
        deviceKindArb,
        deviceIdArb,
        fc.double({ min: 0.5, max: 3, noNaN: true }),
        fc.integer({ min: 5, max: 10 }),
        (now, deviceKind, deviceId, ratePerDay, count) => {
          // Signal dropping toward -27 dBm, last value at -25 dBm => ETA within 7 days.
          const signalDrop: NumericSample[] = Array.from({ length: count }, (_, i) => ({
            t: now - (count - 1 - i) * DAY_MS,
            v: -25 + (count - 1 - i) * ratePerDay,
          }));
          const signalFinding = detectSignalDrift(deviceKind, deviceId, signalDrop, {
            now,
            thresholdDbm: -27,
            horizonDays: 7,
          });
          expect(signalFinding).not.toBeNull();
          expect(signalFinding!.kind).toBe('predicted_low_signal');
          expect(signalFinding!.etaMs).toBeLessThanOrEqual(7 * DAY_MS);

          // Reversed (improving) signal must return null.
          const signalRecover: NumericSample[] = Array.from({ length: count }, (_, i) => ({
            t: now - (count - 1 - i) * DAY_MS,
            v: -25 - (count - 1 - i) * ratePerDay,
          }));
          expect(
            detectSignalDrift(deviceKind, deviceId, signalRecover, {
              now,
              thresholdDbm: -27,
              horizonDays: 7,
            }),
          ).toBeNull();

          // Temperature rising toward 60 C, last value at 58 C => ETA within 7 days.
          const tempRise: NumericSample[] = Array.from({ length: count }, (_, i) => ({
            t: now - (count - 1 - i) * DAY_MS,
            v: 58 - (count - 1 - i) * ratePerDay,
          }));
          const tempFinding = detectTemperatureDrift(deviceKind, deviceId, tempRise, {
            now,
            thresholdCelsius: 60,
            horizonDays: 7,
          });
          expect(tempFinding).not.toBeNull();
          expect(tempFinding!.kind).toBe('predicted_high_temperature');
          expect(tempFinding!.etaMs).toBeLessThanOrEqual(7 * DAY_MS);

          // Cooling temperature must return null.
          const tempCool: NumericSample[] = Array.from({ length: count }, (_, i) => ({
            t: now - (count - 1 - i) * DAY_MS,
            v: 58 + (count - 1 - i) * ratePerDay,
          }));
          expect(
            detectTemperatureDrift(deviceKind, deviceId, tempCool, {
              now,
              thresholdCelsius: 60,
              horizonDays: 7,
            }),
          ).toBeNull();
        },
      ),
      { seed: SEED, numRuns: RUNS },
    );
  });
});
