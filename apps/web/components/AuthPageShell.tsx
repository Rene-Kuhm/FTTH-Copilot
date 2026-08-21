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
      <div aria-hidden="true" className="surface-grid pointer-events-none absolute inset-0 opacity-50" />
      <div className="relative mx-auto grid min-h-screen max-w-7xl lg:grid-cols-[.9fr_1.1fr]">
        <section className="flex flex-col justify-between border-b border-white/[0.06] px-5 py-6 sm:px-8 lg:border-b-0 lg:border-r lg:px-12 lg:py-10">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-400/10 text-cyan-300">
              <SignalIcon className="h-[18px] w-[18px]" />
            </span>
            <span className="text-[15px] font-bold tracking-[-0.025em] text-white">FTTH<span className="text-cyan-400">·</span>Copilot</span>
          </Link>

          <div className="hidden py-16 lg:block">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/15 bg-gradient-to-br from-cyan-400/15 to-indigo-400/10 text-cyan-300">
              <SparklesIcon className="h-6 w-6" />
            </span>
            <h2 className="mt-7 max-w-md text-4xl font-semibold leading-tight tracking-[-0.045em] text-white">
              Operaciones FTTH con más contexto y menos fricción.
            </h2>
            <p className="mt-5 max-w-md text-sm leading-7 text-neutral-400">
              Unificá conversaciones, métricas y alertas sin reemplazar las herramientas que tu equipo ya usa.
            </p>
            <ul className="mt-8 space-y-3 text-sm text-neutral-300">
              {['Conexiones NMS cifradas', 'Contexto separado por red', 'Permisos por rol y organización'].map((item) => (
                <li key={item} className="flex items-center gap-2.5"><CheckCircleIcon className="h-4 w-4 text-emerald-400" />{item}</li>
              ))}
            </ul>
          </div>

          <div className="hidden items-center gap-2 text-xs text-neutral-600 lg:flex">
            <ShieldCheckIcon className="h-4 w-4" />
            Acceso protegido por sesión segura
          </div>
        </section>

        <section className="flex items-center justify-center px-4 py-10 sm:px-8 lg:py-16">
          <div className="w-full max-w-md">
            <p className="eyebrow">Tu espacio de trabajo</p>
            <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-neutral-400">{description}</p>
            <div className="mt-7">{children}</div>
          </div>
        </section>
      </div>
    </main>
  );
}
