/**
 * Phase 1 — Single configuration truth (AD-2)
 *
 * Tests that both Laya config loaders resolve identical `enabled / mode /
 * failOpen` values from the same environment, and that an empty environment
 * resolves to `enabled === false` (opt-in default per AD-2).
 *
 * Style mirrors `laya-metrics.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLayaConfig, resolveLayaEnv } from '../src/laya-shadow';
import { loadLayaConfigFromEnv } from '../src/laya-client';

// ── Confidence threshold tests ───────────────────────────────────────────────

describe('resolveLayaEnv — confidence thresholds', () => {
  afterEach(() => {
    delete process.env.LAYA_CONFIDENCE_THRESHOLD_HIGH;
    delete process.env.LAYA_CONFIDENCE_THRESHOLD_LOW;
  });

  it('resolves default confidenceThresholdHigh=0.95 when unset', () => {
    delete process.env.LAYA_CONFIDENCE_THRESHOLD_HIGH;
    const result = resolveLayaEnv();
    expect(result.confidenceThresholdHigh).toBe(0.95);
  });

  it('resolves default confidenceThresholdLow=0.75 when unset', () => {
    delete process.env.LAYA_CONFIDENCE_THRESHOLD_LOW;
    const result = resolveLayaEnv();
    expect(result.confidenceThresholdLow).toBe(0.75);
  });

  it('resolves custom confidenceThresholdHigh from env var', () => {
    process.env.LAYA_CONFIDENCE_THRESHOLD_HIGH = '0.99';
    expect(resolveLayaEnv().confidenceThresholdHigh).toBe(0.99);

    process.env.LAYA_CONFIDENCE_THRESHOLD_HIGH = '0.80';
    expect(resolveLayaEnv().confidenceThresholdHigh).toBe(0.80);
  });

  it('resolves custom confidenceThresholdLow from env var', () => {
    process.env.LAYA_CONFIDENCE_THRESHOLD_LOW = '0.60';
    expect(resolveLayaEnv().confidenceThresholdLow).toBe(0.60);

    process.env.LAYA_CONFIDENCE_THRESHOLD_LOW = '0.50';
    expect(resolveLayaEnv().confidenceThresholdLow).toBe(0.50);
  });

  it('resolves both thresholds independently', () => {
    process.env.LAYA_CONFIDENCE_THRESHOLD_HIGH = '0.98';
    process.env.LAYA_CONFIDENCE_THRESHOLD_LOW = '0.65';
    const result = resolveLayaEnv();
    expect(result.confidenceThresholdHigh).toBe(0.98);
    expect(result.confidenceThresholdLow).toBe(0.65);
  });
});

describe('loadLayaConfigFromEnv — thresholds match resolver', () => {
  afterEach(() => {
    delete process.env.LAYA_CONFIDENCE_THRESHOLD_HIGH;
    delete process.env.LAYA_CONFIDENCE_THRESHOLD_LOW;
    delete process.env.LAYA_ENABLED;
    delete process.env.LAYA_MODE;
    delete process.env.LAYA_FAIL_OPEN;
    delete process.env.LAYA_URL;
    delete process.env.LAYA_TIMEOUT_MS;
    delete process.env.LAYA_MODEL;
    delete process.env.LAYA_MODEL_VERSION;
  });

  it('builds confidenceThresholdHigh from resolver (no drift on defaults)', () => {
    delete process.env.LAYA_CONFIDENCE_THRESHOLD_HIGH;
    const config = loadLayaConfigFromEnv();
    const resolver = resolveLayaEnv();
    expect(config.confidenceThresholdHigh).toBe(resolver.confidenceThresholdHigh);
    expect(config.confidenceThresholdHigh).toBe(0.95);
  });

  it('builds confidenceThresholdLow from resolver (no drift on defaults)', () => {
    delete process.env.LAYA_CONFIDENCE_THRESHOLD_LOW;
    const config = loadLayaConfigFromEnv();
    const resolver = resolveLayaEnv();
    expect(config.confidenceThresholdLow).toBe(resolver.confidenceThresholdLow);
    expect(config.confidenceThresholdLow).toBe(0.75);
  });

  it('config thresholds track resolver when env vars are set', () => {
    process.env.LAYA_CONFIDENCE_THRESHOLD_HIGH = '0.97';
    process.env.LAYA_CONFIDENCE_THRESHOLD_LOW = '0.72';
    const config = loadLayaConfigFromEnv();
    const resolver = resolveLayaEnv();
    expect(config.confidenceThresholdHigh).toBe(resolver.confidenceThresholdHigh);
    expect(config.confidenceThresholdHigh).toBe(0.97);
    expect(config.confidenceThresholdLow).toBe(resolver.confidenceThresholdLow);
    expect(config.confidenceThresholdLow).toBe(0.72);
  });
});

describe('resolveLayaEnv', () => {
  afterEach(() => {
    delete process.env.LAYA_ENABLED;
    delete process.env.LAYA_MODE;
    delete process.env.LAYA_FAIL_OPEN;
  });

  it('resolves enabled=true when LAYA_ENABLED=true', () => {
    process.env.LAYA_ENABLED = 'true';
    const result = resolveLayaEnv();
    expect(result.enabled).toBe(true);
  });

  it('resolves enabled=false for any other LAYA_ENABLED value', () => {
    process.env.LAYA_ENABLED = '1';
    expect(resolveLayaEnv().enabled).toBe(false);

    process.env.LAYA_ENABLED = 'false';
    expect(resolveLayaEnv().enabled).toBe(false);

    process.env.LAYA_ENABLED = 'anything';
    expect(resolveLayaEnv().enabled).toBe(false);
  });

  it('resolves mode=shadow when LAYA_MODE is unset', () => {
    delete process.env.LAYA_MODE;
    expect(resolveLayaEnv().mode).toBe('shadow');
  });

  it('resolves the set LAYA_MODE value', () => {
    for (const m of ['disabled', 'shadow', 'assisted', 'automatic']) {
      process.env.LAYA_MODE = m;
      expect(resolveLayaEnv().mode).toBe(m);
    }
  });

  it('resolves failOpen=true when LAYA_FAIL_OPEN is unset', () => {
    delete process.env.LAYA_FAIL_OPEN;
    expect(resolveLayaEnv().failOpen).toBe(true);
  });

  it('resolves failOpen=false only when LAYA_FAIL_OPEN=false', () => {
    process.env.LAYA_FAIL_OPEN = 'false';
    expect(resolveLayaEnv().failOpen).toBe(false);

    process.env.LAYA_FAIL_OPEN = 'true';
    expect(resolveLayaEnv().failOpen).toBe(true);

    process.env.LAYA_FAIL_OPEN = '1';
    expect(resolveLayaEnv().failOpen).toBe(true);
  });
});

describe('getLayaConfig (laya-shadow) vs loadLayaConfigFromEnv (laya-client)', () => {
  afterEach(() => {
    delete process.env.LAYA_ENABLED;
    delete process.env.LAYA_MODE;
    delete process.env.LAYA_FAIL_OPEN;
    delete process.env.LAYA_MIN_CONFIDENCE;
    delete process.env.LAYA_SUGGEST_ROUTE;
    delete process.env.LAYA_ALLOW_DIRECT_ROUTING;
    delete process.env.LAYA_MODEL;
    delete process.env.LAYA_MODEL_VERSION;
    delete process.env.LAYA_URL;
    delete process.env.LAYA_TIMEOUT_MS;
    delete process.env.LAYA_CONFIDENCE_THRESHOLD_HIGH;
    delete process.env.LAYA_CONFIDENCE_THRESHOLD_LOW;
  });

  it('both loaders resolve identical enabled and mode for the same environment', () => {
    process.env.LAYA_ENABLED = 'true';
    process.env.LAYA_MODE = 'assisted';
    process.env.LAYA_FAIL_OPEN = 'false';

    const shadow = getLayaConfig();
    const client = loadLayaConfigFromEnv();

    expect(shadow.enabled).toBe(client.enabled);
    expect(shadow.mode).toBe(client.mode);
    expect(shadow.failOpen).toBe(client.failOpen);
  });

  it('both loaders resolve identical values in shadow mode (default)', () => {
    // Empty environment → AD-2 defaults
    const shadow = getLayaConfig();
    const client = loadLayaConfigFromEnv();

    expect(shadow.enabled).toBe(client.enabled);
    expect(shadow.mode).toBe(client.mode);
    expect(shadow.failOpen).toBe(client.failOpen);
  });

  it('both loaders resolve identical values in automatic mode', () => {
    process.env.LAYA_ENABLED = 'true';
    process.env.LAYA_MODE = 'automatic';

    const shadow = getLayaConfig();
    const client = loadLayaConfigFromEnv();

    expect(shadow.enabled).toBe(client.enabled);
    expect(shadow.mode).toBe(client.mode);
    expect(shadow.failOpen).toBe(client.failOpen);
  });

  it('empty environment resolves enabled=false (AD-2 opt-in default)', () => {
    // No LAYA_ENABLED set
    expect(getLayaConfig().enabled).toBe(false);
    expect(loadLayaConfigFromEnv().enabled).toBe(false);
  });
});
