/**
 * Tipos de la API HTTP — GENERADOS. No editar a mano.
 *
 * Fuente: `docs/contract/openapi.yaml`. Regenerar con
 * `pnpm contract:generate` (o `mise run contract:generate`).
 */

/** Error del handler. La forma no es uniforme en todo el repo. */
export type Error = {
  error: string;
  [key: string]: unknown;
};

/** Error con detalle del origen. */
export type ErrorDetail = {
  error: string;
  detail?: string;
  [key: string]: unknown;
};

/** Cuota excedida. */
export type RateLimitedError = {
  error: string;
  retryAfter?: number;
  [key: string]: unknown;
};

/** Conflicto con un recurso existente. */
export type ConflictError = {
  error: string;
  existingId?: string;
  [key: string]: unknown;
};

/** La ventana se solapa con otra existente. */
export type MaintenanceOverlapError = {
  error: "overlap";
  overlappingWindowId?: string;
  [key: string]: unknown;
};

/** El recurso ya está en estado terminal. */
export type AlreadyTerminalError = {
  error: "already_terminal";
  currentStatus?: string;
  [key: string]: unknown;
};

/** La feature está deshabilitada por configuración. */
export type FeatureDisabledError = {
  error: "disabled";
  feature: string;
  [key: string]: unknown;
};

