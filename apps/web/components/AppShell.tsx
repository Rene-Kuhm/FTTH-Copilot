'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useAuth } from '@/lib/auth/client';
import {
  BellIcon,
  ChartBarSquareIcon,
  ChatBubbleLeftRightIcon,
  Cog6ToothIcon,
  ServerStackIcon,
  SignalIcon,
} from './icons';

type AppSection = 'chat' | 'dashboard' | 'alerts' | 'management';

interface AppShellProps {
  active: AppSection;
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

const NAV_ITEMS = [
  { id: 'chat', label: 'Copilot', href: '/app', Icon: ChatBubbleLeftRightIcon },
  { id: 'dashboard', label: 'Tablero', href: '/dashboard', Icon: ChartBarSquareIcon },
  { id: 'alerts', label: 'Alertas', href: '/alerts', Icon: BellIcon },
] as const;

export function AppShell({
  active,
  eyebrow,
  title,
  description,
  children,
  actions,
}: AppShellProps) {
  const auth = useAuth();
  const userLabel = auth.user?.name || auth.user?.email || 'Invitado';
  const initial = userLabel.charAt(0).toUpperCase();

  return (
    <div className="app-frame lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="app-sidebar hidden min-h-screen flex-col px-4 py-5 lg:flex">
        <Brand />

        <div className="mt-9 px-2 text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">
          Operaciones
        </div>
        <nav aria-label="Navegación principal" className="mt-3 space-y-1">
          {NAV_ITEMS.map(({ id, label, href, Icon }) => (
            <Link
              key={id}
              href={href as Route}
              aria-current={active === id ? 'page' : undefined}
              className={`nav-item ${active === id ? 'nav-item-active' : ''}`}
            >
              <Icon className={`h-[18px] w-[18px] ${active === id ? 'text-cyan-300' : ''}`} />
              {label}
              {id === 'alerts' ? (
                <span className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_10px_rgba(246,184,75,.75)]" />
              ) : null}
            </Link>
          ))}
        </nav>

        <div className="mt-8 px-2 text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">
          Espacio de trabajo
        </div>
        <Link href={'/app#gestion' as Route} className={`nav-item mt-3 ${active === 'management' ? 'nav-item-active' : ''}`}>
          <Cog6ToothIcon className="h-[18px] w-[18px]" />
          Configuración
        </Link>
        <Link href={'/docs' as Route} className="nav-item mt-1">
          <ServerStackIcon className="h-[18px] w-[18px]" />
          Documentación
        </Link>

        <div className="mt-auto rounded-2xl border border-cyan-400/10 bg-cyan-400/[0.045] p-3.5">
          <div className="flex items-center gap-2 text-xs font-semibold text-cyan-100">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            Plataforma operativa
          </div>
          <p className="mt-2 text-[11px] leading-4 text-neutral-500">
            Diagnóstico asistido para redes FTTH.
          </p>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="app-topbar sticky top-0 z-30">
          <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            <div className="lg:hidden">
              <Brand compact />
            </div>
            <div className="hidden items-center gap-2 text-xs text-neutral-500 lg:flex">
              <SignalIcon className="h-4 w-4 text-cyan-400" />
              Centro de operaciones
              <span className="text-neutral-700">/</span>
              <span className="text-neutral-300">{title}</span>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="max-w-44 truncate text-xs font-semibold text-neutral-100">{userLabel}</p>
                <p className="mt-0.5 text-[10px] uppercase tracking-wider text-neutral-500">
                  {auth.user?.role ?? 'Sesión pública'}
                </p>
              </div>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-300/15 bg-gradient-to-br from-cyan-400/20 to-indigo-400/10 text-xs font-bold text-cyan-100 shadow-inner">
                {initial || 'F'}
              </span>
            </div>
          </div>
          <nav aria-label="Navegación móvil" className="grid grid-cols-3 gap-1 border-t border-white/[0.04] px-3 py-2 lg:hidden">
            {NAV_ITEMS.map(({ id, label, href, Icon }) => (
              <Link
                key={id}
                href={href as Route}
                aria-current={active === id ? 'page' : undefined}
                className={`nav-item min-w-0 justify-center px-2 py-2 ${active === id ? 'nav-item-active' : ''}`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-[1480px] px-4 py-7 sm:px-6 sm:py-9 lg:px-8">
          <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="eyebrow">{eyebrow}</p>
              <h1 className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-white sm:text-[2rem]">
                {title}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-400">{description}</p>
            </div>
            {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href={'/' as Route} className="group flex items-center gap-3" aria-label="FTTH-Copilot, inicio">
      <span className={`${compact ? 'h-9 w-9 rounded-xl' : 'h-10 w-10 rounded-[14px]'} flex shrink-0 items-center justify-center border border-cyan-300/20 bg-gradient-to-br from-cyan-400/20 to-indigo-500/10 text-cyan-300 shadow-[0_10px_30px_rgba(34,184,230,.12)]`}>
        <SignalIcon className="h-5 w-5" />
      </span>
      <span className={compact ? 'hidden min-[390px]:block' : 'block'}>
        <span className="block text-[15px] font-bold tracking-[-0.025em] text-white">
          FTTH<span className="text-cyan-400">·</span>Copilot
        </span>
        {!compact ? (
          <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
            Network intelligence
          </span>
        ) : null}
      </span>
    </Link>
  );
}
