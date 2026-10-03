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
    accent: 'accent',
  },
  {
    title: 'Visibilidad ejecutiva',
    body: 'Convertí métricas técnicas en una vista clara del estado de la red y de los puntos que requieren atención.',
    Icon: ChartBarSquareIcon,
    accent: 'accent',
  },
  {
    title: 'Alertas priorizadas',
    body: 'Agrupá eventos por impacto y categoría para que el equipo trabaje primero sobre lo realmente importante.',
    Icon: BellIcon,
    accent: 'warning',
  },
  {
    title: 'Multi-NMS seguro',
    body: 'Conectá SmartOLT y Mikrowisp, elegí la red activa y mantené las credenciales cifradas por organización.',
    Icon: ShieldCheckIcon,
    accent: 'success',
  },
] as const;

const ACCENT_STYLES = {
  accent: {
    bg: 'rgb(242 48 119 / 0.12)',
    border: 'color-mix(in srgb, var(--color-accent) 30%, transparent)',
    text: 'var(--color-accent)',
  },
  warning: {
    bg: 'color-mix(in srgb, var(--color-warning) 12%, transparent)',
    border: 'color-mix(in srgb, var(--color-warning) 30%, transparent)',
    text: 'var(--color-warning)',
  },
  success: {
    bg: 'color-mix(in srgb, var(--color-success) 12%, transparent)',
    border: 'color-mix(in srgb, var(--color-success) 30%, transparent)',
    text: 'var(--color-success)',
  },
};

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Background grid */}
      <div
        aria-hidden="true"
        className="surface-grid pointer-events-none absolute inset-x-0 top-0 h-[760px] opacity-80"
      />
      {/* Glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-[-18rem] h-[42rem] w-[42rem] -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: 'rgb(242 48 119 / 0.07)' }}
      />

      {/* ── Nav ─────────────────────────────────── */}
      <nav className="relative z-20 mx-auto flex h-[76px] max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-2.5" aria-label="FTTH-Copilot">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={{
              border: '1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)',
              background: 'rgb(242 48 119 / 0.12)',
              color: 'var(--color-accent)',
              boxShadow: 'var(--shadow-glow)',
            }}
          >
            <SignalIcon className="h-[18px] w-[18px]" />
          </span>
          <span
            className="hidden truncate text-[15px] font-bold tracking-[-0.025em] min-[390px]:block"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
          >
            FTTH<span style={{ color: 'var(--color-accent)' }}>·</span>Copilot
          </span>
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          {[
            { href: '#plataforma', label: 'Plataforma' },
            { href: '#como-funciona', label: 'Cómo funciona' },
            { href: '/docs', label: 'Documentación', external: true },
          ].map(({ href, label }) =>
            href.startsWith('/') ? (
              <Link
                key={label}
                href={href as Route}
                className="text-xs font-semibold transition-colors"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-muted)' }}
              >
                {label}
              </Link>
            ) : (
              <a
                key={label}
                href={href}
                className="text-xs font-semibold transition-colors"
                style={{ fontFamily: 'var(--font-display)', color: 'var(--color-muted)' }}
              >
                {label}
              </a>
            ),
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Link href={'/login' as Route} className="btn-ghost px-2.5 sm:px-3">
            Ingresar
          </Link>
          <Link href={'/signup' as Route} className="btn-primary whitespace-nowrap px-3 sm:px-4">
            Crear cuenta
          </Link>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────── */}
      <section className="relative mx-auto grid max-w-7xl gap-14 px-5 pb-20 pt-16 sm:px-6 sm:pt-24 lg:grid-cols-[1.02fr_.98fr] lg:items-center lg:gap-16 lg:px-8 lg:pb-28 lg:pt-28">
        <div>
          {/* Badge */}
          <div
            className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold"
            style={{
              border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
              background: 'rgb(242 48 119 / 0.08)',
              color: 'var(--color-text)',
              fontFamily: 'var(--font-display)',
            }}
          >
            <span className="relative flex h-1.5 w-1.5">
              <span
                className="absolute inline-flex h-full w-full rounded-full"
                style={{
                  background: 'var(--color-success)',
                  animation: 'ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite',
                  opacity: 0.4,
                }}
              />
              <span
                className="relative inline-flex h-1.5 w-1.5 rounded-full"
                style={{ background: 'var(--color-success)' }}
              />
            </span>
            Inteligencia operativa para ISPs FTTH
          </div>

          {/* Headline */}
          <h1
            className="mt-7 max-w-3xl text-[2.65rem] font-semibold leading-[1.04] tracking-[-0.055em] sm:text-6xl lg:text-[4.4rem]"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
          >
            Tu red, explicada con la claridad que{' '}
            <span
              style={{
                background: `linear-gradient(90deg, var(--color-accent), color-mix(in srgb, var(--color-accent) 60%, var(--color-muted)))`,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              tus operaciones necesitan.
            </span>
          </h1>

          <p
            className="mt-7 max-w-xl text-base leading-7 sm:text-lg sm:leading-8"
            style={{ color: 'var(--color-muted)' }}
          >
            Un centro de control que conecta tus NMS, prioriza alertas y convierte
            datos técnicos en respuestas accionables para todo tu equipo.
          </p>

          {/* CTAs */}
          <div className="mt-9 flex flex-col gap-3 min-[390px]:flex-row">
            <Link href={'/signup' as Route} className="btn-primary min-h-11 px-5 text-sm">
              Empezar ahora
              <ChevronRightIcon className="h-4 w-4" />
            </Link>
            <Link href={'/docs' as Route} className="btn-outline min-h-11 px-5 text-sm">
              Ver documentación
            </Link>
          </div>

          {/* Feature checks */}
          <div
            className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs"
            style={{ color: 'var(--color-muted)' }}
          >
            {[
              'SmartOLT y Mikrowisp',
              'Acceso por roles',
              'Credenciales cifradas',
            ].map((item) => (
              <span key={item} className="inline-flex items-center gap-1.5">
                <CheckCircleIcon
                  className="h-4 w-4"
                  style={{ color: 'var(--color-success)' }}
                />
                {item}
              </span>
            ))}
          </div>
        </div>

        <ProductPreview />
      </section>

      {/* ── Stats bar ──────────────────────────── */}
      <section
        className="border-y"
        style={{ borderColor: 'var(--border-divider)', background: 'color-mix(in srgb, var(--color-surface) 40%, transparent)' }}
      >
        <div className="mx-auto grid max-w-7xl grid-cols-2 px-4 sm:px-6 md:grid-cols-4 lg:px-8">
          {[
            { value: '24/7', label: 'Visibilidad operativa' },
            { value: '2', label: 'NMS compatibles' },
            { value: 'AES-256', label: 'Cifrado de credenciales' },
            { value: '3', label: 'Niveles de acceso' },
          ].map(({ value, label }) => (
            <Proof key={label} value={value} label={label} />
          ))}
        </div>
      </section>

      {/* ── Platform section ─────────────────── */}
      <section id="plataforma" className="mx-auto max-w-7xl px-5 py-24 sm:px-6 lg:px-8 lg:py-32">
        <div className="max-w-2xl">
          <p className="eyebrow">Una sola plataforma</p>
          <h2
            className="mt-4 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
          >
            Diseñada para operar, no para sumar otro dashboard.
          </h2>
          <p
            className="mt-4 text-sm leading-7 sm:text-base"
            style={{ color: 'var(--color-muted)' }}
          >
            La información crítica queda ordenada en el mismo lugar donde tu equipo
            analiza, pregunta y toma decisiones.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map(({ title, body, Icon, accent }) => {
            const style = ACCENT_STYLES[accent as keyof typeof ACCENT_STYLES];
            return (
              <article
                key={title}
                className="card group relative overflow-hidden p-5 transition-all duration-300 sm:p-6"
              >
                <div
                  aria-hidden="true"
                  className="absolute inset-x-8 top-0 h-px opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  style={{
                    background: `linear-gradient(90deg, transparent, ${style.border}, transparent)`,
                  }}
                />
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-[14px]"
                  style={{
                    background: style.bg,
                    border: `1px solid ${style.border}`,
                    color: style.text,
                  }}
                >
                  <Icon className="h-5 w-5" />
                </span>
                <h3
                  className="mt-5 text-[15px] font-semibold"
                  style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
                >
                  {title}
                </h3>
                <p className="mt-2.5 text-sm leading-6" style={{ color: 'var(--color-muted)' }}>
                  {body}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      {/* ── How it works ─────────────────────── */}
      <section
        id="como-funciona"
        className="relative border-y"
        style={{
          borderColor: 'var(--border-divider)',
          background: 'color-mix(in srgb, var(--color-surface) 50%, transparent)',
        }}
      >
        <div className="mx-auto grid max-w-7xl gap-12 px-5 py-24 sm:px-6 lg:grid-cols-[.82fr_1.18fr] lg:items-center lg:px-8 lg:py-28">
          <div>
            <p className="eyebrow">De conexión a decisión</p>
            <h2
              className="mt-4 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
            >
              Operativa en tres pasos simples.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-7" style={{ color: 'var(--color-muted)' }}>
              FTTH-Copilot se integra con tu stack actual. No reemplaza tu NMS:
              hace que sus datos sean más accesibles y útiles.
            </p>
          </div>
          <ol className="space-y-3">
            <Step
              n="01"
              title="Conectá y validá tu NMS"
              body="Configurá SmartOLT o Mikrowisp mediante un flujo guiado y una prueba de conexión segura."
            />
            <Step
              n="02"
              title="Elegí la red que querés analizar"
              body="Alterná entre conectores sin mezclar contextos, métricas ni conversaciones."
            />
            <Step
              n="03"
              title="Preguntá, monitoreá y actuá"
              body="Usá el Copilot, el tablero y las alertas para convertir señales de red en prioridades claras."
            />
          </ol>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-5 py-24 sm:px-6 lg:px-8 lg:py-32">
        <div
          className="relative overflow-hidden rounded-[1.5rem] px-6 py-12 text-center sm:px-12 sm:py-16"
          style={{
            border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
            background: `linear-gradient(135deg, rgb(242 48 119 / 0.1) 0%, var(--color-surface) 50%, rgb(242 48 119 / 0.06) 100%)`,
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div aria-hidden="true" className="absolute inset-0 surface-grid opacity-50" />
          <div className="relative">
            <span
              className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl"
              style={{
                border: '1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)',
                background: 'rgb(242 48 119 / 0.12)',
                color: 'var(--color-accent)',
              }}
            >
              <SparklesIcon className="h-6 w-6" />
            </span>
            <h2
              className="mx-auto mt-5 max-w-2xl text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
            >
              Dale a tu equipo una mejor forma de entender la red.
            </h2>
            <p
              className="mx-auto mt-4 max-w-xl text-sm leading-7"
              style={{ color: 'var(--color-muted)' }}
            >
              Creá tu espacio, conectá el primer NMS y empezá a diagnosticar con
              contexto real.
            </p>
            <Link href={'/signup' as Route} className="btn-primary mt-7 min-h-11 px-5 text-sm">
              Crear mi espacio
              <ChevronRightIcon className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────── */}
      <footer style={{ borderTop: '1px solid var(--border-divider)' }}>
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-8 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8"
          style={{ color: 'var(--color-muted)' }}>
          <div className="flex items-center gap-2">
            <SignalIcon className="h-4 w-4" style={{ color: 'var(--color-accent)' }} />
            <span style={{ fontFamily: 'var(--font-display)' }}>
              FTTH-Copilot · Inteligencia operativa para ISPs
            </span>
          </div>
          <div className="flex gap-5" style={{ fontFamily: 'var(--font-display)' }}>
            <Link href={'/docs' as Route} className="transition-colors hover:text-[var(--color-text)]">
              Documentación
            </Link>
            <Link href={'/login' as Route} className="transition-colors hover:text-[var(--color-text)]">
              Ingresar
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

/* ── Product preview ──────────────────────────── */
function ProductPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[620px] lg:mx-0">
      <div
        aria-hidden="true"
        className="absolute -inset-8 rounded-full blur-3xl"
        style={{ background: 'rgb(242 48 119 / 0.08)' }}
      />
      <div
        className="card relative overflow-hidden rounded-[1.25rem]"
        style={{
          border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
          background: 'color-mix(in srgb, var(--color-bg) 60%, transparent)',
          boxShadow: '0 40px 110px rgb(0 0 0 / 0.42)',
        }}
      >
        {/* Title bar */}
        <div
          className="flex items-center justify-between px-4 py-3 sm:px-5"
          style={{ borderBottom: '1px solid var(--border-divider)' }}
        >
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: '#ff6b7f' }} />
            <span className="h-2 w-2 rounded-full" style={{ background: '#f6b84b' }} />
            <span className="h-2 w-2 rounded-full" style={{ background: 'var(--color-success)' }} />
          </div>
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.15em]"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-muted)' }}
          >
            Centro de operaciones
          </span>
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: 'var(--color-success)', boxShadow: '0 0 8px var(--color-success)' }}
          />
        </div>

        {/* App layout */}
        <div className="grid grid-cols-[76px_1fr] sm:grid-cols-[132px_1fr]">
          {/* Sidebar */}
          <div className="border-r sm:p-4" style={{ borderColor: 'var(--border-divider)', padding: '12px' }}>
            <div
              className="mb-5 flex h-8 w-8 items-center justify-center rounded-lg"
              style={{
                background: 'rgb(242 48 119 / 0.12)',
                color: 'var(--color-accent)',
              }}
            >
              <SignalIcon className="h-4 w-4" />
            </div>
            {[
              { Icon: ChatBubbleLeftRightIcon, label: 'Copilot', active: false },
              { Icon: ChartBarSquareIcon, label: 'Tablero', active: true },
              { Icon: BellIcon, label: 'Alertas', active: false },
              { Icon: ServerStackIcon, label: 'Redes', active: false },
            ].map(({ Icon, label, active }, index) => (
              <div
                key={index}
                className="mb-2 flex items-center gap-2 rounded-lg px-2 py-2"
                style={
                  active
                    ? {
                        background: 'rgb(242 48 119 / 0.12)',
                        border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
                        color: 'var(--color-accent)',
                      }
                    : {
                        color: 'var(--color-muted)',
                      }
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="hidden text-[10px] font-semibold sm:inline" style={{ fontFamily: 'var(--font-display)' }}>
                  {label}
                </span>
              </div>
            ))}
          </div>

          {/* Main content */}
          <div className="min-w-0 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p
                  className="text-[9px] font-bold uppercase tracking-[0.16em]"
                  style={{ fontFamily: 'var(--font-display)', color: 'var(--color-accent)' }}
                >
                  Estado general
                </p>
                <h3
                  className="mt-1.5 text-sm font-semibold sm:text-base"
                  style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
                >
                  Red Metropolitana
                </h3>
              </div>
              <span
                className="badge"
                style={{
                  background: 'color-mix(in srgb, var(--color-success) 12%, transparent)',
                  color: 'var(--color-success)',
                  border: '1px solid color-mix(in srgb, var(--color-success) 25%, transparent)',
                  fontFamily: 'var(--font-display)',
                }}
              >
                En línea
              </span>
            </div>

            {/* Metrics */}
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MiniMetric label="OLTs" value="12" />
              <MiniMetric label="ONUs" value="4.218" />
              <MiniMetric label="Offline" value="27" warning />
              <MiniMetric label="Uptime" value="99,4%" />
            </div>

            {/* Cards row */}
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_.8fr]">
              {/* Distribution card */}
              <div className="card-soft p-3.5" style={{ color: 'var(--color-text)' }}>
                <div
                  className="flex items-center justify-between text-[10px]"
                  style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-display)' }}
                >
                  <span>Distribución de ONUs</span>
                  <span>4.218 total</span>
                </div>
                <div className="mt-4 flex h-2 overflow-hidden rounded-full" style={{ background: 'color-mix(in srgb, var(--color-muted) 15%, transparent)' }}>
                  <div style={{ width: '88%', background: 'var(--color-success)' }} />
                  <div style={{ width: '8%', background: 'var(--color-warning)' }} />
                  <div style={{ width: '4%', background: 'var(--color-danger)' }} />
                </div>
                <div className="mt-4 space-y-2">
                  <PreviewRow name="OLT Centro 01" value="1.280 ONUs" />
                  <PreviewRow name="OLT Norte 03" value="946 ONUs" />
                  <PreviewRow name="OLT Parque 02" value="812 ONUs" />
                </div>
              </div>

              {/* Copilot card */}
              <div className="card-soft p-3.5" style={{ color: 'var(--color-text)' }}>
                <div
                  className="flex items-center gap-2 text-[10px] font-semibold"
                  style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
                >
                  <CpuChipIcon className="h-3.5 w-3.5" style={{ color: 'var(--color-accent)' }} />
                  Copilot
                </div>
                <div
                  className="mt-3 rounded-lg px-3 py-2.5 text-[10px] leading-4"
                  style={{
                    background: 'rgb(242 48 119 / 0.08)',
                    color: 'var(--color-text)',
                  }}
                >
                  La disponibilidad está estable. Hay 27 ONUs offline concentradas en dos zonas.
                </div>
                <div
                  className="mt-2 rounded-lg px-3 py-2 text-[9px]"
                  style={{
                    border: '1px solid var(--border-divider)',
                    color: 'var(--color-muted)',
                  }}
                >
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

