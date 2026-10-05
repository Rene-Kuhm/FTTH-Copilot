'use client';

import { useCallback, useState } from 'react';
import type { FiberPlan, PlanZone, PlanMarker, DeviceKind } from './FiberPlanViewer';
import { csrfFetch } from '@/lib/auth/csrf-client';

const PRESET_COLORS = [
  '#f23077', '#a855f7', '#3b82f6', '#10b981',
  '#f59e0b', '#ef4444', '#14b8a6', '#8b5cf6',
];

interface ZoneManagerProps {
  plan: FiberPlan;
  onPlanChange: (updated: FiberPlan) => void;
  onClose: () => void;
}

interface ZoneForm {
  name: string;
  description: string;
  color: string;
}

interface MarkerForm {
  label: string;
  deviceKind: DeviceKind | '';
  deviceId: string;
  xPercent: string;
  yPercent: string;
}

export default function ZoneManager({ plan, onPlanChange, onClose }: ZoneManagerProps) {
  const [activeTab, setActiveTab] = useState<'zones' | 'markers'>('zones');
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [showZoneForm, setShowZoneForm] = useState(false);
  const [showMarkerForm, setShowMarkerForm] = useState(false);
  const [zoneForm, setZoneForm] = useState<ZoneForm>({ name: '', description: '', color: '#6366F1' });
  const [markerForm, setMarkerForm] = useState<MarkerForm>({
    label: '', deviceKind: '', deviceId: '', xPercent: '', yPercent: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedZone = plan.zones.find((z) => z.id === selectedZoneId) ?? null;

  // ─── Zone CRUD ─────────────────────────────────────────────────────────────

  const createZone = useCallback(async () => {
    if (!zoneForm.name.trim()) { setError('El nombre de zona es obligatorio.'); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await csrfFetch(`/api/fiber-plans/${plan.id}/zones`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(zoneForm),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? 'Error'); return; }
      onPlanChange({ ...plan, zones: [...plan.zones, { ...body.zone, markers: [], markerCount: 0 }] });
      setZoneForm({ name: '', description: '', color: '#6366F1' });
      setShowZoneForm(false);
    } catch {
      setError('Error de red');
    } finally {
      setSaving(false);
    }
  }, [zoneForm, plan, onPlanChange]);

  const deleteZone = useCallback(async (zoneId: string) => {
    if (!confirm('¿Eliminar esta zona? Los marcadores quedarán sin zona.')) return;
    setSaving(true);
    try {
      const res = await csrfFetch(`/api/fiber-plans/${plan.id}/zones/${zoneId}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!res.ok) { setError('Error al eliminar'); return; }
      onPlanChange({ ...plan, zones: plan.zones.filter((z) => z.id !== zoneId) });
      if (selectedZoneId === zoneId) setSelectedZoneId(null);
    } catch {
      setError('Error de red');
    } finally {
      setSaving(false);
    }
  }, [plan, selectedZoneId, onPlanChange]);

  // ─── Marker CRUD ─────────────────────────────────────────────────────────────

  const createMarker = useCallback(async () => {
    if (!markerForm.label.trim() || !markerForm.xPercent || !markerForm.yPercent) {
      setError('Label y posición son obligatorios.'); return;
    }
    if (!selectedZoneId) { setError('Primero seleccioná una zona.'); return; }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        label: markerForm.label.trim(),
        deviceKind: markerForm.deviceKind || null,
        deviceId: markerForm.deviceId.trim() || null,
        xPercent: parseFloat(markerForm.xPercent),
        yPercent: parseFloat(markerForm.yPercent),
      };
      const res = await csrfFetch(`/api/fiber-plans/${plan.id}/zones/${selectedZoneId}/markers`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error ?? 'Error'); return; }
      const updatedZones = plan.zones.map((z) =>
        z.id === selectedZoneId ? { ...z, markers: [...z.markers, body.marker], markerCount: z.markerCount + 1 } : z,
      );
      onPlanChange({ ...plan, zones: updatedZones });
      setMarkerForm({ label: '', deviceKind: '', deviceId: '', xPercent: '', yPercent: '' });
      setShowMarkerForm(false);
    } catch {
      setError('Error de red');
    } finally {
      setSaving(false);
    }
  }, [markerForm, selectedZoneId, plan, onPlanChange]);

  const deleteMarker = useCallback(async (zoneId: string, markerId: string) => {
    if (!confirm('¿Eliminar este marcador?')) return;
    setSaving(true);
    try {
      const res = await csrfFetch(`/api/fiber-plans/${plan.id}/zones/${zoneId}/markers/${markerId}`, {
        method: 'DELETE', credentials: 'include',
      });
      if (!res.ok) { setError('Error al eliminar'); return; }
      const updatedZones = plan.zones.map((z) =>
        z.id === zoneId ? { ...z, markers: z.markers.filter((m) => m.id !== markerId), markerCount: Math.max(0, z.markerCount - 1) } : z,
      );
      onPlanChange({ ...plan, zones: updatedZones });
    } catch {
      setError('Error de red');
    } finally {
      setSaving(false);
    }
  }, [plan, onPlanChange]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        width: 320,
        height: '100%',
        background: 'var(--color-surface)',
        borderRight: '1px solid var(--color-border)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'var(--font-body)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--color-text)' }}>
          Gestionar zonas
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', fontSize: 18, lineHeight: 1 }}>
          ×
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
        {(['zones', 'markers'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: 1,
              padding: '8px',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid var(--color-accent)' : '2px solid transparent',
              color: activeTab === tab ? 'var(--color-accent)' : 'var(--color-muted)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {tab === 'zones' ? 'Zonas' : 'Marcadores'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {error && (
          <div style={{ padding: '8px 10px', borderRadius: 8, background: 'rgba(248,113,113,0.1)', color: 'var(--color-danger)', fontSize: 12, marginBottom: 8 }}>
            {error}
            <button onClick={() => setError(null)} style={{ marginLeft: 8, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 14 }}>×</button>
          </div>
        )}

        {/* ZONES tab */}
        {activeTab === 'zones' && (
          <>
            {/* Zone list */}
            {plan.zones.map((zone) => (
              <div
                key={zone.id}
                onClick={() => setSelectedZoneId(zone.id === selectedZoneId ? null : zone.id)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  marginBottom: 6,
                  cursor: 'pointer',
                  background: selectedZoneId === zone.id ? 'var(--color-surface-elev)' : 'transparent',
                  border: selectedZoneId === zone.id ? `1px solid ${zone.color}44` : '1px solid transparent',
                  transition: 'all 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: zone.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)', flex: 1 }}>{zone.name}</span>
                  <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>{zone.markerCount}</span>
                </div>
                {zone.description && (
                  <p style={{ margin: '4px 0 0 18px', fontSize: 11, color: 'var(--color-muted)' }}>{zone.description}</p>
                )}
                {selectedZoneId === zone.id && (
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteZone(zone.id); }}
                    style={{
                      marginTop: 6,
                      marginLeft: 18,
                      background: 'none',
                      border: '1px solid rgba(248,113,113,0.3)',
                      borderRadius: 6,
                      color: 'var(--color-danger)',
                      fontSize: 11,
                      cursor: 'pointer',
                      padding: '2px 8px',
                    }}
                  >
                    Eliminar zona
                  </button>
                )}
              </div>
            ))}

            {plan.zones.length === 0 && (
              <p style={{ textAlign: 'center', color: 'var(--color-muted)', fontSize: 13, marginTop: 24 }}>
                Sin zonas definidas
              </p>
            )}

            {/* Create zone form */}
            {showZoneForm ? (
              <div style={{ marginTop: 12, padding: 12, borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-surface-elev)' }}>
                <input
                  type="text"
                  value={zoneForm.name}
                  onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })}
                  placeholder="Nombre de la zona"
                  maxLength={255}
                  style={inputStyle()}
                  autoFocus
                />
                <input
                  type="text"
                  value={zoneForm.description}
                  onChange={(e) => setZoneForm({ ...zoneForm, description: e.target.value })}
                  placeholder="Descripción (opcional)"
                  maxLength={1000}
                  style={{ ...inputStyle(), marginTop: 8 }}
                />
                <div style={{ marginTop: 8 }}>
                  <p style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 4 }}>Color</p>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {PRESET_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => setZoneForm({ ...zoneForm, color: c })}
                        style={{
                          width: 24, height: 24, borderRadius: 6, border: zoneForm.color === c ? '2px solid var(--color-text)' : '2px solid transparent',
                          background: c, cursor: 'pointer', padding: 0,
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 12, justifyContent: 'flex-end' }}>
                  <button onClick={() => setShowZoneForm(false)} style={btnSecondaryStyle()}>Cancelar</button>
                  <button onClick={createZone} disabled={saving} style={btnPrimaryStyle()}>{saving ? '…' : 'Crear'}</button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowZoneForm(true)}
                style={{ width: '100%', marginTop: 8, padding: '8px', borderRadius: 10, border: '1px dashed var(--color-border)', background: 'none', color: 'var(--color-muted)', fontSize: 13, cursor: 'pointer' }}
              >
                + Nueva zona
              </button>
            )}
          </>
        )}

        {/* MARKERS tab */}
        {activeTab === 'markers' && (
          <>
            {!selectedZoneId ? (
              <p style={{ textAlign: 'center', color: 'var(--color-muted)', fontSize: 13, marginTop: 24 }}>
                Seleccioná una zona para ver sus marcadores
              </p>
            ) : (
              <>
                <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--color-muted)' }}>
                  Zona: <strong style={{ color: selectedZone?.color }}>{selectedZone?.name}</strong>
                </div>

                {selectedZone?.markers.map((m) => (
                  <div key={m.id} style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--color-surface-elev)', marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>{m.label}</span>
                      {m.deviceKind && (
                        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--color-muted)' }}>{m.deviceKind}</span>
                      )}
                    </div>
                    {m.deviceId && <code style={{ fontSize: 11, color: 'var(--color-muted)' }}>{m.deviceId}</code>}
                    <div style={{ fontSize: 11, color: 'var(--color-muted)', marginTop: 2 }}>
                      {m.xPercent.toFixed(1)}%, {m.yPercent.toFixed(1)}%
                    </div>
                    <button
                      onClick={() => deleteMarker(selectedZoneId, m.id)}
                      style={{ marginTop: 4, background: 'none', border: 'none', color: 'var(--color-danger)', fontSize: 11, cursor: 'pointer', padding: 0 }}
                    >
                      Eliminar
                    </button>
                  </div>
                ))}

                {selectedZone?.markers.length === 0 && (
                  <p style={{ textAlign: 'center', color: 'var(--color-muted)', fontSize: 13 }}>Sin marcadores</p>
                )}

                {/* Create marker form */}
                {showMarkerForm ? (
                  <div style={{ marginTop: 12, padding: 12, borderRadius: 10, border: '1px solid var(--color-border)', background: 'var(--color-surface-elev)' }}>
                    <input type="text" value={markerForm.label} onChange={(e) => setMarkerForm({ ...markerForm, label: e.target.value })} placeholder="Nombre del marcador *" style={inputStyle()} autoFocus />
                    <select value={markerForm.deviceKind} onChange={(e) => setMarkerForm({ ...markerForm, deviceKind: e.target.value as DeviceKind | '' })} style={{ ...inputStyle(), marginTop: 8 }}>
                      <option value="">Sin dispositivo</option>
                      {(['OLT', 'PON_PORT', 'SPLITTER', 'CTO', 'ONU'] as const).map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                    <input type="text" value={markerForm.deviceId} onChange={(e) => setMarkerForm({ ...markerForm, deviceId: e.target.value })} placeholder="Device ID (ej: ONT-12345)" style={{ ...inputStyle(), marginTop: 8 }} />
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 11, color: 'var(--color-muted)' }}>X %</label>
                        <input type="number" min={0} max={100} step={0.1} value={markerForm.xPercent} onChange={(e) => setMarkerForm({ ...markerForm, xPercent: e.target.value })} placeholder="0–100" style={inputStyle()} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 11, color: 'var(--color-muted)' }}>Y %</label>
                        <input type="number" min={0} max={100} step={0.1} value={markerForm.yPercent} onChange={(e) => setMarkerForm({ ...markerForm, yPercent: e.target.value })} placeholder="0–100" style={inputStyle()} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 12, justifyContent: 'flex-end' }}>
                      <button onClick={() => setShowMarkerForm(false)} style={btnSecondaryStyle()}>Cancelar</button>
                      <button onClick={createMarker} disabled={saving} style={btnPrimaryStyle()}>{saving ? '…' : 'Agregar'}</button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowMarkerForm(true)}
                    style={{ width: '100%', marginTop: 8, padding: '8px', borderRadius: 10, border: '1px dashed var(--color-border)', background: 'none', color: 'var(--color-muted)', fontSize: 13, cursor: 'pointer' }}
                  >
                    + Agregar marcador
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Style helpers ───────────────────────────────────────────────────────────

function inputStyle(): React.CSSProperties {
  return {
    width: '100%',
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontSize: 13,
    boxSizing: 'border-box',
    outline: 'none',
    fontFamily: 'var(--font-body)',
  };
}

function btnSecondaryStyle(): React.CSSProperties {
  return {
    padding: '6px 14px',
    borderRadius: 8,
    border: '1px solid var(--color-border)',
    background: 'transparent',
    color: 'var(--color-text)',
    fontSize: 13,
    cursor: 'pointer',
  };
}

function btnPrimaryStyle(): React.CSSProperties {
  return {
    padding: '6px 14px',
    borderRadius: 8,
    border: 'none',
    background: 'var(--color-accent)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  };
}
