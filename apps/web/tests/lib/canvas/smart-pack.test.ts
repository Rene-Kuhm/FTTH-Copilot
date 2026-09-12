import { describe, expect, it } from 'vitest';
import {
  DENSITY_BREAKPOINTS,
  densityForViewport,
  relayoutForColumns,
  smartPack,
  totalLayoutHeight,
  validateLayoutAgainstPanels,
  type SmartPackPanel,
} from '../../../lib/canvas/smart-pack';

function panel(o: Partial<SmartPackPanel> & { id: string }): SmartPackPanel {
  return {
    id: o.id,
    importance: o.importance ?? 3,
    desiredW: o.desiredW ?? 4,
    desiredH: o.desiredH ?? 4,
    minW: o.minW,
    maxW: o.maxW,
    minH: o.minH,
    maxH: o.maxH,
  };
}

describe('smartPack — happy path', () => {
  it('packs a single panel in the top-left', () => {
    const layout = smartPack([panel({ id: 'a' })]);
    expect(layout).toEqual([{ i: 'a', x: 0, y: 0, w: 4, h: 4, importance: 3 }]);
  });

  it('puts higher-importance panels first', () => {
    const layout = smartPack([
      panel({ id: 'low', importance: 1, desiredW: 4, desiredH: 2 }),
      panel({ id: 'high', importance: 5, desiredW: 4, desiredH: 2 }),
    ]);
    expect(layout[0]!.i).toBe('high');
    expect(layout[1]!.i).toBe('low');
  });

  it('wraps to a new row when the row is full', () => {
    const layout = smartPack([
      panel({ id: 'a', desiredW: 6, desiredH: 2 }),
      panel({ id: 'b', desiredW: 6, desiredH: 2 }),
      panel({ id: 'c', desiredW: 4, desiredH: 2 }),
    ], { cols: 12 });
    expect(layout[0]!.y).toBe(0);
    expect(layout[1]!.y).toBe(0);
    expect(layout[2]!.y).toBe(2);
  });

  it('breaks ties by id (stable)', () => {
    const layout = smartPack([
      panel({ id: 'b', importance: 3 }),
      panel({ id: 'a', importance: 3 }),
    ]);
    expect(layout.map((l) => l.i)).toEqual(['a', 'b']);
  });

  it('is idempotent — same inputs produce the same layout', () => {
    const inputs = [
      panel({ id: 'b', importance: 3, desiredW: 6 }),
      panel({ id: 'a', importance: 3, desiredW: 6 }),
    ];
    expect(smartPack(inputs)).toEqual(smartPack(inputs));
  });
});

describe('smartPack — constraint clamping', () => {
  it('clamps desiredW to [minW, maxW]', () => {
    const layout = smartPack([
      panel({ id: 'a', desiredW: 100, minW: 2, maxW: 6 }),
    ]);
    expect(layout[0]!.w).toBe(6);
  });

  it('respects minW even when the panel does not fit on the row', () => {
    // a needs 6 columns; the grid is 12 wide. b needs 8 columns.
    // Together they would be 14, exceeding the grid; the row wraps
    // so both still get their desiredW.
    const layout = smartPack([
      panel({ id: 'a', desiredW: 6, minW: 6 }),
      panel({ id: 'b', desiredW: 8, minW: 8 }),
    ], { cols: 12 });
    expect(layout[0]!.w).toBe(6);
    expect(layout[1]!.w).toBe(8);
  });
});

describe('totalLayoutHeight', () => {
  it('returns the bottom of the deepest row', () => {
    const layout = smartPack([
      panel({ id: 'a', desiredW: 4, desiredH: 3 }),
      panel({ id: 'b', desiredW: 4, desiredH: 5 }),
      panel({ id: 'c', desiredW: 12, desiredH: 2 }),
    ], { cols: 12 });
    const h = totalLayoutHeight(layout);
    expect(h).toBeGreaterThanOrEqual(7); // a(0..3) + b(3..8) + c wraps
  });
});

describe('validateLayoutAgainstPanels', () => {
  it('returns ok when every item respects its constraints', () => {
    const panels = [panel({ id: 'a', minW: 2, maxW: 6 })];
    const layout = smartPack(panels);
    expect(validateLayoutAgainstPanels(layout, panels)).toEqual({ ok: true });
  });

  it('reports w-below-min', () => {
    const panels = [panel({ id: 'a', minW: 2 })];
    const layout = [{ i: 'a', x: 0, y: 0, w: 1, h: 1, importance: 3 }];
    const r = validateLayoutAgainstPanels(layout, panels);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violation.reason).toBe('w-below-min');
  });

  it('reports h-above-max', () => {
    const panels = [panel({ id: 'a', maxH: 4 })];
    const layout = [{ i: 'a', x: 0, y: 0, w: 1, h: 10, importance: 3 }];
    const r = validateLayoutAgainstPanels(layout, panels);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violation.reason).toBe('h-above-max');
  });
});

describe('densityForViewport', () => {
  it('returns the smallest columns for a phone', () => {
    expect(densityForViewport(360)).toBe(1);
  });

  it('returns 12 cols for a desktop', () => {
    expect(densityForViewport(1920)).toBe(12);
  });

  it('respects the documented breakpoints', () => {
    expect(DENSITY_BREAKPOINTS).toHaveLength(4);
    expect(densityForViewport(639)).toBe(1);
    expect(densityForViewport(640)).toBe(2);
    expect(densityForViewport(1024)).toBe(6);
    expect(densityForViewport(1440)).toBe(12);
  });
});

describe('relayoutForColumns', () => {
  it('honors minW when the grid shrinks', () => {
    // a needs 6 cols and refuses to go below 6. On a 1-col grid
    // (phone) the relayout respects minW and the panel stays 6
    // wide; the layout validates OK.
    const panels = [panel({ id: 'a', desiredW: 6, minW: 6 })];
    const layout = relayoutForColumns(panels, 1);
    expect(layout[0]!.w).toBe(6);
    expect(validateLayoutAgainstPanels(layout, panels, { cols: 1 })).toEqual({ ok: true });
  });

  it('compresses panels that are wider than the new grid', () => {
    const panels = [panel({ id: 'a', desiredW: 12, minW: 2 })];
    const layout = relayoutForColumns(panels, 6);
    expect(layout[0]!.w).toBe(6);
  });

  it('is pure — same inputs produce the same output', () => {
    const panels = [
      panel({ id: 'b', importance: 2 }),
      panel({ id: 'a', importance: 5 }),
    ];
    expect(relayoutForColumns(panels, 6)).toEqual(relayoutForColumns(panels, 6));
  });
});
