import Link from 'next/link';
import type { Route } from 'next';

export default function LandingPage() {
  return (
    <main className="min-h-screen">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-base font-semibold tracking-tight">
          FTTH<span className="text-blue-500">-</span>Copilot
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href={'/docs' as Route}
            className="text-sm text-neutral-400 hover:text-neutral-50"
          >
            Docs
          </Link>
          <Link
            href={'/login' as Route}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm hover:border-blue-500"
          >
            Login
          </Link>
          <Link
            href={'/signup' as Route}
            className="rounded-md bg-blue-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            Probar demo
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-6xl px-6 pt-20 pb-24 text-center">
        <span className="inline-block rounded-full border border-neutral-800 bg-neutral-900 px-3 py-1 text-xs text-neutral-400">
          Para ISPs que usan SmartOLT o Mikrowisp
        </span>
        <h1 className="mt-6 text-balance text-5xl font-semibold tracking-tight md:text-6xl">
          Diagnóstico de tu red FTTH
          <br />
          <span className="text-blue-500">en lenguaje natural</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-neutral-400">
          Preguntale a tu red en español. Sin reemplazar tu NMS, sin dashboards crípticos.
          Detectá ONUs offline, OLTs con temperatura alta y alertas críticas antes de que
          te llamen los clientes.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={'/signup' as Route}
            className="rounded-md bg-blue-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            Probar demo
          </Link>
          <Link
            href={'/login' as Route}
            className="rounded-md border border-neutral-700 px-5 py-2.5 text-sm hover:border-blue-500"
          >
            Login
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <h2 className="text-center text-2xl font-semibold tracking-tight">
          Lo que hace por tu ISP
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-neutral-400">
          Cuatro pilares que cubren el día a día operativo de un ISP FTTH chico y mediano.
        </p>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <Feature
            title="Chat en lenguaje natural"
            body='Preguntá "¿cuántas ONUs están offline?" o "qué OLTs tienen temperatura alta" y obtené respuestas con los datos reales de tu NMS.'
          />
          <Feature
            title="Alertas en tiempo real"
            body="Detección continua de ONUs caídas, OLTs degradadas y eventos críticos. Enterate antes de que te lleguen los reclamos."
          />
          <Feature
            title="Multi-NMS"
            body="Soporte para SmartOLT y Mikrowisp. Conectás tu API key una vez y el agente la usa en cada consulta."
          />
          <Feature
            title="Acceso por roles"
            body="Owner, Admin y Operator con permisos diferenciados sobre connectors, usuarios y conversaciones."
          />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <h2 className="text-center text-2xl font-semibold tracking-tight">Cómo funciona</h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-sm text-neutral-400">
          Tres pasos para empezar a chatear con tu red.
        </p>
        <ol className="mt-10 grid gap-4 md:grid-cols-3">
          <Step
            n={1}
            title="Conectá tu NMS"
            body="Cargá tu API key de SmartOLT o Mikrowisp. Se guarda encriptada (AES-256-GCM)."
          />
          <Step
            n={2}
            title="Hablá con tu red"
            body="Preguntá en español sobre ONUs, OLTs, uptime, alertas o cualquier métrica del NMS."
          />
          <Step
            n={3}
            title="Recibí alertas"
            body="El panel te muestra eventos críticos y advertencias a medida que aparecen en tu red."
          />
        </ol>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="rounded-xl border border-neutral-800 bg-neutral-900 px-8 py-12 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">Listo para chatear con tu red?</h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-neutral-400">
            Empezás con datos mockeados. Cuando conectes tu NMS real, el chat pasa a usar
            tu API automáticamente.
          </p>
          <Link
            href={'/signup' as Route}
            className="mt-6 inline-block rounded-md bg-blue-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500"
          >
            Probar demo
          </Link>
        </div>
      </section>

      <footer className="border-t border-neutral-800">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 py-8 text-xs text-neutral-400 md:flex-row">
          <div>FTTH-Copilot · Diagnóstico en lenguaje natural para ISPs FTTH</div>
          <div className="flex gap-6">
            <Link href={'/docs' as Route} className="hover:text-neutral-50">Docs</Link>
            <Link href={'/login' as Route} className="hover:text-neutral-50">Login</Link>
            <Link href={'/signup' as Route} className="hover:text-neutral-50">Demo</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-6">
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="mt-2 text-sm text-neutral-400">{body}</p>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="rounded-lg border border-neutral-800 bg-neutral-900 p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full border border-blue-500 text-sm font-semibold text-blue-500">
          {n}
        </span>
        <h3 className="text-base font-semibold">{title}</h3>
      </div>
      <p className="mt-3 text-sm text-neutral-400">{body}</p>
    </li>
  );
}
