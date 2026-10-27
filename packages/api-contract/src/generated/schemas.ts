import { z } from 'zod';
import type { TopologyNode } from './types';

/**
 * Esquemas Zod de la API HTTP — GENERADOS. No editar a mano.
 *
 * Fuente: `docs/contract/openapi.yaml`. Regenerar con
 * `pnpm contract:generate` (o `mise run contract:generate`).
 *
 * Estos esquemas son la validación de entrada que declara el
 * contrato: un body que no valida, no es un body válido.
 */

/** Error del handler. La forma no es uniforme en todo el repo. */
export const ErrorSchema = z.object({
  error: z.string(),
}).passthrough();

/** Error con detalle del origen. */
export const ErrorDetailSchema = z.object({
  error: z.string(),
  detail: z.string().optional(),
}).passthrough();

/** Cuota excedida. */
export const RateLimitedErrorSchema = z.object({
  error: z.string(),
  retryAfter: z.number().optional(),
}).passthrough();

/** Conflicto con un recurso existente. */
export const ConflictErrorSchema = z.object({
  error: z.string(),
  existingId: z.string().optional(),
}).passthrough();

/** La ventana se solapa con otra existente. */
export const MaintenanceOverlapErrorSchema = z.object({
  error: z.enum(["overlap"]),
  overlappingWindowId: z.string().optional(),
}).passthrough();

/** El recurso ya está en estado terminal. */
export const AlreadyTerminalErrorSchema = z.object({
  error: z.enum(["already_terminal"]),
  currentStatus: z.string().optional(),
}).passthrough();

/** La feature está deshabilitada por configuración. */
export const FeatureDisabledErrorSchema = z.object({
  error: z.enum(["disabled"]),
  feature: z.string(),
}).passthrough();

/** El canal guardado tiene valores no reconocidos. */
export const MisconfiguredChannelErrorSchema = z.object({
  error: z.string(),
  stored: z.object({
}).passthrough().optional(),
}).passthrough();

/** Esquema del contrato. */
export const OkResponseSchema = z.object({
  ok: z.literal(true),
}).passthrough();

/** Rol del usuario. `MEMBER` es el alias histórico de `OPERATOR`. */
export const RoleSchema = z.enum(["OWNER", "ADMIN", "OPERATOR", "MEMBER"]);

/** Esquema del contrato. */
export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: RoleSchema,
}).passthrough();

/** Esquema del contrato. */
export const TenantSchema = z.object({
  id: z.string(),
  name: z.string(),
}).passthrough();

/** Usuario con el contexto de su sesión. */
export const SessionUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  role: RoleSchema,
  tenantId: z.string(),
  mfaEnabled: z.boolean().optional(),
  tenant: TenantSchema.optional(),
}).passthrough();

/** `user: null` cuando no hay sesión válida: es una respuesta normal, no un error. */
export const CurrentUserResponseSchema = z.object({
  user: z.union([SessionUserSchema, z.null()]),
}).passthrough();

/** Esquema del contrato. */
export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
}).passthrough();

/** Esquema del contrato. */
export const LoginResponseSchema = z.object({
  user: UserSchema,
}).passthrough();

/** El usuario tiene MFA activo: falta el segundo factor. */
export const MfaRequiredResponseSchema = z.object({
  mfaRequired: z.literal(true),
  tempToken: z.string(),
}).passthrough();

/** Esquema del contrato. */
export const SignupRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).max(120).nullable().optional(),
  tenantName: z.string().min(1).nullable().optional(),
}).passthrough();

/** Esquema del contrato. */
export const SignupResponseSchema = z.object({
  user: UserSchema,
  tenant: TenantSchema,
}).passthrough();

/** Esquema del contrato. */
export const MfaSetupResponseSchema = z.object({
  secret: z.string(),
  otpauthUri: z.string().url(),
  issuer: z.string(),
  account: z.string(),
  format: z.literal("base32"),
  digits: z.literal(6),
  period: z.literal(30),
}).passthrough();

/** Esquema del contrato. */
export const MfaEnabledResponseSchema = z.object({
  mfaEnabled: z.boolean(),
}).passthrough();

/** Esquema del contrato. */
export const TotpRequestSchema = z.object({
  code: z.string().min(1).max(16),
}).passthrough();

/** Acepta tres formas: `{email,password,code}`, `{code}` o `{tempToken,code}`. */
export const MfaVerifyRequestSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().optional(),
  code: z.string().min(1),
  tempToken: z.string().optional(),
}).passthrough();

