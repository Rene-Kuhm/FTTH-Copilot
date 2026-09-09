import { describe, expect, it } from 'vitest';
import {
  InvestigationCard,
  SUFFICIENCY_LABELS,
  HYPOTHESIS_SUPPORT_LABELS,
  EVIDENCE_QUALITY_LABELS,
  CHECK_KIND_LABELS,
  getSufficiencyBadgeClass,
  getHypothesisSupportBadgeClass,
  getEvidenceQualityBadgeClass,
  formatEvidenceQuality,
  formatHypothesisSupport,
  formatSufficiency,
  formatCheckKind,
  assertReadOnlyCheckKind,
  buildRefreshInvestigationPayload,
} from '../../components/InvestigationCard';
import type {
  HypothesisSupportLevel,
  InvestigationCheckKind,
  InvestigationResult,
  InvestigationSufficiencyState,
} from '@ftth-copilot/shared';

describe('InvestigationCard — snapshot-locked Spanish UI labels', () => {
  it('maps all sufficiency states to clear human labels without numeric scores', () => {
    expect(SUFFICIENCY_LABELS.sufficient).toBe('Suficiente');
    expect(SUFFICIENCY_LABELS.provisional).toBe('Provisional');
    expect(SUFFICIENCY_LABELS.insufficient).toBe('Insuficiente');

    expect(formatSufficiency('sufficient')).toBe('Suficiente');
    expect(formatSufficiency('provisional')).toBe('Provisional');
    expect(formatSufficiency('insufficient')).toBe('Insuficiente');
  });

  it('maps hypothesis support levels to explainable labels (no confidence percentages)', () => {
    expect(HYPOTHESIS_SUPPORT_LABELS.supported).toBe('Respaldada');
    expect(HYPOTHESIS_SUPPORT_LABELS.contradicted).toBe('Contradicha');
    expect(HYPOTHESIS_SUPPORT_LABELS.mixed).toBe('Mixta');
    expect(HYPOTHESIS_SUPPORT_LABELS.unverified).toBe('No verificada');

    expect(formatHypothesisSupport('supported')).toBe('Respaldada');
    expect(formatHypothesisSupport('contradicted')).toBe('Contradicha');
    expect(formatHypothesisSupport('mixed')).toBe('Mixta');
    expect(formatHypothesisSupport('unverified')).toBe('No verificada');
  });

  it('maps evidence quality to descriptive labels', () => {
    expect(EVIDENCE_QUALITY_LABELS.fresh).toBe('Vigente');
    expect(EVIDENCE_QUALITY_LABELS.stale).toBe('Vencida');
    expect(EVIDENCE_QUALITY_LABELS.insufficient).toBe('Insuficiente');
    expect(EVIDENCE_QUALITY_LABELS.unknown).toBe('Desconocida');
    expect(EVIDENCE_QUALITY_LABELS.error).toBe('Error');

    expect(formatEvidenceQuality('fresh')).toBe('Vigente');
    expect(formatEvidenceQuality('stale')).toBe('Vencida');
  });

  it('maps check kinds to readable names', () => {
    expect(CHECK_KIND_LABELS.observe_only).toBe('Observación directa');
    expect(CHECK_KIND_LABELS.topology_lookup).toBe('Consulta de topología');
    expect(CHECK_KIND_LABELS.recent_events).toBe('Eventos recientes');
    expect(CHECK_KIND_LABELS.metric_history).toBe('Historial de métricas');

    expect(formatCheckKind('observe_only')).toBe('Observación directa');
    expect(formatCheckKind('topology_lookup')).toBe('Consulta de topología');
  });
});

describe('InvestigationCard — safety constraints and read-only enforcement', () => {
  it('strictly rejects non-read-only check kinds', () => {
    const validKinds: InvestigationCheckKind[] = [
      'observe_only',
      'topology_lookup',
      'recent_events',
      'metric_history',
    ];

    for (const kind of validKinds) {
      expect(assertReadOnlyCheckKind(kind)).toBe(true);
    }

    expect(() => assertReadOnlyCheckKind('reboot_onu' as unknown as InvestigationCheckKind)).toThrow(
      /read-only check kinds allowed/,
    );
    expect(() => assertReadOnlyCheckKind('provision_profile' as unknown as InvestigationCheckKind)).toThrow(
      /read-only check kinds allowed/,
    );
  });

  it('never outputs numeric confidence percentages for hypothesis support', () => {
    const levels: HypothesisSupportLevel[] = ['supported', 'contradicted', 'mixed', 'unverified'];
    for (const level of levels) {
      const label = formatHypothesisSupport(level);
      expect(label).not.toMatch(/%/);
      expect(label).not.toMatch(/\d+/);
    }
  });
});

