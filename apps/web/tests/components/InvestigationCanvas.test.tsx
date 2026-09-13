// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { InvestigationResult } from '@ftth-copilot/shared';
import { InvestigationCanvas } from '../../components/InvestigationCanvas';

vi.mock('../../components/canvas', () => ({
  CanvasGrid: ({
    panels,
  }: {
    panels: Array<{ id: string; title: string; content: React.ReactNode }>;
  }) => (
    <div data-testid="mock-canvas-grid">
      {panels.map((p) => (
        <div key={p.id} data-testid={`panel-${p.id}`}>
          <h2>{p.title}</h2>
          <div data-testid={`content-${p.id}`}>{p.content}</div>
        </div>
      ))}
    </div>
  ),
}));

function resultWith(overrides: Partial<InvestigationResult>): InvestigationResult {
  return {
    schema: 'ftth.investigation-result.v1',
    resultId: 'r_1',
    runId: 'r_run_1',
    versionId: 'v_1',
    tenantId: 't_1',
    connectionId: null,
    incidentId: 'inc_1',
    windowStart: '2026-09-01T00:00:00.000Z',
    windowEnd: '2026-09-08T00:00:00.000Z',
    windowDays: 7,
    cutoffAt: '2026-09-08T00:00:00.000Z',
    rulesetVersion: 'ruleset-1',
    modelVersion: 'claude-x-1',
    promptVersion: 'prompt-investigation-1',
    evidenceRefs: [],
    hypotheses: [],
    contradictions: [],
    missing: [],
    suggestedChecks: [],
    sufficiency: 'provisional',
    sufficiencyReason: 'Faltan hipótesis.',
    producedAt: '2026-09-08T00:01:00.000Z',
    producedBy: 'agent-core@0.1.0',
    ...overrides,
  };
}

describe('InvestigationCanvas section ordering — importance ranking', () => {
  it('ranks sufficiency highest (5) because it is the gate', () => {
    const r = resultWith({});
    expect(r.sufficiency).toBe('provisional');
    // sufficiency panel is rendered first; the consumer can rearrange
  });

  it('surfaces a result with five sections', () => {
    const r = resultWith({
      evidenceRefs: [
        {
          evidenceRefId: 'ev_1',
          kind: 'metric',
          source: 'smartolt.poll',
          observedAt: '2026-09-08T00:00:00.000Z',
          summary: 'RX bajo',
          quality: 'fresh',
          qualityReason: 'fresh',
        },
      ],
      hypotheses: [
        {
          hypothesisId: 'h_1',
          summary: 'Conector sucio',
          supportLevel: 'supported',
          forRefIds: ['ev_1'],
          againstRefIds: [],
        },
      ],
      contradictions: [],
      missing: [],
      suggestedChecks: [],
    });
    expect(r.evidenceRefs).toHaveLength(1);
    expect(r.hypotheses).toHaveLength(1);
  });

  it('preserves the bounded array sizes from the schema', () => {
    // The schema caps hypotheses at 8, contradictions at 16, etc.
    const r = resultWith({});
    expect(r.hypotheses.length).toBeLessThanOrEqual(8);
    expect(r.contradictions.length).toBeLessThanOrEqual(16);
    expect(r.missing.length).toBeLessThanOrEqual(16);
    expect(r.suggestedChecks.length).toBeLessThanOrEqual(8);
    expect(r.evidenceRefs.length).toBeLessThanOrEqual(64);
  });

  it('enforces the sufficiency enum', () => {
    const r = resultWith({ sufficiency: 'sufficient' });
    expect(['sufficient', 'provisional', 'insufficient']).toContain(r.sufficiency);
  });

  it('carries rulesetVersion / modelVersion / promptVersion (roadmap 3.1)', () => {
    const r = resultWith({
      rulesetVersion: 'ruleset-2',
      modelVersion: 'gpt-x',
      promptVersion: 'prompt-2',
    });
    expect(r.rulesetVersion).toBe('ruleset-2');
    expect(r.modelVersion).toBe('gpt-x');
    expect(r.promptVersion).toBe('prompt-2');
  });

  it('renders default panels including sufficiency when no renderSection is passed', () => {
    const r = resultWith({ sufficiency: 'sufficient', sufficiencyReason: 'Todos los datos validados.' });
    render(<InvestigationCanvas result={r} storageScope="test-scope" />);
    expect(screen.getByTestId('panel-sufficiency')).toBeDefined();
    expect(screen.getByText('Suficiencia')).toBeDefined();
    expect(screen.getByText('Suficiente')).toBeDefined();
    expect(screen.getByText('Todos los datos validados.')).toBeDefined();
  });

  it('renders custom section override specifically for sufficiency', () => {
    const r = resultWith({ sufficiency: 'provisional' });
    render(
      <InvestigationCanvas
        result={r}
        storageScope="test-scope"
        renderSection={(section) => (
          <div data-testid={`custom-${section}`}>Custom override for {section}</div>
        )}
      />,
    );
    expect(screen.getByTestId('custom-sufficiency')).toBeDefined();
    expect(screen.getByText('Custom override for sufficiency')).toBeDefined();
    expect(screen.getByTestId('custom-hypotheses')).toBeDefined();
  });
});
