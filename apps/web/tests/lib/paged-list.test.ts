import { describe, expect, it, vi } from 'vitest';

import {
  fetchAllPages,
  nextPageUrl,
  readPage,
  type Page,
} from '@/lib/api/paged-list';

/**
 * The paging client shared by the panels that consume /api/incidents and
 * /api/predictions.
 *
 * What is under test is the contract that keeps the frontend from hiding
 * data: a page says whether there is more, and a bulk read says whether it
 * got cut short.
 */

function body(items: unknown[], meta: Record<string, unknown> = {}) {
  return {
    incidents: items,
    count: items.length,
    page: { scope: 'unresolved', hasMore: false, nextCursor: null, total: items.length, ...meta },
  };
}

describe('readPage', () => {
  it('reads the items and the metadata', () => {
    const page = readPage<{ id: string }>(body([{ id: 'a' }], { hasMore: true, nextCursor: 'c1', total: 12 }), 'incidents');

    expect(page.items).toHaveLength(1);
    expect(page.meta.hasMore).toBe(true);
    expect(page.meta.nextCursor).toBe('c1');
    expect(page.meta.total).toBe(12);
  });

  it('a response without metadata does not break the caller', () => {
    const page = readPage<{ id: string }>({ incidents: [{ id: 'a' }] }, 'incidents');

    expect(page.items).toHaveLength(1);
    expect(page.meta.hasMore).toBe(false);
    expect(page.meta.nextCursor).toBeNull();
    // Without a total from the API, the only honest number is what came.
    expect(page.meta.total).toBe(1);
  });

  it('a body that is not the expected shape yields an empty page', () => {
    const page = readPage<{ id: string }>(null, 'incidents');

    expect(page.items).toEqual([]);
    expect(page.meta.hasMore).toBe(false);
  });
});

describe('nextPageUrl', () => {
  it('the first page carries no cursor', () => {
    expect(nextPageUrl('/api/incidents', null)).toBe('/api/incidents');
  });

  it('the next page carries the cursor', () => {
    expect(nextPageUrl('/api/incidents', 'c1')).toBe('/api/incidents?cursor=c1');
  });

  it('the cursor joins an existing query', () => {
    expect(nextPageUrl('/api/incidents?status=all', 'c1')).toBe(
      '/api/incidents?status=all&cursor=c1',
    );
  });

  it('the page size travels with the cursor when asked', () => {
    expect(nextPageUrl('/api/incidents', 'c1', 10)).toBe('/api/incidents?cursor=c1&limit=10');
  });
});

describe('fetchAllPages', () => {
  function pageOf(items: unknown[], meta: Record<string, unknown>): Page<{ id: string }> {
    return readPage<{ id: string }>(body(items, meta), 'incidents');
  }

  it('walks the pages until there is no more', async () => {
    const fetchPage = vi
      .fn<(cursor: string | null) => Promise<Page<{ id: string }>>>()
      .mockResolvedValueOnce(pageOf([{ id: 'a' }], { hasMore: true, nextCursor: 'c1', total: 3 }))
      .mockResolvedValueOnce(pageOf([{ id: 'b' }], { hasMore: true, nextCursor: 'c2', total: 3 }))
      .mockResolvedValueOnce(pageOf([{ id: 'c' }], { hasMore: false, nextCursor: null, total: 3 }));

    const result = await fetchAllPages(fetchPage);

    expect(result.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(result.pages).toBe(3);
    expect(result.truncated).toBe(false);
    expect(result.total).toBe(3);
  });

  it('the cursor of a page is the one the next request uses', async () => {
    const fetchPage = vi
      .fn<(cursor: string | null) => Promise<Page<{ id: string }>>>()
      .mockResolvedValueOnce(pageOf([{ id: 'a' }], { hasMore: true, nextCursor: 'c1', total: 2 }))
      .mockResolvedValueOnce(pageOf([{ id: 'b' }], { hasMore: false, nextCursor: null, total: 2 }));

    await fetchAllPages(fetchPage);

    expect(fetchPage.mock.calls[0][0]).toBeNull();
    expect(fetchPage.mock.calls[1][0]).toBe('c1');
  });

  it('a page that says there is more but gives no cursor stops the walk', async () => {
    const fetchPage = vi
      .fn<(cursor: string | null) => Promise<Page<{ id: string }>>>()
      .mockResolvedValue(pageOf([{ id: 'a' }], { hasMore: true, nextCursor: null, total: 9 }));

    const result = await fetchAllPages(fetchPage);

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(result.truncated).toBe(false);
  });

  it('the page ceiling is explicit and the cut is reported', async () => {
    const fetchPage = vi
      .fn<(cursor: string | null) => Promise<Page<{ id: string }>>>()
      .mockResolvedValue(pageOf([{ id: 'a' }], { hasMore: true, nextCursor: 'c1', total: 99 }));

    const result = await fetchAllPages(fetchPage, 3);

    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(result.truncated).toBe(true);
    expect(result.total).toBe(99);
  });
});