describe('InvestigationCard — styling badge classes', () => {
  it('returns distinct badge styles for sufficiency levels', () => {
    const sufficientClass = getSufficiencyBadgeClass('sufficient');
    const provisionalClass = getSufficiencyBadgeClass('provisional');
    const insufficientClass = getSufficiencyBadgeClass('insufficient');

    expect(sufficientClass).toContain('emerald');
    expect(provisionalClass).toContain('amber');
    expect(insufficientClass).toContain('rose');
  });

  it('returns distinct badge styles for hypothesis support levels', () => {
    expect(getHypothesisSupportBadgeClass('supported')).toContain('emerald');
    expect(getHypothesisSupportBadgeClass('contradicted')).toContain('rose');
    expect(getHypothesisSupportBadgeClass('mixed')).toContain('amber');
    expect(getHypothesisSupportBadgeClass('unverified')).toContain('neutral');
  });

  it('returns distinct badge styles for evidence quality', () => {
    expect(getEvidenceQualityBadgeClass('fresh')).toContain('emerald');
    expect(getEvidenceQualityBadgeClass('stale')).toContain('amber');
    expect(getEvidenceQualityBadgeClass('insufficient')).toContain('rose');
    expect(getEvidenceQualityBadgeClass('unknown')).toContain('neutral');
    expect(getEvidenceQualityBadgeClass('error')).toContain('rose');
  });
});

describe('InvestigationCard — request builders', () => {
  it('builds refresh payload with refresh flag', () => {
    const payload = buildRefreshInvestigationPayload();
    expect(payload).toEqual({ refresh: true });
  });

  it('exports InvestigationCard React component', () => {
    expect(typeof InvestigationCard).toBe('function');
  });

  it('formats all components of a valid InvestigationResult snapshot', () => {
    const mockResult: InvestigationResult = {
      schema: 'ftth.investigation-result.v1',
      resultId: 'res-1',
      runId: 'run-1',
      versionId: 'ver-1',
      tenantId: 'tenant-1',
      connectionId: 'conn-1',
      incidentId: 'inc-1',
      windowStart: '2026-09-08T00:00:00.000Z',
      windowEnd: '2026-09-09T00:00:00.000Z',
      windowDays: 1,
      cutoffAt: '2026-09-09T00:00:00.000Z',
      rulesetVersion: 'rules-v1',
      modelVersion: 'claude-3-5-sonnet',
      promptVersion: 'p-v1',
      sufficiency: 'sufficient',
      sufficiencyReason: 'Se cuenta con telemetría óptica y eventos de syslog consistentes.',
      producedAt: '2026-09-09T00:05:00.000Z',
      producedBy: 'agent-core@1.0.0',
      evidenceRefs: [
        {
          evidenceRefId: 'ev-1',
          kind: 'metric',
          source: 'poll:rx_power',
          observedAt: '2026-09-09T00:00:00.000Z',
          summary: 'Atenuación óptica de -27.5 dBm',
          quality: 'fresh',
          qualityReason: 'Muestra reciente dentro del intervalo de 15m',
        },
      ],
      hypotheses: [
        {
          hypothesisId: 'hyp-1',
          summary: 'Degradación física de fibra o conector sucio en CTO.',
          supportLevel: 'supported',
          forRefIds: ['ev-1'],
          againstRefIds: [],
        },
      ],
      contradictions: [
        {
          evidenceRefId: 'ev-1',
          note: 'No se observan microcortes en el registro del puerto PON.',
        },
      ],
      missing: [
        {
          what: 'Curva de reflectometría OTDR histórica',
          whyItMatters: 'Permitiría descartar dobleces en la acometida del abonado.',
        },
      ],
      suggestedChecks: [
        {
          checkId: 'chk-1',
          kind: 'topology_lookup',
          description: 'Inspeccionar clientes vecinos en el mismo splitter.',
          expectedToResolve: 'Confirmar si la degradación es aislada o masiva.',
        },
      ],
    };

    expect(formatSufficiency(mockResult.sufficiency)).toBe('Suficiente');
    expect(formatHypothesisSupport(mockResult.hypotheses[0].supportLevel)).toBe('Respaldada');
    expect(formatEvidenceQuality(mockResult.evidenceRefs[0].quality)).toBe('Vigente');
    expect(formatCheckKind(mockResult.suggestedChecks[0].kind)).toBe('Consulta de topología');
    expect(assertReadOnlyCheckKind(mockResult.suggestedChecks[0].kind)).toBe(true);
  });
});

