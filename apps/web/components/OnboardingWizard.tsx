'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useAuth } from '@/lib/auth/client';

type Provider = 'SMARTOLT' | 'MIKROWISP';

interface Connector {
  id: string;
  provider: Provider;
  label: string;
  baseUrl: string | null;
  status: string;
}

type Step = 'welcome' | 'connector' | 'test' | 'done';

function storageKey(userId: string): string {
  return `onboarding_completed_${userId}`;
}

/**
 * Returns true if the user only has the auto-created mock connector
 * (and no real one). That's the trigger condition for showing the wizard.
 */
function isOnlyMockConnector(connectors: Connector[]): boolean {
  if (connectors.length !== 1) return false;
  return connectors[0].label === 'SmartOLT (demo)';
}

export function OnboardingWizard() {
  const auth = useAuth();
  const [connectors, setConnectors] = useState<Connector[] | null>(null);
  const [show, setShow] = useState(false);
  const [step, setStep] = useState<Step>('welcome');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!auth.user) {
        if (!cancelled) {
          setConnectors(null);
          setShow(false);
        }
        return;
      }
      if (typeof window !== 'undefined') {
        const done = window.localStorage.getItem(storageKey(auth.user.id));
        if (done === 'true') {
          if (!cancelled) setShow(false);
          return;
        }
      }
      try {
        const r = await fetch('/api/connectors', { credentials: 'include' });
        const data = await r.json();
        if (cancelled) return;
        const list: Connector[] = data.connectors ?? [];
        setConnectors(list);
        if (isOnlyMockConnector(list)) setShow(true);
      } catch {
        if (!cancelled) setConnectors([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth.user]);

  if (!auth.user || !show || connectors === null) return null;

  function complete() {
    if (auth.user && typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey(auth.user.id), 'true');
    }
    setShow(false);
  }

  function skip() {
    complete();
  }

  return (
    <div className="mb-6 rounded-lg border border-neutral-800 bg-bg-subtle p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <StepDot active={step === 'welcome'} done={step !== 'welcome'} />
          <StepDot active={step === 'connector'} done={step === 'test' || step === 'done'} />
          <StepDot active={step === 'test'} done={step === 'done'} />
          <StepDot active={step === 'done'} done={false} />
        </div>
        <button onClick={skip} className="text-xs text-fg-muted hover:text-fg">
          Skip
        </button>
      </div>

      {step === 'welcome' && (
        <div>
          <h2 className="text-base font-semibold">Bienvenido a FTTH-Copilot</h2>
          <p className="mt-2 text-sm text-fg-muted">
            Vamos a configurar tu NMS en 3 pasos. Tarda menos de 2 minutos.
          </p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setStep('connector')}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
            >
              Empezar
            </button>
            <button
              onClick={skip}
              className="rounded-md border border-neutral-700 px-4 py-1.5 text-sm hover:border-accent"
            >
              Más tarde
            </button>
          </div>
        </div>
      )}

      {step === 'connector' && (
        <ConnectorForm
          onCancel={() => setStep('welcome')}
          onCreated={(connector) => {
            setConnectors([connector]);
            setStep('test');
          }}
        />
      )}

      {step === 'test' && connectors.length > 0 && (
        <TestStep
          connector={connectors[0]}
          onBack={() => setStep('connector')}
          onDone={() => setStep('done')}
        />
      )}

      {step === 'done' && (
        <div>
          <h2 className="text-base font-semibold">¡Listo! Ya podés chatear con tu red.</h2>
          <p className="mt-2 text-sm text-fg-muted">
            El chat va a usar tu connector real a partir de ahora. Si querés agregar más
            NMS, volvé a la sección <em>NMS Connectors</em>.
          </p>
          <div className="mt-4 flex gap-2">
            <Link
              href={'/app' as Route}
              onClick={complete}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
            >
              Ir al chat
            </Link>
            <button
              onClick={complete}
              className="rounded-md border border-neutral-700 px-4 py-1.5 text-sm hover:border-accent"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StepDot({ active, done }: { active: boolean; done: boolean }) {
  const cls = active
    ? 'bg-accent'
    : done
      ? 'bg-accent/40'
      : 'bg-neutral-700';
  return <span className={`inline-block h-1.5 w-6 rounded-full ${cls}`} />;
}

interface ConnectorFormProps {
  onCancel: () => void;
  onCreated: (connector: Connector) => void;
}

function ConnectorForm({ onCancel, onCreated }: ConnectorFormProps) {
  const [provider, setProvider] = useState<Provider>('SMARTOLT');
  const [label, setLabel] = useState('SmartOLT prod');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://demo.smartolt.com');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await fetch('/api/connectors/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          provider,
          label,
          apiKey,
          baseUrl: baseUrl || null,
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error ?? 'Error');
      }
      const data = await r.json();
      onCreated(data.connector);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)}>
      <h2 className="text-base font-semibold">Conectá tu SmartOLT</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Tu API key se guarda encriptada (AES-256-GCM). No la vemos ni la logueamos.
      </p>
      <div className="mt-4 space-y-2">
        <label className="block text-xs text-fg-muted">
          Provider
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as Provider)}
            className="mt-1 w-full rounded border border-neutral-700 bg-bg px-3 py-1.5 text-sm focus:border-accent focus:outline-none"
          >
            <option value="SMARTOLT">SmartOLT</option>
            <option value="MIKROWISP">Mikrowisp</option>
          </select>
        </label>
        <label className="block text-xs text-fg-muted">
          Etiqueta
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            className="mt-1 w-full rounded border border-neutral-700 bg-bg px-3 py-1.5 text-sm placeholder:text-fg-muted focus:border-accent focus:outline-none"
          />
        </label>
        <label className="block text-xs text-fg-muted">
          API key
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            required
            placeholder="Token Bearer de SmartOLT"
            className="mt-1 w-full rounded border border-neutral-700 bg-bg px-3 py-1.5 text-sm placeholder:text-fg-muted focus:border-accent focus:outline-none"
          />
        </label>
        <label className="block text-xs text-fg-muted">
          Base URL
          <input
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://demo.smartolt.com"
            className="mt-1 w-full rounded border border-neutral-700 bg-bg px-3 py-1.5 text-sm placeholder:text-fg-muted focus:border-accent focus:outline-none"
          />
        </label>
        {error && <div className="text-xs text-red-400">{error}</div>}
      </div>
      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {submitting ? 'Guardando…' : 'Guardar y probar'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-neutral-700 px-4 py-1.5 text-sm hover:border-accent"
        >
          Volver
        </button>
      </div>
    </form>
  );
}

