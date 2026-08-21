'use client';

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@/lib/auth/client';

export interface ClientConnector {
  id: string;
  provider: 'SMARTOLT' | 'MIKROWISP' | 'NETSENSE';
  label: string;
  baseUrl: string | null;
  status: 'connected' | 'error' | 'pending';
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

interface ConnectorState {
  connectors: ClientConnector[];
  connectedConnectors: ClientConnector[];
  selectedConnectionId: string | null;
  selectedConnector: ClientConnector | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  selectConnection: (connectionId: string | null) => void;
}

const ConnectorContext = createContext<ConnectorState | null>(null);

function selectionKey(tenantId: string): string {
  return `ftth:nms-selection:v1:${tenantId}`;
}

function readStoredSelection(tenantId: string): string | null {
  try {
    return window.localStorage.getItem(selectionKey(tenantId));
  } catch {
    return null;
  }
}

function storeSelection(tenantId: string, connectionId: string | null): void {
  try {
    if (connectionId) window.localStorage.setItem(selectionKey(tenantId), connectionId);
    else window.localStorage.removeItem(selectionKey(tenantId));
  } catch {
    // Storage can be unavailable in private browsing; in-memory selection still works.
  }
}

export function ConnectorProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const userId = auth.user?.id;
  const tenantId = auth.user?.tenantId;
  const [connectors, setConnectors] = useState<ClientConnector[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!userId || !tenantId) {
      setConnectors([]);
      setSelectedConnectionId(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/connectors', { credentials: 'include' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof data.error === 'string' ? data.error : 'No se pudieron cargar los conectores.',
        );
      }
      const next = (data.connectors ?? []) as ClientConnector[];
      const connected = next.filter((connector) => connector.status === 'connected');
      setConnectors(next);
      setSelectedConnectionId((current) => {
        const preferred = current ?? readStoredSelection(tenantId);
        const selected = connected.some((connector) => connector.id === preferred)
          ? preferred
          : (connected[0]?.id ?? null);
        storeSelection(tenantId, selected);
        return selected;
      });
    } catch (reason) {
      setConnectors([]);
      setSelectedConnectionId(null);
      setError(
        reason instanceof Error ? reason.message : 'No se pudieron cargar los conectores.',
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId, userId]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh]);

  const connectedConnectors = useMemo(
    () => connectors.filter((connector) => connector.status === 'connected'),
    [connectors],
  );
  const selectedConnector = useMemo(
    () => connectedConnectors.find((connector) => connector.id === selectedConnectionId) ?? null,
    [connectedConnectors, selectedConnectionId],
  );

  const selectConnection = useCallback(
    (connectionId: string | null) => {
      const validId = connectedConnectors.some((connector) => connector.id === connectionId)
        ? connectionId
        : null;
      setSelectedConnectionId(validId);
      if (tenantId) storeSelection(tenantId, validId);
    },
    [connectedConnectors, tenantId],
  );

  const value = useMemo<ConnectorState>(
    () => ({
      connectors,
      connectedConnectors,
      selectedConnectionId,
      selectedConnector,
      loading,
      error,
      refresh,
      selectConnection,
    }),
    [
      connectors,
      connectedConnectors,
      selectedConnectionId,
      selectedConnector,
      loading,
      error,
      refresh,
      selectConnection,
    ],
  );

  return createElement(ConnectorContext.Provider, { value }, children);
}

export function useConnectors(): ConnectorState {
  const context = useContext(ConnectorContext);
  if (!context) throw new Error('useConnectors debe usarse dentro de ConnectorProvider.');
  return context;
}
