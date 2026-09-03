import { describe, expect, it } from 'vitest';
import { PENDING_INCIDENT_CANDIDATE_SCHEMA } from '@ftth-copilot/shared';
import {
  PROMOTION_MIN_AGE_MS,
  buildPendingIncidentCandidate,
  eligibleForPromotion,
} from '../src/pending-incident';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const HOUR_MS = 3_600_000;

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR_MS);
}

const candidate = buildPendingIncidentCandidate({
  tenantId: 't1',
  summary: 'RX bajo en la ONU 1021',
  toolCallsJson: [{ toolName: 'get_onu_detail' }],
  now: NOW,
});

describe('buildPendingIncidentCandidate', () => {
  it('locks the 24h promotion gate constant', () => {
    expect(PROMOTION_MIN_AGE_MS).toBe(24 * HOUR_MS);
  });

  it('builds a pre-insert draft: empty id, pending status, versioned schema', () => {
    expect(candidate.id).toBe('');
    expect(candidate.status).toBe('pending');
    expect(candidate.schema).toBe(PENDING_INCIDENT_CANDIDATE_SCHEMA);
    expect(candidate.tenantId).toBe('t1');
    expect(candidate.summary).toBe('RX bajo en la ONU 1021');
    expect(candidate.toolCallsJson).toEqual([{ toolName: 'get_onu_detail' }]);
  });

  it('stamps proposedConfirmedAt and createdAt with the injected now as ISO', () => {
    expect(candidate.proposedConfirmedAt).toBe('2026-09-01T12:00:00.000Z');
    expect(candidate.createdAt).toBe('2026-09-01T12:00:00.000Z');
  });

  it('defaults the timestamps to the current clock when now is omitted', () => {
    const before = Date.now();
    const built = buildPendingIncidentCandidate({
      tenantId: 't1',
      summary: 's',
      toolCallsJson: null,
    });
    const stamped = Date.parse(built.proposedConfirmedAt);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(Date.now());
  });

  it('carries the optional source references when provided', () => {
    const built = buildPendingIncidentCandidate({
      tenantId: 't1',
      summary: 's',
      toolCallsJson: [],
      sourceIncidentId: 'inc-7',
      runSessionId: 'run-9',
      now: NOW,
    });
    expect(built.sourceIncidentId).toBe('inc-7');
    expect(built.runSessionId).toBe('run-9');
  });

  it('throws on an empty tenantId (multi-tenant refusal path)', () => {
    expect(() =>
      buildPendingIncidentCandidate({ tenantId: '', summary: 's', toolCallsJson: [] }),
    ).toThrow(/tenantId/);
  });

  it('throws on an empty summary', () => {
    expect(() =>
      buildPendingIncidentCandidate({ tenantId: 't1', summary: '', toolCallsJson: [] }),
    ).toThrow(/summary/);
  });
});

describe('eligibleForPromotion', () => {
  const resolved25h = { status: 'resolved', resolvedAt: hoursAgo(25) };

  it('promotes when the incident resolved ≥24h ago and no verdict was incomplete', () => {
    expect(eligibleForPromotion(candidate, resolved25h, NOW, false)).toBe(true);
  });

  it('blocks when the source incident is not resolved', () => {
    expect(
      eligibleForPromotion(candidate, { status: 'open', resolvedAt: hoursAgo(25) }, NOW, false),
    ).toBe(false);
  });

  it('blocks when the incident resolved less than 24h ago', () => {
    expect(
      eligibleForPromotion(candidate, { status: 'resolved', resolvedAt: hoursAgo(12) }, NOW, false),
    ).toBe(false);
  });

  it('blocks when the originating run had an incomplete verdict', () => {
    expect(eligibleForPromotion(candidate, resolved25h, NOW, true)).toBe(false);
  });

  it('treats exactly 24h as eligible (>= boundary)', () => {
    expect(
      eligibleForPromotion(candidate, { status: 'resolved', resolvedAt: hoursAgo(24) }, NOW, false),
    ).toBe(true);
  });

  it('blocks a resolvedAt in the future', () => {
    expect(
      eligibleForPromotion(candidate, { status: 'resolved', resolvedAt: hoursAgo(-1) }, NOW, false),
    ).toBe(false);
  });

  it('blocks a candidate that is no longer pending', () => {
    expect(
      eligibleForPromotion({ ...candidate, status: 'promoted' }, resolved25h, NOW, false),
    ).toBe(false);
  });
});
