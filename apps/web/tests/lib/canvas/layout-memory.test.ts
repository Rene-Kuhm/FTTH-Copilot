import { describe, expect, it } from 'vitest';
import {
  MemoryLayoutStorage,
  nextLayoutId,
  snapshotLayout,
  type SavedLayout,
} from '../../../lib/canvas/layout-memory';
import type { SmartPackLayoutItem } from '../../../lib/canvas/smart-pack';

function layout(o: Partial<SavedLayout> & { id: string }): SavedLayout {
  return {
    id: o.id,
    name: o.name ?? 'Default',
    scope: o.scope ?? 's_1',
    version: o.version ?? 1,
    createdAt: o.createdAt ?? '2026-09-10T12:00:00.000Z',
    items: o.items ?? [],
  };
}

describe('MemoryLayoutStorage — list', () => {
  it('returns only layouts in the requested scope', () => {
    const s = new MemoryLayoutStorage();
    s.save(layout({ id: 'a', scope: 's_1' }));
    s.save(layout({ id: 'b', scope: 's_2' }));
    expect(s.list('s_1').map((l) => l.id)).toEqual(['a']);
    expect(s.list('s_2').map((l) => l.id)).toEqual(['b']);
  });

  it('sorts by createdAt asc', () => {
    const s = new MemoryLayoutStorage();
    s.save(layout({ id: 'b', createdAt: '2026-09-10T13:00:00.000Z' }));
    s.save(layout({ id: 'a', createdAt: '2026-09-10T12:00:00.000Z' }));
    expect(s.list('s_1').map((l) => l.id)).toEqual(['a', 'b']);
  });
});

describe('MemoryLayoutStorage — get / setActive', () => {
  it('returns null for an unknown id', () => {
    expect(new MemoryLayoutStorage().get('nope')).toBeNull();
  });

  it('returns the active layout for a scope', () => {
    const s = new MemoryLayoutStorage();
    s.save(layout({ id: 'a' }));
    s.save(layout({ id: 'b' }));
    s.setActive('s_1', 'b');
    expect(s.getActive('s_1')?.id).toBe('b');
  });

  it('setActive throws on an unknown id (defensive)', () => {
    const s = new MemoryLayoutStorage();
    expect(() => s.setActive('s_1', 'nope')).toThrow();
  });
});

describe('MemoryLayoutStorage — remove', () => {
  it('removes the layout', () => {
    const s = new MemoryLayoutStorage();
    s.save(layout({ id: 'a' }));
    s.remove('a');
    expect(s.get('a')).toBeNull();
  });

  it('also clears the active pointer for any scope that pointed at it', () => {
    const s = new MemoryLayoutStorage();
    s.save(layout({ id: 'a' }));
    s.setActive('s_1', 'a');
    s.remove('a');
    expect(s.getActive('s_1')).toBeNull();
  });
});

describe('nextLayoutId', () => {
  it('pads the counter to 4 chars in base36', () => {
    expect(nextLayoutId(0)).toBe('cl_0000');
    expect(nextLayoutId(35)).toBe('cl_000z');
    expect(nextLayoutId(36)).toBe('cl_0010');
  });
});

describe('snapshotLayout', () => {
  const items: SmartPackLayoutItem[] = [
    { i: 'a', x: 0, y: 0, w: 4, h: 4, importance: 3 },
  ];

  it('starts at version 1 when no previous exists', () => {
    const l = snapshotLayout({
      id: 'cl_0001',
      name: 'Default',
      scope: 's_1',
      previous: null,
      items,
      now: '2026-09-10T12:00:00.000Z',
    });
    expect(l.version).toBe(1);
  });

  it('increments the version from the previous', () => {
    const previous = layout({ id: 'cl_0000', version: 7 });
    const l = snapshotLayout({
      id: 'cl_0001',
      name: 'Default',
      scope: 's_1',
      previous,
      items,
      now: '2026-09-10T12:00:00.000Z',
    });
    expect(l.version).toBe(8);
  });

  it('preserves items and metadata verbatim', () => {
    const l = snapshotLayout({
      id: 'cl_0042',
      name: 'My dashboard',
      scope: 's_X',
      previous: null,
      items,
      now: '2026-09-10T12:00:00.000Z',
    });
    expect(l.id).toBe('cl_0042');
    expect(l.name).toBe('My dashboard');
    expect(l.scope).toBe('s_X');
    expect(l.items).toEqual(items);
    expect(l.createdAt).toBe('2026-09-10T12:00:00.000Z');
  });
});
