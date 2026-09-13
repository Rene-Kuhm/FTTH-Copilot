'use client';

/**
 * IncidentsCanvas — Canvas-grid surface for the incident list.
 *
 * Background:
 *
 * Roadmap enhancement (canvas-foundation, PR #169): the
 * CanvasGrid primitive lets consumers declare importance-aware
 * panels that the operator can drag/resize with persistence.
 *
 * This component is the FIRST consumer: it renders the operator's
 * incident list as a CanvasGrid. Each incident is a panel; severity
 * drives the importance (critical = 5, warning = 3, resolved = 1).
 * The operator can reorganize; the layout memory remembers.
 *
 * The component is additive: it does NOT replace IncidentsPanel.
 * Production switches over in a separate, follow-up PR that flips
 * the default once the new surface has been validated.
 *
 * The component is also a thin wrapper around CanvasGrid; the only
 * domain logic here is the importance mapping + the per-incident
 * panel content (severity badge + title + alert count).
 */

import { CanvasGrid, type PanelDescriptor } from './canvas';
import { ServerStackIcon } from './icons';

export interface CanvasIncident {
  id: string;
  deviceKind: string;
  deviceId: string;
  title: string;
  description: string;
  severity: 'warning' | 'critical';
  status: 'open' | 'acknowledged' | 'resolved';
  firstSeenAt: string;
  lastSeenAt: string;
  alertCount: number;
}

/**
 * Map an incident's severity to a CanvasGrid importance score
 * (1..5). Critical incidents get the highest weight so they anchor
 * in the top-left of the layout.
 */
export function incidentImportance(
  incident: Pick<CanvasIncident, 'severity' | 'status'>,
): 1 | 2 | 3 | 4 | 5 {
  if (incident.severity === 'critical' && incident.status === 'open') return 5;
  if (incident.severity === 'critical') return 4;
  if (incident.severity === 'warning' && incident.status === 'open') return 3;
  if (incident.severity === 'warning') return 2;
  return 1; // resolved
}

export interface IncidentsCanvasProps {
  incidents: ReadonlyArray<CanvasIncident>;
  storageScope: string;
  /** Optional render override for the panel body. */
  renderPanel?: (incident: CanvasIncident) => React.ReactNode;
  /** Read-only mode (drag/resize disabled). Default false. */
  readOnly?: boolean;
}

const SEVERITY_BG: Record<CanvasIncident['severity'], string> = {
  warning: 'rgba(234, 179, 8, 0.15)',
  critical: 'rgba(220, 38, 38, 0.18)',
};

const STATUS_LABEL: Record<CanvasIncident['status'], string> = {
  open: 'Abierto',
  acknowledged: 'Reconocido',
  resolved: 'Resuelto',
};

export function IncidentsCanvas(props: IncidentsCanvasProps): React.ReactElement {
  const panels: PanelDescriptor[] = props.incidents.map((incident) => {
    const importance = incidentImportance(incident);
    return {
      id: incident.id,
      importance,
      desiredW: incident.severity === 'critical' ? 6 : 4,
      desiredH: incident.severity === 'critical' ? 4 : 3,
      minW: 2,
      maxW: 12,
      minH: 2,
      title: incident.title,
      ariaLabel: `Incidente ${STATUS_LABEL[incident.status]} — ${incident.deviceKind} ${incident.deviceId}`,
      content: props.renderPanel ? (
        props.renderPanel(incident)
      ) : (
        <DefaultIncidentPanel incident={incident} />
      ),
    };
  });

  return (
    <CanvasGrid
      panels={panels}
      storageScope={props.storageScope}
      mode={props.readOnly ? 'readonly' : 'editable'}
    />
  );
}

function DefaultIncidentPanel({
  incident,
}: {
  incident: CanvasIncident;
}): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '4px 2px',
        height: '100%',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        <ServerStackIcon />
        <span style={{ color: SEVERITY_BG[incident.severity] ? 'var(--fg)' : 'inherit' }}>
          {incident.deviceKind} · {incident.deviceId}
        </span>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--fg)' }}>
        {incident.description}
      </p>
      <div
        style={{
          marginTop: 'auto',
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          opacity: 0.8,
        }}
      >
        <span>{STATUS_LABEL[incident.status]}</span>
        <span>{incident.alertCount} alertas</span>
      </div>
    </div>
  );
}
