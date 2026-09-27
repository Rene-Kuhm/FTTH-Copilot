import { describe, it, expect, beforeEach } from 'vitest';
import { layaMetrics, recordLayaDecision, LayaMetricsCollector } from '../src/laya-metrics';

describe('LayaMetrics', () => {
  let metrics: LayaMetricsCollector;

  beforeEach(() => {
    metrics = new LayaMetricsCollector();
  });

  it('records decisions correctly', () => {
    metrics.recordDecision('OPTICAL_FAULT', 0.87, 'shadow', 'success', 'INVESTIGATION');
    
    const summary = metrics.getSummary();
    const keys = Object.keys(summary.counters);
    expect(keys.some(k => k.includes('OPTICAL_FAULT'))).toBe(true);
  });

  it('records latency correctly', () => {
    metrics.recordLatency(15, 'shadow');
    metrics.recordLatency(25, 'shadow');
    metrics.recordLatency(35, 'shadow');
    
    const summary = metrics.getSummary();
    expect(summary.latencies['shadow']).toBeDefined();
    expect(summary.latencies['shadow'].p50).toBe(25);
  });

  it('records confidence correctly', () => {
    metrics.recordConfidence(0.87, 'OPTICAL_FAULT');
    metrics.recordConfidence(0.92, 'OPTICAL_FAULT');
    
    const summary = metrics.getSummary();
    expect(summary.confidences['OPTICAL_FAULT']).toBeDefined();
    expect(summary.confidences['OPTICAL_FAULT'].avg).toBeCloseTo(0.895, 2);
  });

  it('generates prometheus format', () => {
    metrics.recordDecision('NORMAL', 0.95, 'shadow', 'success');
    const output = metrics.toPrometheusFormat();
    
    expect(output).toContain('ftth_laya_requests_total');
    expect(output).toContain('ftth_laya_latency_ms');
    expect(output).toContain('ftth_laya_confidence');
  });

  it('resets metrics', () => {
    metrics.recordDecision('NORMAL', 0.95, 'shadow', 'success');
    metrics.reset();
    
    const summary = metrics.getSummary();
    expect(Object.keys(summary.counters)).toHaveLength(0);
  });

  it('singleton recordLayaDecision works', () => {
    recordLayaDecision('OPTICAL_FAULT', 0.87, 'shadow', 'success', 15, 'INVESTIGATION');
    
    const summary = layaMetrics.getSummary();
    const keys = Object.keys(summary.counters);
    expect(keys.some(k => k.includes('OPTICAL_FAULT'))).toBe(true);
  });
});