function MiniMetric({
  label,
  value,
  warning = false,
}: {
  label: string;
  value: string;
  warning?: boolean;
}) {
  return (
    <div className="card-soft px-3 py-2.5" style={{ color: 'var(--color-text)' }}>
      <p className="text-[9px]" style={{ color: 'var(--color-muted)' }}>{label}</p>
      <p
        className="mt-1 text-sm font-semibold"
        style={{
          fontFamily: 'var(--font-display)',
          color: warning ? 'var(--color-warning)' : 'var(--color-text)',
        }}
      >
        {value}
      </p>
    </div>
  );
}

function PreviewRow({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[9px]">
      <span className="truncate" style={{ color: 'color-mix(in srgb, var(--color-text) 70%, var(--color-muted))' }}>
        {name}
      </span>
      <span className="shrink-0" style={{ color: 'var(--color-muted)' }}>{value}</span>
    </div>
  );
}

function Proof({ value, label }: { value: string; label: string }) {
  return (
    <div className="px-3 py-6 text-center sm:px-6 sm:py-7">
      <p
        className="text-lg font-semibold tracking-[-0.03em] sm:text-xl"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
      >
        {value}
      </p>
      <p
        className="mt-1 text-[10px] leading-4 sm:text-xs"
        style={{ color: 'var(--color-muted)' }}
      >
        {label}
      </p>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li
      className="card-soft group flex gap-4 p-4 transition-all duration-200 sm:gap-5 sm:p-5"
      style={{ '--hover-border': 'color-mix(in srgb, var(--color-accent) 30%, transparent)' } as React.CSSProperties}
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xs font-bold"
        style={{
          border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
          background: 'rgb(242 48 119 / 0.08)',
          color: 'var(--color-accent)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {n}
      </span>
      <div>
        <h3
          className="text-sm font-semibold sm:text-[15px]"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
        >
          {title}
        </h3>
        <p className="mt-1.5 text-xs leading-5 sm:text-sm sm:leading-6" style={{ color: 'var(--color-muted)' }}>
          {body}
        </p>
      </div>
    </li>
  );
}
