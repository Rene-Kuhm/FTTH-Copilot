# Referencia del modelo de datos

Fuente única: `packages/db/prisma/schema.prisma` (1199 líneas). Es el **único** schema
Prisma del repo. Datasource `postgresql` con `url = env("DATABASE_URL")` (`:12-15`);
generator `prisma-client-js` con salida en `../src/generated/client` (`:5-10`).

## 1. Identidad y autenticación

### `Tenant` (`:156`) — raíz de todo
`id` (cuid), `name`, `slug` (**único**), `createdAt`, `updatedAt`. Es el padre de 31 modelos
con `onDelete: Cascade`.

### `User` (`:205`)
`email` (`@unique` global), `name?`, `passwordHash` (bcrypt), `role` (`Role`, default
`MEMBER`), `tenantId` → `Tenant`, `totpSecret?` (Base32, cifrado en reposo), `mfaEnabled`
(default `false`). Unique compuesto `[tenantId, email]`.

### `Session` (`:233`)
`tokenHash` (`@unique`, SHA-256 del JWT), `expiresAt`, `userAgent?`, `ipAddress?`,
`lastUsedAt`. **No tiene `tenantId`**: se alcanza por `userId`.

### `RateLimitBucket` (`:441`) y `AuthRateLimit` (`:459`)
- `RateLimitBucket`: contador por `(userId, scope, windowStart)`, único compuesto.
- `AuthRateLimit`: contador **sin FK a usuario ni tenant**, a propósito — el atacante todavía
  no está identificado (comentario `:454-458`). `key` es del tipo `login:email:<email>` o
  `login:ip:<ip>`.

### `TenantPolicy` (`:608`)
1:1 con `Tenant` (`tenantId` es la PK). Sobrescribe por tenant los knobs del módulo:
`retrievalLimit`, `retrievalSinceDays`, `truthGateMode`, `abstainOnCodes`,
`promotionMinAgeMs`. Precedencia: **tenant > env > default del módulo** (comentario
`:596-607`).

### `AuditLog` (`:1055`)
`category` (`AuditCategory`), `action`, `resourceType`, `resourceId`, `outcome`
(`AuditOutcome`), `metadata` (Json), `actorId` (o `"system"`), `actorEmail?`, `actorRole?`,
`ipAddress?`, `userAgent?`.

### `OnCallSchedule` (`:1103`) y `OnCallEntry` (`:1137`)
Rotación con `primaryUserId?`, `backupUserId?`, `escalationUserId?`, `handoffTime`
(default `09:00`), `timezone` (default `UTC`), `rotationType` (default `weekly`),
`startOfWeek` (1 = lunes). `OnCallEntry.userId` es **soft ref**, sin FK.

## 2. Inventario de red

### `NmsConnection` (`:249`)
`provider` (`NmsProvider`), `label`, `encryptedKey` (AES-256-GCM), `baseUrl?`,
`status` (`NmsConnectionStatus`), `lastCheckedAt?`, `lastError?`. Unique
`[tenantId, provider, label]`.

### `TopologyEdge` (`:631`)
Una fila por arista dirigida `parent → child` en la jerarquía `OLT → PON_PORT → SPLITTER →
CTO → ONU`, con validez temporal: `validFrom`, `validTo?` (expiración blanda), `source`.
**Sin FK** en `parentId`/`childId`: son identificadores externos del NMS. Índices en
`[tenantId, parentKind, parentId, validTo]` y `[tenantId, childKind, childId, validTo]`.

### `FiberPlan` (`:838`), `PlanZone` (`:861`), `PlanMarker` (`:879`)
Plano de fibra en imagen (`fileUrl`, `mimeType`, `widthPx`, `heightPx`, `fileSizeBytes`),
zonas con `color` (default `#6366F1`) y markers con posición en porcentaje
(`xPercent`, `yPercent`) y referencia opcional a un nodo de topología (`deviceKind`,
`deviceId`). `PlanMarker.zoneId` es nullable con `SetNull`.

### `GeoZone` (`:903`)
Zona geográfica con `latitude?`, `longitude?`, `color` (default `#3B82F6`), `severity`
(`normal|degraded|critical`).

## 3. Telemetría

