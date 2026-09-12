'use client';

/**
 * useLayoutMemory — Canvas grid system foundation (PR #1).
 *
 * The runtime hook for the CanvasGrid component. Wraps the
 * `LayoutStorage` interface in a small React API:
 *
 *   - `layouts`: the saved layouts in the current scope.
 *   - `active`: the currently-active layout (or null).
 *   - `apply(items)`: smart-pack output OR user drag/resize output
 *     that becomes the new active layout (snapshot versioned).
 *   - `switchTo(id)`: make another saved layout active.
 *   - `rename(id, name)`: rename a saved layout.
 *   - `remove(id)`: delete a saved layout.
 *
 * The hook is intentionally dumb — all decisions live in the
 * storage layer and the smart-pack library. The hook is just the
 * React adapter.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  nextLayoutId,
  snapshotLayout,
  type LayoutStorage,
  type SavedLayout,
} from '../../lib/canvas/layout-memory';
import type { SmartPackLayoutItem } from '../../lib/canvas/smart-pack';

export interface UseLayoutMemoryArgs {
  storage: LayoutStorage;
  scope: string;
  initialItems: SmartPackLayoutItem[];
  initialName?: string;
  /** Counter provider for deterministic id generation in tests. */
  nextId?: () => string;
  /** Clock provider for deterministic timestamps in tests. */
  now?: () => string;
}

export interface UseLayoutMemoryResult {
  layouts: SavedLayout[];
  active: SavedLayout | null;
  apply: (items: SmartPackLayoutItem[], name?: string) => SavedLayout;
  switchTo: (id: string) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
}

export function useLayoutMemory(args: UseLayoutMemoryArgs): UseLayoutMemoryResult {
  const nextId = useMemo(() => args.nextId ?? (() => nextLayoutId(Date.now())), [args]);
  const now = useMemo(() => args.now ?? (() => new Date().toISOString()), [args]);
  const counterRef = useRef(0);

  // Initial mount: read the active layout from storage, or seed one
  // from the consumer's initialItems.
  const [activeId, setActiveId] = useState<string | null>(() => {
    const a = args.storage.getActive(args.scope);
    return a?.id ?? null;
  });
  const [layouts, setLayouts] = useState<SavedLayout[]>(() => args.storage.list(args.scope));
  const [, setVersion] = useState(0);

  const apply = useCallback(
    (items: SmartPackLayoutItem[], name?: string): SavedLayout => {
      counterRef.current += 1;
      const id = nextId();
      const previous = activeId === null ? null : args.storage.get(activeId);
      const layout = snapshotLayout({
        id,
        name: name ?? (previous?.name ?? 'Default'),
        scope: args.scope,
        previous,
        items,
        now: now(),
      });
      args.storage.save(layout);
      args.storage.setActive(args.scope, id);
      setActiveId(id);
      setLayouts(args.storage.list(args.scope));
      setVersion((v) => v + 1);
      return layout;
    },
    [activeId, args, nextId, now],
  );

  const switchTo = useCallback(
    (id: string): void => {
      const found = args.storage.get(id);
      if (found === null) return;
      args.storage.setActive(args.scope, id);
      setActiveId(id);
    },
    [args],
  );

  const rename = useCallback(
    (id: string, name: string): void => {
      const found = args.storage.get(id);
      if (found === null) return;
      const updated: SavedLayout = { ...found, name };
      args.storage.save(updated);
      setLayouts(args.storage.list(args.scope));
      setVersion((v) => v + 1);
    },
    [args],
  );

  const remove = useCallback(
    (id: string): void => {
      args.storage.remove(id);
      if (activeId === id) {
        const remaining = args.storage.list(args.scope);
        const nextActive = remaining[0];
        if (nextActive !== undefined) {
          args.storage.setActive(args.scope, nextActive.id);
          setActiveId(nextActive.id);
        } else {
          setActiveId(null);
        }
      }
      setLayouts(args.storage.list(args.scope));
      setVersion((v) => v + 1);
    },
    [activeId, args],
  );

  const active = activeId === null ? null : args.storage.get(activeId);

  // Seed an active layout on first mount if none exists AND
  // initialItems are provided.
  useEffect(() => {
    if (active !== null) return;
    if (args.initialItems.length === 0) return;
    apply(args.initialItems, args.initialName ?? 'Default');
    // We intentionally only run on mount; the apply function is
    // stable across renders via useCallback closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { layouts, active, apply, switchTo, rename, remove };
}
