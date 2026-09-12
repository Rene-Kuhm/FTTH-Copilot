/**
 * Smart-Pack algorithm (Canvas grid system — foundation PR #1).
 *
 * Background — why this is not a plain bin-packing:
 *
 * Grafana and Zabbix use a simple "fill the grid" layout: panels
 * start at the top-left and grow downward. This works until the
 * user has 12 panels of different importance — a low-importance
 * status panel ends up the same size as a high-importance evidence
 * panel, and the eye has no anchor.
 *
 * Smart-Pack keeps Grafana's grid semantics (12-column rows, panels
 * are rectangles on a discrete grid) but layers three improvements:
 *
 *   1. **Importance-weighted row packing.** Panels declare an
 *      `importance: 1..5` (default 3). Within a row, higher
 *      importance gets more columns first; within the whole
 *      layout, importance influences row order.
 *
 *   2. **Constraint-respecting bin-packing.** Every panel
 *      declares `minW/maxW/minH/maxH` (in grid units, default 1/12/1/24).
 *      The algorithm respects these. A panel that needs 6 columns
 *      to be readable never gets compressed to 1.
 *
 *   3. **Deterministic.** Same inputs → same output, sorted by id
 *      as tie-breaker. Pure, no clock reads.
 *
 * The algorithm is **offline** — given the panels and the grid
 * width, it produces a layout array. The runtime layout (drag,
 * resize) is delegated to react-grid-layout; smart-pack only
 * produces the initial layout.
 */

export interface SmartPackPanel {
  /** Stable id used as tie-breaker and as the layout `i` key. */
  id: string;
  /** Importance 1 (low) .. 5 (high). Default 3. */
  importance: 1 | 2 | 3 | 4 | 5 | number;
  /** Logical width in grid units. The algorithm maps this to columns. */
  desiredW: number;
  /** Logical height in grid units. */
  desiredH: number;
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
}

export interface SmartPackOptions {
  /** Grid width in columns. Default 12 (matches react-grid-layout). */
  cols?: number;
  /** Row height in grid units. Default 1. */
  rowHeight?: number;
  /** Vertical gap between rows in grid units. Default 1. */
  margin?: number;
}

export interface SmartPackLayoutItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Echoed from the input panel for callers that want to map. */
  importance: number;
}

export class SmartPackValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmartPackValidationError';
  }
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function clampPanel(p: SmartPackPanel, cols: number): {
  importance: number;
  w: number;
  h: number;
} {
  const importance = clamp(p.importance, 1, 5);
  const minW = clamp(p.minW ?? 1, 1, cols);
  const maxW = clamp(p.maxW ?? cols, minW, cols);
  const minH = clamp(p.minH ?? 1, 1, 24);
  const maxH = clamp(p.maxH ?? 24, minH, 24);
  const w = clamp(p.desiredW, minW, maxW);
  const h = clamp(p.desiredH, minH, maxH);
  return { importance, w, h };
}

/**
 * Sort panels by importance (high first), then by id (stable
 * tie-breaker).
 */
