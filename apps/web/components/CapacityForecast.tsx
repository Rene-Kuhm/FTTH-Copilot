'use client';

import { useCallback, useEffect, useState } from 'react';

// Stable render time — avoids impure Date.now() inside JSX
const RENDER_MS = Date.now();

interface CapacityDevice {
  deviceId: string; deviceKind: string; metric: string;
  current: number; unit: string; threshold: number;
  forecast: number; trend: number; confidence: number;
  predictedOverloadAt: number | null;
  projectedOverloadPct: number;
}
interface CapacityResponse { devices: CapacityDevice[]; summary: { total: number; overloaded: number; warning: number; lookbackHours: number } }

function fmtBytes(b: number) {
  return b >= 1_073_741_824 ? `${(b / 1_073_741_824).toFixed(1)} GiB`
    : b >= 1_048_576 ? `${(b / 1_048_576).toFixed(0)} MiB`
    : b >= 1024 ? `${(b / 1024).toFixed(0)} KiB` : `${b} B`;
}
function fmtDate(ts: number) {
  return new Date(ts).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function ForecastBar({ device }: { device: CapacityDevice }) {
  const pct = device.projectedOverloadPct;
  const col = pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#10b981';
  const trendCol = device.trend > 0 ? '#ef4444' : device.trend < 0 ? '#10b981' : '#6b7280';
  const trendIcon = device.trend > 0.01 ? '↑' : device.trend < -0.01 ? '↓' : '→';
  const conf = Math.round(device.confidence * 100);

  return (
    <div className="rounded-lg border border-base-200 p-3 space-y-1.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="badge badge-xs badge-outline">{device.deviceKind}</span>
            <span className="font-mono text-xs font-semibold">{device.deviceId}</span>
          </div>
          <div className="text-[10px] text-base-content/50">{device.metric}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-sm font-black" style={{ color: col }}>{pct}%</div>
          <div className="text-[9px] text-base-content/40">conf {conf}%</div>
        </div>
      </div>

      {/* Current vs forecast bar */}
      <div className="space-y-0.5">
        <div className="flex justify-between text-[9px] text-base-content/40">
          <span>Actual: <span className="font-mono">{device.unit === 'bytes' ? fmtBytes(device.current) : device.current.toFixed(1)}</span></span>
          <span>Pronóstico: <span className="font-mono">{device.unit === 'bytes' ? fmtBytes(device.forecast) : device.forecast.toFixed(1)}</span></span>
        </div>
        <div className="relative h-2.5 overflow-hidden rounded-full bg-base-200">
          {/* Threshold marker */}
          <div className="absolute left-full h-full w-px -translate-x-full" style={{ left: `${Math.min((device.threshold / Math.max(device.forecast, device.threshold)) * 100, 100)}%` }}>
            <div className="h-full w-px bg-base-content/40" />
          </div>
          <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: col }} />
        </div>
        <div className="flex justify-between text-[9px]">
          <span className="text-base-content/30">0%</span>
          <span className="text-base-content/30">{device.threshold > 0 ? `${device.unit === 'bytes' ? fmtBytes(device.threshold) : device.threshold}` : ''}</span>
        </div>
      </div>

      {/* Trend */}
      <div className="flex items-center justify-between">
        <span className="text-[10px]" style={{ color: trendCol }}>
          {trendIcon} {Math.abs(device.trend).toFixed(2)}/step
        </span>
        {device.predictedOverloadAt && device.predictedOverloadAt > RENDER_MS && (
          <span className="text-[10px] font-medium text-warning">
            Sobrecarga predicted: {fmtDate(device.predictedOverloadAt)}
          </span>
        )}
        {device.predictedOverloadAt && device.predictedOverloadAt <= RENDER_MS && (
          <span className="badge badge-xs badge-error">⚠ Sobrecargado ahora</span>
        )}
      </div>
    </div>
  );
}

export function CapacityForecast() {
  const [devices, setDevices] = useState<CapacityDevice[]>([]);
  const [summary, setSummary] = useState<{ total: number; overloaded: number; warning: number; lookbackHours: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState(6);

  const loadCapacity = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/ops/capacity?hours=${hours}&min_conf=0.2`, { credentials: 'include' });
      if (!r.ok) throw new Error(await r.text());
      const data: CapacityResponse = await r.json();
      setDevices(data.devices ?? []);
      setSummary(data.summary ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally { setLoading(false); }
  }, [hours]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadCapacity(); }, [loadCapacity]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold">Predicción de capacidad</h3>
          <p className="text-xs text-base-content/40">Exponential Smoothing sobre métricas VM · ventana {hours}h</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="select select-xs select-bordered" value={hours} onChange={e => setHours(Number(e.target.value))}>
            <option value={1}>1h</option><option value={3}>3h</option>
            <option value={6}>6h</option><option value={12}>12h</option><option value={24}>24h</option>
          </select>
          <button className={`btn btn-xs btn-ghost ${loading ? 'loading' : ''}`} onClick={() => void loadCapacity()} disabled={loading}>↻</button>
        </div>
      </div>

      {summary && (
        <div className="flex flex-wrap gap-2">
          <span className="badge badge-lg badge-outline">{summary.total} métricas</span>
          <span className="badge badge-lg badge-error gap-1">{summary.overloaded} sobrecargadas</span>
          <span className="badge badge-lg badge-warning gap-1">{summary.warning} en warning</span>
        </div>
      )}

      {error && <div className="alert alert-error py-2 text-xs">{error}</div>}

      {devices.length === 0 && !loading && (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <span className="text-xl">📊</span>
          <p className="text-sm text-base-content/50">Sin predicciones disponibles</p>
          <p className="text-xs text-base-content/30">Se necesitan al menos 2 puntos de datos para Forecasting</p>
        </div>
      )}

      <div className="space-y-2">
        {devices.map((d, i) => (
          <ForecastBar key={i} device={d} />
        ))}
      </div>

      {/* Method note */}
      <details className="rounded-xl border border-base-200">
        <summary className="cursor-pointer px-4 py-2.5 text-xs text-base-content/40 hover:bg-base-200/30">
          Metodología: Simple Exponential Smoothing (SES)
        </summary>
        <div className="divide-y divide-base-200 px-4 pb-3 text-[10px] text-base-content/40">
          <div className="py-2">
            <strong>Modelo:</strong> SES con α=0.3 (memoria), β=0.1 (tendencia).
           Forecast: F(t+1) = α·X(t) + (1-α)·(F(t) + T(t))
          </div>
          <div className="py-2">
            <strong>Confidence:</strong> 1 - CV (coeficiente de variación). Bajo CV → alta confianza.
          </div>
          <div className="py-2">
            <strong>Overload prediction:</strong> Extrapola tendencia lineal hasta cruzar threshold.
          </div>
        </div>
      </details>
    </div>
  );
}
