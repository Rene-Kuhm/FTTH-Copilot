import { describe, it, expect } from 'vitest';
import { FTTHExpertClassifier, getExpertClassifier } from '../src/laya-expert-system';

describe('FTTHExpertClassifier', () => {
  const classifier = new FTTHExpertClassifier();

  it('classifies OPTICAL_FAULT correctly', () => {
    const result = classifier.classify('OLT reports LOS alarm all ONUs');
    expect(result.eventClass).toBe('OPTICAL_FAULT');
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.severity).toBe('HIGH');
    expect(result.probableScope).toBe('PON');
    expect(result.requiresInvestigation).toBe(true);
  });

  it('classifies POWER_FAULT correctly', () => {
    const result = classifier.classify('ONU dying gasp detected');
    expect(result.eventClass).toBe('POWER_FAULT');
    expect(result.severity).toBe('CRITICAL');
    expect(result.probableScope).toBe('ONU');
  });

  it('classifies DEVICE_FAULT correctly', () => {
    const result = classifier.classify('OLT temperature at 85C exceeded');
    expect(result.eventClass).toBe('DEVICE_FAULT');
    expect(result.severity).toBe('HIGH');
    expect(result.probableScope).toBe('OLT');
  });

  it('classifies UPLINK_FAULT correctly', () => {
    const result = classifier.classify('Uplink port down aggregation');
    expect(result.eventClass).toBe('UPLINK_FAULT');
    expect(result.severity).toBe('HIGH');
    expect(result.probableScope).toBe('UPLINK');
  });

  it('classifies CONGESTION correctly', () => {
    const result = classifier.classify('High uplink utilization at 95%');
    expect(result.eventClass).toBe('CONGESTION');
    expect(result.severity).toBe('LOW');
    expect(result.probableScope).toBe('UPLINK');
    expect(result.requiresInvestigation).toBe(false);
  });

  it('classifies MASS_OUTAGE correctly', () => {
    const result = classifier.classify('Multiple ONUs offline widespread');
    expect(result.eventClass).toBe('MASS_OUTAGE');
    expect(result.severity).toBe('CRITICAL');
    expect(result.probableScope).toBe('PON');
  });

  it('classifies NORMAL correctly', () => {
    const result = classifier.classify('ONT online operational services');
    expect(result.eventClass).toBe('NORMAL');
    expect(result.severity).toBe('INFO');
    expect(result.probableScope).toBe('UNKNOWN');
    expect(result.requiresInvestigation).toBe(false);
  });

  it('classifies OPTICAL_DEGRADATION correctly', () => {
    const result = classifier.classify('RX power declining slowly');
    expect(result.eventClass).toBe('OPTICAL_DEGRADATION');
    expect(result.severity).toBe('MEDIUM');
    expect(result.probableScope).toBe('PON');
  });

  it('handles empty input', () => {
    const result = classifier.classify('');
    expect(result.eventClass).toBe('NORMAL');
    expect(result.severity).toBe('INFO');
    expect(result.requiresInvestigation).toBe(false);
  });

  it('returns matched keywords', () => {
    const result = classifier.classify('Multiple ONUs affected LOS alarm');
    expect(result.matchedKeywords.length).toBeGreaterThan(0);
  });

  it('singleton returns same instance', () => {
    const instance1 = getExpertClassifier();
    const instance2 = getExpertClassifier();
    expect(instance1).toBe(instance2);
  });

  it('batch classify works', () => {
    const events = [
      'OLT reports LOS alarm',
      'Multiple ONUs offline',
      'ONT online operational',
    ];
    const results = classifier.classifyBatch(events);
    expect(results).toHaveLength(3);
    expect(results[0].eventClass).toBe('OPTICAL_FAULT');
    expect(results[1].eventClass).toBe('MASS_OUTAGE');
    expect(results[2].eventClass).toBe('NORMAL');
    // Verify all new fields are present
    expect(results[0].severity).toBeDefined();
    expect(results[0].probableScope).toBeDefined();
    expect(results[0].requiresInvestigation).toBeDefined();
  });
});
