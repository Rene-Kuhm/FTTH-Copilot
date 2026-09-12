/**
 * Layout memory (Canvas grid system — foundation PR #1).
 *
 * Background:
 *
 * Grafana persists layouts per dashboard. Zabbix persists per
 * user. The Canvas grid system persists layouts per
 * (user, scope) with **versioning** — the user can rename,
 * snapshot, restore, and share layouts.
 *
 * Storage:
 *   - Persistence is delegated to a small `LayoutStorage`
 *     interface; the default implementation is `localStorage`
 *     (synchronous, fast).
 *   - Each layout has a stable id, a name, a version, a creation
 *     timestamp, and a snapshot of the SmartPackLayoutItem[].
 *   - The active layout id lives under a separate key
 *     (`active:<scope>`) so switching layouts is a single read.
 *
 * Determinism:
 *   - All operations are pure given the storage. The storage
 *     itself may change (localStorage swap → server-backed
 *     storage), but the API is stable.
 *
 * Out of scope (PR #1):
 *   - Server-backed storage (the `LayoutStorage` interface lets a
 *     later PR swap the implementation).
 *   - Sharing across users (the data model supports it; the UI
 *     does not yet).
 */

import type { SmartPackLayoutItem } from './smart-pack';

export interface SavedLayout {
  id: string;
  name: string;
  scope: string;
  version: number;
  createdAt: string;
  items: SmartPackLayoutItem[];
}

export interface LayoutStorage {
  list(scope: string): SavedLayout[];
  get(id: string): SavedLayout | null;
  getActive(scope: string): SavedLayout | null;
  save(layout: SavedLayout): void;
  setActive(scope: string, id: string): void;
  remove(id: string): void;
}

/**
 * Generate a stable, monotonically-increasing layout id. Pure.
 * The runtime layer passes a counter; tests pass `0`.
 */
export function nextLayoutId(counter: number): string {
  return `cl_${counter.toString(36).padStart(4, '0')}`;
}

/**
 * In-memory LayoutStorage. Useful for tests and SSR. Production
 * uses `LocalStorageLayoutStorage`.
 */
export class MemoryLayoutStorage implements LayoutStorage {
  private readonly store = new Map<string, SavedLayout>();
  private readonly activeByScope = new Map<string, string>();

  list(scope: string): SavedLayout[] {
    return Array.from(this.store.values())
      .filter((l) => l.scope === scope)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  }

  get(id: string): SavedLayout | null {
    return this.store.get(id) ?? null;
  }

  getActive(scope: string): SavedLayout | null {
    const id = this.activeByScope.get(scope);
    if (id === undefined) return null;
    return this.store.get(id) ?? null;
  }

  save(layout: SavedLayout): void {
    this.store.set(layout.id, layout);
  }

  setActive(scope: string, id: string): void {
    if (!this.store.has(id)) {
      throw new Error(`LayoutStorage.setActive: unknown layout id ${id}`);
    }
    this.activeByScope.set(scope, id);
  }

  remove(id: string): void {
    this.store.delete(id);
    for (const [scope, active] of this.activeByScope) {
      if (active === id) this.activeByScope.delete(scope);
    }
  }
}

/**
 * localStorage-backed LayoutStorage. SSR-safe: when
 * `window.localStorage` is undefined (Node tests without
 * happy-dom), it falls back to MemoryLayoutStorage.
 */
export function createLocalStorageLayoutStorage(
  prefix: string = 'canvas_layout_',
  fallback?: LayoutStorage,
): LayoutStorage {
  const mem = fallback ?? new MemoryLayoutStorage();
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return mem;
  }
  const ls = window.localStorage;
  const activePrefix = 'canvas_active_';
  return {
    list(scope) {
      const out: SavedLayout[] = [];
      for (let i = 0; i < ls.length; i += 1) {
        const key = ls.key(i);
        if (key === null) continue;
        if (!key.startsWith(prefix)) continue;
        const raw = ls.getItem(key);
        if (raw === null) continue;
        try {
          const l = JSON.parse(raw) as SavedLayout;
          if (l.scope === scope) out.push(l);
        } catch {
          // Skip malformed entries; the storage layer must never
          // throw because of a corrupted entry.
        }
      }
      out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
      return out;
    },
    get(id) {
      const raw = ls.getItem(prefix + id);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as SavedLayout;
      } catch {
        return null;
      }
    },
    getActive(scope) {
      const id = ls.getItem(activePrefix + scope);
      if (id === null) return null;
      const found = ls.getItem(prefix + id);
      if (found === null) return null;
      try {
        return JSON.parse(found) as SavedLayout;
      } catch {
        return null;
      }
    },
    save(layout) {
      ls.setItem(prefix + layout.id, JSON.stringify(layout));
    },
    setActive(scope, id) {
      ls.setItem(activePrefix + scope, id);
    },
    remove(id) {
      ls.removeItem(prefix + id);
    },
  };
}

/**
 * Snapshot the current layout into a new SavedLayout with
 * incremented version. Pure: the runtime applies the returned
 * layout to the storage.
 */
export function snapshotLayout(args: {
  id: string;
  name: string;
  scope: string;
  previous: SavedLayout | null;
  items: SmartPackLayoutItem[];
  now: string;
}): SavedLayout {
  const version = args.previous === null ? 1 : args.previous.version + 1;
  return {
    id: args.id,
    name: args.name,
    scope: args.scope,
    version,
    createdAt: args.now,
    items: args.items,
  };
}
