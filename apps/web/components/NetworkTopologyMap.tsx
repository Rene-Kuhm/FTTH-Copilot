'use client';

import { useCallback, useEffect, useState } from 'react';

interface TreeNode { kind: string; id: string; children: TreeNode[]; downstreamCount: number }
interface TopologyResponse { roots: TreeNode[]; nodeCount: number; count: number }
interface Incident { id: string; deviceKind: string; deviceId: string; severity: string; status: string }
interface IncidentsResponse { incidents: Incident[]; count: number }

const KIND_META: Record<string, { icon: string; color: string; bg: string; w: number; h: number }> = {
  OLT: { icon: 'OLT', color: '#3b82f6', bg: '#3b82f615', w: 80, h: 44 },
  PON_PORT: { icon: 'PON', color: '#6b7280', bg: '#6b728015', w: 64, h: 36 },
  SPLITTER: { icon: 'SPL', color: '#f59e0b', bg: '#f59e0b15', w: 56, h: 32 },
  CTO: { icon: 'CTO', color: '#8b5cf6', bg: '#8b5cf615', w: 52, h: 30 },
  ONU: { icon: 'ONU', color: '#10b981', bg: '#10b98115', w: 44, h: 26 },
};

interface LayoutNode {
  id: string; kind: string; label: string;
  x: number; y: number; w: number; h: number;
  color: string; bg: string; icon: string;
  downstreamCount: number;
  impacted: boolean; severity: string | null;
  children: LayoutNode[];
}

function layoutTree(roots: TreeNode[], incidentMap: Map<string, string>): LayoutNode[] {
  const layoutNodes: LayoutNode[] = [];
  const posMap = new Map<string, { x: number; y: number }>();

  // Column widths based on kind
  const colX: Record<string, number> = { OLT: 30, PON_PORT: 180, SPLITTER: 310, CTO: 430, ONU: 550 };
  const colW = 130;

  function countDescendants(node: TreeNode): number {
    return node.downstreamCount || 0;
  }

  let oltsByKind = new Map<string, TreeNode[]>();
  function groupByKind(nodes: TreeNode[]): Map<string, TreeNode[]> {
    const m = new Map<string, TreeNode[]>();
    for (const n of nodes) {
      if (!m.has(n.kind)) m.set(n.kind, []);
      m.get(n.kind)!.push(n);
    }
    return m;
  }

  function layoutLevel(nodes: TreeNode[], depth: number, startY: number): number {
    const grouped = groupByKind(nodes);
    let currentY = startY;
    const kindOrder = ['OLT', 'PON_PORT', 'SPLITTER', 'CTO', 'ONU'];
    for (const kind of kindOrder) {
      const kids = grouped.get(kind) ?? [];
      if (kids.length === 0) continue;
      const meta = KIND_META[kind] ?? { icon: '?', color: '#6b7280', bg: '#6b728015', w: 40, h: 26 };
      const x = colX[kind] ?? (30 + depth * colW);
      const spacing = 48;

      for (let i = 0; i < kids.length; i++) {
        const node = kids[i]!;
        const sev = incidentMap.get(`${kind}:${node.id}`);
        layoutNodes.push({
          id: node.id, kind: node.kind,
          label: node.id.length > 12 ? node.id.slice(0, 11) + '…' : node.id,
          x, y: currentY, w: meta.w, h: meta.h,
          color: meta.color, bg: meta.bg, icon: meta.icon,
          downstreamCount: node.downstreamCount,
          impacted: sev != null,
          severity: sev ?? null,
          children: [],
        });
        posMap.set(`${kind}:${node.id}`, { x: x + meta.w / 2, y: currentY + meta.h / 2 });

        // Layout children recursively
        if (node.children.length > 0) {
          const childMeta = KIND_META[node.children[0]!.kind] ?? { icon: '?', color: '#6b7280', bg: '#6b728015', w: 40, h: 26 };
          const childX = colX[node.children[0]!.kind] ?? (x + colW);
          currentY = layoutLevel(node.children, depth + 1, currentY);
        } else {
          currentY += spacing;
        }
      }
    }
    return currentY;
  }

  layoutLevel(roots, 0, 10);
  return layoutNodes;
}

