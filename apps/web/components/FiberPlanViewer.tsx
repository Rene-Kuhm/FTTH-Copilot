'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DeviceKind = 'OLT' | 'PON_PORT' | 'SPLITTER' | 'CTO' | 'ONU';

export interface PlanMarker {
  id: string;
  label: string;
  deviceKind: DeviceKind | null;
  deviceId: string | null;
  xPercent: number;
  yPercent: number;
  createdAt: string;
}

export interface PlanZone {
  id: string;
  name: string;
  description: string | null;
  color: string;
  markerCount: number;
  createdAt: string;
  markers: PlanMarker[];
}

export interface FiberPlan {
  id: string;
  name: string;
  description: string | null;
  fileUrl: string;
  mimeType: string;
  widthPx: number | null;
  heightPx: number | null;
  fileSizeBytes: string | null;
  connectionId: string | null;
  createdAt: string;
  updatedAt: string;
  zones: PlanZone[];
}

interface FiberPlanViewerProps {
  /** The plan to display (loaded via GET /api/fiber-plans/[id]) */
  plan: FiberPlan;
  /** Called when a marker is clicked — parent can load device details */
  onMarkerClick?: (marker: PlanMarker, zone: PlanZone | null) => void;
  /** Called when the viewer requests the upload modal */
  onUploadRequest?: () => void;
  /** Show upload button */
  showUploadButton?: boolean;
}

// ─── Marker icon per device kind ──────────────────────────────────────────────

const DEVICE_ICONS: Record<string, string> = {
  OLT: 'M4 4h16v16H4zM4 9h16M9 4v16',
  PON_PORT: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  SPLITTER: 'M12 2v20M7 7h10M7 17h10',
  CTO: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  ONU: 'M5 12.55a11 11 0 0 1 14.08 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01',
};

const DEVICE_LABELS: Record<string, string> = {
  OLT: 'OLT',
  PON_PORT: 'PON',
  SPLITTER: 'SPL',
  CTO: 'CTO',
  ONU: 'ONU',
};

const DEVICE_COLORS: Record<string, string> = {
  OLT: '#f23077',
  PON_PORT: '#a855f7',
  SPLITTER: '#3b82f6',
  CTO: '#10b981',
  ONU: '#fbbf24',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function ZoomControls({
  scale,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        right: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        zIndex: 20,
      }}
    >
      {[
        { label: '+', title: 'Zoom in', on: onZoomIn },
        { label: '−', title: 'Zoom out', on: onZoomOut },
        { label: '⊙', title: 'Reset', on: onReset },
      ].map(({ label, title, on }) => (
        <button
          key={label}
          title={title}
          onClick={on}
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface-elev)',
            color: 'var(--color-text)',
            cursor: 'pointer',
            fontSize: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {label}
        </button>
      ))}
      <span
        style={{
          fontSize: 10,
          color: 'var(--color-muted)',
          textAlign: 'center',
          fontFamily: 'var(--font-mono)',
        }}
      >
        {Math.round(scale * 100)}%
      </span>
    </div>
  );
}

function MarkerPopover({
  marker,
  zone,
  onClose,
  onAssignZone,
}: {
  marker: PlanMarker;
  zone: PlanZone | null;
  onClose: () => void;
  onAssignZone?: (markerId: string, zoneId: string | null) => void;
}) {
  const deviceColor = marker.deviceKind ? DEVICE_COLORS[marker.deviceKind] : 'var(--color-muted)';

  return (
    <div
      style={{
        position: 'absolute',
        left: `calc(${marker.xPercent}% + 12px)`,
        top: `calc(${marker.yPercent}% - 8px)`,
        zIndex: 30,
        background: 'var(--color-surface-elev)',
        border: '1px solid var(--color-border)',
        borderRadius: 12,
        padding: 12,
        minWidth: 200,
        maxWidth: 280,
        boxShadow: 'var(--shadow-float)',
        fontFamily: 'var(--font-body)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-text)' }}>
            {marker.label}
          </div>
          {marker.deviceKind && (
            <span
              style={{
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                color: deviceColor,
                background: `${deviceColor}22`,
                padding: '1px 6px',
                borderRadius: 4,
                border: `1px solid ${deviceColor}44`,
              }}
            >
              {DEVICE_LABELS[marker.deviceKind] ?? marker.deviceKind}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-muted)',
            padding: 0,
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      {marker.deviceId && (
        <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 8 }}>
          <span style={{ color: 'var(--color-text)', opacity: 0.7 }}>Device ID: </span>
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{marker.deviceId}</code>
        </div>
      )}

      <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 8 }}>
        <span style={{ color: 'var(--color-text)', opacity: 0.7 }}>Posición: </span>
        {marker.xPercent.toFixed(1)}%, {marker.yPercent.toFixed(1)}%
      </div>

      {zone && (
        <div style={{ fontSize: 12, marginBottom: 8 }}>
          <span style={{ color: 'var(--color-text)', opacity: 0.7 }}>Zona: </span>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              color: zone.color,
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: zone.color,
              }}
            />
            {zone.name}
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Marker dot ───────────────────────────────────────────────────────────────

