import type { InvestigationEvidenceRef } from '@ftth-copilot/shared';
import type { InvestigationFacts } from './investigation-facts';

export const INVESTIGATION_PROMPT_VERSION = 'prompt-investigation@1.0.0';
export const INVESTIGATION_RULESET_VERSION = 'ruleset-investigation@1.0.0';

export function buildInvestigationSystemPrompt(
  facts: InvestigationFacts,
  evidenceRefs: InvestigationEvidenceRef[],
): string {
  const evidenceCatalog = evidenceRefs
    .map(
      (ref) =>
        `- ID: "${ref.evidenceRefId}" | Kind: ${ref.kind} | Source: ${ref.source} | Observed: ${ref.observedAt} | Quality: ${ref.quality} | Summary: ${ref.summary}`,
    )
    .join('\n');

  const deterministicSummary = [
    `- Optical: samples=${facts.optical.sampleCount}, minRx=${facts.optical.minRxPower ?? 'N/A'} dBm, maxRx=${facts.optical.maxRxPower ?? 'N/A'} dBm, delta=${facts.optical.deltaRxPower ?? 'N/A'} dB, criticalAttenuation=${facts.optical.hasCriticalAttenuation}, warningAttenuation=${facts.optical.hasWarningAttenuation}`,
    `- Events: total=${facts.events.totalEvents}, dyingGasp=${facts.events.dyingGaspCount}, los=${facts.events.losCount}, linkDown=${facts.events.linkDownCount}, indicatesPowerLoss=${facts.events.indicatesPowerLoss}, indicatesFiberCut=${facts.events.indicatesFiberCut}`,
    `- Topology: hops=${facts.topology.hopCount}, ancestors=[${facts.topology.ancestors.join(', ')}]`,
    `- History: priorIncidents=${facts.history.incidentCount} (context only, not current proof)`,
  ].join('\n');

  return `You are the FTTH-Copilot Cognitive Investigation Engine for NOC incident diagnosis.
Your role is to formulate competing hypotheses, identify contradictions, note missing evidence, and suggest read-only checks based strictly on the provided evidence and deterministic facts.

### RULES & CONSTRAINTS:
1. CITATION INTEGRITY: In hypotheses, 'forRefIds' and 'againstRefIds' MUST ONLY contain IDs from the AVAILABLE EVIDENCE list below. Never invent reference IDs.
2. CONTRADICTIONS: 'evidenceRefId' MUST match an ID from the AVAILABLE EVIDENCE list.
3. EXPLAINABLE SUPPORT: 'supportLevel' must be one of: 'supported', 'contradicted', 'mixed', 'unverified'. Do not invent numeric percentages.
4. READ-ONLY CHECKS: 'kind' for suggested checks must be one of: 'observe_only', 'topology_lookup', 'recent_events', 'metric_history'. Operations modifying network state (reboot, provision, config change) are STRICTLY FORBIDDEN (Roadmap Regla 8).
5. SUFFICIENCY: 'sufficiency' must be 'sufficient', 'provisional', or 'insufficient'.
6. HISTORICAL INCIDENTS: Any prior confirmed incidents are background context only; never cite them as proof of the current root cause.
7. OUTPUT FORMAT: Respond ONLY with a valid JSON object with the following schema:

\`\`\`json
{
  "hypotheses": [
    {
      "hypothesisId": "string (e.g. hyp-power-loss)",
      "summary": "string describing the hypothesis",
      "supportLevel": "supported" | "contradicted" | "mixed" | "unverified",
      "forRefIds": ["evidenceRefId"],
      "againstRefIds": ["evidenceRefId"]
    }
  ],
  "contradictions": [
    {
      "evidenceRefId": "evidenceRefId",
      "note": "string"
    }
  ],
  "missing": [
    {
      "what": "string",
      "whyItMatters": "string (optional)"
    }
  ],
  "suggestedChecks": [
    {
      "checkId": "string (e.g. chk-1)",
      "kind": "observe_only" | "topology_lookup" | "recent_events" | "metric_history",
      "description": "string",
      "expectedToResolve": "string (optional)"
    }
  ],
  "sufficiency": "sufficient" | "provisional" | "insufficient",
  "sufficiencyReason": "string"
}
\`\`\`

### DETERMINISTIC FACTS:
${deterministicSummary}

### AVAILABLE EVIDENCE (IDs allowed for citations):
${evidenceCatalog || '(No evidence available)'}
`;
}

export function buildInvestigationUserMessage(context: {
  incidentId: string | null;
  connectionId: string | null;
  tenantId: string;
}): string {
  return `Please investigate incident ${context.incidentId ?? 'N/A'} for connection ${context.connectionId ?? 'N/A'} in tenant ${context.tenantId} based on the evidence provided in the system prompt.`;
}

export function extractJsonFromLlmText(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Try finding ```json ... ``` or first { ... }
    const matchJsonBlock = /```(?:json)?\s*([\s\S]*?)\s*```/.exec(trimmed);
    if (matchJsonBlock) {
      try {
        return JSON.parse(matchJsonBlock[1].trim()) as Record<string, unknown>;
      } catch {
        // continue
      }
    }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        const substr = trimmed.substring(firstBrace, lastBrace + 1);
        return JSON.parse(substr) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}
