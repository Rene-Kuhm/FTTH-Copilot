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

import { useCallback, useMemo, useRef, useState } from 'react';
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
  const nextId = useMemo(() => args.nextId ?? (() => nextLayoutId(Date.now())), [args.nextId]);
  const now = useMemo(() => args.now ?? (() => new Date().toISOString()), [args.now]);
  // Initial mount: read the active layout from storage, or seed one
  // from the consumer's initialItems.
  const [activeId, setActiveId] = useState<string | null>(() => {
    const active = args.storage.getActive(args.scope);
    if (active !== null) {
      return active.id;
    }
    if (args.initialItems.length === 0) {
      return null;
    }
    // Idempotency guard for StrictMode double-invocation:
    // If a layout for this scope already exists, reuse it rather than creating a duplicate.
    const existingList = args.storage.list(args.scope);
    if (existingList.length > 0) {
      const match = existingList.find((l) => l.name === (args.initialName ?? 'Default')) ?? existingList[0]!;
      args.storage.setActive(args.scope, match.id);
      return match.id;
    }
    const id = (args.nextId ?? (() => nextLayoutId(Date.now())))();
    const timestamp = (args.now ?? (() => new Date().toISOString()))();
    const seeded = snapshotLayout({
      id,
      name: args.initialName ?? 'Default',
      scope: args.scope,
      previous: null,
      items: args.initialItems,
      now: timestamp,
    });
    args.storage.save(seeded);
    args.storage.setActive(args.scope, id);
    return id;
  });
  const [layouts, setLayouts] = useState<SavedLayout[]>(() => args.storage.list(args.scope));
  const [, setVersion] = useState(0);

  const apply = useCallback(
    (items: SmartPackLayoutItem[], name?: string): SavedLayout => {
      const id = nextId();
      const previous = args.storage.getActive(args.scope);
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
    [args.storage, args.scope, nextId, now],
  );

  const switchTo = useCallback(
    (id: string): void => {
      const found = args.storage.get(id);
      if (found === null) return;
      args.storage.setActive(args.scope, id);
      setActiveId(id);
    },
    [args.storage, args.scope],
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
    [args.storage, args.scope],
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
    [activeId, args.storage, args.scope],
  );

  const active = activeId === null ? null : args.storage.get(activeId);

  return useMemo(
    () => ({ layouts, active, apply, switchTo, rename, remove }),
    [layouts, active, apply, switchTo, rename, remove],
  );
}
