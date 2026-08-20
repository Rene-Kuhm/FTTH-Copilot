import ChatUI from '@/components/ChatUI';
import { AuthBar } from '@/components/AuthBar';
import { ConnectorManager } from '@/components/ConnectorManager';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 py-8">
      <header className="mb-8 border-b border-neutral-800 pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">FTTH-Copilot</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Diagnóstico de tu red FTTH en lenguaje natural — demo con datos mockeados
          de SmartOLT.
        </p>
      </header>
      <AuthBar />
      <ConnectorManager />
      <ChatUI />
    </main>
  );
}