/** El canal guardado tiene valores no reconocidos. */
export type MisconfiguredChannelError = {
  error: string;
  stored?: {
  [key: string]: unknown;
};
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type OkResponse = {
  ok: true;
  [key: string]: unknown;
};

/** Rol del usuario. `MEMBER` es el alias histórico de `OPERATOR`. */
export type Role = "OWNER" | "ADMIN" | "OPERATOR" | "MEMBER";

/** Esquema del contrato. */
export type User = {
  id: string;
  email: string;
  name: string;
  role: Role;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type Tenant = {
  id: string;
  name: string;
  [key: string]: unknown;
};

/** Usuario con el contexto de su sesión. */
export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  tenantId: string;
  mfaEnabled?: boolean;
  tenant?: Tenant;
  [key: string]: unknown;
};

/** `user: null` cuando no hay sesión válida: es una respuesta normal, no un error. */
export type CurrentUserResponse = {
  user: SessionUser | null;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type LoginRequest = {
  email: string;
  password: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type LoginResponse = {
  user: User;
  [key: string]: unknown;
};

/** El usuario tiene MFA activo: falta el segundo factor. */
export type MfaRequiredResponse = {
  mfaRequired: true;
  tempToken: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type SignupRequest = {
  email: string;
  password: string;
  name?: string;
  tenantName?: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type SignupResponse = {
  user: User;
  tenant: Tenant;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type MfaSetupResponse = {
  secret: string;
  otpauthUri: string;
  issuer: string;
  account: string;
  format: "base32";
  digits: 6;
  period: 30;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type MfaEnabledResponse = {
  mfaEnabled: boolean;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type TotpRequest = {
  code: string;
  [key: string]: unknown;
};

/** Acepta tres formas: `{email,password,code}`, `{code}` o `{tempToken,code}`. */
export type MfaVerifyRequest = {
  email?: string;
  password?: string;
  code: string;
  tempToken?: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type HealthReport = {
  status: "ok" | "degraded";
  timestamp: string;
  uptime: number;
  memory: {
  rss: number;
  heapUsed: number;
  [key: string]: unknown;
};
  version: string;
  database?: {
  [key: string]: unknown;
};
  services?: {
  [key: string]: unknown;
};
  hungLoops?: {
  [key: string]: unknown;
}[];
  connections?: {
  [key: string]: unknown;
};
  ingest?: {
  [key: string]: unknown;
};
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type ChatRequest = {
  message: string;
  conversationId?: string;
  connectionId?: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type ChatResponse = {
  reply: string;
  toolsUsed: string[];
  conversationId: string;
  dataSource: string;
  abstention?: {
  [key: string]: unknown;
};
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  messageCount: number;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type ConversationList = {
  conversations: ConversationSummary[];
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type ConversationMessage = {
  id: string;
  role: string;
  content: string;
  toolCalls?: {
  [key: string]: unknown;
}[];
  createdAt: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type ConversationDetail = {
  conversation: {
  id: string;
  title: string;
  connectionId?: string;
  messages: ConversationMessage[];
  [key: string]: unknown;
};
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type Provider = "SMARTOLT" | "MIKROWISP" | "NETSENSE" | "MIKROTIK";

/** Nunca incluye la API key: el endpoint la redacta siempre. */
export type Connector = {
  id: string;
  provider: Provider;
  label: string;
  baseUrl: string;
  createdAt?: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type ConnectorList = {
  user?: User;
  connectors: Connector[];
  demoMode: boolean;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type CreateConnectorRequest = {
  provider: Provider;
  label: string;
  apiKey: string;
  baseUrl: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type ConnectorTestResponse = {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  [key: string]: unknown;
};

/** Origen de los datos de la respuesta. */
export type DataSource = "live" | "demo" | "empty" | "cached";

/** Esquema del contrato. */
export type DashboardResponse = {
  dataSource: DataSource;
  overview?: {
  [key: string]: unknown;
};
  olts: {
  id?: string;
  name?: string;
  onusTotal: number;
  onusOnline: number;
  onusOffline: number;
  onusDegraded: number;
  [key: string]: unknown;
}[];
  statusDistribution: {
  [key: string]: unknown;
};
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type Alert = {
  id: string;
  deviceKind: string;
  deviceId: string;
  kind?: string;
  severity: string;
  status: string;
  detectedAt?: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type AlertsResponse = {
  alerts: Alert[];
  count: number;
  dataSource: DataSource;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type SlaEntry = {
  connectionId: string;
  deviceKind: string;
  deviceId: string;
  uptimePercent?: number;
  coveragePercent?: number;
  measuredMs: number;
  unmeasuredMs: number;
  offlineMs: number;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type SlaResponse = {
  windowDays: number;
  sla: SlaEntry[];
  count: number;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type AuditRow = {
  id: string;
  category: string;
  actorId?: string;
  resourceType?: string;
  outcome: string;
  createdAt: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type AuditPagination = {
  page: number;
  limit: number;
  total: number;
  pages: number;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type AuditResponse = {
  rows: AuditRow[];
  byDay: {
  [key: string]: unknown;
}[];
  pagination: AuditPagination;
  generatedAt: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type SecurityAccessEvent = {
  id: string;
  category: "access" | "auth_failure";
  sourceIp?: string;
  userId?: string;
  occurredAt: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type SecurityAccessResponse = {
  events: SecurityAccessEvent[];
  count: number;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type TopologyKind = "OLT" | "ONU" | "CTO" | "SPLITTER" | "PON_PORT";

/** Esquema del contrato. */
export type TopologyNode = {
  kind: string;
  id: string;
  children?: TopologyNode[];
  downstreamCount: number;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type TopologyTreeResponse = {
  roots: TopologyNode[];
  nodeCount: number;
  count: number;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type TopologyPathResponse = {
  schema: "ftth.topology.v1";
  kind: string;
  id: string;
  path: {
  kind: string;
  id: string;
  [key: string]: unknown;
}[];
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type TopologyDownstreamResponse = {
  schema: "ftth.topology.v1";
  kind: string;
  id: string;
  onuIds: string[];
  edgesTraversed: number;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type DeviceKind = "OLT" | "ONU";

/** Esquema del contrato. */
export type IncidentStatus = "open" | "acknowledged" | "resolved";

/** Esquema del contrato. */
export type IncidentSeverity = "warning" | "critical";

/** Esquema del contrato. */
export type Incident = {
  id: string;
  deviceKind: DeviceKind;
  deviceId: string;
  title: string;
  description?: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type IncidentList = {
  incidents: Incident[];
  count: number;
  page: {
  scope: string;
  hasMore: boolean;
  nextCursor?: string;
  [key: string]: unknown;
};
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type IncidentDetail = {
  incident: Incident;
  relatedMaintenance: MaintenanceWindow[];
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type CreateIncidentRequest = {
  deviceKind: DeviceKind;
  deviceId: string;
  title: string;
  description?: string;
  severity?: IncidentSeverity;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type UpdateIncidentRequest = {
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  title?: string;
  description?: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type ConfirmIncidentRequest = {
  rootCause: string;
  fix: string;
  summary: string;
  investigationFeedbackId?: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type InvestigationStatus = {
  runId: string;
  status: string;
  requestedAt: string;
  version?: {
  versionId: string;
  versionIndex: number;
  rulesetVersion: string;
  modelVersion: string;
  snapshotAt: string;
  snapshot: {
  [key: string]: unknown;
};
  [key: string]: unknown;
} | null;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type InvestigationPendingResponse = {
  runId: string;
  status: "pending";
  retryAfterMs: 3000;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type InvestigationResultResponse = {
  runId: string;
  versionId: string;
  versionIndex: number;
  status: "ready";
  result: {
  [key: string]: unknown;
};
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type InvestigateRequest = {
  refresh?: boolean;
  timeoutMs?: number;
  windowDays?: number;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type FeedbackLabel = "confirmed" | "incorrect" | "insufficient_data";

/** Esquema del contrato. */
export type FeedbackRequest = {
  label: FeedbackLabel;
  observations?: string;
  realCause?: string;
  resolutionEvidence?: string;
  feedbackId?: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type FeedbackList = {
  runId: string;
  status: string;
  requestedAt: string;
  feedbacks: {
  [key: string]: unknown;
}[];
  count: number;
  limit: number;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type Prediction = {
  id: string;
  deviceKind: string;
  deviceId: string;
  kind?: string;
  severity: string;
  status: string;
  predictedAt?: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type PredictionList = {
  predictions: Prediction[];
  count: number;
  page: {
  scope: string;
  hasMore: boolean;
  nextCursor?: string;
  [key: string]: unknown;
};
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type MarkerDeviceKind = "OLT" | "PON_PORT" | "SPLITTER" | "CTO" | "ONU";

/** Esquema del contrato. */
export type FiberPlan = {
  id: string;
  name: string;
  description?: string;
  connectionId?: string;
  fileUrl?: string;
  zoneCount: number;
  createdAt?: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type FiberPlanList = {
  plans: FiberPlan[];
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type FiberZone = {
  id: string;
  planId: string;
  name: string;
  description?: string;
  color?: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type FiberMarker = {
  id: string;
  planId: string;
  zoneId?: string;
  label: string;
  deviceKind?: MarkerDeviceKind;
  deviceId?: string;
  xPercent: number;
  yPercent: number;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type FiberPlanDetail = {
  plan: FiberPlan;
  zones: FiberZone[];
  markers: FiberMarker[];
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type FiberPlanCorrelation = {
  markers: FiberMarker[];
  primaryZone?: FiberZone | null;
  [key: string]: unknown;
};

/** Multipart: el archivo del plano y sus metadatos. */
export type CreateFiberPlanRequest = {
  name: string;
  file: string;
  description?: string;
  connectionId?: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type CreateFiberZoneRequest = {
  name: string;
  description?: string;
  color?: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type UpdateFiberZoneRequest = {
  name?: string;
  description?: string;
  color?: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type CreateFiberMarkerRequest = {
  label: string;
  deviceKind?: MarkerDeviceKind;
  deviceId?: string;
  xPercent: number;
  yPercent: number;
  [key: string]: unknown;
};

/** Todos los campos son opcionales. `zoneId` acepta `null` para dejar el marcador sin zona. */
export type UpdateFiberMarkerRequest = {
  label?: string;
  deviceKind?: MarkerDeviceKind;
  deviceId?: string;
  xPercent?: number;
  yPercent?: number;
  zoneId?: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type MaintenanceScopeKind = "tenant" | "connection" | "device";

/** Esquema del contrato. */
export type MaintenanceScope = {
  kind: MaintenanceScopeKind;
  id?: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type MaintenanceWindow = {
  id: string;
  title: string;
  description?: string;
  startUtc: string;
  endUtc: string;
  timezone: string;
  scope: MaintenanceScope;
  status?: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type CreateMaintenanceWindowRequest = {
  title: string;
  description?: string;
  startUtc: string;
  endUtc: string;
  timezone: string;
  scope: MaintenanceScope;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type CancelMaintenanceWindowRequest = {
  cancellationReason: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type ReevaluateMaintenanceWindowRequest = {
  since?: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type OncallEntry = {
  id: string;
  userId: string;
  role: "primary" | "backup" | "escalation";
  startUtc: string;
  endUtc: string;
  notes?: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type OncallSchedule = {
  id: string;
  name: string;
  description?: string;
  rotationType: "weekly" | "daily" | "custom";
  startOfWeek?: number;
  primaryUserId?: string;
  backupUserId?: string;
  escalationUserId?: string;
  handoffTime: string;
  timezone: string;
  currentEntry?: OncallEntry | null;
  [key: string]: unknown;
};

/** Cuerpo de guardia (`name`) o de entrada (`userId`, `startUtc`, `endUtc`). */
export type CreateOncallRequest = {
  name?: string;
  description?: string;
  rotationType?: "weekly" | "daily" | "custom";
  startOfWeek?: number;
  primaryUserId?: string;
  backupUserId?: string;
  escalationUserId?: string;
  handoffTime?: string;
  timezone?: string;
  userId?: string;
  role?: "primary" | "backup" | "escalation";
  startUtc?: string;
  endUtc?: string;
  notes?: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type NotificationType = "slack" | "webhook" | "email";

/** Esquema del contrato. */
export type NotificationSeverity = "info" | "warning" | "critical";

/** El target viene redactado: nunca expone el secreto. */
export type NotificationChannel = {
  id: string;
  type: NotificationType;
  target: string;
  enabled: boolean;
  minSeverity: NotificationSeverity;
  labels?: string[];
  cooldownSeconds?: number;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type CreateNotificationChannelRequest = {
  type: NotificationType;
  target: string;
  enabled?: boolean;
  minSeverity?: NotificationSeverity;
  labels?: string[];
  cooldownSeconds?: number;
  [key: string]: unknown;
};

/** Todos los campos son opcionales. */
export type UpdateNotificationChannelRequest = {
  type?: NotificationType;
  target?: string;
  enabled?: boolean;
  minSeverity?: NotificationSeverity;
  labels?: string[];
  cooldownSeconds?: number;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type OpsEventsResponse = {
  timeline: {
  [key: string]: unknown;
}[];
  summary: {
  total: number;
  byKind: {
  [key: string]: number;
};
  lookbackHours: number;
  [key: string]: unknown;
};
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type OpsSituationsResponse = {
  situations: {
  confidence: number;
  scoreSeverity: string;
  anomalyCorroboration?: {
  [key: string]: unknown;
};
  topContributions?: {
  [key: string]: unknown;
}[];
  [key: string]: unknown;
}[];
  summary: {
  [key: string]: unknown;
};
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type OpsAnomaliesResponse = {
  hours: number;
  metricsScanned: number;
  count: number;
  reports: {
  key: string;
  expr: string;
  points: number;
  residualMad: number;
  groups: {
  [key: string]: unknown;
}[];
  [key: string]: unknown;
}[];
  generatedAt: string;
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type OpsCapacityResponse = {
  devices: {
  deviceId: string;
  metric: string;
  current: number;
  unit?: string;
  threshold: number;
  forecast?: number;
  trend?: string;
  confidence: number;
  predictedOverloadAt?: string;
  [key: string]: unknown;
}[];
  summary: {
  [key: string]: unknown;
};
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type OpsRunbooksResponse = {
  runbooks: {
  id: string;
  title: string;
  content: string;
  deviceKind?: string;
  deviceId?: string;
  alertKind?: string;
  severity?: string;
  tags?: string[];
  stepCount: number;
  useCount: number;
  lastUsedAt?: string;
  [key: string]: unknown;
}[];
  relatedHistory: {
  [key: string]: unknown;
}[];
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type CreateUserRequest = {
  email: string;
  password: string;
  name?: string;
  role: "OWNER" | "ADMIN" | "OPERATOR";
  [key: string]: unknown;
};

/** Esquema del contrato. */
export type UpdateUserRequest = {
  role: "OWNER" | "ADMIN" | "OPERATOR";
  [key: string]: unknown;
};
