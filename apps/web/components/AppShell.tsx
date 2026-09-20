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
      {/* ── Sidebar ──────────────────────────────────────── */}
      <aside className="app-sidebar hidden min-h-screen flex-col px-4 py-5 lg:flex">
        <Brand />

        <div className="mt-9 px-2 text-[10px] font-bold uppercase tracking-[0.18em]"
          style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-display)' }}>
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
              <Icon
                className={`h-[18px] w-[18px] shrink-0 ${
                  active === id ? 'text-[var(--color-accent)]' : ''
                }`}
              />
              {label}
              {id === 'alerts' ? (
                <span
                  className="ml-auto h-1.5 w-1.5 rounded-full"
                  style={{
                    background: 'var(--color-warning)',
                    boxShadow: '0 0 8px var(--color-warning)',
                  }}
                />
              ) : null}
            </Link>
          ))}
        </nav>

        <div className="mt-8 px-2 text-[10px] font-bold uppercase tracking-[0.18em]"
          style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-display)' }}>
          Espacio de trabajo
        </div>
        <Link
          href={'/app#gestion' as Route}
          className={`nav-item mt-3 ${active === 'management' ? 'nav-item-active' : ''}`}
        >
          <Cog6ToothIcon className="h-[18px] w-[18px] shrink-0" />
          Configuración
        </Link>
        <Link href={'/docs' as Route} className="nav-item mt-1">
          <ServerStackIcon className="h-[18px] w-[18px] shrink-0" />
          Documentación
        </Link>

        {/* Status pill */}
        <div
          className="mt-auto rounded-2xl p-3.5"
          style={{
            border: '1px solid color-mix(in srgb, var(--color-accent) 25%, transparent)',
            background: 'rgb(242 48 119 / 0.06)',
          }}
        >
          <div
            className="flex items-center gap-2 text-xs font-semibold"
            style={{ color: 'var(--color-text)', fontFamily: 'var(--font-display)' }}
          >
            <span className="relative flex h-2 w-2">
              <span
                className="absolute inline-flex h-full w-full rounded-full opacity-40"
                style={{
                  background: 'var(--color-success)',
                  animation: 'ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite',
                }}
              />
              <span
                className="relative inline-flex h-2 w-2 rounded-full"
                style={{ background: 'var(--color-success)' }}
              />
            </span>
            Plataforma operativa
          </div>
          <p
            className="mt-2 text-[11px] leading-4"
            style={{ color: 'var(--color-muted)' }}
          >
            Diagnóstico asistido para redes FTTH.
          </p>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────── */}
      <div className="min-w-0">
        <header className="app-topbar sticky top-0 z-30">
          <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
            {/* Mobile brand */}
            <div className="lg:hidden">
              <Brand compact />
            </div>

            {/* Breadcrumb — desktop */}
            <div
              className="hidden items-center gap-2 text-xs lg:flex"
              style={{ color: 'var(--color-muted)' }}
            >
              <SignalIcon className="h-4 w-4" style={{ color: 'var(--color-accent)' }} />
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>
                Centro de operaciones
              </span>
              <span>/</span>
              <span style={{ color: 'var(--color-text)' }}>{title}</span>
            </div>

            {/* User */}
            <div className="ml-auto flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p
                  className="max-w-44 truncate text-xs font-semibold"
                  style={{ color: 'var(--color-text)', fontFamily: 'var(--font-display)' }}
                >
                  {userLabel}
                </p>
                <p
                  className="mt-0.5 text-[10px] uppercase tracking-wider"
                  style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-display)' }}
                >
                  {auth.user?.role ?? 'Sesión pública'}
                </p>
              </div>
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-xs font-bold"
                style={{
                  border: '1px solid color-mix(in srgb, var(--color-accent) 30%, transparent)',
                  background: 'linear-gradient(135deg, rgb(242 48 119 / 0.2), rgb(242 48 119 / 0.05))',
                  color: 'var(--color-text)',
                  boxShadow: 'var(--shadow-glow)',
                  fontFamily: 'var(--font-display)',
                }}
              >
                {initial || 'F'}
              </span>
            </div>
          </div>

          {/* Mobile nav */}
          <nav
            aria-label="Navegación móvil"
            className="grid grid-cols-3 gap-1 border-t px-3 py-2 lg:hidden"
            style={{ borderColor: 'var(--border-divider)' }}
          >
            {NAV_ITEMS.map(({ id, label, href, Icon }) => (
              <Link
                key={id}
                href={href as Route}
                aria-current={active === id ? 'page' : undefined}
                className={`nav-item min-w-0 justify-center px-2 py-2 ${
                  active === id ? 'nav-item-active' : ''
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            ))}
          </nav>
        </header>

        {/* Page content */}
        <main className="mx-auto w-full max-w-[1480px] px-4 py-7 sm:px-6 sm:py-9 lg:px-8">
          <div className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="eyebrow">{eyebrow}</p>
              <h1
                className="mt-3"
                style={{
                  fontSize: 'clamp(1.5rem, 3vw, 2rem)',
                  fontFamily: 'var(--font-display)',
                  fontWeight: 600,
                  letterSpacing: '-0.03em',
                  color: 'var(--color-text)',
                }}
              >
                {title}
              </h1>
              <p
                className="mt-2 max-w-2xl text-sm leading-6"
                style={{ color: 'var(--color-muted)' }}
              >
                {description}
              </p>
            </div>
            {actions ? (
              <div className="flex shrink-0 items-center gap-2">{actions}</div>
            ) : null}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

/* ── Brand logo ──────────────────────────────────── */
function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href={'/' as Route}
      className="group flex items-center gap-3"
      aria-label="FTTH-Copilot, inicio"
    >
      <span
        className={`${compact ? 'h-9 w-9' : 'h-10 w-10'} shrink-0 flex items-center justify-center rounded-[14px]`}
        style={{
          border: '1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)',
          background: 'linear-gradient(135deg, rgb(242 48 119 / 0.25), rgb(242 48 119 / 0.05))',
          color: 'var(--color-accent)',
          boxShadow: 'var(--shadow-glow)',
        }}
      >
        <SignalIcon className="h-5 w-5" />
      </span>
      <span className={compact ? 'hidden min-[390px]:block' : 'block'}>
        <span
          className="block text-[15px] font-bold tracking-[-0.025em]"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}
        >
          FTTH
          <span style={{ color: 'var(--color-accent)' }}>·</span>
          Copilot
        </span>
        {!compact ? (
          <span
            className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.16em]"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--color-muted)' }}
          >
            Network intelligence
          </span>
        ) : null}
      </span>
    </Link>
  );
}
