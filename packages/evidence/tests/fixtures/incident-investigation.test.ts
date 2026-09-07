import { describe, expect, it } from 'vitest';
import {
  INVESTIGATION_FIXTURE_TENANT_PRIMARY,
  INVESTIGATION_FIXTURE_TENANT_NEIGHBOR,
  INVESTIGATION_FIXTURE_CONNECTION_A,
  INVESTIGATION_FIXTURE_ONU_INDIVIDUAL,
  INVESTIGATION_FIXTURE_ONU_NEIGHBOR,
  INVESTIGATION_FIXTURE_NOW,
  INVESTIGATION_FIXTURE_WINDOW_START,
  INVESTIGATION_FIXTURE_DAY_MS,
  investigationFixtureRunIds,
  investigationFixtureVersionIds,
  investigationFixtureFeedbackIds,
} from './incident-investigation';

/**
 * RED tests for the phase 0.5 fixture set.
 *
 * These tests only verify the fixture values exist and are
 * self-consistent — they do not exercise any production code. Phase
 * 3 (Investigar incidente) and phase 5 (maintenance) tests will
 * import these fixtures to seed deterministic scenarios.
 *
 * If a fixture is renamed or removed without an OpenSpec change,
 * these tests fail and force a deliberate decision.
 */

describe('cognitive-investigation fixtures (phase 0.5)', () => {
  it('defines two distinct tenant identifiers for cross-tenant collision tests', () => {
    expect(INVESTIGATION_FIXTURE_TENANT_PRIMARY).not.toBe(
      INVESTIGATION_FIXTURE_TENANT_NEIGHBOR,
    );
  });

  it('distinguishes tenant-primary vs tenant-neighbor ONUs at the namespace level', () => {
    // The constants below are namespace markers. The actual
    // cross-tenant collision test (same `deviceId` field in the
    // database row, owned by different tenants) lives in phase 1+
    // because it requires real Prisma seeding. Here we only assert
    // that the namespaces are distinguishable so a typo in a
    // later phase cannot accidentally reuse one for the other.
    expect(INVESTIGATION_FIXTURE_ONU_INDIVIDUAL).not.toBe(
      INVESTIGATION_FIXTURE_ONU_NEIGHBOR,
    );
  });

  it('defines a stable window of exactly 30 days', () => {
    const start = new Date(INVESTIGATION_FIXTURE_WINDOW_START).getTime();
    const end = new Date(INVESTIGATION_FIXTURE_NOW).getTime();
    const days = Math.round((end - start) / INVESTIGATION_FIXTURE_DAY_MS);
    expect(days).toBe(30);
  });

  it('exposes one run/version/feedback id per scenario with no collisions', () => {
    const runIds = Object.values(investigationFixtureRunIds);
    const versionIds = Object.values(investigationFixtureVersionIds);
    const feedbackIds = Object.values(investigationFixtureFeedbackIds);
    expect(new Set(runIds).size).toBe(runIds.length);
    expect(new Set(versionIds).size).toBe(versionIds.length);
    expect(new Set(feedbackIds).size).toBe(feedbackIds.length);
  });

  it('keeps run/version/feedback identifiers disjoint across types', () => {
    // A run id must never collide with a version id or feedback id
    // even by accident, so the three namespaces are addressable
    // separately in audit logs and storage.
    const all = [
      ...Object.values(investigationFixtureRunIds),
      ...Object.values(investigationFixtureVersionIds),
      ...Object.values(investigationFixtureFeedbackIds),
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps connection identifiers opaque ASCII', () => {
    expect(INVESTIGATION_FIXTURE_CONNECTION_A).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
