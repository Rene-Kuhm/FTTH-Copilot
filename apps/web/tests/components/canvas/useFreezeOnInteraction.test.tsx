import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFreezeOnInteraction } from '../../../components/canvas/useFreezeOnInteraction';

function withFakeTimers(): void {
  vi.useFakeTimers();
}

describe('useFreezeOnInteraction', () => {
  it('starts unfrozen', () => {
    withFakeTimers();
    const ref = { current: document.createElement('div') };
    document.body.appendChild(ref.current);
    const { result } = renderHook(() => useFreezeOnInteraction(ref));
    expect(result.current.frozen).toBe(false);
    document.body.removeChild(ref.current);
  });

  it('flips to frozen on pointerdown and unfreezes after the timeout', () => {
    withFakeTimers();
    const ref = { current: document.createElement('div') };
    document.body.appendChild(ref.current);
    const { result } = renderHook(() => useFreezeOnInteraction(ref, 1000));

    act(() => {
      ref.current.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(result.current.frozen).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1100);
    });
    expect(result.current.frozen).toBe(false);

    document.body.removeChild(ref.current);
  });

  it('flips back to false on pointerleave immediately', () => {
    withFakeTimers();
    const ref = { current: document.createElement('div') };
    document.body.appendChild(ref.current);
    const { result } = renderHook(() => useFreezeOnInteraction(ref, 5000));

    act(() => {
      ref.current.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(result.current.frozen).toBe(true);

    act(() => {
      ref.current.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true }));
    });
    expect(result.current.frozen).toBe(false);

    document.body.removeChild(ref.current);
  });

  it('resetTimer re-arms the unfreeze schedule', () => {
    withFakeTimers();
    const ref = { current: document.createElement('div') };
    document.body.appendChild(ref.current);
    const { result } = renderHook(() => useFreezeOnInteraction(ref, 1000));

    act(() => {
      ref.current.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(result.current.frozen).toBe(true);

    act(() => {
      vi.advanceTimersByTime(800);
      result.current.resetTimer();
      vi.advanceTimersByTime(500); // total elapsed 1300ms since first pointerdown
    });
    // resetTimer reset the clock — at 500ms after reset, we are
    // still frozen.
    expect(result.current.frozen).toBe(true);

    document.body.removeChild(ref.current);
  });

  it('flips on keydown (keyboard users freeze the grid too)', () => {
    withFakeTimers();
    const ref = { current: document.createElement('div') };
    document.body.appendChild(ref.current);
    const { result } = renderHook(() => useFreezeOnInteraction(ref, 1000));

    act(() => {
      ref.current.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    });
    expect(result.current.frozen).toBe(true);

    document.body.removeChild(ref.current);
  });
});
