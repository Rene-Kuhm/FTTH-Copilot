'use client';

/**
 * useViewportDensity — Canvas grid system foundation (PR #1).
 *
 * Maps the current viewport width to a column count using
 * `densityForViewport` (lib/canvas/smart-pack). The hook listens
 * to `window.matchMedia` for the documented breakpoints so the
 * layout collapses cleanly when the operator resizes the window
 * or rotates a tablet.
 *
 * SSR-safe: returns the column count for the default breakpoint
 * (1 col) when `window` is undefined.
 */

import { useEffect, useState } from 'react';
import { densityForViewport } from '../../lib/canvas/smart-pack';

export function useViewportDensity(): number {
  const [cols, setCols] = useState<number>(() => {
    if (typeof window === 'undefined') return 1;
    return densityForViewport(window.innerWidth);
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    function onResize(): void {
      setCols(densityForViewport(window.innerWidth));
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return cols;
}
