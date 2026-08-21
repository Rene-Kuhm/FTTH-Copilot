'use client';

import { useAuth } from '@/lib/auth/client';
import { useConnectors } from '@/lib/connectors/client';
import { ServerStackIcon } from './icons';

export function NmsSelector() {
  const auth = useAuth();
  const connectorState = useConnectors();

  if (auth.loading || !auth.user) return null;

  return (
    <section className="card flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300 ring-1 ring-inset ring-cyan-300/15">
          <ServerStackIcon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-white">Red activa</h2>
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_9px_rgba(45,212,167,.65)]" />
          </div>
          <p className="mt-0.5 text-xs text-neutral-500">
            Contexto compartido por Copilot, tablero y alertas.
          </p>
        </div>
      </div>
      <label className="min-w-0 sm:w-80">
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
