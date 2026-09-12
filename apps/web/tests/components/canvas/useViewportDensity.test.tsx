import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useViewportDensity } from '../../../components/canvas/useViewportDensity';

describe('useViewportDensity', () => {
  it('returns 1 col when the viewport is below the smallest breakpoint', () => {
    // jsdom defaults window.innerWidth to 1024; we override for
    // this test. The hook reads window.innerWidth at mount time,
    // before any resize event.
    (window as unknown as { innerWidth: number }).innerWidth = 360;
    const { result } = renderHook(() => useViewportDensity());
    expect(result.current).toBe(1);
  });

  it('returns 12 cols when the viewport is wide', () => {
    (window as unknown as { innerWidth: number }).innerWidth = 1920;
    const { result } = renderHook(() => useViewportDensity());
    expect(result.current).toBe(12);
  });
});
