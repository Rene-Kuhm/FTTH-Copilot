import { describe, expect, it } from 'vitest';
import type { InvestigationEvidenceRef } from '@ftth-copilot/shared';
import { computeInvestigationFacts } from '../src/investigation-facts';

describe('computeInvestigationFacts', () => {
  const baseDate = new Date('2026-09-09T12:00:00.000Z');

  it('computes optical statistics and flags critical attenuation', () => {
    const refs: InvestigationEvidenceRef[] = [
      {
        evidenceRefId: 'ref-metric-1',
        kind: 'metric',
        source: 'telemetry:rx_power',
        observedAt: '2026-09-09T10:00:00.000Z',
        summary: 'rx_power: -19.5 dBm',
        quality: 'fresh',
        qualityReason: 'within_ttl',
      },
      {
        evidenceRefId: 'ref-metric-2',
        kind: 'metric',
        source: 'telemetry:rx_power',
        observedAt: '2026-09-09T11:00:00.000Z',
        summary: 'rx_power: -28.2 dBm',
        quality: 'fresh',
        qualityReason: 'within_ttl',
      },
    ];

    const facts = computeInvestigationFacts(refs);

    expect(facts.optical.sampleCount).toBe(2);
    expect(facts.optical.minRxPower).toBe(-28.2);
    expect(facts.optical.maxRxPower).toBe(-19.5);
    expect(facts.optical.deltaRxPower).toBeCloseTo(8.7);
    expect(facts.optical.hasCriticalAttenuation).toBe(true); // < -27 dBm
    expect(facts.optical.hasWarningAttenuation).toBe(true); // < -25 dBm
  });

  it('aggregates events and identifies power outage vs fiber alarm', () => {
    const refs: InvestigationEvidenceRef[] = [
      {
        evidenceRefId: 'ref-event-1',
        kind: 'event',
        source: 'syslog:olt-1',
        observedAt: '2026-09-09T11:15:00.000Z',
        summary: 'event: dying-gasp received from ONU',
        quality: 'fresh',
        qualityReason: 'fresh',
      },
      {
        evidenceRefId: 'ref-event-2',
        kind: 'event',
        source: 'syslog:olt-1',
        observedAt: '2026-09-09T11:16:00.000Z',
        summary: 'event: link-down reported',
        quality: 'fresh',
        qualityReason: 'fresh',
      },
    ];

    const facts = computeInvestigationFacts(refs);

    expect(facts.events.totalEvents).toBe(2);
    expect(facts.events.dyingGaspCount).toBe(1);
    expect(facts.events.losCount).toBe(0);
    expect(facts.events.indicatesPowerLoss).toBe(true);
    expect(facts.events.indicatesFiberCut).toBe(false);
  });

  it('aggregates LOS events indicating potential optical/fiber issue', () => {
    const refs: InvestigationEvidenceRef[] = [
      {
        evidenceRefId: 'ref-event-1',
        kind: 'event',
        source: 'syslog:olt-1',
        observedAt: '2026-09-09T11:15:00.000Z',
        summary: 'event: loss-of-signal (LOS) detected on port 1/1/2',
        quality: 'fresh',
        qualityReason: 'fresh',
      },
    ];

    const facts = computeInvestigationFacts(refs);

    expect(facts.events.losCount).toBe(1);
    expect(facts.events.indicatesFiberCut).toBe(true);
    expect(facts.events.indicatesPowerLoss).toBe(false);
  });

  it('summarizes topology hops and shared infrastructure', () => {
    const refs: InvestigationEvidenceRef[] = [
      {
        evidenceRefId: 'ref-topo-1',
        kind: 'topology',
        source: 'topology:path',
        observedAt: '2026-09-09T11:00:00.000Z',
        summary: 'hop 1 (olt): OLT-NORDELTA-01',
        quality: 'fresh',
        qualityReason: 'fresh',
      },
      {
        evidenceRefId: 'ref-topo-2',
        kind: 'topology',
        source: 'topology:path',
        observedAt: '2026-09-09T11:00:00.000Z',
        summary: 'hop 2 (splitter): SPLITTER-N1-04',
        quality: 'fresh',
        qualityReason: 'fresh',
      },
    ];

    const facts = computeInvestigationFacts(refs);

    expect(facts.topology.hopCount).toBe(2);
    expect(facts.topology.ancestors).toContain('OLT-NORDELTA-01');
    expect(facts.topology.ancestors).toContain('SPLITTER-N1-04');
  });

  it('detects missing optical metrics and generates missing observations', () => {
    const refs: InvestigationEvidenceRef[] = [
      {
        evidenceRefId: 'ref-event-1',
        kind: 'event',
        source: 'syslog:olt-1',
        observedAt: '2026-09-09T11:15:00.000Z',
        summary: 'event: dying-gasp received',
        quality: 'fresh',
        qualityReason: 'fresh',
      },
    ];

    const facts = computeInvestigationFacts(refs);

    expect(facts.optical.sampleCount).toBe(0);
    expect(facts.deterministicMissing.length).toBeGreaterThanOrEqual(1);
    expect(
      facts.deterministicMissing.some((m) => m.what.includes('telemetría óptica')),
    ).toBe(true);
  });
});
