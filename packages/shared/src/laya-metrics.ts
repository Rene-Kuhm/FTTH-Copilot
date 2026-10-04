/**
 * Laya VictoriaMetrics / Prometheus-compatible Metrics
 * 
 * Metrics for monitoring Laya Expert System performance.
 * 
 * Usage:
 *   import { layaMetrics } from '@ftth-copilot/shared';
 *   layaMetrics.recordDecision('OPTICAL_FAULT', 0.87, 'shadow');
 */

import type { LayaMode, LayaResult } from './laya-shadow';
export type { LayaMode, LayaResult };
interface MetricLabels {
  eventClass?: string;
  mode: LayaMode;
  result: LayaResult;
  suggestedRoute?: string;
}

// In-memory metrics (for standalone use)
// In production, use Prometheus client library
class LayaMetricsCollector {
  private counters: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();

  private key(labels: MetricLabels): string {
    return JSON.stringify(labels);
  }

  /**
   * Record a Laya decision
   */
  recordDecision(
    eventClass: string,
    confidence: number,
    mode: LayaMode,
    result: LayaResult = 'success',
    suggestedRoute?: string
  ): void {
    const labels: MetricLabels = { eventClass, mode, result, suggestedRoute };
    const k = this.key(labels);
    this.counters.set(k, (this.counters.get(k) ?? 0) + 1);
  }

  /**
   * Record decision latency in ms
   */
  recordLatency(latencyMs: number, mode: LayaMode): void {
    const k = `latency:${mode}`;
    const arr = this.histograms.get(k) ?? [];
    arr.push(latencyMs);
    if (arr.length > 1000) arr.shift(); // Keep last 1000
    this.histograms.set(k, arr);
  }

  /**
   * Record confidence value
   */
  recordConfidence(confidence: number, eventClass: string): void {
    const k = `confidence:${eventClass}`;
    const arr = this.histograms.get(k) ?? [];
    arr.push(confidence);
    if (arr.length > 1000) arr.shift();
    this.histograms.set(k, arr);
  }

  /**
   * Get metrics summary
   */
  getSummary(): {
    counters: Record<string, number>;
    latencies: Record<string, { p50: number; p95: number; p99: number; count: number }>;
    confidences: Record<string, { min: number; max: number; avg: number }>;
  } {
    // Counters
    const counters: Record<string, number> = {};
    for (const [k, v] of this.counters) {
      counters[k] = v;
    }

    // Latency percentiles
    const latencies: Record<string, { p50: number; p95: number; p99: number; count: number }> = {};
    for (const [k, arr] of this.histograms) {
      if (k.startsWith('latency:')) {
        const mode = k.replace('latency:', '');
        const sorted = [...arr].sort((a, b) => a - b);
        const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
        const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
        latencies[mode] = { p50, p95, p99, count: sorted.length };
      }
    }

    // Confidence stats
    const confidences: Record<string, { min: number; max: number; avg: number }> = {};
    for (const [k, arr] of this.histograms) {
      if (k.startsWith('confidence:')) {
        const eventClass = k.replace('confidence:', '');
        const min = Math.min(...arr);
        const max = Math.max(...arr);
        const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
        confidences[eventClass] = { min, max, avg };
      }
    }

    return { counters, latencies, confidences };
  }

  /**
   * Get Prometheus-formatted metrics
   */
  toPrometheusFormat(): string {
    const lines: string[] = [
      '# HELP ftth_laya_requests_total Total Laya requests',
      '# TYPE ftth_laya_requests_total counter',
      '# HELP ftth_laya_latency_ms Laya decision latency in ms',
      '# TYPE ftth_laya_latency_ms gauge',
      '# HELP ftth_laya_confidence Laya decision confidence',
      '# TYPE ftth_laya_confidence gauge',
    ];

    // Requests
    for (const [k, v] of this.counters) {
      try {
        const labels = JSON.parse(k);
        const labelStr = Object.entries(labels)
          .filter(([_, val]) => val !== undefined)
          .map(([key, val]) => `${key}="${val}"`)
          .join(',');
        lines.push(`ftth_laya_requests_total{${labelStr}} ${v}`);
      } catch {
        // Skip invalid JSON
      }
    }

    // Latencies
    for (const [mode, stats] of Object.entries(this.getSummary().latencies)) {
      lines.push(`ftth_laya_latency_ms{mode="${mode}",quantile="p50"} ${stats.p50}`);
      lines.push(`ftth_laya_latency_ms{mode="${mode}",quantile="p95"} ${stats.p95}`);
      lines.push(`ftth_laya_latency_ms{mode="${mode}",quantile="p99"} ${stats.p99}`);
    }

    // Confidences
    for (const [eventClass, stats] of Object.entries(this.getSummary().confidences)) {
      lines.push(`ftth_laya_confidence{event_class="${eventClass}",stat="avg"} ${stats.avg.toFixed(3)}`);
      lines.push(`ftth_laya_confidence{event_class="${eventClass}",stat="min"} ${stats.min.toFixed(3)}`);
      lines.push(`ftth_laya_confidence{event_class="${eventClass}",stat="max"} ${stats.max.toFixed(3)}`);
    }

    return lines.join('\n');
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.counters.clear();
    this.histograms.clear();
  }
}

// Singleton instance
export const layaMetrics = new LayaMetricsCollector();

// Export class for testing
export { LayaMetricsCollector };

// Helper function for easy recording
export function recordLayaDecision(
  eventClass: string,
  confidence: number,
  mode: LayaMode,
  result: LayaResult = 'success',
  latencyMs?: number,
  suggestedRoute?: string
): void {
  layaMetrics.recordDecision(eventClass, confidence, mode, result, suggestedRoute);
  layaMetrics.recordConfidence(confidence, eventClass);
  if (latencyMs !== undefined) {
    layaMetrics.recordLatency(latencyMs, mode);
  }
}
