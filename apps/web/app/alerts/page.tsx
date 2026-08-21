import Link from 'next/link';
import type { Route } from 'next';
import { AppShell } from '@/components/AppShell';
import { AlertsPanel } from '@/components/AlertsPanel';
import { AuthBar } from '@/components/AuthBar';
import { NmsSelector } from '@/components/NmsSelector';
import { ChatBubbleLeftRightIcon } from '@/components/icons';

export default function AlertsPage() {
  return (
    <AppShell
      active="alerts"
      eyebrow="Priorización operativa"
      title="Alertas de red"
      description="Eventos agrupados por impacto y categoría para acelerar el diagnóstico sobre la red seleccionada."
      actions={
        <Link href={'/app' as Route} className="btn-outline">
          <ChatBubbleLeftRightIcon className="h-4 w-4" />
          Consultar al Copilot
        </Link>
      }
    >
      <div className="space-y-5">
        <AuthBar />
        <NmsSelector />
        <AlertsPanel />
      </div>
    </AppShell>
  );
}
