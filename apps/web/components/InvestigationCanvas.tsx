'use client';

/**
 * InvestigationCanvas — Canvas-grid surface for the cognitive
 * investigation result (Fase 3, #128).
 *
 * Background:
 *
 * Roadmap canvas PR #3 — the second consumer of the CanvasGrid
 * primitive (PR #169). Renders the five canonical sections of an
 * InvestigationResult as importance-aware, drag-resizable panels:
 *
 *   - evidenceRefs      (low importance, list)
 *   - missing           (low importance, list)
 *   - contradictions    (medium importance, list)
 *   - suggestedChecks   (medium importance, list)
 *   - hypotheses        (high importance, ranked)
 *
 * The original InvestigationCard renders the same content as a
 * stacked layout. InvestigationCanvas is additive: the production
 * switchover is a separate, follow-up PR that flips the default.
 *
 * The component is also a thin wrapper around CanvasGrid; the only
 * domain logic here is the importance mapping per section, the
 * empty-state copy, and the per-section rendering.
 */

import { CanvasGrid, type PanelDescriptor } from './canvas';
import type {
  InvestigationResult,
  InvestigationSufficiencyState,
} from '@ftth-copilot/shared';

export interface InvestigationCanvasProps {
  result: InvestigationResult;
  /** Storage scope — usually the conversation or incident id. */
  storageScope: string;
  /** Read-only mode (drag/resize disabled). Default false. */
  readOnly?: boolean;
  /** Optional render override for individual sections. */
  renderSection?: (
    section:
      | 'sufficiency'
      | 'evidenceRefs'
      | 'hypotheses'
      | 'contradictions'
      | 'missing'
      | 'suggestedChecks',
  ) => React.ReactNode;
}

const SUFFICIENCY_LABEL: Record<InvestigationSufficiencyState, string> = {
  sufficient: 'Suficiente',
  provisional: 'Provisional',
  insufficient: 'Insuficiente',
};

export function InvestigationCanvas(props: InvestigationCanvasProps): React.ReactElement {
  const { result } = props;
  const panels: PanelDescriptor[] = [
    {
      id: 'sufficiency',
      title: 'Suficiencia',
      importance: 5,
      desiredW: 12,
      desiredH: 2,
      minH: 2,
      content: props.renderSection ? (
        props.renderSection('sufficiency')
      ) : (
        <SufficiencyPanel
          state={result.sufficiency}
          reason={result.sufficiencyReason}
          cutoffAt={result.cutoffAt}
          producedAt={result.producedAt}
        />
      ),
    },
    {
      id: 'hypotheses',
      title: `Hipótesis (${result.hypotheses.length})`,
      importance: 5,
      desiredW: 8,
      desiredH: 4,
      minW: 4,
      minH: 3,
      content: props.renderSection ? (
        props.renderSection('hypotheses')
      ) : (
        <HypothesesListPanel hypotheses={result.hypotheses} />
      ),
    },
    {
      id: 'contradictions',
      title: `Contradicciones (${result.contradictions.length})`,
      importance: 3,
      desiredW: 6,
      desiredH: 3,
      minH: 2,
      content: props.renderSection ? (
        props.renderSection('contradictions')
      ) : (
        <ContradictionsListPanel contradictions={result.contradictions} />
      ),
    },
    {
      id: 'evidenceRefs',
      title: `Evidencia (${result.evidenceRefs.length})`,
      importance: 2,
      desiredW: 6,
      desiredH: 3,
      minH: 2,
      content: props.renderSection ? (
        props.renderSection('evidenceRefs')
      ) : (
        <EvidenceListPanel items={result.evidenceRefs} />
      ),
    },
    {
      id: 'suggestedChecks',
      title: `Comprobaciones sugeridas (${result.suggestedChecks.length})`,
      importance: 3,
      desiredW: 6,
      desiredH: 3,
      minH: 2,
      content: props.renderSection ? (
        props.renderSection('suggestedChecks')
      ) : (
        <ChecksListPanel checks={result.suggestedChecks} />
      ),
    },
    {
      id: 'missing',
      title: `Faltantes (${result.missing.length})`,
      importance: 2,
      desiredW: 6,
      desiredH: 3,
      minH: 2,
      content: props.renderSection ? (
        props.renderSection('missing')
      ) : (
        <MissingListPanel items={result.missing} />
      ),
    },
  ];

  return (
    <CanvasGrid
      panels={panels}
      storageScope={props.storageScope}
      mode={props.readOnly ? 'readonly' : 'editable'}
    />
  );
}

