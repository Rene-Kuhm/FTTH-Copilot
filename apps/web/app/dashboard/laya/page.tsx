import Link from 'next/link';
import type { Route } from 'next';
import { AppShell } from '@/components/AppShell';
import { LayaMetricsPanel } from '@/components/LayaMetricsPanel';
import { ChatBubbleLeftRightIcon } from '@/components/icons';

export default function LayaMetricsPage() {
  return (
    <AppShell
      active="dashboard"
      eyebrow="Laya Decision Layer"
      title="Panel de métricas — Laya"
      description="Monitoreo en tiempo real del Expert System de Laya: decisiones, latencia y confianza por clase de evento."
      actions={
        <div className="flex gap-2">
          <Link href={'/dashboard' as Route} className="btn-outline btn btn-sm gap-1">
              ←
            Tablero
          </Link>
          <Link href={'/app' as Route} className="btn-outline btn btn-sm gap-1">
            <ChatBubbleLeftRightIcon className="h-4 w-4" />
            Volver al Copilot
          </Link>
        </div>
      }
    >
      <LayaMetricsPanel />
    </AppShell>
  );
}
