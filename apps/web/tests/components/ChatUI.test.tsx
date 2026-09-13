// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ChatUI from '../../components/ChatUI';

vi.mock('@/lib/auth/client', () => ({
  useAuth: () => ({
    user: { id: 'usr-1', email: 'admin@example.com', role: 'ADMIN', tenantId: 'tenant-1' },
    loading: false,
  }),
}));

vi.mock('@/lib/connectors/client', () => ({
  useConnectors: () => ({
    connectedConnectors: [{ id: 'conn-1', name: 'SmartOLT' }],
    selectedConnectionId: 'conn-1',
    loading: false,
    demoMode: false,
    selectConnection: vi.fn(),
  }),
}));

vi.mock('../../components/HistorySidebar', () => ({
  HistorySidebar: () => <div data-testid="mock-history-sidebar" />,
  loadConversation: vi.fn().mockResolvedValue(null),
}));

describe('ChatUI error handling & kind/hint rendering', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders kind badge and actionable hint when API returns structured error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        error: 'No hay proveedor de IA configurado.',
        kind: 'no-llm-configured',
        hint: 'Configure LLM_PROVIDER in .env',
      }),
    });

    render(<ChatUI />);

    const input = screen.getByRole('textbox', { name: /pregunta para el copilot/i });
    const sendButton = screen.getByRole('button', { name: /enviar/i });

    fireEvent.change(input, { target: { value: '¿Cómo está la OLT 1?' } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('No hay proveedor de IA configurado.');
    expect(alert.textContent).toContain('no-llm-configured');
    expect(alert.textContent).toContain('Configure LLM_PROVIDER in .env');
  });

  it('handles generic error when kind and hint are omitted', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({
        error: 'Internal server error',
      }),
    });

    render(<ChatUI />);

    const input = screen.getByRole('textbox', { name: /pregunta para el copilot/i });
    const sendButton = screen.getByRole('button', { name: /enviar/i });

    fireEvent.change(input, { target: { value: 'Test query' } });
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeDefined();
    });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Internal server error');
  });
});
