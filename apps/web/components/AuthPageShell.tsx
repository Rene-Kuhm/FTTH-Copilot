import Link from 'next/link';
import { CheckCircleIcon, ShieldCheckIcon, SignalIcon, SparklesIcon } from './icons';

interface AuthPageShellProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

export function AuthPageShell({ title, description, children }: AuthPageShellProps) {
  return (
    <main className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden="true"
        className="surface-grid pointer-events-none absolute inset-0 opacity-50"
      />
      <div className="relative mx-auto grid min-h-screen max-w-7xl lg:grid-cols-[.9fr_1.1fr]">

        {/* ── Left panel ──────────────────────────────── */}
        <section
          className="flex flex-col justify-between border-b px-5 py-6 sm:px-8 lg:border-b-0 lg:border-r lg:px-12 lg:py-10"
          style={{
            borderColor: 'var(--border-divider)',
            background: 'var(--color-surface)',
          }}
        >
          {/* Brand */}
          <Link href="/" className="flex items-center gap-2.5">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-xl"
              style={{
                border: '1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)',
                background: 'rgb(242 48 119 / 0.12)',
                color: 'var(--color-accent)',
              }}
            >
              <SignalIcon className="h-[18px] w-[18px]" />
            </span>
            <span
              className="text-[15px] font-bold tracking-[-0.025em]"
              style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
            >
              FTTH
              <span style={{ color: 'var(--color-accent)' }}>·</span>
              Copilot
            </span>
          </Link>

          {/* Hero copy — desktop only */}
          <div className="hidden py-16 lg:block">
            <span
              className="flex h-12 w-12 items-center justify-center rounded-2xl"
              style={{
                border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
                background: 'rgb(242 48 119 / 0.1)',
                color: 'var(--color-accent)',
              }}
            >
              <SparklesIcon className="h-6 w-6" />
            </span>
            <h2
              className="mt-7 max-w-md"
              style={{
                fontSize: 'clamp(1.75rem, 3vw, 2.25rem)',
                fontFamily: 'var(--font-display)',
                fontWeight: 600,
                letterSpacing: '-0.045em',
                lineHeight: 1.2,
                color: 'var(--color-text)',
              }}
            >
              Operaciones FTTH con más contexto y menos fricción.
            </h2>
            <p
              className="mt-5 max-w-md text-sm leading-7"
              style={{ color: 'var(--color-muted)' }}
            >
              Unificá conversaciones, métricas y alertas sin reemplazar las
              herramientas que tu equipo ya usa.
            </p>
            <ul
              className="mt-8 space-y-3 text-sm"
              style={{ color: 'var(--color-text)' }}
            >
              {[
                'Conexiones NMS cifradas',
                'Contexto separado por red',
                'Permisos por rol y organización',
              ].map((item) => (
                <li key={item} className="flex items-center gap-2.5">
                  <CheckCircleIcon
                    className="h-4 w-4 shrink-0"
                    style={{ color: 'var(--color-success)' }}
                  />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          {/* Footer */}
          <div
            className="hidden items-center gap-2 text-xs lg:flex"
            style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-display)' }}
          >
            <ShieldCheckIcon className="h-4 w-4" style={{ color: 'var(--color-success)' }} />
            Acceso protegido por sesión segura
          </div>
        </section>

        {/* ── Right panel — form ─────────────────────── */}
        <section className="flex items-center justify-center px-4 py-10 sm:px-8 lg:py-16">
          <div className="w-full max-w-md">
            <p className="eyebrow">Tu espacio de trabajo</p>
            <h1
              className="mt-4"
              style={{
                fontSize: 'clamp(1.5rem, 3vw, 1.875rem)',
                fontFamily: 'var(--font-display)',
                fontWeight: 600,
                letterSpacing: '-0.04em',
                color: 'var(--color-text)',
              }}
            >
              {title}
            </h1>
            <p className="mt-2 text-sm leading-6" style={{ color: 'var(--color-muted)' }}>
              {description}
            </p>
            <div className="mt-7">{children}</div>
          </div>
        </section>
      </div>
    </main>
  );
}
