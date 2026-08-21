import Link from 'next/link';
import type { Route } from 'next';
import { AppShell } from '@/components/AppShell';
import { AuthBar } from '@/components/AuthBar';
import NetworkDashboard from '@/components/NetworkDashboard';
import { NmsSelector } from '@/components/NmsSelector';
import { ChatBubbleLeftRightIcon } from '@/components/icons';

export default function DashboardPage() {
  return (
    <AppShell
      active="dashboard"
      eyebrow="Visibilidad de red"
      title="Tablero de red"
      description="Una lectura ejecutiva y operativa del NMS seleccionado, desde disponibilidad general hasta detalle por OLT."
      actions={
        <Link href={'/app' as Route} className="btn-outline">
          <ChatBubbleLeftRightIcon className="h-4 w-4" />
          Volver al Copilot
        </Link>
      }
    >
      <div className="space-y-5">
        <AuthBar />
        <NmsSelector />
        <NetworkDashboard />
      </div>
    </AppShell>
  );
}
