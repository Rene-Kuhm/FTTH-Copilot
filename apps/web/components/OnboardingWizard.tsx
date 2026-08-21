'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth/client';
import { useConnectors, type ClientConnector } from '@/lib/connectors/client';

type Provider = 'SMARTOLT' | 'MIKROWISP';
type Step = 'welcome' | 'connector' | 'test' | 'done';

function storageKey(userId: string): string {
  return `ftth:onboarding:v2:${userId}`;
}

function readOnboardingState(userId: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(userId)) !== null;
  } catch {
    return false;
  }
}

function writeOnboardingState(userId: string, state: 'completed' | 'skipped') {
  try {
    window.localStorage.setItem(storageKey(userId), state);
  } catch {
    // El almacenamiento local no es indispensable para operar.
  }
}

export function OnboardingWizard() {
  const auth = useAuth();
  const connectorState = useConnectors();
  const [opened, setOpened] = useState(false);
  const [initializedFor, setInitializedFor] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('welcome');
  const [createdConnector, setCreatedConnector] = useState<ClientConnector | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      const userId = auth.user?.id;
      if (!userId) {
        setOpened(false);
        setInitializedFor(null);
        setStep('welcome');
        setCreatedConnector(null);
        return;
      }
      if (connectorState.loading || initializedFor === userId) return;

      setInitializedFor(userId);
      setOpened(
        !readOnboardingState(userId) &&
          connectorState.connectedConnectors.length === 0,
      );
    });
  }, [
    auth.user?.id,
    connectorState.connectedConnectors.length,
    connectorState.loading,
    initializedFor,
  ]);

  if (!auth.user || !opened) return null;

  function close(state: 'completed' | 'skipped') {
    if (auth.user) writeOnboardingState(auth.user.id, state);
    setOpened(false);
  }

  return (
    <section className="mb-6 rounded-xl border border-blue-500/30 bg-neutral-900 p-5 shadow-lg shadow-blue-950/10">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2" aria-label="Progreso de configuración">
          <StepDot active={step === 'welcome'} done={step !== 'welcome'} />
          <StepDot active={step === 'connector'} done={step === 'test' || step === 'done'} />
          <StepDot active={step === 'test'} done={step === 'done'} />
          <StepDot active={step === 'done'} done={false} />
        </div>
        <button type="button" onClick={() => close('skipped')} className="btn-ghost text-xs">
          Omitir por ahora
        </button>
      </header>

      {step === 'welcome' && (
        <div>
          <h2 className="text-base font-semibold text-neutral-50">
            Conectá tu primera red
          </h2>
          <p className="mt-2 text-sm text-neutral-300">
            Configurá SmartOLT o Mikrowisp y validaremos la conexión antes de habilitar
            las consultas. Tarda menos de dos minutos.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => setStep('connector')} className="btn-primary">
              Empezar
            </button>
            <button type="button" onClick={() => close('skipped')} className="btn-outline">
              Más tarde
            </button>
          </div>
        </div>
      )}

      {step === 'connector' && (
        <ConnectorForm
          onCancel={() => setStep('welcome')}
          onCreated={async (connector) => {
            setCreatedConnector(connector);
            await connectorState.refresh();
            setStep('test');
          }}
        />
      )}

      {step === 'test' && createdConnector && (
        <TestStep
          connector={createdConnector}
          onBack={() => setStep('connector')}
          onConnected={async () => {
            await connectorState.refresh();
            connectorState.selectConnection(createdConnector.id);
          }}
          onDone={() => setStep('done')}
        />
      )}

      {step === 'done' && (
        <div role="status" aria-live="polite">
          <h2 className="text-base font-semibold text-neutral-50">
            ¡Listo! Tu red quedó conectada.
          </h2>
          <p className="mt-2 text-sm text-neutral-300">
            Chat, tablero y alertas consultarán el NMS validado. Podés agregar o cambiar
            de red cuando quieras desde Conectores NMS.
          </p>
          <button type="button" onClick={() => close('completed')} className="btn-primary mt-4">
            Ir al chat
          </button>
        </div>
      )}
    </section>
  );
}