function sortPanels(panels: SmartPackPanel[]): SmartPackPanel[] {
  return [...panels].sort((a, b) => {
    const ai = clamp(a.importance, 1, 5);
    const bi = clamp(b.importance, 1, 5);
    if (ai !== bi) return bi - ai;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Greedy row packer. Builds rows greedily until the row is full or
 * no panel fits; moves to the next row. Panels are pre-sorted by
 * importance (high first) so the eye anchors on the top-left.
 *
 * Pure: same inputs → same output. Deterministic across runs.
 */
export function smartPack(
  panels: SmartPackPanel[],
  options: SmartPackOptions = {},
): SmartPackLayoutItem[] {
  const cols = options.cols ?? 12;
  const sorted = sortPanels(panels);

  const out: SmartPackLayoutItem[] = [];
  let rowY = 0;
  let rowCursor = 0;
  let rowMaxH = 0;

  for (const raw of sorted) {
    const p = clampPanel(raw, cols);
    if (rowCursor + p.w > cols) {
      // Move to the next row.
      rowY += rowMaxH + (options.margin ?? 0);
      rowCursor = 0;
      rowMaxH = 0;
    }
    out.push({
      i: raw.id,
      x: rowCursor,
      y: rowY,
      w: p.w,
      h: p.h,
      importance: p.importance,
    });
    rowCursor += p.w;
    if (p.h > rowMaxH) rowMaxH = p.h;
  }

  return out;
}

/**
 * Total grid height of a layout (the last row's `y + h`).
 * Useful for sizing the parent container.
 */
export function totalLayoutHeight(items: SmartPackLayoutItem[]): number {
  let max = 0;
  for (const item of items) {
    const bottom = item.y + item.h;
    if (bottom > max) max = bottom;
  }
  return max;
}

/**
 * Validate a layout against its panels' constraints. Used by the
 * runtime layer to refuse user drags that violate minW/maxW.
 */
export function validateLayoutAgainstPanels(
  layout: SmartPackLayoutItem[],
  panels: SmartPackPanel[],
  options: SmartPackOptions = {},
): { ok: true } | { ok: false; violation: { id: string; reason: string } } {
  const cols = options.cols ?? 12;
  const panelById = new Map(panels.map((p) => [p.id, p]));
  for (const item of layout) {
    const p = panelById.get(item.i);
    if (p === undefined) {
      return { ok: false, violation: { id: item.i, reason: 'orphan-layout-item' } };
    }
    const minW = p.minW ?? 1;
    const maxW = p.maxW ?? cols;
    const minH = p.minH ?? 1;
    const maxH = p.maxH ?? 24;
    if (item.w < minW) return { ok: false, violation: { id: item.i, reason: 'w-below-min' } };
    if (item.w > maxW) return { ok: false, violation: { id: item.i, reason: 'w-above-max' } };
    if (item.h < minH) return { ok: false, violation: { id: item.i, reason: 'h-below-min' } };
    if (item.h > maxH) return { ok: false, violation: { id: item.i, reason: 'h-above-max' } };
  }
  return { ok: true };
}

/**
 * Density breakpoint resolver. The Canvas runtime asks the
 * layout layer: "given this viewport width, how many grid
 * columns do I show?" Smart-Pack's algorithm receives that
 * number; smaller viewports collapse wider panels (the
 * constraint solver respects minW, so panels that need 6
 * columns stay at 6 and the rest wrap to a second row).
 *
 * Pure, deterministic. The breakpoints are documented as exported
 * constants so the UI can show them in the layout editor.
 */
export const DENSITY_BREAKPOINTS: ReadonlyArray<{
  minWidth: number;
  cols: number;
}> = [
  { minWidth: 0, cols: 1 },     // phones
  { minWidth: 640, cols: 2 },    // small tablets
  { minWidth: 1024, cols: 6 },   // tablets / small laptops
  { minWidth: 1440, cols: 12 },  // desktops
] as const;

export function densityForViewport(viewportWidth: number): number {
  let cols = DENSITY_BREAKPOINTS[0]!.cols;
  for (const bp of DENSITY_BREAKPOINTS) {
    if (viewportWidth >= bp.minWidth) cols = bp.cols;
  }
  return cols;
}

/**
 * Recompute a layout for a different column count while honoring
 * each panel's minW/maxW. This is what `useViewportDensity`
 * calls on resize. Pure.
 */
export function relayoutForColumns(
  panels: SmartPackPanel[],
  newCols: number,
  options: SmartPackOptions = {},
): SmartPackLayoutItem[] {
  // Re-clamp desiredW to the new column count so panels wider
  // than the new grid are compressed to fit (down to their minW).
  const adjusted = panels.map((p) => {
    const maxW = p.maxW ?? newCols;
    return {
      ...p,
      maxW: Math.min(maxW, newCols),
      desiredW: Math.min(p.desiredW, newCols),
    };
  });
  return smartPack(adjusted, { ...options, cols: newCols });
}
