/**
 * ODN Hint Extractor (Roadmap Fase ODN).
 *
 * Extracts hints about Optical Distribution Network components (NAP, CTO, Splitter, FDH, FAT)
 * from SNMP trap varbinds. The extractor is intentionally conservative: it only emits a
 * hint when a varbind value explicitly names an ODN component. Per the evidence-first
 * principle, this module MUST NOT infer or invent ODN components.
 *
 * Hints are advisory metadata attached to TelemetryEvent. Operators must confirm them
 * against registered topology edges before they become authoritative.
 */

import type { OdnComponentHint } from '@ftth-copilot/connectors-core';
import type { DecodedSnmpNotification } from '../types';

/**
 * Patterns that explicitly reference ODN components in varbind OIDs or values.
 *
 * These patterns are intentionally conservative: a match must contain a keyword
 * plus a value that looks like a registered identifier (alphanumeric, hyphens,
 * underscores). Anything more aggressive would risk false positives.
 */
const ODN_PATTERNS: ReadonlyArray<{
  hintKind: OdnComponentHint['kind'];
  oidSubstrings: readonly string[];
  valueRegex: RegExp;
  confidence: OdnComponentHint['confidence'];
}> = [
  {
    hintKind: 'SPLITTER',
    oidSubstrings: ['splitter', 'split', 'odf'],
    valueRegex: /\b(?:SPL|SPLITTER|SP)[-_][A-Z0-9-]{2,}\b/i,
    confidence: 'high',
  },
  {
    hintKind: 'CTO',
    oidSubstrings: ['cto', 'caja-terminal', 'fat'],
    valueRegex: /\bCTO[-_][A-Z0-9-]{2,}\b|\bFAT[-_][A-Z0-9-]{2,}\b/i,
    confidence: 'high',
  },
  {
    hintKind: 'NAP',
    oidSubstrings: ['nap', 'odb', 'nap-'],
    valueRegex: /\bNAP[-_][A-Z0-9-]{2,}\b|\bODB[-_][A-Z0-9-]{2,}\b/i,
    confidence: 'high',
  },
  {
    hintKind: 'FDH',
    oidSubstrings: ['fdh', 'distribution-hub'],
    valueRegex: /\bFDH[-_][A-Z0-9-]{2,}\b/i,
    confidence: 'medium',
  },
];

/**
 * Extract ODN component hints from a decoded SNMP notification.
 *
 * @returns array of hints (empty if no explicit ODN reference is found in varbinds).
 */
export function extractOdnHints(notification: DecodedSnmpNotification): OdnComponentHint[] {
  const hints: OdnComponentHint[] = [];
  const seen = new Set<string>();

  for (const vb of notification.varbinds) {
    const oidLower = vb.oid.toLowerCase();
    const valueStr = vb.value !== null && vb.value !== undefined ? String(vb.value) : '';

    for (const pattern of ODN_PATTERNS) {
      // Match on either OID substring or value regex
      const oidMatches = pattern.oidSubstrings.some((sub) => oidLower.includes(sub));
      const valueMatches = valueStr.length > 0 && pattern.valueRegex.test(valueStr);

      if (!oidMatches && !valueMatches) continue;

      // Extract candidate ID from value, otherwise from OID last segment
      const candidateId = extractCandidateId(valueStr, vb.oid, pattern.hintKind);
      if (!candidateId) continue;

      const dedupeKey = `${pattern.hintKind}:${candidateId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      hints.push({
        kind: pattern.hintKind,
        candidateId,
        sourceTrapOid: notification.trapOid,
        confidence: pattern.confidence,
        evidence: {
          oid: vb.oid,
          value: valueStr.slice(0, 256),
        },
      });
    }
  }

  return hints;
}

function extractCandidateId(value: string, oid: string, kind: string): string | null {
  // Prefer the value if it matches a recognizable pattern
  const valueMatch = value.match(/[A-Z]{2,}[-_][A-Z0-9-]{2,}/i);
  if (valueMatch) {
    return valueMatch[0].toUpperCase();
  }

  // Fall back to the last OID segment, prefixed by kind
  const parts = oid.split('.');
  const last = parts[parts.length - 1];
  if (last && /^\d+$/.test(last)) {
    return `${kind}-${last}`;
  }

  return null;
}
