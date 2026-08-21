import Link from 'next/link';
import type { Route } from 'next';
import {
  BellIcon,
  ChartBarSquareIcon,
  ChatBubbleLeftRightIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  CpuChipIcon,
  ServerStackIcon,
  ShieldCheckIcon,
  SignalIcon,
  SparklesIcon,
} from '@/components/icons';

const CAPABILITIES = [
  {
    title: 'Copilot operativo',
    body: 'Consultá ONUs, OLTs, potencia y disponibilidad en español, con respuestas basadas en tu NMS activo.',
    Icon: ChatBubbleLeftRightIcon,
    accent: 'from-cyan-400/20 to-cyan-400/5 text-cyan-300',
  },
  {
    title: 'Visibilidad ejecutiva',
    body: 'Convertí métricas técnicas en una vista clara del estado de la red y de los puntos que requieren atención.',
    Icon: ChartBarSquareIcon,
    accent: 'from-indigo-400/20 to-indigo-400/5 text-indigo-300',
  },
  {
    title: 'Alertas priorizadas',
    body: 'Agrupá eventos por impacto y categoría para que el equipo trabaje primero sobre lo realmente importante.',
    Icon: BellIcon,
    accent: 'from-amber-400/20 to-amber-400/5 text-amber-300',
  },
  {
    title: 'Multi-NMS seguro',
    body: 'Conectá SmartOLT y Mikrowisp, elegí la red activa y mantené las credenciales cifradas por organización.',
    Icon: ShieldCheckIcon,
    accent: 'from-emerald-400/20 to-emerald-400/5 text-emerald-300',
  },
] as const;

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div aria-hidden="true" className="surface-grid pointer-events-none absolute inset-x-0 top-0 h-[760px] opacity-80" />
      <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[-18rem] h-[42rem] w-[42rem] -translate-x-1/2 rounded-full bg-cyan-400/[0.07] blur-3xl" />

      <nav className="relative z-20 mx-auto flex h-[76px] max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-2.5" aria-label="FTTH-Copilot, inicio">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-400/10 text-cyan-300 shadow-[0_10px_30px_rgba(34,184,230,.12)]">
            <SignalIcon className="h-[18px] w-[18px]" />
          </span>
          <span className="hidden truncate text-[15px] font-bold tracking-[-0.025em] text-white min-[390px]:block">
            FTTH<span className="text-cyan-400">·</span>Copilot
          </span>
        </Link>
        <div className="hidden items-center gap-7 md:flex">
          <a href="#plataforma" className="text-xs font-semibold text-neutral-400 transition-colors hover:text-white">Plataforma</a>
          <a href="#como-funciona" className="text-xs font-semibold text-neutral-400 transition-colors hover:text-white">Cómo funciona</a>
          <Link href={'/docs' as Route} className="text-xs font-semibold text-neutral-400 transition-colors hover:text-white">Documentación</Link>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link href={'/login' as Route} className="btn-ghost px-2.5 sm:px-3">Ingresar</Link>
          <Link href={'/signup' as Route} className="btn-primary whitespace-nowrap px-3 sm:px-4">Crear cuenta</Link>
        </div>
      </nav>

      <section className="relative mx-auto grid max-w-7xl gap-14 px-5 pb-20 pt-16 sm:px-6 sm:pt-24 lg:grid-cols-[1.02fr_.98fr] lg:items-center lg:gap-16 lg:px-8 lg:pb-28 lg:pt-28">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/15 bg-cyan-400/[0.07] px-3 py-1.5 text-[11px] font-semibold text-cyan-100 shadow-inner">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            Inteligencia operativa para ISPs FTTH
          </div>
          <h1 className="mt-7 max-w-3xl text-balance text-[2.65rem] font-semibold leading-[1.04] tracking-[-0.055em] text-white sm:text-6xl lg:text-[4.4rem]">
            Tu red, explicada con la claridad que{' '}
            <span className="bg-gradient-to-r from-cyan-300 via-cyan-400 to-indigo-300 bg-clip-text text-transparent">
              tus operaciones necesitan.
            </span>
          </h1>
          <p className="mt-7 max-w-xl text-pretty text-base leading-7 text-neutral-400 sm:text-lg sm:leading-8">
            Un centro de control que conecta tus NMS, prioriza alertas y convierte datos técnicos en respuestas accionables para todo tu equipo.
          </p>
          <div className="mt-9 flex flex-col gap-3 min-[390px]:flex-row">
            <Link href={'/signup' as Route} className="btn-primary min-h-11 px-5 text-sm">
              Empezar ahora
              <ChevronRightIcon className="h-4 w-4" />
            </Link>
            <Link href={'/docs' as Route} className="btn-outline min-h-11 px-5 text-sm">
              Ver documentación
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs text-neutral-500">
            <span className="inline-flex items-center gap-1.5"><CheckCircleIcon className="h-4 w-4 text-emerald-400" /> SmartOLT y Mikrowisp</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircleIcon className="h-4 w-4 text-emerald-400" /> Acceso por roles</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircleIcon className="h-4 w-4 text-emerald-400" /> Credenciales cifradas</span>
          </div>
        </div>

        <ProductPreview />
      </section>

      <section className="border-y border-white/[0.06] bg-white/[0.018]">
        <div className="mx-auto grid max-w-7xl grid-cols-2 divide-x divide-white/[0.06] px-4 sm:px-6 md:grid-cols-4 lg:px-8">
          <Proof value="24/7" label="Visibilidad operativa" />
          <Proof value="2" label="NMS compatibles" />
          <Proof value="AES-256" label="Cifrado de credenciales" />
          <Proof value="3" label="Niveles de acceso" />
        </div>
      </section>

      <section id="plataforma" className="mx-auto max-w-7xl px-5 py-24 sm:px-6 lg:px-8 lg:py-32">
        <div className="max-w-2xl">
          <p className="eyebrow">Una sola plataforma</p>
          <h2 className="mt-4 text-balance text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
            Diseñada para operar, no para sumar otro dashboard.
          </h2>
          <p className="mt-4 text-sm leading-7 text-neutral-400 sm:text-base">
            La información crítica queda ordenada en el mismo lugar donde tu equipo analiza, pregunta y toma decisiones.
          </p>
        </div>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map(({ title, body, Icon, accent }) => (
            <article key={title} className="card group relative overflow-hidden p-5 sm:p-6">
              <div aria-hidden="true" className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/30 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
              <span className={`flex h-11 w-11 items-center justify-center rounded-[14px] bg-gradient-to-br ${accent} ring-1 ring-inset ring-white/10`}>
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-5 text-[15px] font-semibold text-white">{title}</h3>
              <p className="mt-2.5 text-sm leading-6 text-neutral-400">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="como-funciona" className="relative border-y border-white/[0.06] bg-[#08131d]/80">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-24 sm:px-6 lg:grid-cols-[.82fr_1.18fr] lg:items-center lg:px-8 lg:py-28">
          <div>
            <p className="eyebrow">De conexión a decisión</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
              Operativa en tres pasos simples.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-7 text-neutral-400">
              FTTH-Copilot se integra con tu stack actual. No reemplaza tu NMS: hace que sus datos sean más accesibles y útiles.
            </p>
          </div>
          <ol className="space-y-3">
            <Step n="01" title="Conectá y validá tu NMS" body="Configurá SmartOLT o Mikrowisp mediante un flujo guiado y una prueba de conexión segura." />
            <Step n="02" title="Elegí la red que querés analizar" body="Alterná entre conectores sin mezclar contextos, métricas ni conversaciones." />
            <Step n="03" title="Preguntá, monitoreá y actuá" body="Usá el Copilot, el tablero y las alertas para convertir señales de red en prioridades claras." />
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-24 sm:px-6 lg:px-8 lg:py-32">
        <div className="relative overflow-hidden rounded-[1.5rem] border border-cyan-300/15 bg-gradient-to-br from-cyan-400/[0.11] via-[#0c1c29] to-indigo-400/[0.08] px-6 py-12 text-center shadow-[0_30px_100px_rgba(0,0,0,.28)] sm:px-12 sm:py-16">
          <div aria-hidden="true" className="absolute inset-0 surface-grid opacity-50" />
          <div className="relative">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-400/10 text-cyan-300">
              <SparklesIcon className="h-6 w-6" />
            </span>
            <h2 className="mx-auto mt-5 max-w-2xl text-balance text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
              Dale a tu equipo una mejor forma de entender la red.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-neutral-400">
              Creá tu espacio, conectá el primer NMS y empezá a diagnosticar con contexto real.
            </p>
            <Link href={'/signup' as Route} className="btn-primary mt-7 min-h-11 px-5 text-sm">
              Crear mi espacio
              <ChevronRightIcon className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/[0.06]">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-8 text-xs text-neutral-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <SignalIcon className="h-4 w-4 text-cyan-400" />
            <span>FTTH-Copilot · Inteligencia operativa para ISPs</span>
          </div>
          <div className="flex gap-5">
            <Link href={'/docs' as Route} className="transition-colors hover:text-white">Documentación</Link>
            <Link href={'/login' as Route} className="transition-colors hover:text-white">Ingresar</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function ProductPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[620px] lg:mx-0">
      <div aria-hidden="true" className="absolute -inset-8 rounded-full bg-cyan-400/[0.08] blur-3xl" />
      <div className="card relative overflow-hidden rounded-[1.25rem] border-cyan-300/15 bg-[#09151f]/95 shadow-[0_40px_110px_rgba(0,0,0,.42)]">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3 sm:px-5">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#ff6b7f]" />
            <span className="h-2 w-2 rounded-full bg-[#f6b84b]" />
            <span className="h-2 w-2 rounded-full bg-[#2dd4a7]" />
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-neutral-500">Centro de operaciones</span>
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_9px_rgba(45,212,167,.75)]" />
        </div>
        <div className="grid grid-cols-[76px_1fr] sm:grid-cols-[132px_1fr]">
          <div className="border-r border-white/[0.06] p-3 sm:p-4">
            <div className="mb-5 flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-400/10 text-cyan-300">
              <SignalIcon className="h-4 w-4" />
            </div>
            {[ChatBubbleLeftRightIcon, ChartBarSquareIcon, BellIcon, ServerStackIcon].map((Icon, index) => (
              <div key={index} className={`mb-2 flex items-center gap-2 rounded-lg px-2 py-2 ${index === 1 ? 'bg-cyan-400/10 text-cyan-200' : 'text-neutral-600'}`}>
                <Icon className="h-4 w-4 shrink-0" />
                <span className="hidden text-[10px] font-semibold sm:inline">{['Copilot', 'Tablero', 'Alertas', 'Redes'][index]}</span>
              </div>
            ))}
          </div>
          <div className="min-w-0 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.16em] text-cyan-400">Estado general</p>
                <h3 className="mt-1.5 text-sm font-semibold text-white sm:text-base">Red Metropolitana</h3>
              </div>
              <span className="badge border border-emerald-400/15 bg-emerald-400/[0.08] text-emerald-300">En línea</span>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniMetric label="OLTs" value="12" />
              <MiniMetric label="ONUs" value="4.218" />
              <MiniMetric label="Offline" value="27" warning />
              <MiniMetric label="Uptime" value="99,4%" />
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_.8fr]">
              <div className="card-soft p-3.5">
                <div className="flex items-center justify-between text-[10px] text-neutral-500">
                  <span>Distribución de ONUs</span>
                  <span>4.218 total</span>
                </div>
                <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-white/[0.04]">
                  <div className="w-[88%] bg-emerald-400" />
                  <div className="w-[8%] bg-amber-400" />
                  <div className="w-[4%] bg-rose-400" />
                </div>
                <div className="mt-4 space-y-2">
                  <PreviewRow name="OLT Centro 01" value="1.280 ONUs" />
                  <PreviewRow name="OLT Norte 03" value="946 ONUs" />
                  <PreviewRow name="OLT Parque 02" value="812 ONUs" />
                </div>
              </div>
              <div className="card-soft p-3.5">
                <div className="flex items-center gap-2 text-[10px] font-semibold text-neutral-300">
                  <CpuChipIcon className="h-3.5 w-3.5 text-cyan-300" />
                  Copilot
                </div>
                <div className="mt-3 rounded-lg bg-cyan-400/[0.08] px-3 py-2.5 text-[10px] leading-4 text-cyan-50">
                  La disponibilidad está estable. Hay 27 ONUs offline concentradas en dos zonas.
                </div>
                <div className="mt-2 rounded-lg border border-white/[0.06] px-3 py-2 text-[9px] text-neutral-500">
                  ¿Qué zona requiere atención?
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniMetric({ label, value, warning = false }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className="card-soft px-3 py-2.5">
      <p className="text-[9px] text-neutral-500">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${warning ? 'text-amber-300' : 'text-white'}`}>{value}</p>
    </div>
  );
}

function PreviewRow({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[9px]">
      <span className="truncate text-neutral-400">{name}</span>
      <span className="shrink-0 text-neutral-500">{value}</span>
    </div>
  );
}

function Proof({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-3 py-6 text-center sm:px-6 sm:py-7">
      <p className="text-lg font-semibold tracking-[-0.03em] text-white sm:text-xl">{value}</p>
      <p className="mt-1 text-[10px] leading-4 text-neutral-500 sm:text-xs">{label}</p>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="card-soft group flex gap-4 p-4 transition-colors hover:border-cyan-300/20 hover:bg-cyan-400/[0.035] sm:gap-5 sm:p-5">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/15 bg-cyan-400/[0.07] font-mono text-xs font-bold text-cyan-300">{n}</span>
      <div>
        <h3 className="text-sm font-semibold text-white sm:text-[15px]">{title}</h3>
        <p className="mt-1.5 text-xs leading-5 text-neutral-400 sm:text-sm sm:leading-6">{body}</p>
      </div>
    </li>
  );
}
