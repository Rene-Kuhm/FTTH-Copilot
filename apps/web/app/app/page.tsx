import Link from 'next/link';
import type { Route } from 'next';
import ChatUI from '@/components/ChatUI';
import { AppShell } from '@/components/AppShell';
import { AuthBar } from '@/components/AuthBar';
import { ConnectorManager } from '@/components/ConnectorManager';
import { UserManager } from '@/components/UserManager';
import { AlertsPanel } from '@/components/AlertsPanel';
import { OnboardingWizard } from '@/components/OnboardingWizard';
import { NmsSelector } from '@/components/NmsSelector';
import { ChartBarSquareIcon, Cog6ToothIcon } from '@/components/icons';

export default function AppPage() {
  return (
    <AppShell
      active="chat"
      eyebrow="Asistente operativo"
      title="Copilot de red"
      description="Investigá eventos, consultá métricas y mantené cada conversación vinculada a la red correcta."
      actions={
        <Link href={'/dashboard' as Route} className="btn-outline">
          <ChartBarSquareIcon className="h-4 w-4" />
          Ver tablero
        </Link>
      }
    >
      <div className="space-y-5">
        <AuthBar />
        <OnboardingWizard />
        <NmsSelector />

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(330px,.8fr)]">
          <ChatUI />
          <aside className="space-y-5 xl:sticky xl:top-24">
            <AlertsPanel />
          </aside>
        </div>

        <section id="gestion" className="scroll-mt-28 pt-6">
          <div className="mb-5 flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-indigo-300/15 bg-indigo-400/[0.08] text-indigo-300">
              <Cog6ToothIcon className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-neutral-500">Administración</p>
              <h2 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-white">Configuración del espacio</h2>
              <p className="mt-1 text-sm text-neutral-400">Gestioná las fuentes de datos y el acceso de tu equipo.</p>
            </div>
          </div>
          <div className="grid items-start gap-5 2xl:grid-cols-2">
            <ConnectorManager />
            <UserManager />
          </div>
        </section>
      </div>
    </AppShell>
  );
}
