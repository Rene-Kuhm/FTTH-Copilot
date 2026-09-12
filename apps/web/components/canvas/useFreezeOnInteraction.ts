'use client';

/**
 * useFreezeOnInteraction — Canvas grid system foundation (PR #1).
 *
 * Background:
 *
 * Grafana and Zabbix reorder / animate panels whenever data
 * arrives. If the operator is mid-edit (dragging a panel,
 * configuring a widget, reading a number), an auto-arrange event
 * is jarring and can lose work. This hook returns a `frozen` flag
 * the CanvasGrid consults to decide whether smart-pack relayout
 * is allowed.
 *
 * The flag:
 *   - flips to `true` on `pointerdown`, `keydown`, `focusin`.
 *   - flips back to `false` after `freezeTimeoutMs` (default 1500)
 *     of inactivity.
 *   - flips back to `false` immediately on `pointerleave` of the
 *     grid root.
 *
 * Pure side-effects: no reads of mutable globals outside the
 * element ref. SSR-safe: returns `{ frozen: false }` when `window`
 * is undefined.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface FreezeHandle {
  frozen: boolean;
  /** Reset the timer manually — used by tests and by the layout editor's "Apply" button. */
  resetTimer: () => void;
}

export function useFreezeOnInteraction(
  ref: React.RefObject<HTMLElement | null>,
  freezeTimeoutMs: number = 1500,
): FreezeHandle {
  const [frozen, setFrozen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleUnfreeze = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      setFrozen(false);
      timerRef.current = null;
    }, freezeTimeoutMs);
  }, [clearTimer, freezeTimeoutMs]);

  const handleActivate = useCallback(() => {
    setFrozen(true);
    scheduleUnfreeze();
  }, [scheduleUnfreeze]);

  const handleLeave = useCallback(() => {
    clearTimer();
    setFrozen(false);
  }, [clearTimer]);

  const resetTimer = useCallback(() => {
    scheduleUnfreeze();
  }, [scheduleUnfreeze]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const el = ref.current;
    if (el === null) return;
    el.addEventListener('pointerdown', handleActivate);
    el.addEventListener('keydown', handleActivate);
    el.addEventListener('focusin', handleActivate);
    el.addEventListener('pointerleave', handleLeave);
    return () => {
      el.removeEventListener('pointerdown', handleActivate);
      el.removeEventListener('keydown', handleActivate);
      el.removeEventListener('focusin', handleActivate);
      el.removeEventListener('pointerleave', handleLeave);
      clearTimer();
    };
  }, [ref, handleActivate, handleLeave, clearTimer]);

  return { frozen, resetTimer };
}
