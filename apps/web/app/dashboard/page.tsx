import { AuthBar } from '@/components/AuthBar';
import NetworkDashboard from '@/components/NetworkDashboard';
import Link from 'next/link';
import type { Route } from 'next';

export default function DashboardPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-8">
      <header className="mb-8 border-b border-neutral-800 pb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard de Red</h1>
            <p className="mt-1 text-sm text-neutral-400">
              Vista general de la red FTTH — datos de SmartOLT (mock).
            </p>
          </div>
          <Link
            href={'/app' as Route}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-xs text-neutral-400 hover:border-blue-500 hover:text-neutral-50"
          >
            Volver al chat
          </Link>
        </div>
      </header>
      <AuthBar />
      <NetworkDashboard />
    </main>
  );
}