### `MetricSample` (`:332`)
Un punto de serie temporal: `connectionId?`, `deviceKind` (`DeviceKind`), `deviceId`,
`kind` (`MetricKind`), `value?`, `valueText?`, `sampledAt`. Índice principal
`[tenantId, connectionId, deviceKind, deviceId, kind, sampledAt]`.

### `DeviceEvent` (`:412`)
Evento syslog crudo: `sourceIp?`, `facility?`, `severity?`, `category`
(`DeviceEventCategory`), `message` (Text), `occurredAt`, `deviceKind?`, `deviceId?`, y
`ingestId String? @unique` — id de deduplicación de reintentos del spool de ingesta.

### `SnmpEvidence` (`:1171`)
Evidencia SNMP cruda para forense: `evidenceId`, `fingerprint`, `senderIp`, `snmpVersion`,
`pduType`, `trapOid`, `sysUpTime?`, `eventTime?`, `receivedAt`, `expiresAt` (límite de
retención), `varbinds` (Json) e `identifyingVarsEncrypted?` (AES-256-GCM). Unique
`[tenantId, evidenceId]`.

## 4. Incidentes e investigaciones

### `Incident` (`:385`)
Agrupa alertas activas de un equipo. Unique `[tenantId, connectionId, deviceKind, deviceId]`
— **una unidad de trabajo por equipo**. `severity` (`AlertSeverity`), `status`
(`AlertStatus`), `firstSeenAt`, `lastSeenAt`, `resolvedAt?`.

### `DetectedAlert` (`:352`)
Alerta proactiva deduplicada. Unique
`[tenantId, connectionId, kind, deviceKind, deviceId]`: **una sola alerta activa por
problema por equipo**. `etaMs?`, `confidence?`, `lastNotifiedAt?`, `incidentId?` (SetNull).

### `ConfirmedIncident` (`:482`) — memoria inmutable
`summary`, `symptoms` (Json), `rootCause`, `fix`, `observedAt`, `resolvedAt`, `severity`,
`confirmedBy` (`ConfirmedBy`), `confirmedByUserId?` (SetNull), `searchTokens` (tokens BM25
precomputados), `embedding Bytes?` (pgvector diferido), `sourceIncidentId?` y
`investigationFeedbackId?` (**soft refs**, sin FK: borrar un feedback no debe borrar el
conocimiento). Unique `[tenantId, sourceIncidentId]`.

### `PendingIncidentCandidate` (`:529`)
Candidato escrito por el chat tras una corrida limpia; lo promueve un admin a
`ConfirmedIncident`. `status` (`PendingIncidentStatus`), `toolCallsJson`, `runSessionId?`.

### `InvestigationRun` (`:683`), `InvestigationVersion` (`:719`), `InvestigationFeedback` (`:746`)
- `InvestigationRun`: `runId` (id opaco de aplicación), `status`
  (`pending|ready|failed|expired`), `requestedAt`, `windowStart?`, `windowEnd?`,
  `requestedByUserId`, `incidentId?` (soft). Unique `[tenantId, runId]`. **No tiene relación
  Prisma con las versiones** (comentario `:707`): se consultan por el `runId` blando.
- `InvestigationVersion`: `versionId`, `versionIndex`, `rulesetVersion`, `promptVersion`,
  `modelVersion`, `snapshotJson`, `snapshotAt`. Uniques `[tenantId, runId, versionIndex]` y
  `[tenantId, versionId]`.
- `InvestigationFeedback`: `feedbackId`, `label`
  (`confirmed|incorrect|insufficient_data`), `observations?`, `realCause?`,
  `resolutionEvidence?`, `authorUserId`, `submittedAt`. Uniques
  `[tenantId, runId, versionId, authorUserId, label]` y `[tenantId, feedbackId]`.

### `MaintenanceWindow` (`:801`)
`title`, `description?`, `scopeJson` (Text), `startUtc`, `endUtc`, `timezone`, `status`
(default `scheduled`), `createdByUserId`, `cancelledAt?`, `cancelledByUserId?`,
`cancellationReason?`. Dos ventanas que se solapan del mismo tenant se rechazan (comentario
`:787`).