/** Esquema del contrato. */
export const HealthReportSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  timestamp: z.string().datetime(),
  uptime: z.number(),
  memory: z.object({
  rss: z.number(),
  heapUsed: z.number(),
}).passthrough(),
  version: z.string(),
  database: z.object({
}).passthrough().optional(),
  services: z.object({
}).passthrough().optional(),
  hungLoops: z.array(z.object({
}).passthrough()).optional(),
  connections: z.object({
}).passthrough().optional(),
  ingest: z.object({
}).passthrough().optional(),
}).passthrough();

/** Esquema del contrato. */
export const ChatRequestSchema = z.object({
  message: z.string().min(1).max(8000),
  conversationId: z.string().min(1).nullable().optional(),
  connectionId: z.string().min(1).nullable().optional(),
}).passthrough();

/** Esquema del contrato. */
export const ChatResponseSchema = z.object({
  reply: z.string(),
  toolsUsed: z.array(z.string()),
  conversationId: z.string(),
  dataSource: z.string(),
  abstention: z.object({
}).passthrough().optional(),
}).passthrough();

/** Esquema del contrato. */
export const ConversationSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  messageCount: z.number().int(),
}).passthrough();

/** Esquema del contrato. */
export const ConversationListSchema = z.object({
  conversations: z.array(ConversationSummarySchema),
}).passthrough();

/** Esquema del contrato. */
export const ConversationMessageSchema = z.object({
  id: z.string(),
  role: z.string(),
  content: z.string(),
  toolCalls: z.array(z.object({
}).passthrough()).optional(),
  createdAt: z.string().datetime(),
}).passthrough();

/** Esquema del contrato. */
export const ConversationDetailSchema = z.object({
  conversation: z.object({
  id: z.string(),
  title: z.string(),
  connectionId: z.string().nullable().optional(),
  messages: z.array(ConversationMessageSchema),
}).passthrough(),
}).passthrough();

/** Esquema del contrato. */
export const ProviderSchema = z.enum(["SMARTOLT", "MIKROWISP", "NETSENSE", "MIKROTIK"]);

/** Nunca incluye la API key: el endpoint la redacta siempre. */
export const ConnectorSchema = z.object({
  id: z.string(),
  provider: ProviderSchema,
  label: z.string(),
  baseUrl: z.string().url(),
  createdAt: z.string().datetime().optional(),
}).passthrough();

/** Esquema del contrato. */
export const ConnectorListSchema = z.object({
  user: UserSchema.optional(),
  connectors: z.array(ConnectorSchema),
  demoMode: z.boolean(),
}).passthrough();

/** Esquema del contrato. */
export const CreateConnectorRequestSchema = z.object({
  provider: ProviderSchema,
  label: z.string().min(1).max(80),
  apiKey: z.string().min(1).max(500),
  baseUrl: z.string().url(),
}).passthrough();

/** Esquema del contrato. */
export const ConnectorTestResponseSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().optional(),
  error: z.string().optional(),
}).passthrough();

/** Origen de los datos de la respuesta. */
export const DataSourceSchema = z.enum(["live", "demo", "empty", "cached"]);

/** Esquema del contrato. */
export const DashboardResponseSchema = z.object({
  dataSource: DataSourceSchema,
  overview: z.object({
}).passthrough().optional(),
  olts: z.array(z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  onusTotal: z.number().int(),
  onusOnline: z.number().int(),
  onusOffline: z.number().int(),
  onusDegraded: z.number().int(),
}).passthrough()),
  statusDistribution: z.object({
}).passthrough(),
}).passthrough();

/** Esquema del contrato. */
export const AlertSchema = z.object({
  id: z.string(),
  deviceKind: z.string(),
  deviceId: z.string(),
  kind: z.string().optional(),
  severity: z.string(),
  status: z.string(),
  detectedAt: z.string().datetime().optional(),
}).passthrough();

/** Esquema del contrato. */
export const AlertsResponseSchema = z.object({
  alerts: z.array(AlertSchema),
  count: z.number().int(),
  dataSource: DataSourceSchema,
}).passthrough();

/** Esquema del contrato. */
export const SlaEntrySchema = z.object({
  connectionId: z.string(),
  deviceKind: z.string(),
  deviceId: z.string(),
  uptimePercent: z.number().nullable().optional(),
  coveragePercent: z.number().nullable().optional(),
  measuredMs: z.number(),
  unmeasuredMs: z.number(),
  offlineMs: z.number(),
}).passthrough();

