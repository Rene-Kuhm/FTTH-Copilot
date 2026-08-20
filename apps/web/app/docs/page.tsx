'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';

type Section = 'getting-started' | 'features' | 'api' | 'troubleshooting';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'features', label: 'Features' },
  { id: 'api', label: 'API' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
];

export default function DocsPage() {
  const [active, setActive] = useState<Section>('getting-started');

  useEffect(() => {
    const onScroll = () => {
      const offsets = SECTIONS.map((s) => {
        const el = document.getElementById(s.id);
        if (!el) return { id: s.id, top: Number.POSITIVE_INFINITY };
        const rect = el.getBoundingClientRect();
        return { id: s.id, top: rect.top };
      });
      const visible = offsets.filter((o) => o.top < 160).sort((a, b) => b.top - a.top);
      if (visible[0]) setActive(visible[0].id as Section);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <main className="mx-auto flex max-w-6xl gap-10 px-6 py-10">
      <aside className="hidden w-56 shrink-0 md:block">
        <Link href="/" className="text-sm text-fg-muted hover:text-fg">
          ← FTTH-Copilot
        </Link>
        <nav className="mt-6 space-y-1 text-sm">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={`block rounded px-3 py-1.5 transition-colors ${
                active === s.id
                  ? 'border-l-2 border-accent bg-bg-subtle text-fg'
                  : 'border-l-2 border-transparent text-fg-muted hover:text-fg'
              }`}
            >
              {s.label}
            </a>
          ))}
        </nav>
      </aside>

      <article className="min-w-0 flex-1">
        <header className="mb-10 border-b border-neutral-800 pb-6">
          <h1 className="text-3xl font-semibold tracking-tight">Docs para ISPs</h1>
          <p className="mt-2 text-sm text-fg-muted">
            Cómo conectar tu NMS, qué podés hacer con FTTH-Copilot, y cómo resolver los
            problemas más comunes.
          </p>
        </header>

        <Section id="getting-started" title="Getting Started">
          <p>
            FTTH-Copilot se monta como un panel SaaS: creás una cuenta, conectás tu NMS y
            empezás a chatear con tu red. El primer arranque usa datos mockeados, así que
            podés probar la experiencia completa antes de tocar tu NMS real.
          </p>

          <SubTitle>1. Crear una cuenta</SubTitle>
          <ol className="list-decimal space-y-1 pl-5 text-fg-muted">
            <li>Entrá a <Link href={'/signup' as Route} className="text-accent hover:underline">/signup</Link>.</li>
            <li>Completá email, contraseña y el nombre de tu ISP.</li>
            <li>Te logueás automáticamente y caés en <code className="rounded bg-bg-subtle px-1 py-0.5 text-xs">/app</code>.</li>
            <li>Por ahora vas a ver un connector SmartOLT mockeado.</li>
          </ol>

          <SubTitle>2. Conectar SmartOLT</SubTitle>
          <ol className="list-decimal space-y-1 pl-5 text-fg-muted">
            <li>En <code className="rounded bg-bg-subtle px-1 py-0.5 text-xs">/app</code>, abrí la sección <strong>NMS Connectors</strong>.</li>
            <li>Hacé clic en <em>+ Agregar connector</em>.</li>
            <li>Completá: provider <code className="rounded bg-bg-subtle px-1 py-0.5 text-xs">SmartOLT</code>, una etiqueta, la API key y la base URL (ej. <code className="rounded bg-bg-subtle px-1 py-0.5 text-xs">https://demo.smartolt.com</code>).</li>
            <li>La API key se guarda encriptada (AES-256-GCM) en el tenant.</li>
            <li>Probá la conexión con el endpoint de test (ver sección API).</li>
          </ol>

          <SubTitle>3. Conectar Mikrowisp</SubTitle>
          <ol className="list-decimal space-y-1 pl-5 text-fg-muted">
            <li>Mismo flujo: provider <code className="rounded bg-bg-subtle px-1 py-0.5 text-xs">Mikrowisp</code>.</li>
            <li>La API key de Mikrowisp tiene la forma de un token Bearer.</li>
            <li>El adapter HTTP real a Mikrowisp está en roadmap — por ahora el chat cae a fixtures mock cuando detecta este provider.</li>
          </ol>
        </Section>

        <Section id="features" title="Features">
          <SubTitle>Consultas en lenguaje natural</SubTitle>
          <p>
            El agente responde preguntas operativas sobre tu red. Algunos ejemplos reales:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-fg-muted">
            <li><em>¿Cuántas ONUs están offline ahora?</em></li>
            <li><em>¿Qué OLTs tienen temperatura alta?</em></li>
            <li><em>Dame el detalle de la ONU con serial SN-001.</em></li>
            <li><em>¿Cuál es el uptime promedio de la red?</em></li>
          </ul>

          <SubTitle>Dashboard</SubTitle>
          <p>
            En <code className="rounded bg-bg-subtle px-1 py-0.5 text-xs">/dashboard</code> ves el estado por OLT: cantidad de ONUs online/offline/degraded,
            uptime promedio, y temperatura. Los datos vienen del mismo connector que usa el
            chat.
          </p>

          <SubTitle>Alertas</SubTitle>
          <p>
            El panel de alertas (visible arriba del chat) muestra eventos críticos,
            advertencias e info. Las alertas se filtran por severidad y se colapsan/expanden
            con un click.
          </p>

          <SubTitle>Gestión de usuarios</SubTitle>
          <p>
            Los owners y admins pueden invitar usuarios al tenant con roles diferenciados:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-fg-muted">
            <li><strong>Owner</strong> — control total, no se puede degradar.</li>
            <li><strong>Admin</strong> — gestiona usuarios y connectors.</li>
            <li><strong>Operator</strong> — sólo chatea y ve la red.</li>
          </ul>
        </Section>

        <Section id="api" title="API">
          <p>
            Todos los endpoints son <code className="rounded bg-bg-subtle px-1 py-0.5 text-xs">POST/GET/PATCH/DELETE</code> sobre
            <code className="rounded bg-bg-subtle px-1 py-0.5 text-xs">/api/*</code> y devuelven JSON.
          </p>

          <SubTitle>Autenticación</SubTitle>
          <p>
            La sesión se mantiene con una cookie HTTP-only <code className="rounded bg-bg-subtle px-1 py-0.5 text-xs">ftth_session</code> que contiene un
            JWT firmado. El cliente la manda automáticamente con <code className="rounded bg-bg-subtle px-1 py-0.5 text-xs">credentials: 'include'</code>.
          </p>

          <SubTitle>Endpoints de alto nivel</SubTitle>
          <Endpoint method="POST" path="/api/auth/signup" desc="Crear cuenta y tenant. Setea cookie de sesión." />
          <Endpoint method="POST" path="/api/auth/login" desc="Login con email + contraseña." />
          <Endpoint method="POST" path="/api/auth/logout" desc="Cierra la sesión actual." />
          <Endpoint method="GET" path="/api/auth/me" desc="Devuelve el usuario logueado o null." />
          <Endpoint method="GET" path="/api/connectors" desc="Lista los NMS connectors del tenant." />
          <Endpoint method="POST" path="/api/connectors/create" desc="Crea un connector (provider, label, apiKey, baseUrl)." />
          <Endpoint method="POST" path="/api/connectors/:id/test" desc="Prueba la conexión contra el NMS." />
          <Endpoint method="DELETE" path="/api/connectors/:id" desc="Borra el connector." />
          <Endpoint method="POST" path="/api/chat" desc="Envía un mensaje al agente. Devuelve reply + toolsUsed." />
          <Endpoint method="GET" path="/api/conversations" desc="Lista conversaciones del usuario." />
          <Endpoint method="GET" path="/api/alerts" desc="Lista alertas activas de la red." />
          <Endpoint method="GET" path="/api/dashboard" desc="Snapshot agregado para /dashboard." />
        </Section>

        <Section id="troubleshooting" title="Troubleshooting">
          <Faq
            q="El chat responde con datos que no son los de mi red."
            a="Probablemente seguís sin un connector real. En NMS Connectors verificá que exista uno con status 'connected'. El fallback a mocks sólo se quita cuando hay al menos un connector real configurado."
          />
          <Faq
            q="El test del connector falla con 'Invalid credentials'."
            a="Revisá que la API key sea la correcta y que la baseUrl apunte al host correcto (ej. https://demo.smartolt.com para cuentas demo). El error exacto queda guardado en el campo lastError del connector."
          />
          <Faq
            q="No me deja agregar un connector."
            a="Sólo roles con permiso manage_connectors (Owner y Admin) pueden crear/borrar. Si sos Operator, pedile a un admin que lo agregue."
          />
          <Faq
            q="Las alertas no aparecen."
            a="El panel sólo muestra alertas cuando el backend detecta eventos reales. Con datos mock vas a ver un set fijo; con datos reales depende del estado de tu red."
          />
          <Faq
            q="Olvidé la contraseña."
            a="El flujo de reset está en roadmap. Pedile a un Owner de tu tenant que te cree un usuario nuevo desde el panel de User Management."
          />
        </Section>

        <footer className="mt-16 border-t border-neutral-800 pt-6 text-xs text-fg-muted">
          ¿Falta algo? Escribinos — esta doc se actualiza con cada release.
        </footer>
      </article>
    </main>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-16 scroll-mt-24">
      <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-4 space-y-4 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-4 text-base font-semibold">{children}</h3>;
}

function Endpoint({ method, path, desc }: { method: string; path: string; desc: string }) {
  const colors: Record<string, string> = {
    GET: 'border-green-800 text-green-400',
    POST: 'border-blue-800 text-blue-400',
    PATCH: 'border-yellow-800 text-yellow-400',
    DELETE: 'border-red-800 text-red-400',
  };
  return (
    <div className="rounded border border-neutral-800 bg-bg-subtle px-4 py-2">
      <div className="flex items-center gap-3">
        <span className={`rounded border px-2 py-0.5 font-mono text-xs ${colors[method] ?? 'border-neutral-700 text-fg-muted'}`}>
          {method}
        </span>
        <code className="text-xs">{path}</code>
      </div>
      <p className="mt-1 text-xs text-fg-muted">{desc}</p>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div className="rounded border border-neutral-800 bg-bg-subtle p-4">
      <div className="text-sm font-medium">{q}</div>
      <p className="mt-2 text-sm text-fg-muted">{a}</p>
    </div>
  );
}
