import Link from 'next/link';
import type { Route } from 'next';
import { AppShell } from '@/components/AppShell';
import { AuthBar } from '@/components/AuthBar';
import NetworkDashboard from '@/components/NetworkDashboard';
import { PredictiveAlerts } from '@/components/PredictiveAlerts';
import { IncidentsPanel } from '@/components/IncidentsPanel';
import { SlaPanel } from '@/components/SlaPanel';
import { AccessLog } from '@/components/AccessLog';
import { NmsSelector } from '@/components/NmsSelector';
import { ChatBubbleLeftRightIcon, ChartBarSquareIcon } from '@/components/icons';

export default function DashboardPage() {
  return (
    <AppShell
      active="dashboard"
      eyebrow="Visibilidad de red"
      title="Tablero de red"
      description="Una lectura ejecutiva y operativa del NMS seleccionado, desde disponibilidad general hasta detalle por OLT."
      actions={
        <>
          <Link href={'/dashboard/metrics' as Route} className="btn-outline btn btn-sm gap-1">
            <ChartBarSquareIcon className="h-4 w-4" />
            Métricas
          </Link>
          <Link href={'/app' as Route} className="btn-outline">
            <ChatBubbleLeftRightIcon className="h-4 w-4" />
            Copilot
          </Link>
        </>
      }
    >
      <div className="space-y-5">
        <AuthBar />
        <NmsSelector />
        <IncidentsPanel />
        <PredictiveAlerts />
        <SlaPanel />
        <AccessLog />
        <NetworkDashboard />
      </div>
    </AppShell>
  );
}
