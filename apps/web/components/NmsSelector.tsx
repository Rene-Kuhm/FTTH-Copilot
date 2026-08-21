'use client';

import { useAuth } from '@/lib/auth/client';
import { useConnectors } from '@/lib/connectors/client';
import { ServerStackIcon } from './icons';

export function NmsSelector() {
  const auth = useAuth();
  const connectorState = useConnectors();

  if (auth.loading || !auth.user) return null;

  return (
    <section className="card flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-400 ring-1 ring-inset ring-blue-500/30">
          <ServerStackIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-neutral-50">Red activa</h2>
          <p className="mt-0.5 text-xs text-neutral-400">
            Esta selección se aplica al chat, tablero y alertas.
          </p>
        </div>
      </div>
      <label className="min-w-0 sm:w-72">
        <span className="sr-only">Seleccionar conector NMS</span>
        <select
          className="input"
          value={connectorState.selectedConnectionId ?? ''}
          onChange={(event) => connectorState.selectConnection(event.target.value)}
          disabled={connectorState.loading || connectorState.connectedConnectors.length === 0}
        >
          {connectorState.connectedConnectors.length === 0 && (
            <option value="">Sin conectores validados</option>
          )}
          {connectorState.connectedConnectors.map((connector) => (
            <option key={connector.id} value={connector.id}>
              {connector.label} · {connector.provider}
            </option>
          ))}
        </select>
      </label>
      {connectorState.error && (
        <p role="alert" className="text-sm text-red-300">
          {connectorState.error}
        </p>
      )}
    </section>
  );
}
