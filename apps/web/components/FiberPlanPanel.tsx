'use client';

import { useCallback, useEffect, useState } from 'react';
import FiberPlanViewer from './FiberPlanViewer';
import FiberPlanUpload from './FiberPlanUpload';
import ZoneManager from './ZoneManager';
import type { FiberPlan, PlanMarker, PlanZone } from './FiberPlanViewer';

interface FiberPlanPanelProps {
  onMarkerContext?: (marker: PlanMarker, zone: PlanZone | null) => void;
}

export default function FiberPlanPanel({ onMarkerContext }: FiberPlanPanelProps) {
  const [plans, setPlans] = useState<FiberPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showZoneManager, setShowZoneManager] = useState(false);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;

  const loadPlans = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/fiber-plans', { credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? 'Error'); return; }
      const loadedPlans: FiberPlan[] = body.plans;
      setPlans(loadedPlans);
      if (loadedPlans.length > 0 && !selectedPlanId) {
        setSelectedPlanId(loadedPlans[0].id);
      }
    } catch {
      setError('Error de red');
    } finally {
      setLoading(false);
    }
  }, [selectedPlanId]);

  // Load full plan with zones and markers
  const loadFullPlan = useCallback(async (planId: string): Promise<FiberPlan | null> => {
    try {
      const res = await fetch(`/api/fiber-plans/${planId}`, { credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return null;
      return body.plan as FiberPlan;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => { void loadPlans(); }, [loadPlans]);

  // When a plan is selected, load full details
  useEffect(() => {
    if (!selectedPlanId) return;
    void loadFullPlan(selectedPlanId).then((full) => {
      if (full) {
        setPlans((prev) => prev.map((p) => p.id === full.id ? full : p));
      }
    });
  }, [selectedPlanId, loadFullPlan]);

  const handleUploaded = useCallback((newPlan: { id: string; name: string; fileUrl: string }) => {
    void loadFullPlan(newPlan.id).then((full) => {
      if (full) {
        setPlans((prev) => [full, ...prev]);
        setSelectedPlanId(full.id);
      }
    });
  }, [loadFullPlan]);

  const handlePlanChange = useCallback((updated: FiberPlan) => {
    setPlans((prev) => prev.map((p) => p.id === updated.id ? updated : p));
  }, []);

  const handleMarkerClick = useCallback((marker: PlanMarker, zone: PlanZone | null) => {
    onMarkerContext?.(marker, zone);
  }, [onMarkerContext]);

  if (loading && plans.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-muted)', fontFamily: 'var(--font-body)', fontSize: 14 }}>
        Cargando planos…
      </div>
    );
  }

  if (error && plans.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, fontFamily: 'var(--font-body)', padding: 24 }}>
        <span style={{ color: 'var(--color-danger)', fontSize: 13 }}>{error}</span>
        <button onClick={() => void loadPlans()} style={{ padding: '6px 16px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface-elev)', color: 'var(--color-text)', cursor: 'pointer', fontSize: 13 }}>
          Reintentar
        </button>
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 16, fontFamily: 'var(--font-body)' }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <polyline points="21 15 16 10 5 21" />
        </svg>
        <div style={{ textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>Sin planos cargados</p>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--color-muted)' }}>Subí un plano de fibra óptica para comenzar</p>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          style={{ padding: '8px 20px', borderRadius: 10, border: 'none', background: 'var(--color-accent)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
        >
          + Subir primer plano
        </button>
        {showUpload && <FiberPlanUpload onClose={() => setShowUpload(false)} onUploaded={handleUploaded} />}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Plan selector sidebar */}
      <div
        style={{
          width: 180,
          flexShrink: 0,
          background: 'var(--color-surface)',
          borderRight: '1px solid var(--color-border)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text)', fontFamily: 'var(--font-display)' }}>Planos</span>
          <button
            onClick={() => setShowUpload(true)}
            title="Subir plano"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-accent)', fontSize: 16, lineHeight: 1 }}
          >
            +
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          {plans.map((plan) => (
            <button
              key={plan.id}
              onClick={() => setSelectedPlanId(plan.id)}
              style={{
                width: '100%',
                padding: '8px 12px',
                background: selectedPlanId === plan.id ? 'var(--color-surface-elev)' : 'none',
                border: 'none',
                borderLeft: selectedPlanId === plan.id ? '2px solid var(--color-accent)' : '2px solid transparent',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600, color: selectedPlanId === plan.id ? 'var(--color-text)' : 'var(--color-muted)', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {plan.name}
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-muted)' }}>
                {plan.zones.length} zona{plan.zones.length !== 1 ? 's' : ''} · {plan.mimeType.split('/')[1]?.toUpperCase() ?? 'FILE'}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Zone manager sidebar */}
      {showZoneManager && selectedPlan && (
        <ZoneManager
          plan={selectedPlan}
          onPlanChange={handlePlanChange}
          onClose={() => setShowZoneManager(false)}
        />
      )}

      {/* Viewer */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: showZoneManager ? 0 : 8 }}>
        {!showZoneManager && selectedPlan && (
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <FiberPlanViewer
              plan={selectedPlan}
              onMarkerClick={handleMarkerClick}
              showUploadButton={false}
            />
          </div>
        )}

        {/* Action bar */}
        {!showZoneManager && selectedPlan && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              padding: '8px 0',
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => setShowZoneManager(true)}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: '1px solid var(--color-border)',
                background: 'var(--color-surface)',
                color: 'var(--color-text)',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Gestionar zonas ({selectedPlan.zones.length})
            </button>
            <button
              onClick={() => setShowUpload(true)}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--color-accent)',
                color: '#fff',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              + Nuevo plano
            </button>
          </div>
        )}
      </div>

      {/* Upload modal */}
      {showUpload && <FiberPlanUpload onClose={() => setShowUpload(false)} onUploaded={handleUploaded} />}
    </div>
  );
}
