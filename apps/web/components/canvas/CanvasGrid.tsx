'use client';

/**
 * CanvasGrid — the user-facing component for the Canvas grid system.
 *
 * The component is composed of:
 *
 *   - `useViewportDensity` to know how many columns to show.
 *   - `useLayoutMemory` for persistence + versioning.
 *   - `useFreezeOnInteraction` to suppress auto-relayout while the
 *     operator is editing or reading.
 *   - `smartPack` / `relayoutForColumns` for the initial layout.
 *
 * The runtime layout is delegated to react-grid-layout (the
 * `GridLayout` component). Drag/resize events produce new layout
 * items; when the operator releases the drag, the layout is
 * snapshotted into the layout memory with an incremented version.
 *
 * The auto-relayout trigger fires only when:
 *   - The density changed (viewport crossed a breakpoint), AND
 *   - The grid is not frozen (operator is not interacting).
 *
 * That keeps Grafana's "auto-fit on resize" feature while
 * avoiding the jarring reorder that happens on data arrival.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// react-grid-layout@2.2.4 ships its own TypeScript types and
// exports Layout + GridLayoutProps directly. We do NOT need the
// old @types/react-grid-layout package — it conflicts with 2.x.
import { GridLayout, type Layout, type GridLayoutProps } from 'react-grid-layout';
import { useViewportDensity } from './useViewportDensity';
import { useLayoutMemory } from './useLayoutMemory';
import { useFreezeOnInteraction, type FreezeHandle } from './useFreezeOnInteraction';
import {
  relayoutForColumns,
  smartPack,
  validateLayoutAgainstPanels,
  type SmartPackLayoutItem,
} from '../../lib/canvas/smart-pack';
import {
  createLocalStorageLayoutStorage,
} from '../../lib/canvas/layout-memory';
import type { CanvasGridProps } from './types';

// Re-export the upstream Layout shape so consumers of the CanvasGrid
// can type their callbacks without re-importing from react-grid-layout.
export type { Layout };

const ROW_HEIGHT = 60; // px
const MARGIN: [number, number] = [12, 12];

export function CanvasGrid(props: CanvasGridProps): React.ReactElement {
  const cols = useViewportDensity();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const freeze = useFreezeOnInteraction(rootRef);
  const storage = useMemo(
    () => createLocalStorageLayoutStorage(`canvas_layout_${props.storageScope}_`),
    [props.storageScope],
  );

  // Build the smart-pack input from the consumer's panels.
  const packInput = useMemo(
    () => props.panels.map((p) => ({
      id: p.id,
      importance: p.importance,
      desiredW: p.desiredW,
      desiredH: p.desiredH,
      minW: p.minW,
      maxW: p.maxW,
      minH: p.minH,
      maxH: p.maxH,
    })),
    [props.panels],
  );

  // Initial smart-pack output (rendered once, on mount).
  const initialLayout = useMemo(() => smartPack(packInput, { cols }), [packInput, cols]);

  const memory = useLayoutMemory({
    storage,
    scope: props.storageScope,
    initialItems: initialLayout,
  });

  // Track the layout reactively so drag/resize updates the DOM.
  // The grid runtime wants `Layout[]` (mutable, with extra optional
  // fields like minW/maxW); we keep our richer SmartPackLayoutItem
  // shape in `liveLayout` and convert on the way to GridLayout.
  const [liveLayout, setLiveLayout] = useState<SmartPackLayoutItem[]>(
    memory.active?.items ?? initialLayout,
  );

  // When the viewport density changes AND the operator is not
  // interacting, recompute the layout for the new column count.
  useEffect(() => {
    if (freeze.frozen) return;
    const next = relayoutForColumns(packInput, cols);
    const validation = validateLayoutAgainstPanels(next, packInput, { cols });
    if (!validation.ok) return;
    const saved = memory.apply(next);
    setLiveLayout(saved.items);
    props.onLayoutChange?.(saved.items);
    // We intentionally depend on `cols` only — packInput and the
    // other hooks are stable for the lifetime of the panel list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols]);

  const onLayoutChange = useCallback(
    (next: ReadonlyArray<Layout>) => {
      // Update the live layout immediately for visual feedback;
      // the consumer can persist via debouncing if needed.
      const mapped: SmartPackLayoutItem[] = next.map((it) => {
        const importance =
          packInput.find((p) => p.id === it.i)?.importance ?? 3;
        return {
          i: it.i,
          x: it.x,
          y: it.y,
          w: it.w,
          h: it.h,
          importance,
        };
      });
      setLiveLayout(mapped);
      props.onLayoutChange?.(mapped);
    },
    [packInput, props],
  );

  const onLayoutCommit = useCallback(() => {
    // Persist the live layout as a new versioned snapshot.
    memory.apply(liveLayout);
  }, [memory, liveLayout]);

  const isReadonly = props.mode === 'readonly';
  const editable = !isReadonly && !freeze.frozen;

  return (
    <div
      ref={rootRef}
      className="canvas-grid-root"
      data-canvas-density={cols}
      data-canvas-frozen={freeze.frozen ? 'true' : 'false'}
      data-canvas-mode={props.mode ?? 'editable'}
    >
      <RGL
        className="layout"
        layout={liveLayout.map((it) => ({
          i: it.i,
          x: it.x,
          y: it.y,
          w: it.w,
          h: it.h,
        }))}
        cols={cols}
        rowHeight={ROW_HEIGHT}
        margin={MARGIN}
        isDraggable={editable}
        isResizable={editable}
        draggableHandle=".canvas-panel-handle"
        onLayoutChange={onLayoutChange}
        onDragStop={onLayoutCommit}
        onResizeStop={onLayoutCommit}
        compactType="vertical"
        preventCollision={false}
        useCSSTransforms
      >
        {props.panels.map((panel) => (
          <div
            key={panel.id}
            className="canvas-panel"
            data-canvas-panel-id={panel.id}
            data-canvas-importance={panel.importance}
          >
            {panel.title !== undefined ? (
              <div className="canvas-panel-handle canvas-panel-header">
                {panel.title}
              </div>
            ) : (
              <div className="canvas-panel-handle canvas-panel-header" aria-hidden="true">
                &nbsp;
              </div>
            )}
            <div className="canvas-panel-body" aria-label={panel.ariaLabel ?? panel.title ?? panel.id}>
              {panel.content}
            </div>
          </div>
        ))}
      </RGL>
    </div>
  );
}