### `Conversation` (`:277`), `Message` (`:297`), `AgentActionLog` (`:313`), `VerdictLog` (`:664`)
- `Conversation`: `userId`, `title?`, `connectionId?` (SetNull).
- `Message`: `role` (`MessageRole`), `content` (Text), `toolCalls` (Json?),
  `toolName?`, `toolResultJson?`. **Sin `tenantId`**: se alcanza por `conversationId`.
- `AgentActionLog`: registro de cada tool call (`toolName`, `parameters` Json, `result` Json?,
  `durationMs`, `errorMessage?`). Todos los ids son soft refs.
- `VerdictLog`: una fila por veredicto de tool call (`code` `VerdictCode`, `severity`
  `VerdictSeverity`, `observedAt`, `injectionSuspicion`). Es la persistencia de la Fase F.

## 5. Alertas y operaciones

| Modelo | Línea | Clave |
|---|---|---|
| `DecisionEvaluation` | `:554` | Registro de decisión de Laya en shadow mode: `eventId`, `eventClass`, `severity`, `probableScope`, `suggestedRoute`, `requiresInvestigation`, `confidence` (Json), `latencyMs`, `actualRoute`, `operatorOutcome`, `shadow` (default `true`) |
| `Runbook` | `:923` | `title`, `content`, `deviceKind?`, `deviceId?`, `alertKind?`, `severity?`, `tags`, `stepCount`, `useCount`, `lastUsedAt` |
| `NotificationChannel` | `:948` | `type` (`slack\|webhook\|email`), `target` (**se redacta siempre**, comentario `:949`), `enabled`, `minSeverity` (`info\|warning\|critical`), `labels`, `cooldownSeconds` (default 300) |
| `NotificationDelivery` | `:973` | `dedupeKey`, `severity`, `title`, `ok`, `status?`, `error?` |
| `CorrelationWeight` | `:992` | Pesos logísticos por tenant (1:1 con `Tenant`), `weights` Json, `sampleCount` |
| `CorrelationOutcome` | `:1008` | `groupId`, `confirmed`, `windowStart`, `windowEnd`, `metricKey?`, `actor?` — dataset de aprendizaje |
| `ChangeEvent` | `:1026` | Timeline de cambios: `category` (`maintenance`, `config_change`, `firmware_upgrade`, `power_event`), `deviceKind?`, `deviceId?`, `severity`, `occurredAt`, `resolvedAt?`, `correlatedIncidentIds String[]` (soft), `actor?`, `metadata` |

## 6. Enums

| Enum | Línea | Valores |
|---|---|---|
| `Role` | `:17` | `OWNER`, `ADMIN`, `OPERATOR`, `MEMBER` |
| `NmsProvider` | `:24` | `SMARTOLT`, `MIKROWISP`, `NETSENSE`, `MIKROTIK` |
| `NmsConnectionStatus` | `:31` | `connected`, `error`, `pending` |
| `MessageRole` | `:37` | `user`, `assistant`, `tool` |
| `DeviceKind` | `:45` | `OLT`, `ONU` |
| `MetricKind` | `:50` | `RX_POWER_DBM`, `TX_POWER_DBM`, `TEMPERATURE_CELSIUS`, `UPTIME_SECONDS`, `STATUS`, `FEC_CORRECTED`, `FEC_UNCORRECTED`, `BIAS_CURRENT_MA`, `ONT_TEMPERATURE_CELSIUS`, `LOS_SECONDS_TOTAL`, `TRAFFIC_THROUGHPUT_MBPS` |
| `AlertKind` | `:65` | `predicted_low_signal`, `predicted_high_temperature`, `intermittent_connection`, `frequent_reboots`, `metric_anomaly`, `fec_degradation`, `optical_degradation`, `traffic_anomaly` |
| `AlertSeverity` | `:76` | `warning`, `critical` |
| `AlertStatus` | `:81` | `open`, `acknowledged`, `resolved` |
| `DeviceEventCategory` | `:88` | `auth_failure`, `access`, `config_change`, `other` |
| `ConfirmedBy` | `:100` | `operator`, `agent`, `system` |
| `TruthGateMode` | `:109` | `observe`, `strict` |
| `PendingIncidentStatus` | `:115` | `pending`, `promoted`, `rejected` |
| `TopologyNodeKind` | `:125` | `OLT`, `PON_PORT`, `SPLITTER`, `CTO`, `ONU` |
| `VerdictCode` | `:137` | `ok`, `low_confidence`, `stale`, `incomplete` |
| `VerdictSeverity` | `:149` | `ok`, `info`, `warning`, `critical` |
| `AuditCategory` | `:1081` | `AUTH`, `USER_MANAGEMENT`, `INCIDENT`, `MAINTENANCE`, `CONNECTOR`, `NETWORK`, `NOTIFICATION`, `CONFIGURATION`, `AI`, `SYSTEM` |
| `AuditOutcome` | `:1094` | `SUCCESS`, `FAILURE` |

