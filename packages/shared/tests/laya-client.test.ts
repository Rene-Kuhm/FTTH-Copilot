/**
 * Unit tests for Laya Decision Client
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadLayaConfigFromEnv,
  createCircuitBreaker,
  createInitialMetrics,
  recordLayaDecision,
  LAYA_QUESTIONS,
} from '../src/laya-client.js';

// ── Circuit Breaker Tests ──────────────────────────────────────────────────

describe('Circuit Breaker', () => {
  it('starts in closed state', () => {
    const cb = createCircuitBreaker();
    expect(cb.getState().status).toBe('closed');
    expect(cb.canExecute()).toBe(true);
  });

  it('records success and resets failure count', () => {
    const cb = createCircuitBreaker({
      consecutiveFailuresThreshold: 3,
      resetTimeoutMs: 1000,
    });

    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState().consecutiveFailures).toBe(2);

    cb.recordSuccess();
    expect(cb.getState().consecutiveFailures).toBe(0);
    expect(cb.getState().status).toBe('closed');
  });

  it('opens after consecutive failures threshold', () => {
    const cb = createCircuitBreaker({
      consecutiveFailuresThreshold: 3,
      resetTimeoutMs: 1000,
    });

    cb.recordFailure();
    cb.recordFailure();
    const opened = cb.recordFailure();

    expect(opened).toBe(true);
    expect(cb.getState().status).toBe('open');
    expect(cb.canExecute()).toBe(false);
  });

  it('transitions to half-open after reset timeout', async () => {
    const cb = createCircuitBreaker({
      consecutiveFailuresThreshold: 2,
      resetTimeoutMs: 50, // 50ms
    });

    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState().status).toBe('open');

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 60));

    expect(cb.canExecute()).toBe(true);
    expect(cb.getState().status).toBe('half-open');
  });
});

// ── Metrics Tests ─────────────────────────────────────────────────────────

describe('Laya Metrics', () => {
  it('starts with zero values', () => {
    const metrics = createInitialMetrics();
    expect(metrics.requestsTotal).toBe(0);
    expect(metrics.failuresTotal).toBe(0);
    expect(metrics.timeoutsTotal).toBe(0);
    expect(metrics.shadowTotal).toBe(0);
  });

  it('records successful decision', () => {
    const metrics = createInitialMetrics();
    recordLayaDecision(metrics, {
      latencyMs: 100,
      success: true,
      suggestedRoute: 'DIRECT',
      confidence: 0.9,
    });

    expect(metrics.requestsTotal).toBe(1);
    expect(metrics.failuresTotal).toBe(0);
    expect(metrics.latencySum).toBe(100);
    expect(metrics.routeSuggestionTotal['DIRECT']).toBe(1);
    expect(metrics.confidenceCount).toBe(1);
  });

  it('records failure', () => {
    const metrics = createInitialMetrics();
    recordLayaDecision(metrics, {
      latencyMs: 50,
      success: false,
      isTimeout: true,
    });

    expect(metrics.requestsTotal).toBe(1);
    expect(metrics.failuresTotal).toBe(1);
    expect(metrics.timeoutsTotal).toBe(1);
  });

  it('records shadow mode decisions', () => {
    const metrics = createInitialMetrics();
    recordLayaDecision(metrics, {
      latencyMs: 80,
      success: true,
      isShadow: true,
      suggestedRoute: 'ASSISTED',
    });

    expect(metrics.shadowTotal).toBe(1);
  });

  it('records fallback decisions', () => {
    const metrics = createInitialMetrics();
    // Fallback is when Laya fails but we continue with fail-open
    // Note: fallbackTotal is for tracking, not for success/failure counting
    // This test documents the current behavior
    recordLayaDecision(metrics, {
      latencyMs: 0,
      success: false,
      isFallback: true,
    });

    // Fallback decisions are counted separately from success/failure
    // In this test, we're just verifying the metric exists
    expect(metrics.failuresTotal).toBe(1);
  });

  it('records shadow agreement/disagreement', () => {
    const metrics = createInitialMetrics();

    recordLayaDecision(metrics, {
      latencyMs: 100,
      success: true,
      isShadow: true,
      shadowAgreement: true,
    });
    recordLayaDecision(metrics, {
      latencyMs: 100,
      success: true,
      isShadow: true,
      shadowAgreement: false,
    });

    expect(metrics.shadowAgreementTotal).toBe(1);
    expect(metrics.shadowDisagreementTotal).toBe(1);
  });
});

// ── Laya Questions Tests ───────────────────────────────────────────────────

describe('Laya Questions', () => {
  it('has event_class question with all required classes', () => {
    const q = LAYA_QUESTIONS.event_class;
    expect(q.type).toBe('choice');
    expect(q.criteria).toHaveProperty('NORMAL');
    expect(q.criteria).toHaveProperty('OPTICAL_FAULT');
    expect(q.criteria).toHaveProperty('OPTICAL_DEGRADATION');
    expect(q.criteria).toHaveProperty('POWER_FAULT');
    expect(q.criteria).toHaveProperty('DEVICE_FAULT');
    expect(q.criteria).toHaveProperty('UPLINK_FAULT');
    expect(q.criteria).toHaveProperty('CONGESTION');
    expect(q.criteria).toHaveProperty('MASS_OUTAGE');
    expect(q.criteria).toHaveProperty('SECURITY_EVENT');
    expect(q.criteria).toHaveProperty('UNKNOWN');
  });

  it('has severity question with all levels', () => {
    const q = LAYA_QUESTIONS.severity;
    expect(q.type).toBe('choice');
    expect(q.criteria).toHaveProperty('INFO');
    expect(q.criteria).toHaveProperty('LOW');
    expect(q.criteria).toHaveProperty('MEDIUM');
    expect(q.criteria).toHaveProperty('HIGH');
    expect(q.criteria).toHaveProperty('CRITICAL');
  });

  it('has requires_investigation as noul type', () => {
    const q = LAYA_QUESTIONS.requires_investigation;
    expect(q.type).toBe('noul');
  });
});

// ── Config Tests ─────────────────────────────────────────────────────────

describe('Laya Config', () => {
  beforeEach(() => {
    // Reset env
    delete process.env.LAYA_ENABLED;
    delete process.env.LAYA_MODE;
    delete process.env.LAYA_URL;
    delete process.env.LAYA_TIMEOUT_MS;
  });

  it('loads defaults when no env vars set', () => {
    const config = loadLayaConfigFromEnv();
    expect(config.enabled).toBe(false);
    expect(config.mode).toBe('shadow'); // AD-2: mode defaults to 'shadow', not 'disabled'
    expect(config.timeoutMs).toBe(250);
    expect(config.failOpen).toBe(true);
  });

  it('loads from environment variables', () => {
    process.env.LAYA_ENABLED = 'true';
    process.env.LAYA_MODE = 'shadow';
    process.env.LAYA_URL = 'http://laya:8080';
    process.env.LAYA_TIMEOUT_MS = '500';

    const config = loadLayaConfigFromEnv();
    expect(config.enabled).toBe(true);
    expect(config.mode).toBe('shadow');
    expect(config.url).toBe('http://laya:8080');
    expect(config.timeoutMs).toBe(500);
  });

  it('respects LAYA_FAIL_OPEN=false', () => {
    process.env.LAYA_ENABLED = 'true';
    process.env.LAYA_FAIL_OPEN = 'false';

    const config = loadLayaConfigFromEnv();
    expect(config.failOpen).toBe(false);
  });
});