/** Esquema del contrato. */
export const SlaResponseSchema = z.object({
  windowDays: z.number().int(),
  sla: z.array(SlaEntrySchema),
  count: z.number().int(),
}).passthrough();

/** Esquema del contrato. */
export const AuditRowSchema = z.object({
  id: z.string(),
  category: z.string(),
  actorId: z.string().nullable().optional(),
  resourceType: z.string().optional(),
  outcome: z.string(),
  createdAt: z.string().datetime(),
}).passthrough();

/** Esquema del contrato. */
export const AuditPaginationSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  pages: z.number().int(),
}).passthrough();

/** Esquema del contrato. */
export const AuditResponseSchema = z.object({
  rows: z.array(AuditRowSchema),
  byDay: z.array(z.object({
}).passthrough()),
  pagination: AuditPaginationSchema,
  generatedAt: z.string().datetime(),
}).passthrough();

/** Esquema del contrato. */
export const SecurityAccessEventSchema = z.object({
  id: z.string(),
  category: z.enum(["access", "auth_failure"]),
  sourceIp: z.string().optional(),
  userId: z.string().nullable().optional(),
  occurredAt: z.string().datetime(),
}).passthrough();

/** Esquema del contrato. */
export const SecurityAccessResponseSchema = z.object({
  events: z.array(SecurityAccessEventSchema),
  count: z.number().int(),
}).passthrough();

/** Esquema del contrato. */
export const TopologyKindSchema = z.enum(["OLT", "ONU", "CTO", "SPLITTER", "PON_PORT"]);

/** Esquema del contrato. */
export const TopologyNodeSchema: z.ZodType<TopologyNode> = z.object({
  kind: z.string(),
  id: z.string(),
  children: z.array(z.lazy(() => TopologyNodeSchema)).optional(),
  downstreamCount: z.number().int(),
}).passthrough();

/** Esquema del contrato. */
export const TopologyTreeResponseSchema = z.object({
  roots: z.array(TopologyNodeSchema),
  nodeCount: z.number().int(),
  count: z.number().int(),
}).passthrough();

/** Esquema del contrato. */
export const TopologyPathResponseSchema = z.object({
  schema: z.literal("ftth.topology.v1"),
  kind: z.string(),
  id: z.string(),
  path: z.array(z.object({
  kind: z.string(),
  id: z.string(),
}).passthrough()),
}).passthrough();

/** Esquema del contrato. */
export const TopologyDownstreamResponseSchema = z.object({
  schema: z.literal("ftth.topology.v1"),
  kind: z.string(),
  id: z.string(),
  onuIds: z.array(z.string()),
  edgesTraversed: z.number().int(),
}).passthrough();

/** Esquema del contrato. */
export const DeviceKindSchema = z.enum(["OLT", "ONU"]);

/** Esquema del contrato. */
export const IncidentStatusSchema = z.enum(["open", "acknowledged", "resolved"]);

/** Esquema del contrato. */
export const IncidentSeveritySchema = z.enum(["warning", "critical"]);

/** Esquema del contrato. */
export const IncidentSchema = z.object({
  id: z.string(),
  deviceKind: DeviceKindSchema,
  deviceId: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  severity: IncidentSeveritySchema,
  status: IncidentStatusSchema,
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
}).passthrough();

/** Esquema del contrato. */
export const IncidentListSchema = z.object({
  incidents: z.array(IncidentSchema),
  count: z.number().int(),
  page: z.object({
  scope: z.string(),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable().optional(),
}).passthrough(),
}).passthrough();

/** Esquema del contrato. */
export const IncidentDetailSchema = z.object({
  incident: IncidentSchema,
  relatedMaintenance: z.array(z.lazy(() => MaintenanceWindowSchema)),
}).passthrough();

/** Esquema del contrato. */
export const CreateIncidentRequestSchema = z.object({
  deviceKind: DeviceKindSchema,
  deviceId: z.string().min(1),
  title: z.string().min(1).max(256),
  description: z.string().max(4096).nullable().optional(),
  severity: IncidentSeveritySchema.default("warning"),
}).passthrough();

/** Esquema del contrato. */
export const UpdateIncidentRequestSchema = z.object({
  status: IncidentStatusSchema.optional(),
  severity: IncidentSeveritySchema.optional(),
  title: z.string().min(1).max(256).optional(),
  description: z.string().max(4096).nullable().optional(),
}).passthrough();