interface TestStepProps {
  connector: Connector;
  onBack: () => void;
  onDone: () => void;
}

function TestStep({ connector, onBack, onDone }: TestStepProps) {
  const [result, setResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setRunning(true);
      try {
        const r = await fetch(`/api/connectors/${connector.id}/test`, {
          method: 'POST',
          credentials: 'include',
        });
        const data = await r.json();
        if (!cancelled) setResult({ ok: !!data.ok, error: data.error });
      } catch (e) {
        if (!cancelled) setResult({ ok: false, error: e instanceof Error ? e.message : 'Error' });
      } finally {
        if (!cancelled) setRunning(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connector.id]);

  return (
    <div>
      <h2 className="text-base font-semibold">Probemos la conexión</h2>
      <p className="mt-1 text-sm text-fg-muted">
        Estamos haciendo un <em>ping</em> contra <code className="rounded bg-bg px-1 py-0.5 text-xs">{connector.provider}</code> con tu API key.
      </p>
      <div className="mt-4 rounded border border-neutral-800 bg-bg p-3 text-sm">
        {running && <span className="text-fg-muted">Probando…</span>}
        {!running && result?.ok && (
          <span className="text-green-400">Conexión exitosa. Tu NMS responde correctamente.</span>
        )}
        {!running && result && !result.ok && (
          <div>
            <div className="text-red-400">Falló la conexión.</div>
            {result.error && (
              <div className="mt-1 text-xs text-fg-muted">{result.error}</div>
            )}
          </div>
        )}
      </div>
      <div className="mt-4 flex gap-2">
        <button
          onClick={onDone}
          disabled={running}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Continuar
        </button>
        <button
          onClick={onBack}
          disabled={running}
          className="rounded-md border border-neutral-700 px-4 py-1.5 text-sm hover:border-accent disabled:opacity-50"
        >
          Editar connector
        </button>
      </div>
    </div>
  );
}
