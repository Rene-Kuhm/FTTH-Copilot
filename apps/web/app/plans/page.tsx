import Link from 'next/link';
import type { Route } from 'next';
import { AppShell } from '@/components/AppShell';
import { AuthBar } from '@/components/AuthBar';
import FiberPlanPanel from '@/components/FiberPlanPanel';
import { ChatBubbleLeftRightIcon } from '@/components/icons';

export default function PlansPage() {
  return (
    <AppShell
      active="plans"
      eyebrow="Planos de fibra"
      title="Planos y relevamientos"
      description="Visualizá planos de fibra óptica con marcadores interactivos. Al hacer click en un incidente, se muestra el plano de la zona afectada."
      actions={
        <Link href={'/dashboard' as Route} className="btn-outline">
          <ChatBubbleLeftRightIcon className="h-4 w-4" />
          Volver al tablero
        </Link>
      }
    >
      <div className="space-y-5">
        <AuthBar />
        <div
          style={{
            borderRadius: 'var(--radius-card)',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            overflow: 'hidden',
            height: 'calc(100vh - 240px)',
            minHeight: 500,
          }}
        >
          <FiberPlanPanel />
        </div>
      </div>
    </AppShell>
  );
}