/** Esquema del contrato. */
export const ConfirmIncidentRequestSchema = z.object({
  rootCause: z.string().min(1),
  fix: z.string().min(1),
  summary: z.string().min(1),
  investigationFeedbackId: z.string().min(1).max(128).nullable().optional(),
}).passthrough();

/** Esquema del contrato. */
export const InvestigationStatusSchema = z.object({
  runId: z.string(),
  status: z.string(),
  requestedAt: z.string().datetime(),
  version: z.union([z.object({
  versionId: z.string(),
  versionIndex: z.number().int(),
  rulesetVersion: z.string(),
  modelVersion: z.string(),
  snapshotAt: z.string().datetime(),
  snapshot: z.object({
}).passthrough(),
}).passthrough(), z.null()]).optional(),
}).passthrough();

/** Esquema del contrato. */
export const InvestigationPendingResponseSchema = z.object({
  runId: z.string(),
  status: z.literal("pending"),
  retryAfterMs: z.literal(3000),
}).passthrough();

/** Esquema del contrato. */
export const InvestigationResultResponseSchema = z.object({
  runId: z.string(),
  versionId: z.string(),
  versionIndex: z.number().int(),
  status: z.literal("ready"),
  result: z.object({
}).passthrough(),
}).passthrough();

/** Esquema del contrato. */
export const InvestigateRequestSchema = z.object({
  refresh: z.boolean().optional(),
  timeoutMs: z.number().int().min(1).max(15000).optional(),
  windowDays: z.number().int().min(1).optional(),
}).passthrough();

/** Esquema del contrato. */
export const FeedbackLabelSchema = z.enum(["confirmed", "incorrect", "insufficient_data"]);

/** Esquema del contrato. */
export const FeedbackRequestSchema = z.object({
  label: FeedbackLabelSchema,
  observations: z.string().max(8192).nullable().optional(),
  realCause: z.string().max(8192).nullable().optional(),
  resolutionEvidence: z.string().max(8192).nullable().optional(),
  feedbackId: z.string().nullable().optional(),
}).passthrough();

/** Esquema del contrato. */
export const FeedbackListSchema = z.object({
  runId: z.string(),
  status: z.string(),
  requestedAt: z.string().datetime(),
  feedbacks: z.array(z.object({
}).passthrough()),
  count: z.number().int(),
  limit: z.number().int(),
}).passthrough();

/** Esquema del contrato. */
export const PredictionSchema = z.object({
  id: z.string(),
  deviceKind: z.string(),
  deviceId: z.string(),
  kind: z.string().optional(),
  severity: z.string(),
  status: z.string(),
  predictedAt: z.string().datetime().optional(),
}).passthrough();

/** Esquema del contrato. */
export const PredictionListSchema = z.object({
  predictions: z.array(PredictionSchema),
  count: z.number().int(),
  page: z.object({
  scope: z.string(),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable().optional(),
}).passthrough(),
}).passthrough();

/** Esquema del contrato. */
export const MarkerDeviceKindSchema = z.enum(["OLT", "PON_PORT", "SPLITTER", "CTO", "ONU"]);

/** Esquema del contrato. */
export const FiberPlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  connectionId: z.string().nullable().optional(),
  fileUrl: z.string().nullable().optional(),
  zoneCount: z.number().int(),
  createdAt: z.string().datetime().optional(),
}).passthrough();

/** Esquema del contrato. */
export const FiberPlanListSchema = z.object({
  plans: z.array(FiberPlanSchema),
}).passthrough();

/** Esquema del contrato. */
export const FiberZoneSchema = z.object({
  id: z.string(),
  planId: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  color: z.string().regex(new RegExp("^#[0-9A-Fa-f]{6}$")).nullable().optional(),
}).passthrough();

/** Esquema del contrato. */
export const FiberMarkerSchema = z.object({
  id: z.string(),
  planId: z.string(),
  zoneId: z.string().nullable().optional(),
  label: z.string(),
  deviceKind: MarkerDeviceKindSchema.optional(),
  deviceId: z.string().nullable().optional(),
  xPercent: z.number().min(0).max(100),
  yPercent: z.number().min(0).max(100),
}).passthrough();

/** Esquema del contrato. */
export const FiberPlanDetailSchema = z.object({
  plan: FiberPlanSchema,
  zones: z.array(FiberZoneSchema),
  markers: z.array(FiberMarkerSchema),
}).passthrough();

/** Esquema del contrato. */
export const FiberPlanCorrelationSchema = z.object({
  markers: z.array(FiberMarkerSchema),
  primaryZone: z.union([FiberZoneSchema, z.null()]).optional(),
}).passthrough();

