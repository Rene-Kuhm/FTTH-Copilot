import { AppShell } from '@/components/AppShell';
import MetricsDashboard from '@/components/MetricsDashboard';

export default function MetricsPage() {
  return (
    <AppShell
      active="dashboard"
      eyebrow="Observabilidad"
      title="Métricas"
      description="Series temporales de VictoriaMetrics — router, LLM, SNMP, alertas y sistema."
    >
      <div className="mx-auto max-w-6xl">
        <MetricsDashboard />
      </div>
    </AppShell>
  );
}
