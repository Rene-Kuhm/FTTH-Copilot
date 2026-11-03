// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { IncidentsPanel } from '../../components/IncidentsPanel';

/**
 * The incident list has to page.
 *
 * `GET /api/incidents` answers with one page, not with the whole list. A
 * panel that reads the first page and stops hides the open incidents that
 * did not fit in it, and the operator has no way of knowing that is what
 * happened.
 *
 * What is asserted:
 *   1. The panel says how many incidents there are, not just how many it has
 *      on screen.
 *   2. There is a way to ask for the next page.
 *   3. The next page is **added**: the operator asked for more, not for a
 *      different list.
 *   4. The request for the next page carries the cursor.
 *   5. With nothing left to load, the button is gone.
 */

// The user object has to keep the same identity across renders: the panel
// memoizes the loader on `auth.user`, and a fresh object every render would
// re-run the effect and fetch in a loop.
const FAKE_USER = {
  id: 'usr-1',
  email: 'op@isp.example',
  role: 'ADMIN',
  tenantId: 'ten-1',
} as const;

vi.mock('@/lib/auth/client', () => ({
  useAuth: () => ({ user: FAKE_USER, loading: false }),
}));

vi.mock('@/components/FeedbackControls', () => ({
  FeedbackControls: () => null,
}));

vi.mock('@/components/InvestigationCard', () => ({
  InvestigationCard: () => null,
}));

function incident(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    deviceKind: 'OLT',
    deviceId: `OLT-${id}`,
    title: `Incidente ${id}`,
    description: 'desc',
    severity: 'warning',
    status: 'open',
    firstSeenAt: '2026-10-01T00:00:00.000Z',
    lastSeenAt: '2026-10-02T00:00:00.000Z',
    alertCount: 1,
    ...overrides,
  };
}

function pageOf(items: unknown[], meta: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => ({
      incidents: items,
      count: items.length,
      page: { scope: 'unresolved', hasMore: false, nextCursor: null, total: items.length, ...meta },
    }),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

/** Calls to the incidents endpoint only: the panel also loads the topology. */
function incidentCalls(): string[] {
  return fetchMock.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.startsWith('/api/incidents'));
}

beforeEach(() => {
  fetchMock = vi.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('IncidentsPanel — la lista de incidentes pagina', () => {
  it('dice cuántos incidentes hay, no sólo los que tiene en pantalla', async () => {
    fetchMock.mockResolvedValue(pageOf([incident('a')], { hasMore: true, nextCursor: 'c1', total: 120 }));

    render(<IncidentsPanel />);

    await waitFor(() => expect(screen.getByText(/1 de 120 incidentes/)).toBeTruthy());
  });

  it('ofrece cargar más cuando hay otra página', async () => {
    fetchMock.mockResolvedValue(pageOf([incident('a')], { hasMore: true, nextCursor: 'c1', total: 120 }));

    render(<IncidentsPanel />);

    const button = await screen.findByTestId('load-more-incidents');
    expect(button.textContent).toContain('119 restantes');
  });

  it('la siguiente página se agrega a la lista', async () => {
    // Answer by URL, not by call order: the panel also loads the topology of
    // each incident, and those requests are interleaved.
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/topology/')) return { ok: true, json: async () => ({}) };
      if (url.includes('cursor=c1')) {
        return pageOf([incident('b')], { hasMore: false, nextCursor: null, total: 2 });
      }
      return pageOf([incident('a')], { hasMore: true, nextCursor: 'c1', total: 2 });
    });

    render(<IncidentsPanel />);

    await screen.findByTestId('incident-row-a');
    fireEvent.click(await screen.findByTestId('load-more-incidents'));

    await waitFor(() => expect(screen.getByTestId('incident-row-b')).toBeTruthy());
    // El primero sigue en pantalla: se agregó, no se reemplazó.
    expect(screen.getByTestId('incident-row-a')).toBeTruthy();
  });

  it('la petición de la siguiente página lleva el cursor', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/topology/')) return { ok: true, json: async () => ({}) };
      if (url.includes('cursor=c1')) {
        return pageOf([incident('b')], { hasMore: false, nextCursor: null, total: 2 });
      }
      return pageOf([incident('a')], { hasMore: true, nextCursor: 'c1', total: 2 });
    });

    render(<IncidentsPanel />);

    await screen.findByTestId('load-more-incidents');
    fireEvent.click(screen.getByTestId('load-more-incidents'));

    await waitFor(() => expect(incidentCalls()).toHaveLength(2));
    expect(incidentCalls()[1]).toContain('cursor=c1');
  });

  it('sin más páginas no hay botón', async () => {
    fetchMock.mockResolvedValue(pageOf([incident('a')], { hasMore: false, nextCursor: null, total: 1 }));

    render(<IncidentsPanel />);

    await screen.findByTestId('incident-row-a');
    expect(screen.queryByTestId('load-more-incidents')).toBeNull();
  });
});