function MarkerDot({
  marker,
  zone,
  selected,
  onClick,
  scale,
}: {
  marker: PlanMarker;
  zone: PlanZone | null;
  selected: boolean;
  onClick: () => void;
  scale: number;
}) {
  const color = marker.deviceKind ? DEVICE_COLORS[marker.deviceKind] : zone?.color ?? 'var(--color-muted)';
  const size = Math.max(8, Math.min(16, 10 / scale));

  return (
    <div
      title={`${marker.label}${marker.deviceId ? ` (${marker.deviceId})` : ''}`}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        position: 'absolute',
        left: `${marker.xPercent}%`,
        top: `${marker.yPercent}%`,
        transform: 'translate(-50%, -50%)',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        border: selected ? `2px solid var(--color-text)` : `1.5px solid rgba(255,255,255,0.4)`,
        boxShadow: selected
          ? `0 0 0 3px ${color}66, 0 2px 8px rgba(0,0,0,0.5)`
          : `0 2px 6px rgba(0,0,0,0.4)`,
        cursor: 'pointer',
        zIndex: 10,
        transition: 'all 0.15s ease',
      }}
    >
      {/* Pulse ring for selected */}
      {selected && (
        <span
          style={{
            position: 'absolute',
            inset: -4,
            borderRadius: '50%',
            border: `2px solid ${color}`,
            animation: 'fiberMarkerPulse 1.2s ease-out infinite',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function FiberPlanViewer({
  plan,
  onMarkerClick,
  showUploadButton,
}: FiberPlanViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);

  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);

  const isPdf = plan.mimeType === 'application/pdf';

  // Build flat marker list with zone info
  const allMarkers: Array<{ marker: PlanMarker; zone: PlanZone | null }> = plan.zones.flatMap((zone) =>
    zone.markers.map((marker) => ({ marker, zone })),
  );

  const visibleMarkers =
    selectedZoneId === null
      ? allMarkers
      : allMarkers.filter(({ zone }) => zone?.id === selectedZoneId);

  // Wheel zoom
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setScale((s) => Math.min(5, Math.max(0.1, s + delta)));
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-marker]')) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y });
  }, [offset]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return;
    setOffset({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
  }, [isPanning, panStart]);

  const handleMouseUp = useCallback(() => setIsPanning(false), []);

  const handleMarkerClick = useCallback((marker: PlanMarker, zone: PlanZone | null) => {
    setSelectedMarkerId((prev) => (prev === marker.id ? null : marker.id));
    onMarkerClick?.(marker, zone);
  }, [onMarkerClick]);

  const handleZoomIn = useCallback(() => setScale((s) => Math.min(5, s + 0.2)), []);
  const handleZoomOut = useCallback(() => setScale((s) => Math.max(0.1, s - 0.2)), []);
  const handleReset = useCallback(() => { setScale(1); setOffset({ x: 0, y: 0 }); }, []);

  const selectedEntry = allMarkers.find(({ marker }) => marker.id === selectedMarkerId) ?? null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        gap: 8,
        fontFamily: 'var(--font-body)',
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: 'var(--color-surface)',
          borderRadius: 12,
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--color-text)', fontFamily: 'var(--font-display)' }}>
          {plan.name}
        </span>

        {plan.description && (
          <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>
            — {plan.description}
          </span>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {/* Zone filter */}
          <select
            value={selectedZoneId ?? ''}
            onChange={(e) => setSelectedZoneId(e.target.value || null)}
            style={{
              height: 28,
              padding: '0 8px',
              borderRadius: 8,
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface-elev)',
              color: 'var(--color-text)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            <option value="">Todas las zonas</option>
            {plan.zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name} ({z.markerCount})
              </option>
            ))}
          </select>

          {/* Legend */}
          {Object.entries(DEVICE_LABELS).map(([kind, label]) => (
            <span
              key={kind}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                color: DEVICE_COLORS[kind],
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: DEVICE_COLORS[kind],
                  display: 'inline-block',
                }}
              />
              {label}
            </span>
          ))}

          {showUploadButton && (
            <button
              onClick={() => {}}
              style={{
                height: 28,
                padding: '0 12px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--color-accent)',
                color: '#fff',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              + Subir plano
            </button>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 12,
          border: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
          cursor: isPanning ? 'grabbing' : 'grab',
          minHeight: 300,
        }}
      >
        {/* Image / PDF */}
        <div
          ref={imageRef}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: 'center center',
            transition: isPanning ? 'none' : 'transform 0.1s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            userSelect: 'none',
          }}
        >
          {isPdf ? (
            <iframe
              src={plan.fileUrl}
              title={plan.name}
              style={{ width: '100%', height: '100%', border: 'none', minHeight: '80vh' }}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={plan.fileUrl}
              alt={plan.name}
              draggable={false}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                pointerEvents: 'none',
              }}
            />
          )}
        </div>

        {/* SVG overlay for markers (positioned absolutely over the image) */}
        {!isPdf && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
            }}
          >
            {visibleMarkers.map(({ marker, zone }) => (
              <MarkerDot
                key={marker.id}
                marker={marker}
                zone={zone}
                selected={selectedMarkerId === marker.id}
                scale={scale}
                onClick={() => handleMarkerClick(marker, zone)}
              />
            ))}
          </div>
        )}

        {/* Selected marker popover */}
        {selectedEntry && (
          <MarkerPopover
            marker={selectedEntry.marker}
            zone={selectedEntry.zone}
            onClose={() => setSelectedMarkerId(null)}
          />
        )}

        {/* Zoom controls */}
        <ZoomControls
          scale={scale}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onReset={handleReset}
        />

        {/* Empty state */}
        {!isPdf && visibleMarkers.length === 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>
              Sin marcadores en esta zona
            </span>
          </div>
        )}
      </div>

      {/* CSS animation for pulse */}
      <style>{`
        @keyframes fiberMarkerPulse {
          0% { transform: scale(1); opacity: 0.8; }
          100% { transform: scale(2.5); opacity: 0; }
        }
      `}</style>
    </div>
  );
}