/** Multipart: el archivo del plano y sus metadatos. */
export const CreateFiberPlanRequestSchema = z.object({
  name: z.string().min(1).max(255),
  file: z.string(),
  description: z.string().max(1000).nullable().optional(),
  connectionId: z.string().nullable().optional(),
}).passthrough();

/** Esquema del contrato. */
export const CreateFiberZoneRequestSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).nullable().optional(),
  color: z.string().regex(new RegExp("^#[0-9A-Fa-f]{6}$")).nullable().optional(),
}).passthrough();

/** Esquema del contrato. */
export const UpdateFiberZoneRequestSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).nullable().optional(),
  color: z.string().regex(new RegExp("^#[0-9A-Fa-f]{6}$")).nullable().optional(),
}).passthrough();

/** Esquema del contrato. */
export const CreateFiberMarkerRequestSchema = z.object({
  label: z.string().min(1).max(255),
  deviceKind: MarkerDeviceKindSchema.optional(),
  deviceId: z.string().max(255).nullable().optional(),
  xPercent: z.number().min(0).max(100),
  yPercent: z.number().min(0).max(100),
}).passthrough();

/** Todos los campos son opcionales. `zoneId` acepta `null` para dejar el marcador sin zona. */
export const UpdateFiberMarkerRequestSchema = z.object({
  label: z.string().min(1).max(255).optional(),
  deviceKind: MarkerDeviceKindSchema.optional(),
  deviceId: z.string().max(255).nullable().optional(),
  xPercent: z.number().min(0).max(100).optional(),
  yPercent: z.number().min(0).max(100).optional(),
  zoneId: z.string().nullable().optional(),
}).passthrough();

/** Esquema del contrato. */
export const MaintenanceScopeKindSchema = z.enum(["tenant", "connection", "device"]);

/** Esquema del contrato. */
export const MaintenanceScopeSchema = z.object({
  kind: MaintenanceScopeKindSchema,
  id: z.string().min(1).max(128).nullable().optional(),
}).passthrough();

/** Esquema del contrato. */
export const MaintenanceWindowSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  startUtc: z.string().datetime(),
  endUtc: z.string().datetime(),
  timezone: z.string(),
  scope: MaintenanceScopeSchema,
  status: z.string().optional(),
}).passthrough();

/** Esquema del contrato. */
export const CreateMaintenanceWindowRequestSchema = z.object({
  title: z.string().min(1).max(256),
  description: z.string().max(4096).nullable().optional(),
  startUtc: z.string().datetime(),
  endUtc: z.string().datetime(),
  timezone: z.string().min(1).max(64),
  scope: MaintenanceScopeSchema,
}).passthrough();

/** Esquema del contrato. */
export const CancelMaintenanceWindowRequestSchema = z.object({
  cancellationReason: z.string().min(1).max(4096),
}).passthrough();

/** Esquema del contrato. */
export const ReevaluateMaintenanceWindowRequestSchema = z.object({
  since: z.string().datetime().nullable().optional(),
}).passthrough();

/** Esquema del contrato. */
export const OncallEntrySchema = z.object({
  id: z.string(),
  userId: z.string(),
  role: z.enum(["primary", "backup", "escalation"]),
  startUtc: z.string().datetime(),
  endUtc: z.string().datetime(),
  notes: z.string().nullable().optional(),
}).passthrough();

/** Esquema del contrato. */
export const OncallScheduleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  rotationType: z.enum(["weekly", "daily", "custom"]),
  startOfWeek: z.number().int().optional(),
  primaryUserId: z.string().nullable().optional(),
  backupUserId: z.string().nullable().optional(),
  escalationUserId: z.string().nullable().optional(),
  handoffTime: z.string(),
  timezone: z.string(),
  currentEntry: z.union([OncallEntrySchema, z.null()]).optional(),
}).passthrough();

/** Cuerpo de guardia (`name`) o de entrada (`userId`, `startUtc`, `endUtc`). */
export const CreateOncallRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  rotationType: z.enum(["weekly", "daily", "custom"]),
  startOfWeek: z.number().int().min(1).max(7).default(1),
  primaryUserId: z.string().nullable().optional(),
  backupUserId: z.string().nullable().optional(),
  escalationUserId: z.string().nullable().optional(),
  handoffTime: z.string().regex(new RegExp("^\\d{2}:\\d{2}$")).default("09:00"),
  timezone: z.string().max(64).default("UTC"),
  userId: z.string().min(1).optional(),
  role: z.enum(["primary", "backup", "escalation"]),
  startUtc: z.string().datetime().optional(),
  endUtc: z.string().datetime().optional(),
  notes: z.string().max(500).nullable().optional(),
}).passthrough();

