import type { InvestigationEvidenceRef } from '@ftth-copilot/shared';

export interface OpticalFacts {
  sampleCount: number;
  minRxPower: number | null;
  maxRxPower: number | null;
  avgRxPower: number | null;
  deltaRxPower: number | null;
  hasCriticalAttenuation: boolean; // Rx < -27.0 dBm
  hasWarningAttenuation: boolean;  // Rx < -25.0 dBm
}

export interface EventFacts {
  totalEvents: number;
  dyingGaspCount: number;
  losCount: number;
  linkDownCount: number;
  indicatesPowerLoss: boolean;
  indicatesFiberCut: boolean;
}

export interface TopologyFacts {
  hopCount: number;
  ancestors: string[];
}

export interface HistoryFacts {
  incidentCount: number;
  hasPriorIncidents: boolean;
  summaries: string[];
}

export interface InvestigationFacts {
  optical: OpticalFacts;
  events: EventFacts;
  topology: TopologyFacts;
  history: HistoryFacts;
  deterministicMissing: Array<{ what: string; whyItMatters?: string }>;
}

const RX_POWER_REGEX = /rx[-_ ]?power[:= ]+([+-]?\d+(?:\.\d+)?)/i;
const RX_DBM_REGEX = /([+-]?\d+(?:\.\d+)?)\s*dBm/i;

function parseRxPower(summary: string): number | null {
  const match = RX_POWER_REGEX.exec(summary);
  if (match) {
    const val = parseFloat(match[1]);
    if (!Number.isNaN(val)) return val;
  }
  const dbmMatch = RX_DBM_REGEX.exec(summary);
  if (dbmMatch) {
    const val = parseFloat(dbmMatch[1]);
    if (!Number.isNaN(val)) return val;
  }
  return null;
}

/**
 * Pure function to extract deterministic facts from collected evidence refs.
 * No LLM or DB dependency.
 */
export function computeInvestigationFacts(
  evidenceRefs: InvestigationEvidenceRef[],
): InvestigationFacts {
  // 1. Optical facts
  const rxValues: number[] = [];
  for (const ref of evidenceRefs) {
    if (ref.kind === 'metric') {
      const parsed = parseRxPower(ref.summary);
      if (parsed !== null) {
        rxValues.push(parsed);
      }
    }
  }

  let minRxPower: number | null = null;
  let maxRxPower: number | null = null;
  let avgRxPower: number | null = null;
  let deltaRxPower: number | null = null;
  let hasCriticalAttenuation = false;
  let hasWarningAttenuation = false;

  if (rxValues.length > 0) {
    minRxPower = Math.min(...rxValues);
    maxRxPower = Math.max(...rxValues);
    const sum = rxValues.reduce((a, b) => a + b, 0);
    avgRxPower = parseFloat((sum / rxValues.length).toFixed(2));
    deltaRxPower = parseFloat((maxRxPower - minRxPower).toFixed(2));
    hasCriticalAttenuation = minRxPower < -27.0;
    hasWarningAttenuation = minRxPower < -25.0;
  }

  const optical: OpticalFacts = {
    sampleCount: rxValues.length,
    minRxPower,
    maxRxPower,
    avgRxPower,
    deltaRxPower,
    hasCriticalAttenuation,
    hasWarningAttenuation,
  };

  // 2. Event facts
  let dyingGaspCount = 0;
  let losCount = 0;
  let linkDownCount = 0;
  let totalEvents = 0;

  for (const ref of evidenceRefs) {
    if (ref.kind === 'event') {
      totalEvents++;
      const text = (ref.summary + ' ' + ref.source).toLowerCase();
      if (text.includes('dying-gasp') || text.includes('dying gasp') || text.includes('power loss')) {
        dyingGaspCount++;
      }
      if (text.includes('loss-of-signal') || text.includes('los') || text.includes('signal loss')) {
        losCount++;
      }
      if (text.includes('link-down') || text.includes('linkdown') || text.includes('down')) {
        linkDownCount++;
      }
    }
  }

  const indicatesPowerLoss = dyingGaspCount > 0;
  const indicatesFiberCut = losCount > 0 && dyingGaspCount === 0;

  const events: EventFacts = {
    totalEvents,
    dyingGaspCount,
    losCount,
    linkDownCount,
    indicatesPowerLoss,
    indicatesFiberCut,
  };

  // 3. Topology facts
  const ancestors: string[] = [];
  let hopCount = 0;
  for (const ref of evidenceRefs) {
    if (ref.kind === 'topology') {
      hopCount++;
      // Extract hop name if present
      const colonIdx = ref.summary.indexOf(':');
      if (colonIdx !== -1) {
        ancestors.push(ref.summary.substring(colonIdx + 1).trim());
      } else {
        ancestors.push(ref.summary);
      }
    }
  }

  const topology: TopologyFacts = {
    hopCount,
    ancestors,
  };

  // 4. Historical incident facts
  const historySummaries: string[] = [];
  let incidentCount = 0;
  for (const ref of evidenceRefs) {
    if (ref.kind === 'incident_history') {
      incidentCount++;
      historySummaries.push(ref.summary);
    }
  }

  const history: HistoryFacts = {
    incidentCount,
    hasPriorIncidents: incidentCount > 0,
    summaries: historySummaries,
  };

  // 5. Deterministic missing observations
  const deterministicMissing: Array<{ what: string; whyItMatters?: string }> = [];

  if (optical.sampleCount === 0) {
    deterministicMissing.push({
      what: 'Muestras de telemetría óptica (potencia Rx/Tx)',
      whyItMatters: 'Permite confirmar o descartar atenuación excesiva o corte de fibra',
    });
  }

  if (events.totalEvents === 0) {
    deterministicMissing.push({
      what: 'Registros de eventos o alarmas en el período',
      whyItMatters: 'Permite correlacionar la hora exacta de la desconexión',
    });
  }

  return {
    optical,
    events,
    topology,
    history,
    deterministicMissing,
  };
}
