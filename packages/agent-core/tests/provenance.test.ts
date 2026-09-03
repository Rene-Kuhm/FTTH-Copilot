import { describe, expect, it } from 'vitest';
import {
  PROVENANCE_TOOL_META,
  defaultProvenance,
  deriveSource,
} from '../src/tools/provenance';
import { DEFAULT_TTL_MS, DEMO_TTL_MS } from '@ftth-copilot/shared';

describe('deriveSource', () => {
  it('maps get_predicted_issues to curated source', () => {
    expect(deriveSource('live', 'smartolt', 'get_predicted_issues')).toBe('curated');
    expect(deriveSource('demo', 'smartolt', 'get_predicted_issues')).toBe('curated');
  });

  it('derives live mode with .poll suffix', () => {
    expect(deriveSource('live', 'smartolt', 'list_olts')).toBe('smartolt.poll');
  });

  it('derives demo mode with .demo suffix', () => {
    expect(deriveSource('demo', 'smartolt', 'list_olts')).toBe('smartolt.demo');
  });

  it('lowercases the provider name', () => {
    expect(deriveSource('live', 'SMARTOLT', 'list_olts')).toBe('smartolt.poll');
  });

  it('uses source override when provided', () => {
    expect(deriveSource('live', 'smartolt', 'list_olts', 'custom')).toBe('custom');
  });
});

describe('defaultProvenance', () => {
  it('uses the default TTL for live mode', () => {
    expect(defaultProvenance('live')).toBe(DEFAULT_TTL_MS);
  });

  it('uses the longer TTL for demo mode', () => {
    expect(defaultProvenance('demo')).toBe(DEMO_TTL_MS);
  });
});

describe('PROVENANCE_TOOL_META', () => {
  it('defines get_predicted_issues as minimal with low confidence and custom TTL', () => {
    const meta = PROVENANCE_TOOL_META.get_predicted_issues;
    expect(meta.completeness).toBe('minimal');
    expect(meta.confidence).toBe(0.5);
    expect(meta.ttlOverrideMs).toBe(60000);
  });

  it('defines list_olts as complete with full confidence', () => {
    const meta = PROVENANCE_TOOL_META.list_olts;
    expect(meta.completeness).toBe('complete');
    expect(meta.confidence).toBe(1.0);
    expect(meta.ttlOverrideMs).toBeUndefined();
  });

  it('defines get_onu_detail as partial with 0.8 confidence', () => {
    const meta = PROVENANCE_TOOL_META.get_onu_detail;
    expect(meta.completeness).toBe('partial');
    expect(meta.confidence).toBe(0.8);
    expect(meta.ttlOverrideMs).toBeUndefined();
  });

  it('defines get_onus_with_low_signal as partial with 0.8 confidence', () => {
    const meta = PROVENANCE_TOOL_META.get_onus_with_low_signal;
    expect(meta.completeness).toBe('partial');
    expect(meta.confidence).toBe(0.8);
    expect(meta.ttlOverrideMs).toBeUndefined();
  });

  it('defines search_by_customer_name as partial with 0.8 confidence', () => {
    const meta = PROVENANCE_TOOL_META.search_by_customer_name;
    expect(meta.completeness).toBe('partial');
    expect(meta.confidence).toBe(0.8);
    expect(meta.ttlOverrideMs).toBeUndefined();
  });

  it('defines get_olt_detail as complete with full confidence', () => {
    const meta = PROVENANCE_TOOL_META.get_olt_detail;
    expect(meta.completeness).toBe('complete');
    expect(meta.confidence).toBe(1.0);
    expect(meta.ttlOverrideMs).toBeUndefined();
  });

  it('defines get_network_overview as complete with full confidence', () => {
    const meta = PROVENANCE_TOOL_META.get_network_overview;
    expect(meta.completeness).toBe('complete');
    expect(meta.confidence).toBe(1.0);
    expect(meta.ttlOverrideMs).toBeUndefined();
  });

  it('defines list_onus as complete with full confidence', () => {
    const meta = PROVENANCE_TOOL_META.list_onus;
    expect(meta.completeness).toBe('complete');
    expect(meta.confidence).toBe(1.0);
    expect(meta.ttlOverrideMs).toBeUndefined();
  });
});
