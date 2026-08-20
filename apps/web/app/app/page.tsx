import Link from 'next/link';
import type { Route } from 'next';
import ChatUI from '@/components/ChatUI';
import { AuthBar } from '@/components/AuthBar';
import { ConnectorManager } from '@/components/ConnectorManager';
import { UserManager } from '@/components/UserManager';
import { AlertsPanel } from '@/components/AlertsPanel';
import { OnboardingWizard } from '@/components/OnboardingWizard';
import { SignalIcon, ChartBarSquareIcon } from '@/components/icons';

export default function AppPage() {
  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-20 border-b border-neutral-800 bg-bg/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href={'/app' as Route} className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent ring-1 ring-accent/20">
              <SignalIcon className="h-5 w-5" />
            </span>
            <div className="flex flex-col leading-none">
              <span className="text-sm font-semibold tracking-tight text-fg">
                FTTH-Copilot
              </span>
              <span className="mt-0.5 text-xs text-fg-dim">
                Network diagnostics
              </span>
            </div>
          </Link>

          <nav className="flex items-center gap-1 rounded-lg border border-neutral-800 bg-bg-subtle p-1">
            <Link
              href={'/app' as Route}
              className="flex items-center gap-2 rounded-md bg-bg px-3 py-1.5 text-sm font-medium text-fg shadow-sm ring-1 ring-neutral-800"
              aria-current="page"
            >
              <ChartBarSquareIcon className="h-4 w-4 text-accent" />
              Chat
            </Link>
            <Link
              href={'/dashboard' as Route}
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium text-fg-muted hover:bg-bg hover:text-fg"
            >
              Dashboard
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <AlertsPanel />
        <AuthBar />
        <OnboardingWizard />
        <UserManager />
        <ConnectorManager />
        <ChatUI />
      </main>
    </div>
  );
}
