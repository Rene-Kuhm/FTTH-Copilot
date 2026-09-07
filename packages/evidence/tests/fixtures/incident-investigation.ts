/**
 * Phase 0 fixtures for the cognitive-investigation roadmap.
 *
 * These fixtures are *seed data*, not test assertions. They give the
 * future tests (phase 1+, phase 3+) deterministic inputs so we can
 * exercise:
 *
 *   - Individual ONU outage with full evidence.
 *   - Shared outage (multiple devices on one OLT) with topology.
 *   - Insufficient data (no telemetry in the window).
 *   - Contradictory evidence (online metric + offline syslog event).
 *   - Missing topology (deviceId not in any TopologyEdge).
 *   - Active maintenance window (per phase 5 — fixture only, behavior in phase 5).
 *   - Cross-tenant collision (two tenants, both have deviceId "onu-1").
 *
 * Phase 0.5 commits these identifiers and shapes. Phases 1 and 3 will
 * import the same fixtures so a regression in the diagnostic engine
 * fails deterministically against a known seed.
 *
 * No Prisma calls in this file. Tests that need a real database should
 * pass these into a `beforeAll` that seeds the relevant tables via
 * the Prisma client, not by importing this module's runtime side
 * effects.
 */

export const INVESTIGATION_FIXTURE_TENANT_PRIMARY = 'tenant-primary';
export const INVESTIGATION_FIXTURE_TENANT_NEIGHBOR = 'tenant-neighbor';
export const INVESTIGATION_FIXTURE_CONNECTION_A = 'conn-sj-a';
export const INVESTIGATION_FIXTURE_CONNECTION_B = 'conn-sj-b';
export const INVESTIGATION_FIXTURE_OLT_A = 'olt-sj-1';
export const INVESTIGATION_FIXTURE_OLT_B = 'olt-sj-2';
export const INVESTIGATION_FIXTURE_PON_A = 'pon-1';
export const INVESTIGATION_FIXTURE_SPLITTER_A = 'splitter-1';
export const INVESTIGATION_FIXTURE_CTO_A = 'cto-1';
export const INVESTIGATION_FIXTURE_ONU_INDIVIDUAL = 'onu-individual';
export const INVESTIGATION_FIXTURE_ONU_SHARED_A = 'onu-shared-a';
export const INVESTIGATION_FIXTURE_ONU_SHARED_B = 'onu-shared-b';
export const INVESTIGATION_FIXTURE_ONU_CONTRADICTION = 'onu-contradiction';
export const INVESTIGATION_FIXTURE_ONU_NO_TOPOLOGY = 'onu-no-topology';
export const INVESTIGATION_FIXTURE_ONU_NEIGHBOR = 'onu-neighbor';
export const INVESTIGATION_FIXTURE_INCIDENT_INDIVIDUAL = 'inc-individual';
export const INVESTIGATION_FIXTURE_INCIDENT_SHARED = 'inc-shared';
export const INVESTIGATION_FIXTURE_INCIDENT_INSUFFICIENT = 'inc-insufficient';
export const INVESTIGATION_FIXTURE_INCIDENT_CONTRADICTION = 'inc-contradiction';
export const INVESTIGATION_FIXTURE_INCIDENT_NO_TOPOLOGY = 'inc-no-topology';
export const INVESTIGATION_FIXTURE_INCIDENT_MAINTENANCE = 'inc-maintenance';

export const INVESTIGATION_FIXTURE_TENANTS = [
  INVESTIGATION_FIXTURE_TENANT_PRIMARY,
  INVESTIGATION_FIXTURE_TENANT_NEIGHBOR,
] as const;

/**
 * Stable IDs use opaque ASCII strings (cuid-like) so a regression
 * test does not depend on Prisma row numbers.
 */
export const investigationFixtureRunIds = {
  individual: 'r_fix_individual',
  shared: 'r_fix_shared',
  insufficient: 'r_fix_insufficient',
  contradiction: 'r_fix_contradiction',
  noTopology: 'r_fix_no_topology',
  maintenance: 'r_fix_maintenance',
} as const;

export const investigationFixtureVersionIds = {
  individual: 'v_fix_individual',
  shared: 'v_fix_shared',
  insufficient: 'v_fix_insufficient',
  contradiction: 'v_fix_contradiction',
  noTopology: 'v_fix_no_topology',
  maintenance: 'v_fix_maintenance',
} as const;

export const investigationFixtureFeedbackIds = {
  individual: 'f_fix_individual',
  shared: 'f_fix_shared',
  insufficient: 'f_fix_insufficient',
  contradiction: 'f_fix_contradiction',
  noTopology: 'f_fix_no_topology',
  maintenance: 'f_fix_maintenance',
} as const;

/**
 * Reference timestamps. Use these so a future test can assert that
 * a diagnostic correctly distinguishes "the device was offline
 * during this window" from "no telemetry was observed during this
 * window" without depending on the wall clock.
 *
 * The window is 30 days ending at FIXTURE_NOW.
 */
export const INVESTIGATION_FIXTURE_NOW = '2026-08-21T12:00:00.000Z';
export const INVESTIGATION_FIXTURE_WINDOW_START = '2026-07-22T12:00:00.000Z';
export const INVESTIGATION_FIXTURE_WINDOW_END = INVESTIGATION_FIXTURE_NOW;
export const INVESTIGATION_FIXTURE_DAY_MS = 24 * 60 * 60 * 1000;
