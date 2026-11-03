// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PredictiveAlerts } from '../../components/PredictiveAlerts';

/**
 * The predicted-alerts list has to page.
 *
 * Same contract as the incident list: `GET /api/predictions` answers with
 * one page, so a panel that reads the first page and stops hides the alerts
 * that did not fit in it.
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

function prediction(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    kind: 'predicted_low_signal',
    severity: 'warning',
    status: 'open',
    deviceKind: 'ONU',
    deviceId: `ONU-${id}`,
    title: `Alerta ${id}`,
    description: 'desc',
    etaMs: 3_600_000,
    confidence: 0.9,
    firstSeenAt: '2026-10-01T00:00:00.000Z',
    lastSeenAt: '2026-10-02T00:00:00.000Z',
    ...overrides,
  };
}

function pageOf(items: unknown[], meta: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => ({
      predictions: items,
      count: items.length,
      page: { scope: 'unresolved', hasMore: false, nextCursor: null, total: items.length, ...meta },
    }),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

function predictionCalls(): string[] {
  return fetchMock.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.startsWith('/api/predictions'));
}

beforeEach(() => {
  fetchMock = vi.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('PredictiveAlerts — la lista de alertas pagina', () => {
  it('dice cuántas alertas hay, no sólo las que tiene en pantalla', async () => {
    fetchMock.mockResolvedValue(
      pageOf([prediction('a')], { hasMore: true, nextCursor: 'c1', total: 90 }),
    );

    render(<PredictiveAlerts />);

    await waitFor(() => expect(screen.getByText(/1 de 90 alertas/)).toBeTruthy());
  });

  it('ofrece cargar más cuando hay otra página', async () => {
    fetchMock.mockResolvedValue(
      pageOf([prediction('a')], { hasMore: true, nextCursor: 'c1', total: 90 }),
    );

    render(<PredictiveAlerts />);

    const button = await screen.findByTestId('load-more-predictions');
    expect(button.textContent).toContain('89 restantes');
  });

  it('la siguiente página se agrega a la lista', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('cursor=c1')) {
        return pageOf([prediction('b')], { hasMore: false, nextCursor: null, total: 2 });
      }
      return pageOf([prediction('a')], { hasMore: true, nextCursor: 'c1', total: 2 });
    });

    render(<PredictiveAlerts />);

    await screen.findByText('Alerta a');
    fireEvent.click(await screen.findByTestId('load-more-predictions'));

    await waitFor(() => expect(screen.getByText('Alerta b')).toBeTruthy());
    // La primera sigue en pantalla: se agregó, no se reemplazó.
    expect(screen.getByText('Alerta a')).toBeTruthy();
  });

  it('la petición de la siguiente página lleva el cursor', async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('cursor=c1')) {
        return pageOf([prediction('b')], { hasMore: false, nextCursor: null, total: 2 });
      }
      return pageOf([prediction('a')], { hasMore: true, nextCursor: 'c1', total: 2 });
    });

    render(<PredictiveAlerts />);

    await screen.findByTestId('load-more-predictions');
    fireEvent.click(screen.getByTestId('load-more-predictions'));

    await waitFor(() => expect(predictionCalls()).toHaveLength(2));
    expect(predictionCalls()[1]).toContain('cursor=c1');
  });

  it('sin más páginas no hay botón', async () => {
    fetchMock.mockResolvedValue(
      pageOf([prediction('a')], { hasMore: false, nextCursor: null, total: 1 }),
    );

    render(<PredictiveAlerts />);

    await screen.findByText('Alerta a');
    expect(screen.queryByTestId('load-more-predictions')).toBeNull();
  });
});
