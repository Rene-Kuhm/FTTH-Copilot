/**
 * Public types for the Canvas grid system.
 *
 * The CanvasGrid component is the single import surface for
 * consumers. Underneath it coordinates:
 *
 *   - smart-pack         (lib/canvas/smart-pack.ts)
 *   - layout memory      (lib/canvas/layout-memory.ts)
 *   - useViewportDensity (components/canvas/useViewportDensity.ts)
 *   - useLayoutMemory    (components/canvas/useLayoutMemory.ts)
 *   - useFreezeOnInteraction (components/canvas/useFreezeOnInteraction.ts)
 *
 * Consumers declare `panels: PanelDescriptor[]` (with id,
 * importance, min/max constraints) and the CanvasGrid produces a
 * smart-packed layout that the operator can drag/resize. Changes
 * are versioned snapshots.
 */

import type { SmartPackPanel, SmartPackLayoutItem } from '../../lib/canvas/smart-pack';

export interface PanelDescriptor extends SmartPackPanel {
  /** React node rendered inside the panel. */
  content: React.ReactNode;
  /** Optional title shown in the panel header. */
  title?: string;
  /** Optional ARIA label override. */
  ariaLabel?: string;
}

export interface CanvasGridProps {
  panels: PanelDescriptor[];
  /** Storage backend; defaults to localStorage-backed. */
  storageScope: string;
  /** Render mode: 'readonly' disables drag/resize. */
  mode?: 'editable' | 'readonly';
  /** Called whenever the layout changes (drag/resize/apply). */
  onLayoutChange?: (items: SmartPackLayoutItem[]) => void;
}

export type { SmartPackLayoutItem };