// Draw connections between nodes
function Connections({ nodes }: { nodes: LayoutNode[] }) {
  const posMap = new Map<string, { x: number; y: number }>();
  for (const n of nodes) posMap.set(`${n.kind}:${n.id}`, { x: n.x + n.w / 2, y: n.y + n.h / 2 });

  const lines: Array<{ x1: number; y1: number; x2: number; y2: number; impacted: boolean; key: string }> = [];
  for (const parent of nodes) {
    const parentPos = posMap.get(`${parent.kind}:${parent.id}`);
    if (!parentPos) continue;
    for (const child of parent.children) {
      const childPos = posMap.get(`${child.kind}:${child.id}`);
      if (!childPos) continue;
      lines.push({
        x1: parentPos.x, y1: parentPos.y,
        x2: childPos.x, y2: childPos.y,
        impacted: parent.impacted,
        key: `${parent.id}-${child.id}`,
      });
    }
  }

  return (
    <svg className="absolute inset-0 pointer-events-none" style={{ width: 700, height: '100%' }}>
      {lines.map(l => (
        <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
          stroke={l.impacted ? '#ef4444' : '#374151'} strokeWidth={l.impacted ? 2 : 1}
          strokeDasharray={l.impacted ? '4,2' : undefined}
          opacity={l.impacted ? 0.8 : 0.3} />
      ))}
    </svg>
  );
}

function NodeBox({ node }: { node: LayoutNode }) {
  const sev = node.severity;
  const borderColor = sev === 'critical' ? '#ef4444' : sev === 'warning' ? '#f59e0b' : node.impacted ? '#ef4444' : node.color;
  const pulse = sev != null || node.impacted;
  return (
    <div
      className={`absolute flex flex-col items-center justify-center rounded-lg border-2 transition-all cursor-pointer hover:scale-105 ${pulse ? 'animate-pulse' : ''}`}
      style={{
        left: node.x, top: node.y,
        width: node.w, height: node.h,
        borderColor,
        backgroundColor: node.bg,
        boxShadow: pulse ? `0 0 8px ${borderColor}60` : undefined,
      }}
      title={`${node.kind}: ${node.id} · ${node.downstreamCount} downstream${node.severity ? ` · ${node.severity}` : ''}`}
    >
      <span className="font-mono text-[9px] font-black" style={{ color: node.color }}>{node.icon}</span>
      <span className="mt-0.5 truncate w-full text-center font-mono text-[8px] text-base-content/70 px-1">{node.label}</span>
      {node.downstreamCount > 0 && (
        <span className="absolute -top-1 -right-1 rounded-full bg-base-300 px-1 text-[8px] font-mono font-bold text-base-content">
          {node.downstreamCount}
        </span>
      )}
      {sev && (
        <span className="absolute -bottom-1 -right-1 h-2 w-2 rounded-full" style={{ backgroundColor: sev === 'critical' ? '#ef4444' : '#f59e0b' }} />
      )}
    </div>
  );
}

export function NetworkTopologyMap() {
  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [incidents, setIncidents] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true); setError(null);
    try {
      const [topoRes, incRes] = await Promise.all([
        fetch('/api/topology/tree', { credentials: 'include' }).then(r => r.json()) as Promise<TopologyResponse>,
        fetch('/api/incidents', { credentials: 'include' }).then(r => r.json()) as Promise<IncidentsResponse>,
      ]);
      setRoots(topoRes.roots ?? []);
      const imap = new Map<string, string>();
      for (const inc of incRes.incidents ?? []) {
        imap.set(`${inc.deviceKind}:${inc.deviceId}`, inc.severity);
      }
      setIncidents(imap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading topology');
    } finally {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
    }
  }, []);

  useEffect(() => {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void fetchData(); }, [fetchData]);

  if (loading) return <div className="flex items-center justify-center py-8"><span className="loading loading-spinner loading-sm" /></div>;
  if (error) return <div className="text-xs text-error py-4">{error}</div>;
  if (roots.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <span className="text-2xl">🗺️</span>
        <p className="text-sm text-base-content/50">Sin topología cargada</p>
        <p className="text-xs text-base-content/30">Agregá dispositivos NMS para ver el mapa</p>
      </div>
    );
  }

  // Build layout
  const nodes = layoutTree(roots, incidents);
  const maxY = nodes.reduce((m, n) => Math.max(m, n.y + n.h), 0) + 20;
  const svgH = Math.max(300, maxY);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold">Mapa de red</h3>
          <p className="text-xs text-base-content/40">{roots.length} raíz(es) · {nodes.length} dispositivo(s)</p>
        </div>
        <div className="flex items-center gap-2 text-[9px] text-base-content/40">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-error" /> Incidente</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warning" /> Warning</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-base-300" /> OK</span>
        </div>
      </div>

      <div className="relative overflow-x-auto rounded-xl border border-base-200 bg-base-100">
        <div style={{ width: 700, height: svgH, position: 'relative' }}>
          <Connections nodes={nodes} />
          {nodes.map(n => <NodeBox key={`${n.kind}-${n.id}`} node={n} />)}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-[9px] text-base-content/50">
        {Object.entries(KIND_META).map(([kind, meta]) => (
          <div key={kind} className="flex items-center gap-1.5">
            <div className="h-4 w-6 rounded border-2 text-center font-mono font-black text-[7px]" style={{ borderColor: meta.color, color: meta.color, fontSize: '7px', lineHeight: '14px' }}>
              {meta.icon}
            </div>
            <span>{kind}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