Varios campos son `String` con el conjunto de valores documentado **sólo en el comentario**:
`InvestigationRun.status` (`:699`), `InvestigationFeedback.label` (`:766`),
`MaintenanceWindow.status` (`:814`), `NotificationChannel.type`/`minSeverity` (`:952`,
`:957`), `ChangeEvent.category`/`severity` (`:1031`), `GeoZone.severity` (`:912`),
`OnCallSchedule.rotationType` (`:1113`), `OnCallEntry.role` (`:1146`),
`DecisionEvaluation.eventClass`/`severity`/`probableScope`/`suggestedRoute` (`:570-573`).

## 7. Migraciones

27 directorios bajo `packages/db/prisma/migrations/`, más `migration_lock.toml`
(`provider = "postgresql"`).

```text
20260820054804_init
20260820223000_add_rate_limit_buckets
20260821060000_add_metric_samples
20260821070000_add_detected_alerts
20260821080000_add_incidents
20260821090000_add_device_events
20260830100000_add_auth_rate_limits
20260830110000_drop_nms_connection_encryption_meta
20260830120000_add_fec_optical_metric_kinds
20260830130000_add_fec_optical_alert_kinds
20260830140000_add_role_admin_operator
20260903195643_confirmed_incidents
20260903211301_tenant_policies
20260903220000_topology_edges
20260904002325_verdict_log
20260905000000_add_los_metric_kind
20260907140000_investigation_run_version_feedback
20260907141000_add_investigation_feedback_id_to_confirmed
20260910120000_maintenance_windows
20260912235000_drop_investigation_run_global_unique
20260914140000_add_mikrotik_nms_provider
20260926223334_add_fiber_plan
20260927_add_decision_evaluation
20261005120000_add_event_ingest_id
20261006120000_confirmed_incident_source_unique
20261006130000_align_migrations_with_schema
20261006150000_add_snmp_evidence
```

Aplicar en producción: `pnpm db:deploy` (usa `prisma migrate deploy`, no `dev`).

## 8. Aislamiento por tenant

El aislamiento es **estructural**, no aplicado por el schema:

- 31 modelos llevan `tenantId` → `Tenant.id` con `onDelete: Cascade`. Borrar el tenant borra
  todo lo suyo.
- 6 modelos se alcanzan transitivamente y no tienen `tenantId`: `Session`, `RateLimitBucket`
  (por `userId`), `Message` (por `conversationId`), `OnCallEntry` (por `scheduleId`),
  `AuthRateLimit` (sin FK, a propósito) y `Tenant` mismo.
- Los uniques compuestos incluyen `tenantId`, lo que evita colisiones entre tenants:
  `[tenantId, email]`, `[tenantId, provider, label]`,
  `[tenantId, connectionId, kind, deviceKind, deviceId]`,
  `[tenantId, connectionId, deviceKind, deviceId]`, `[tenantId, sourceIncidentId]`,
  `[tenantId, runId]`, `[tenantId, runId, versionIndex]`, `[tenantId, versionId]`,
  `[tenantId, runId, versionId, authorUserId, label]`, `[tenantId, feedbackId]`,
  `[tenantId, evidenceId]`.
- **Uniques globales** (no por tenant): `Tenant.slug`, `User.email`, `Session.tokenHash`,
  `DeviceEvent.ingestId`.
- Las FKs opcionales usan `SetNull`, nunca `Cascade`: las filas sobreviven al borrado del
  conector (`connectionId` en 8 modelos, `PlanMarker.zoneId`, `ConfirmedIncident.confirmedByUserId`).
- `deviceId` es un `String` sin FK en todos los modelos: la unicidad la garantiza el índice
  compuesto que incluye `tenantId`.
