'use client';

import { useAuth } from '@/lib/auth/client';
import { useConnectors } from '@/lib/connectors/client';
import { ServerStackIcon } from './icons';

export function NmsSelector() {
  const auth = useAuth();
  const connectorState = useConnectors();

  if (auth.loading || !auth.user) return null;

  const isConnected =
    connectorState.connectedConnectors.length > 0 || connectorState.demoMode;

  return (
    <section
      className="card flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
      style={{ color: 'var(--color-text)' }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{
            background: 'rgb(242 48 119 / 0.1)',
            border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
            color: 'var(--color-accent)',
          }}
        >
          <ServerStackIcon className="h-[18px] w-[18px]" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2
              className="text-sm font-semibold"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
            >
              Red activa
            </h2>
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: isConnected ? 'var(--color-success)' : 'var(--color-warning)',
                boxShadow: isConnected
                  ? '0 0 8px var(--color-success)'
                  : 'none',
              }}
            />
          </div>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--color-muted)' }}>
            Contexto compartido por Copilot, tablero y alertas.
          </p>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-2 sm:w-80 sm:flex-row">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Seleccionar conector NMS</span>
          <select
            className="input"
            value={connectorState.selectedConnectionId ?? ''}
            onChange={(event) => connectorState.selectConnection(event.target.value)}
            disabled={
              connectorState.loading ||
              connectorState.connectedConnectors.length === 0
            }
            style={{ color: 'var(--color-text)' }}
          >
            {connectorState.connectedConnectors.length === 0 && (
              <option value="">
                {connectorState.demoMode
                  ? 'Demo · datos simulados'
                  : 'Sin conectores validados'}
              </option>
            )}
            {connectorState.connectedConnectors.map((connector) => (
              <option key={connector.id} value={connector.id}>
                {connector.label} · {connector.provider}
              </option>
            ))}
          </select>
        </label>
        {!connectorState.loading &&
          connectorState.connectedConnectors.length === 0 &&
          !connectorState.demoMode && (
            <a href="#gestion" className="btn-primary shrink-0">
              Configurar red
            </a>
          )}
      </div>
    </section>
  );
}