function PanelShell({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        height: '100%',
        overflow: 'auto',
      }}
    >
      {children}
    </div>
  );
}

function SufficiencyPanel(props: {
  state: InvestigationSufficiencyState;
  reason: string;
  cutoffAt: string;
  producedAt: string;
}): React.ReactElement {
  return (
    <PanelShell>
      <strong style={{ fontSize: 14 }}>{SUFFICIENCY_LABEL[props.state]}</strong>
      <span style={{ fontSize: 12, opacity: 0.85 }}>{props.reason}</span>
      <span style={{ fontSize: 11, opacity: 0.6 }}>
        Corte {new Date(props.cutoffAt).toLocaleString('es-AR')} ·
        Producido {new Date(props.producedAt).toLocaleString('es-AR')}
      </span>
    </PanelShell>
  );
}

function HypothesesListPanel(props: {
  hypotheses: InvestigationResult['hypotheses'];
}): React.ReactElement {
  if (props.hypotheses.length === 0) {
    return <Empty text="Sin hipótesis." />;
  }
  return (
    <PanelShell>
      {props.hypotheses.map((h) => (
        <div key={h.hypothesisId} style={{ borderBottom: '1px solid #1e293b', padding: '4px 0' }}>
          <strong style={{ fontSize: 13 }}>{h.summary}</strong>
          <div style={{ fontSize: 11, opacity: 0.7 }}>
            soporte: {h.supportLevel} · a favor: {h.forRefIds.length} · en contra: {h.againstRefIds.length}
          </div>
        </div>
      ))}
    </PanelShell>
  );
}

function ContradictionsListPanel(props: {
  contradictions: InvestigationResult['contradictions'];
}): React.ReactElement {
  if (props.contradictions.length === 0) {
    return <Empty text="Sin contradicciones detectadas." />;
  }
  return (
    <PanelShell>
      {props.contradictions.map((c, i) => (
        <div key={`${c.evidenceRefId}-${i}`} style={{ padding: '4px 0' }}>
          <div style={{ fontSize: 11, opacity: 0.7 }}>ref: {c.evidenceRefId}</div>
          <div style={{ fontSize: 12 }}>{c.note}</div>
        </div>
      ))}
    </PanelShell>
  );
}

function EvidenceListPanel(props: {
  items: InvestigationResult['evidenceRefs'];
}): React.ReactElement {
  if (props.items.length === 0) {
    return <Empty text="Sin referencias de evidencia." />;
  }
  return (
    <PanelShell>
      {props.items.map((r) => (
        <div key={r.evidenceRefId} style={{ padding: '4px 0', borderBottom: '1px solid #1e293b' }}>
          <div style={{ fontSize: 11, opacity: 0.7 }}>
            {r.kind} · {r.source} · calidad: {r.quality} ({r.qualityReason})
          </div>
          <div style={{ fontSize: 12 }}>{r.summary}</div>
        </div>
      ))}
    </PanelShell>
  );
}

function ChecksListPanel(props: {
  checks: InvestigationResult['suggestedChecks'];
}): React.ReactElement {
  if (props.checks.length === 0) {
    return <Empty text="Sin comprobaciones sugeridas." />;
  }
  return (
    <PanelShell>
      {props.checks.map((c) => (
        <div key={c.checkId} style={{ padding: '4px 0' }}>
          <strong style={{ fontSize: 12 }}>{c.kind}</strong>
          <div style={{ fontSize: 12 }}>{c.description}</div>
          {c.expectedToResolve !== undefined && c.expectedToResolve !== '' ? (
            <div style={{ fontSize: 11, opacity: 0.7 }}>{c.expectedToResolve}</div>
          ) : null}
        </div>
      ))}
    </PanelShell>
  );
}

function MissingListPanel(props: {
  items: InvestigationResult['missing'];
}): React.ReactElement {
  if (props.items.length === 0) {
    return <Empty text="Sin observaciones faltantes." />;
  }
  return (
    <PanelShell>
      {props.items.map((m, i) => (
        <div key={i} style={{ padding: '4px 0' }}>
          <div style={{ fontSize: 12 }}>{m.what}</div>
          {m.whyItMatters !== undefined && m.whyItMatters !== '' ? (
            <div style={{ fontSize: 11, opacity: 0.7 }}>{m.whyItMatters}</div>
          ) : null}
        </div>
      ))}
    </PanelShell>
  );
}

function Empty({ text }: { text: string }): React.ReactElement {
  return (
    <div style={{ fontSize: 12, opacity: 0.6, fontStyle: 'italic', padding: '8px 4px' }}>
      {text}
    </div>
  );
}
