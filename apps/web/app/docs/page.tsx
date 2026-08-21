'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';

type Section = 'getting-started' | 'features' | 'api' | 'troubleshooting';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'getting-started', label: 'Primeros pasos' },
  { id: 'features', label: 'Funciones' },
  { id: 'api', label: 'API' },
  { id: 'troubleshooting', label: 'Solución de problemas' },
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
    <main className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 md:flex-row md:gap-12 md:py-10 lg:px-8">
      <aside className="w-full shrink-0 md:sticky md:top-8 md:h-fit md:w-60">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-300 hover:text-cyan-200">
          ← FTTH·Copilot
        </Link>
        <nav aria-label="Secciones de documentación" className="mt-4 flex gap-1 overflow-x-auto pb-2 text-sm md:mt-6 md:block md:space-y-1 md:overflow-visible md:pb-0">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={`block flex-shrink-0 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-colors ${
                active === s.id
                  ? 'border-cyan-300/15 bg-cyan-400/[0.08] text-cyan-100'
                  : 'border-transparent text-neutral-500 hover:bg-white/[0.025] hover:text-white'
              }`}
            >
              {s.label}
            </a>
          ))}
        </nav>
      </aside>

      <article className="min-w-0 flex-1 md:max-w-3xl">
        <header className="mb-12 border-b border-white/[0.07] pb-8">
          <p className="eyebrow">Centro de ayuda</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">Documentación para ISPs</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-neutral-400">
            Cómo conectar tu NMS, qué podés hacer con FTTH-Copilot, y cómo resolver los
            problemas más comunes.
          </p>
        </header>

        <Section id="getting-started" title="Primeros pasos">
          <p>
            FTTH-Copilot se monta como un panel SaaS: creás una cuenta, conectás tu NMS y
            empezás a consultar tu red. Una cuenta nueva no incluye conectores ni datos
            simulados: el asistente de configuración te guía para validar el primer NMS.
          </p>

          <SubTitle>1. Crear una cuenta</SubTitle>
          <ol className="list-decimal space-y-1 pl-5 text-neutral-400">
            <li>Entrá a <Link href={'/signup' as Route} className="text-blue-500 hover:underline">/signup</Link>.</li>
            <li>Completá email, contraseña y el nombre de tu ISP.</li>
            <li>Te logueás automáticamente y caés en <code className="rounded bg-neutral-900 px-1 py-0.5 text-xs">/app</code>.</li>
            <li>El asistente te pedirá los datos de SmartOLT o Mikrowisp.</li>
          </ol>

          <SubTitle>2. Conectar SmartOLT</SubTitle>
          <ol className="list-decimal space-y-1 pl-5 text-neutral-400">
            <li>En <code className="rounded bg-neutral-900 px-1 py-0.5 text-xs">/app</code>, usá el asistente o abrí <strong>Conectores NMS</strong>.</li>
            <li>Hacé clic en <em>Agregar conector</em>.</li>
            <li>Completá el proveedor, una etiqueta, la clave de API y la URL base pública HTTPS.</li>
            <li>La API key se guarda encriptada (AES-256-GCM) en el tenant.</li>
            <li>Elegí <em>Guardar y probar</em>. Solo una conexión validada se habilita para las consultas.</li>
          </ol>

          <SubTitle>3. Conectar Mikrowisp</SubTitle>
          <ol className="list-decimal space-y-1 pl-5 text-neutral-400">
            <li>Usá el mismo flujo y elegí <code className="rounded bg-neutral-900 px-1 py-0.5 text-xs">Mikrowisp</code>.</li>
            <li>La API key de Mikrowisp tiene la forma de un token Bearer.</li>
            <li>La integración consulta el adaptador HTTP real. Si falla, se informa el error y no se reemplaza con datos simulados.</li>
          </ol>
        </Section>

        <Section id="features" title="Funciones">
          <SubTitle>Consultas en lenguaje natural</SubTitle>
          <p>
            El agente responde preguntas operativas sobre tu red. Algunos ejemplos reales:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-neutral-400">
            <li><em>¿Cuántas ONUs están offline ahora?</em></li>
            <li><em>¿Qué OLTs tienen temperatura alta?</em></li>
            <li><em>Dame el detalle de la ONU con serial SN-001.</em></li>
            <li><em>¿Cuál es el uptime promedio de la red?</em></li>
          </ul>

          <SubTitle>Tablero</SubTitle>
          <p>
            En <code className="rounded bg-neutral-900 px-1 py-0.5 text-xs">/dashboard</code> ves el estado por OLT: cantidad de ONUs online/offline/degraded,
            disponibilidad promedio y temperatura. Los datos vienen del mismo conector que usa el
            chat. Si hay varios NMS conectados, el selector <strong>Red activa</strong>
            permite decidir cuál consultar.
          </p>

          <SubTitle>Alertas</SubTitle>
          <p>
            El panel de alertas muestra eventos críticos,
            advertencias e información. Es una consulta bajo demanda: usá Actualizar para
            obtener un nuevo estado. También dispone de una vista dedicada en <code className="rounded bg-neutral-900 px-1 py-0.5 text-xs">/alerts</code>.
          </p>

          <SubTitle>Gestión de usuarios</SubTitle>
          <p>
            Los propietarios y administradores pueden agregar usuarios a la organización:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-neutral-400">
            <li><strong>Propietario</strong> — control total, no se puede degradar.</li>
            <li><strong>Administrador</strong> — gestiona usuarios y conectores.</li>
            <li><strong>Operador</strong> — chatea y ve la red.</li>
          </ul>
        </Section>

        <Section id="api" title="API">
          <p>
            Todos los endpoints son <code className="rounded bg-neutral-900 px-1 py-0.5 text-xs">POST/GET/PATCH/DELETE</code> sobre
            <code className="rounded bg-neutral-900 px-1 py-0.5 text-xs">/api/*</code> y devuelven JSON.
          </p>

          <SubTitle>Autenticación</SubTitle>
          <p>
            La sesión se mantiene con una cookie HTTP-only <code className="rounded bg-neutral-900 px-1 py-0.5 text-xs">ftth_session</code> que contiene un
            JWT firmado. El cliente la manda automáticamente con <code className="rounded bg-neutral-900 px-1 py-0.5 text-xs">credentials: {'include'}</code>.
          </p>

          <SubTitle>Endpoints de alto nivel</SubTitle>
          <Endpoint method="POST" path="/api/auth/signup" desc="Crear cuenta y tenant. Setea cookie de sesión." />
          <Endpoint method="POST" path="/api/auth/login" desc="Inicia sesión con email y contraseña." />
          <Endpoint method="POST" path="/api/auth/logout" desc="Cierra la sesión actual." />
          <Endpoint method="GET" path="/api/auth/me" desc="Devuelve el usuario logueado o null." />
          <Endpoint method="GET" path="/api/connectors" desc="Lista los NMS connectors del tenant." />
          <Endpoint method="POST" path="/api/connectors/create" desc="Crea un conector (provider, label, apiKey, baseUrl)." />
          <Endpoint method="POST" path="/api/connectors/:id/test" desc="Prueba la conexión contra el NMS." />
          <Endpoint method="DELETE" path="/api/connectors/:id" desc="Borra el conector." />
          <Endpoint method="POST" path="/api/chat" desc="Envía un mensaje al agente. Devuelve reply + toolsUsed." />
          <Endpoint method="GET" path="/api/conversations" desc="Lista conversaciones del usuario." />
          <Endpoint method="GET" path="/api/alerts" desc="Lista alertas activas de la red." />
          <Endpoint method="GET" path="/api/dashboard" desc="Snapshot agregado para /dashboard." />
        </Section>

        <Section id="troubleshooting" title="Solución de problemas">
          <Faq
            q="El chat responde con datos que no son los de mi red."
            a="Verificá que la Red activa sea la correcta y que su conector figure como Conectado. El sistema no sustituye silenciosamente una conexión fallida por datos simulados."
          />
          <Faq
            q="La prueba del conector falla por credenciales inválidas."
            a="Revisá la clave de API y la URL base. El motivo exacto queda visible en Conectores NMS y podés usar Reintentar después de corregirlo."
          />
          <Faq
            q="No me deja agregar un conector."
            a="Solo Propietario y Administrador pueden crear o borrar conectores. Si sos Operador, pedile a un administrador que lo agregue."
          />
          <Faq
            q="Las alertas no aparecen."
            a="El panel muestra el resultado de la última consulta. Confirmá la Red activa y usá Actualizar para volver a consultar el NMS."
          />
          <Faq
            q="Olvidé la contraseña."
            a="La recuperación automática todavía no está disponible. No intentes crear otra cuenta con el mismo email: contactá al administrador del despliegue para recuperar el acceso de forma segura."
          />
        </Section>

        <footer className="mt-16 border-t border-white/[0.07] pt-6 text-xs text-neutral-500">
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
    <section id={id} className="mb-20 scroll-mt-24">
      <h2 className="text-2xl font-semibold tracking-[-0.03em] text-white">{title}</h2>
      <div className="mt-5 space-y-4 text-sm leading-7 text-neutral-300">{children}</div>
    </section>
  );
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-7 text-base font-semibold text-white">{children}</h3>;
}

function Endpoint({ method, path, desc }: { method: string; path: string; desc: string }) {
  const colors: Record<string, string> = {
    GET: 'border-green-800 text-green-400',
    POST: 'border-blue-800 text-blue-400',
    PATCH: 'border-yellow-800 text-yellow-400',
    DELETE: 'border-red-800 text-red-400',
  };
  return (
    <div className="card-soft px-4 py-3">
      <div className="flex items-center gap-3">
        <span className={`rounded border px-2 py-0.5 font-mono text-xs ${colors[method] ?? 'border-neutral-700 text-neutral-400'}`}>
          {method}
        </span>
        <code className="text-xs">{path}</code>
      </div>
      <p className="mt-1 text-xs text-neutral-400">{desc}</p>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div className="card-soft p-4 sm:p-5">
      <div className="text-sm font-semibold text-white">{q}</div>
      <p className="mt-2 text-sm leading-6 text-neutral-400">{a}</p>
    </div>
  );
}