function StepDot({ active, done }: { active: boolean; done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-1.5 w-6 rounded-full ${
        active ? 'bg-blue-400' : done ? 'bg-blue-400/50' : 'bg-neutral-700'
      }`}
    />
  );
}

function ConnectorForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (connector: ClientConnector) => Promise<void>;
}) {
  const [provider, setProvider] = useState<Provider>('SMARTOLT');
  const [label, setLabel] = useState('SmartOLT producción');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.smartolt.com');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/connectors/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider, label, apiKey, baseUrl }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.connector) {
        throw new Error(data.error ?? 'No se pudo guardar el conector.');
      }
      await onCreated(data.connector);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo guardar el conector.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <h2 className="text-base font-semibold text-neutral-50">Datos de tu NMS</h2>
      <p className="mt-1 text-sm text-neutral-300">
        La clave de API se almacena cifrada con AES-256-GCM y nunca se muestra de nuevo.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-neutral-300">Proveedor</span>
          <select
            value={provider}
            onChange={(event) => {
              const next = event.target.value as Provider;
              setProvider(next);
              setLabel(next === 'SMARTOLT' ? 'SmartOLT producción' : 'Mikrowisp producción');
              setBaseUrl(next === 'SMARTOLT' ? 'https://api.smartolt.com' : '');
            }}
            className="input"
          >
            <option value="SMARTOLT">SmartOLT</option>
            <option value="MIKROWISP">Mikrowisp</option>
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-neutral-300">Etiqueta</span>
          <input name="connector-label" autoComplete="organization" type="text" value={label} onChange={(event) => setLabel(event.target.value)} required className="input" />
        </label>
        <label className="block space-y-1.5 sm:col-span-2">
          <span className="text-xs font-medium text-neutral-300">Clave de API</span>
          <input name="connector-api-key" autoComplete="off" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} required placeholder={`Token de ${provider === 'SMARTOLT' ? 'SmartOLT' : 'Mikrowisp'}`} className="input" />
        </label>
        <label className="block space-y-1.5 sm:col-span-2">
          <span className="text-xs font-medium text-neutral-300">URL base</span>
          <input name="connector-base-url" autoComplete="url" type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required placeholder={provider === 'SMARTOLT' ? 'https://api.smartolt.com' : 'https://tu-mikrowisp.example.com'} className="input" />
        </label>
      </div>
      {error && <div role="alert" aria-live="assertive" className="mt-3 rounded-lg border border-danger/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</div>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? 'Guardando…' : 'Guardar y probar'}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting} className="btn-outline">
          Volver
        </button>
      </div>
    </form>
  );
}

function TestStep({
  connector,
  onBack,
  onConnected,
  onDone,
}: {
  connector: ClientConnector;
  onBack: () => void;
  onConnected: () => Promise<void>;
  onDone: () => void;
}) {
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [running, setRunning] = useState(false);

  async function runTest() {
    setRunning(true);
    setResult(null);
    try {
      const response = await fetch(`/api/connectors/${connector.id}/test`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      const next = {
        ok: response.ok && data.ok === true,
        error: data.error ?? (!response.ok ? 'La prueba no pudo completarse.' : undefined),
      };
      setResult(next);
      if (next.ok) await onConnected();
    } catch (caught) {
      setResult({
        ok: false,
        error: caught instanceof Error ? caught.message : 'La prueba no pudo completarse.',
      });
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    queueMicrotask(() => void runTest());
    // La prueba debe iniciarse una sola vez por conector.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connector.id]);

  return (
    <div>
      <h2 className="text-base font-semibold text-neutral-50">Validemos la conexión</h2>
      <p className="mt-1 text-sm text-neutral-300">
        Estamos consultando {connector.label} con las credenciales que acabás de guardar.
      </p>
      <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-sm" aria-live="polite">
        {running && <span role="status" className="text-neutral-300">Probando conexión…</span>}
        {!running && result?.ok && <span role="status" className="text-emerald-300">Conexión exitosa. El NMS respondió correctamente.</span>}
        {!running && result && !result.ok && (
          <div role="alert">
            <p className="font-medium text-red-300">La conexión falló.</p>
            <p className="mt-1 text-xs text-neutral-300">{result.error ?? 'Revisá la URL y la clave de API.'}</p>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={onDone} disabled={running || result?.ok !== true} className="btn-primary">
          Continuar
        </button>
        {!running && result?.ok === false && <button type="button" onClick={() => void runTest()} className="btn-outline">Volver a probar</button>}
        <button type="button" onClick={onBack} disabled={running} className="btn-outline">Editar conector</button>
      </div>
    </div>
  );
}
