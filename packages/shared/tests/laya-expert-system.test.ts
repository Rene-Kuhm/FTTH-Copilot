import { describe, it, expect } from 'vitest';
import { FTTHExpertClassifier, getExpertClassifier } from '../src/laya-expert-system';

describe('FTTHExpertClassifier', () => {
  const classifier = new FTTHExpertClassifier();

  it('classifies OPTICAL_FAULT correctly', () => {
    const result = classifier.classify('OLT reports LOS alarm all ONUs');
    expect(result.eventClass).toBe('OPTICAL_FAULT');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('classifies POWER_FAULT correctly', () => {
    const result = classifier.classify('ONU dying gasp detected');
    expect(result.eventClass).toBe('POWER_FAULT');
  });

  it('classifies DEVICE_FAULT correctly', () => {
    const result = classifier.classify('OLT temperature at 85C exceeded');
    expect(result.eventClass).toBe('DEVICE_FAULT');
  });

  it('classifies UPLINK_FAULT correctly', () => {
    const result = classifier.classify('Uplink port down aggregation');
    expect(result.eventClass).toBe('UPLINK_FAULT');
  });

  it('classifies CONGESTION correctly', () => {
    const result = classifier.classify('High uplink utilization at 95%');
    expect(result.eventClass).toBe('CONGESTION');
  });

  it('classifies MASS_OUTAGE correctly', () => {
    const result = classifier.classify('Multiple ONUs offline widespread');
    expect(result.eventClass).toBe('MASS_OUTAGE');
  });

  it('classifies NORMAL correctly', () => {
    const result = classifier.classify('ONT online operational services');
    expect(result.eventClass).toBe('NORMAL');
  });

  it('classifies OPTICAL_DEGRADATION correctly', () => {
    const result = classifier.classify('RX power declining slowly');
    expect(result.eventClass).toBe('OPTICAL_DEGRADATION');
  });

  it('handles empty input', () => {
    const result = classifier.classify('');
    expect(result.eventClass).toBe('NORMAL');
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
  });
});
