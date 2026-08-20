import Link from 'next/link';
import ChatUI from '@/components/ChatUI';
import { AuthBar } from '@/components/AuthBar';
import { ConnectorManager } from '@/components/ConnectorManager';
import { UserManager } from '@/components/UserManager';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-8">
      <header className="mb-8 border-b border-neutral-800 pb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">FTTH-Copilot</h1>
            <p className="mt-1 text-sm text-fg-muted">
              Diagnóstico de tu red FTTH en lenguaje natural — demo con datos mockeados
              de SmartOLT.
            </p>
          </div>
          <Link href="/dashboard" className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-fg-muted hover:border-accent hover:text-fg">
            Dashboard
          </Link>
        </div>
      </header>
      <AuthBar />
      <UserManager />
      <ConnectorManager />
      <ChatUI />
    </main>
  );
}
