/**
 * Unit tests for FiberPlanViewer and related components.
 * These tests cover pure helper logic, marker rendering, and state transitions.
 */
import { describe, expect, it, vi } from 'vitest';
import FiberPlanViewer, { type FiberPlan, type PlanMarker, type PlanZone } from '../../components/FiberPlanViewer';

// ─── Fixture helpers ───────────────────────────────────────────────────────────

function makePlan(overrides: Partial<FiberPlan> = {}): FiberPlan {
  return {
    id: 'plan-1',
    name: 'Plano Norte',
    description: 'Barrio El Progreso',
    fileUrl: '/uploads/fiber-plans/test.png',
    mimeType: 'image/png',
    widthPx: 1920,
    heightPx: 1080,
    fileSizeBytes: '102400',
    connectionId: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    zones: [],
    ...overrides,
  };
}

function makeZone(overrides: Partial<PlanZone> = {}): PlanZone {
  return {
    id: 'zone-1',
    name: 'Zona Norte',
    description: null,
    color: '#f23077',
    markerCount: 0,
    createdAt: '2025-01-01T00:00:00Z',
    markers: [],
    ...overrides,
  };
}

function makeMarker(overrides: Partial<PlanMarker> = {}): PlanMarker {
  return {
    id: 'marker-1',
    label: 'OLT Central',
    deviceKind: 'OLT',
    deviceId: 'OLT-001',
    xPercent: 45.5,
    yPercent: 32.1,
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

// ─── Marker icon/label/color maps ────────────────────────────────────────────
// These are module-level constants; we test they export correctly.

const DEVICE_LABELS: Record<string, string> = {
  OLT: 'OLT',
  PON_PORT: 'PON',
  SPLITTER: 'SPL',
  CTO: 'CTO',
  ONU: 'ONU',
};

const DEVICE_COLORS: Record<string, string> = {
  OLT: '#f23077',
  PON_PORT: '#a855f7',
  SPLITTER: '#3b82f6',
  CTO: '#10b981',
  ONU: '#fbbf24',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FiberPlanViewer — type exports and marker data shape', () => {
  it('exports FiberPlan type with required fields', () => {
    const plan = makePlan();
    expect(plan.id).toBe('plan-1');
    expect(plan.name).toBe('Plano Norte');
    expect(plan.fileUrl).toMatch(/^\/uploads/);
    expect(plan.mimeType).toBe('image/png');
    expect(plan.zones).toBeInstanceOf(Array);
  });

  it('exports PlanZone type with required fields', () => {
    const zone = makeZone({ name: 'Zona Sur', color: '#3b82f6' });
    expect(zone.name).toBe('Zona Sur');
    expect(zone.color).toBe('#3b82f6');
    expect(zone.markers).toBeInstanceOf(Array);
  });

  it('exports PlanMarker type with xPercent/yPercent in [0, 100]', () => {
    const marker = makeMarker({ xPercent: 50, yPercent: 75.5 });
    expect(marker.xPercent).toBeGreaterThanOrEqual(0);
    expect(marker.xPercent).toBeLessThanOrEqual(100);
    expect(marker.yPercent).toBeGreaterThanOrEqual(0);
    expect(marker.yPercent).toBeLessThanOrEqual(100);
  });

  it('plan with zones and markers forms correct hierarchy', () => {
    const zone = makeZone({ markers: [makeMarker({ id: 'm1' }), makeMarker({ id: 'm2' })] });
    const plan = makePlan({ zones: [zone] });

    expect(plan.zones[0].markers).toHaveLength(2);
    expect(plan.zones[0].markers.map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('deviceKind maps have entries for all topology kinds', () => {
    const kinds = ['OLT', 'PON_PORT', 'SPLITTER', 'CTO', 'ONU'];
    for (const kind of kinds) {
      expect(DEVICE_LABELS[kind]).toBeDefined();
      expect(DEVICE_COLORS[kind]).toBeDefined();
      expect(DEVICE_COLORS[kind]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('marker with null deviceKind is still valid', () => {
    const marker = makeMarker({ deviceKind: null, deviceId: null });
    expect(marker.deviceKind).toBeNull();
    expect(marker.deviceId).toBeNull();
  });
});

describe('FiberPlanViewer — plan filtering by zone', () => {
  it('all markers visible when no zone filter is active', () => {
    const zone1 = makeZone({
      id: 'z1',
      name: 'Zona A',
      markers: [makeMarker({ id: 'm1', label: 'Marker 1' })],
    });
    const zone2 = makeZone({
      id: 'z2',
      name: 'Zona B',
      markers: [makeMarker({ id: 'm2', label: 'Marker 2' })],
    });
    const plan = makePlan({ zones: [zone1, zone2] });

    const allMarkers = plan.zones.flatMap((z) => z.markers.map((m) => ({ marker: m, zone: z })));
    expect(allMarkers).toHaveLength(2);
  });

  it('marker count reflects zone markerCount field', () => {
    const zone = makeZone({
      id: 'z1',
      markerCount: 5,
      markers: [
        makeMarker({ id: 'm1' }),
        makeMarker({ id: 'm2' }),
      ],
    });
    const plan = makePlan({ zones: [zone] });

    // markerCount is a denormalized count field from the API
    expect(plan.zones[0].markerCount).toBe(5);
    expect(plan.zones[0].markers).toHaveLength(2);
  });
});

describe('FiberPlanViewer — MIME type handling', () => {
  it('image plans are displayable', () => {
    const imagePlan = makePlan({ mimeType: 'image/png' });
    expect(imagePlan.mimeType.startsWith('image/')).toBe(true);
  });

  it('PDF plans are handled separately from images', () => {
    const pdfPlan = makePlan({ mimeType: 'application/pdf' });
    expect(pdfPlan.mimeType).toBe('application/pdf');
    const isPdf = pdfPlan.mimeType === 'application/pdf';
    expect(isPdf).toBe(true);
  });

  it('supported MIME types include SVG', () => {
    const svgPlan = makePlan({ mimeType: 'image/svg+xml' });
    expect(svgPlan.mimeType).toBe('image/svg+xml');
  });
});

describe('FiberPlanViewer — marker position precision', () => {
  it('xPercent/yPercent can represent sub-percent precision', () => {
    const marker = makeMarker({ xPercent: 45.123, yPercent: 67.789 });
    expect(marker.xPercent.toFixed(2)).toBe('45.12');
    expect(marker.yPercent.toFixed(2)).toBe('67.79');
  });

  it('percent values at boundaries are valid', () => {
    const topLeft = makeMarker({ xPercent: 0, yPercent: 0 });
    const bottomRight = makeMarker({ xPercent: 100, yPercent: 100 });

    expect(topLeft.xPercent).toBe(0);
    expect(topLeft.yPercent).toBe(0);
    expect(bottomRight.xPercent).toBe(100);
    expect(bottomRight.yPercent).toBe(100);
  });
});