/** Esquema del contrato. */
export const NotificationTypeSchema = z.enum(["slack", "webhook", "email"]);

/** Esquema del contrato. */
export const NotificationSeveritySchema = z.enum(["info", "warning", "critical"]);

/** El target viene redactado: nunca expone el secreto. */
export const NotificationChannelSchema = z.object({
  id: z.string(),
  type: NotificationTypeSchema,
  target: z.string(),
  enabled: z.boolean(),
  minSeverity: NotificationSeveritySchema,
  labels: z.array(z.string()).optional(),
  cooldownSeconds: z.number().int().optional(),
}).passthrough();

/** Esquema del contrato. */
export const CreateNotificationChannelRequestSchema = z.object({
  type: NotificationTypeSchema,
  target: z.string().min(1).max(2000),
  enabled: z.boolean().default(true),
  minSeverity: NotificationSeveritySchema.default("warning"),
  labels: z.array(z.string().max(64)).max(16).default([]),
  cooldownSeconds: z.number().int().min(0).max(86400).default(300),
}).passthrough();

/** Todos los campos son opcionales. */
export const UpdateNotificationChannelRequestSchema = z.object({
  type: NotificationTypeSchema.optional(),
  target: z.string().min(1).max(2000).optional(),
  enabled: z.boolean().optional(),
  minSeverity: NotificationSeveritySchema.optional(),
  labels: z.array(z.string().max(64)).max(16).optional(),
  cooldownSeconds: z.number().int().min(0).max(86400).optional(),
}).passthrough();

/** Esquema del contrato. */
export const OpsEventsResponseSchema = z.object({
  timeline: z.array(z.object({
}).passthrough()),
  summary: z.object({
  total: z.number().int(),
  byKind: z.object({
}).passthrough(),
  lookbackHours: z.number().int(),
}).passthrough(),
}).passthrough();

/** Esquema del contrato. */
export const OpsSituationsResponseSchema = z.object({
  situations: z.array(z.object({
  confidence: z.number(),
  scoreSeverity: z.string(),
  anomalyCorroboration: z.object({
}).passthrough().optional(),
  topContributions: z.array(z.object({
}).passthrough()).optional(),
}).passthrough()),
  summary: z.object({
}).passthrough(),
}).passthrough();

/** Esquema del contrato. */
export const OpsAnomaliesResponseSchema = z.object({
  hours: z.number().int(),
  metricsScanned: z.number().int(),
  count: z.number().int(),
  reports: z.array(z.object({
  key: z.string(),
  expr: z.string(),
  points: z.number().int(),
  residualMad: z.number(),
  groups: z.array(z.object({
}).passthrough()),
}).passthrough()),
  generatedAt: z.string().datetime(),
}).passthrough();

/** Esquema del contrato. */
export const OpsCapacityResponseSchema = z.object({
  devices: z.array(z.object({
  deviceId: z.string(),
  metric: z.string(),
  current: z.number(),
  unit: z.string().optional(),
  threshold: z.number(),
  forecast: z.number().optional(),
  trend: z.string().optional(),
  confidence: z.number(),
  predictedOverloadAt: z.string().datetime().nullable().optional(),
}).passthrough()),
  summary: z.object({
}).passthrough(),
}).passthrough();

/** Esquema del contrato. */
export const OpsRunbooksResponseSchema = z.object({
  runbooks: z.array(z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  deviceKind: z.string().nullable().optional(),
  deviceId: z.string().nullable().optional(),
  alertKind: z.string().nullable().optional(),
  severity: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  stepCount: z.number().int(),
  useCount: z.number().int(),
  lastUsedAt: z.string().datetime().nullable().optional(),
}).passthrough()),
  relatedHistory: z.array(z.object({
}).passthrough()),
}).passthrough();

/** Esquema del contrato. */
export const CreateUserRequestSchema = z.object({
  email: z.string().max(254).email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(120).nullable().optional(),
  role: z.enum(["OWNER", "ADMIN", "OPERATOR"]),
}).passthrough();

/** Esquema del contrato. */
export const UpdateUserRequestSchema = z.object({
  role: z.enum(["OWNER", "ADMIN", "OPERATOR"]),
}).passthrough();
