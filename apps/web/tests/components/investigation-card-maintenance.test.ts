import { describe, expect, it } from 'vitest';
import {
  MAINTENANCE_CONTEXT_HEADING,
  MAINTENANCE_CONTEXT_DISCLAIMER,
  formatMaintenanceWindowStatus,
  type RelatedMaintenanceWindow,
} from '../../components/InvestigationCard';

describe('InvestigationCard — Maintenance Context (Fase 5 — 5.5)', () => {
  it('defines snapshot-locked Spanish headings and disclaimers', () => {
    expect(MAINTENANCE_CONTEXT_HEADING).toBe('Ventanas de Mantenimiento Relacionadas');
    expect(MAINTENANCE_CONTEXT_DISCLAIMER).toBe('Contexto operativo — no etiquetado como causa raíz');
  });

  it('formats maintenance window statuses correctly', () => {
    expect(formatMaintenanceWindowStatus('scheduled')).toBe('Programado');
    expect(formatMaintenanceWindowStatus('cancelled')).toBe('Cancelado');
    expect(formatMaintenanceWindowStatus('completed')).toBe('Completado');
    expect(formatMaintenanceWindowStatus('in_progress')).toBe('in_progress');
  });

  it('preserves 5.5 requirement that maintenance is context, not root cause', () => {
    const window: RelatedMaintenanceWindow = {
      id: 'win-1',
      title: 'Ventana de empalme troncal',
      description: 'Corte preventivo de fibra para ampliación',
      scope: { kind: 'tenant' },
      startUtc: '2026-09-10T02:00:00.000Z',
      endUtc: '2026-09-10T06:00:00.000Z',
      timezone: 'America/Argentina/Buenos_Aires',
      status: 'scheduled',
    };

    expect(window.title).toBe('Ventana de empalme troncal');
    expect(MAINTENANCE_CONTEXT_DISCLAIMER).toContain('no etiquetado como causa raíz');
  });
});
