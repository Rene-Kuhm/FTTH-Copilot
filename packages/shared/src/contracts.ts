/**
 * Cross-service contracts for the AIOps pipeline (see docs/aiops-roadmap.md).
 *
 * These are the stable JSON boundaries between the three stages:
 *   ingesta (telemetry.v1) → filtrado (finding.v1) → cognitiva (action.v1).
 *
 * They are language-agnostic by design: a Go collector or a Rust correlator can
 * emit/consume the exact same JSON and validate it against these zod schemas.
 * The version literal is part of the schema, so a producer can never silently
 * emit a shape the consumer does not understand.
 */
import { z } from 'zod';

// ── Version markers ──────────────────────────────────────────────────────────

export const TELEMETRY_SCHEMA = 'ftth.telemetry.v1' as const;
export const FINDING_SCHEMA = 'ftth.finding.v1' as const;
export const ACTION_SCHEMA = 'ftth.action.v1' as const;

// ── telemetry.v1 (salida de ingesta) ─────────────────────────────────────────

export const telemetrySourceSchema = z.enum(['poll', 'syslog', 'snmp-trap', 'gnmi']);

/**
 * A normalized device sample. `metrics` is deliberately open (passthrough) so a
 * new counter (e.g. a future optical metric) can be added without a breaking
 * version bump, while the fields we already reason about stay validated.
 */
export const telemetryEventSchema = z.object({
  schema: z.literal(TELEMETRY_SCHEMA),
  tenantId: z.string().min(1),
  deviceKind: z.enum(['OLT', 'ONU']),
  deviceId: z.string().min(1),
  source: telemetrySourceSchema,
  ts: z.string().datetime(),
  metrics: z
    .object({
      rx_power_dbm: z.number().optional(),
      tx_power_dbm: z.number().optional(),
      temperature_celsius: z.number().optional(),
      fec_corrected: z.number().int().nonnegative().optional(),
      fec_uncorrected: z.number().int().nonnegative().optional(),
      bias_current_ma: z.number().optional(),
    })
    .passthrough(),
  tags: z.record(z.string(), z.string()).optional(),
});

export type TelemetryEvent = z.infer<typeof telemetryEventSchema>;

// ── finding.v1 (salida de filtrado → entrada cognitiva) ──────────────────────

/**
 * External (snake_case) finding vocabulary. It maps 1:1 onto the internal
 * `FindingKind` in `@ftth-copilot/detection` (e.g. signal_drift ↔
 * predicted_low_signal); the mapping lives at the adapter boundary, not here.
 */
export const findingKindSchema = z.enum([
  'signal_drift',
  'fec_degradation',
  'optical_degradation',
  'temperature_drift',
  'intermittent_connection',
  'frequent_reboots',
  'traffic_anomaly',
  'metric_anomaly',
]);

export const findingSchema = z.object({
  schema: z.literal(FINDING_SCHEMA),
  kind: findingKindSchema,
  severity: z.enum(['warning', 'critical']),
  deviceKind: z.enum(['OLT', 'ONU']),
  deviceId: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
  etaMs: z.number().int().nonnegative().optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  context: z
    .object({
      tenantId: z.string().min(1),
      oltId: z.string().optional(),
      customer: z.string().optional(),
    })
    .passthrough(),
});

export type Finding = z.infer<typeof findingSchema>;

// ── action.v1 (salida de la capa cognitiva) ──────────────────────────────────

export const actionTypeSchema = z.enum(['pre_alert', 'ticket', 'workflow', 'notify']);

export const actionSchema = z.object({
  schema: z.literal(ACTION_SCHEMA),
  type: actionTypeSchema,
  incidentId: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
  targets: z
    .object({
      webhook: z.boolean().optional(),
      telegram: z.boolean().optional(),
      ticketing: z.boolean().optional(),
    })
    .passthrough(),
});

export type Action = z.infer<typeof actionSchema>;
