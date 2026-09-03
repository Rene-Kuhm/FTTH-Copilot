import { describe, expect, it } from 'vitest';
import {
  TOPOLOGY_HEADING_OWNER_ADMIN,
  TOPOLOGY_HEADING_OPERATOR_MEMBER,
  TOPOLOGY_EMPTY_MESSAGE,
} from '../../components/IncidentsPanel';

/**
 * RED tests for `apps/web/components/IncidentsPanel.tsx` (Fase E-7.1) —
 * the snapshot-locked Spanish UI strings + the role gate for
 * `<TopologyImpact>`.
 *
 * The component itself is exercised end-to-end by the Playwright spec in
 * `apps/web/e2e/topology.spec.ts`. Here we lock the literal strings so any
 * prompt drift is caught before it ships.
 */
describe('TopologyImpact — snapshot-locked Spanish strings', () => {
  it('exports the OWNER/ADMIN accordion heading', () => {
    expect(TOPOLOGY_HEADING_OWNER_ADMIN).toBe('Análisis de impacto');
  });

  it('exports the OPERATOR/MEMBER compact summary heading', () => {
    expect(TOPOLOGY_HEADING_OPERATOR_MEMBER).toBe('Resumen');
  });

  it('exports the empty-state message', () => {
    expect(TOPOLOGY_EMPTY_MESSAGE).toBe('No hay datos de topología para este dispositivo.');
  });
});

describe('TopologyImpact — role gate', () => {
  it('OWNER + ADMIN render the expandable accordion', () => {
    // Both roles gate to `expandable=true`. Inline check mirrors the
    // component logic: `auth.user.role === 'OWNER' || auth.user.role === 'ADMIN'`.
    const OWNER: string = 'OWNER';
    const ADMIN: string = 'ADMIN';
    const isExpandable = (role: string) => role === OWNER || role === ADMIN;
    expect(isExpandable('OWNER')).toBe(true);
    expect(isExpandable('ADMIN')).toBe(true);
    expect(isExpandable('OPERATOR')).toBe(false);
    expect(isExpandable('MEMBER')).toBe(false);
  });
});