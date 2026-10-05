'use client';

import { useState, useEffect, useCallback } from 'react';

interface AuditRow {
  id: string;
  actorId: string;
  actorEmail: string | null;
  actorRole: string | null;
  category: string;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: 'SUCCESS' | 'FAILURE';
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

const CATEGORIES = [
  { value: '', label: 'All' },
  { value: 'AUTH', label: 'Auth' },
  { value: 'USER_MANAGEMENT', label: 'Users' },
  { value: 'INCIDENT', label: 'Incidents' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'CONNECTOR', label: 'Connectors' },
  { value: 'NOTIFICATION', label: 'Notifications' },
  { value: 'NETWORK', label: 'Network' },
  { value: 'CONFIGURATION', label: 'Config' },
  { value: 'AI', label: 'AI' },
  { value: 'SYSTEM', label: 'System' },
];

const CATEGORY_COLORS: Record<string, string> = {
  AUTH: 'bg-purple-100 text-purple-700 border-purple-200',
  USER_MANAGEMENT: 'bg-violet-100 text-violet-700 border-violet-200',
  INCIDENT: 'bg-red-100 text-red-700 border-red-200',
  MAINTENANCE: 'bg-amber-100 text-amber-700 border-amber-200',
  CONNECTOR: 'bg-blue-100 text-blue-700 border-blue-200',
  NETWORK: 'bg-teal-100 text-teal-700 border-teal-200',
  NOTIFICATION: 'bg-pink-100 text-pink-700 border-pink-200',
  CONFIGURATION: 'bg-gray-100 text-gray-700 border-gray-200',
  AI: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  SYSTEM: 'bg-slate-100 text-slate-600 border-slate-200',
};

const OUTCOME_COLORS = {
  SUCCESS: 'text-green-600',
  FAILURE: 'text-red-600',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function AuditPanel() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 50, total: 0, pages: 0 });
  const [loading, setLoading] = useState(false);
  const [category, setCategory] = useState('');
  const [outcome, setOutcome] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetch_ = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (category) params.set('category', category);
      if (outcome) params.set('outcome', outcome);
      const res = await fetch(`/api/audit?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to load audit log');
      const data = await res.json();
      setRows(data.rows);
      setPagination(data.pagination);
    } catch {
      // silently fail — audit log should never block the UI
    } finally {
      setLoading(false);
    }
  }, [category, outcome]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void fetch_(); }, [fetch_]);

  const total = pagination.total;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-base-content">Audit Log</h2>
          <p className="text-sm text-base-content/60">
            {total > 0 ? `${total.toLocaleString()} events (last 30 days)` : 'No events recorded'}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <select
            className="select select-sm select-bordered"
            value={category}
            onChange={(e) => { setCategory(e.target.value); }}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <select
            className="select select-sm select-bordered"
            value={outcome}
            onChange={(e) => { setOutcome(e.target.value); }}
          >
            <option value="">All outcomes</option>
            <option value="SUCCESS">✓ Success</option>
            <option value="FAILURE">✗ Failure</option>
          </select>
          <button className="btn btn-sm btn-ghost" onClick={() => fetch_(pagination.page)}>
            ↺
          </button>
        </div>
      </div>

      {/* ── Summary cards ── */}
      {total > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'Auth events', cat: 'AUTH' },
            { label: 'Incident ops', cat: 'INCIDENT' },
            { label: 'Connector changes', cat: 'CONNECTOR' },
            { label: 'Notification ops', cat: 'NOTIFICATION' },
          ].map(({ label, cat }) => {
            const count = rows.filter((r) => r.category === cat).length;
            return (
              <div key={cat} className="stat bg-base-200 rounded-lg py-2 px-3">
                <div className="stat-title text-xs">{label}</div>
                <div className="stat-value text-lg">{count}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Table ── */}
      {loading ? (
        <div className="flex justify-center py-12">
          <span className="loading loading-spinner loading-lg" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-base-content/40">
          <p>No audit events found</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-base-300">
          <table className="table table-sm">
            <thead>
              <tr className="text-xs text-base-content/60 uppercase">
                <th>Time</th>
                <th>Category</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Resource</th>
                <th>Outcome</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <>
                  <tr
                    key={row.id}
                    className={`hover:bg-base-200/50 cursor-pointer ${row.outcome === 'FAILURE' ? 'bg-red-50/30' : ''}`}
                    onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                  >
                    <td className="whitespace-nowrap text-xs text-base-content/60">
                      {timeAgo(row.createdAt)}
                    </td>
                    <td>
                      <span className={`badge badge-sm border ${CATEGORY_COLORS[row.category] ?? 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                        {row.category}
                      </span>
                    </td>
                    <td className="text-sm">
                      <div className="font-medium">{row.actorEmail ?? row.actorId}</div>
                      {row.actorRole && (
                        <div className="text-xs text-base-content/40">{row.actorRole}</div>
                      )}
                    </td>
                    <td className="text-sm">{row.action}</td>
                    <td className="text-xs text-base-content/60">
                      <div>{row.resourceType}</div>
                      <div className="font-mono text-[10px]">{row.resourceId.slice(0, 16)}…</div>
                    </td>
                    <td>
                      <span className={`text-sm font-medium ${OUTCOME_COLORS[row.outcome]}`}>
                        {row.outcome === 'SUCCESS' ? '✓' : '✗'}
                      </span>
                    </td>
                    <td>
                      <span className="text-base-content/40">{expandedId === row.id ? '▲' : '▼'}</span>
                    </td>
                  </tr>
                  {expandedId === row.id && (
                    <tr key={`${row.id}-detail`} className="bg-base-200/20">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                          <div>
                            <div className="font-medium text-base-content/60 mb-1">Actor ID</div>
                            <div className="font-mono">{row.actorId}</div>
                          </div>
                          {row.ipAddress && (
                            <div>
                              <div className="font-medium text-base-content/60 mb-1">IP Address</div>
                              <div className="font-mono">{row.ipAddress}</div>
                            </div>
                          )}
                          {row.userAgent && (
                            <div className="col-span-2">
                              <div className="font-medium text-base-content/60 mb-1">User-Agent</div>
                              <div className="font-mono truncate">{row.userAgent.slice(0, 80)}</div>
                            </div>
                          )}
                          {Object.keys(row.metadata ?? {}).length > 0 && (
                            <div className="col-span-2">
                              <div className="font-medium text-base-content/60 mb-1">Metadata</div>
                              <pre className="font-mono text-[10px] whitespace-pre-wrap">
                                {JSON.stringify(row.metadata, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Pagination ── */}
      {pagination.pages > 1 && (
        <div className="flex justify-center gap-2 items-center">
          <button
            className="btn btn-sm"
            disabled={pagination.page <= 1}
            onClick={() => fetch_(pagination.page - 1)}
          >
            ←
          </button>
          <span className="text-sm text-base-content/60">
            Page {pagination.page} of {pagination.pages}
          </span>
          <button
            className="btn btn-sm"
            disabled={pagination.page >= pagination.pages}
            onClick={() => fetch_(pagination.page + 1)}
          >
            →
          </button>
        </div>
      )}
    </div>
  );
}
