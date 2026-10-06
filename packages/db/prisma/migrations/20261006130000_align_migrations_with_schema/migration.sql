-- Bring the migration history in line with schema.prisma.
--
-- Generated with the real tool, against a database built purely from
-- prisma/migrations, diffed against schema.prisma:
--
--   prisma migrate diff --from-url <db> --to-schema-datamodel prisma/schema.prisma --script
--
-- CI never caught this because it built the schema with `prisma db push`, which
-- reads schema.prisma and never applies migrations. Production runs
-- `migrate deploy`, so a deploy would have produced a database missing the
-- audit log, runbooks, on-call schedules, notification channels, geo zones,
-- change events and correlation tables, plus the MFA columns the auth code
-- reads.
--
-- WARNING: the fiber_plans / plan_zones / plan_markers sections drop and re-add
-- columns rather than renaming them. On a database that already holds rows in
-- those tables the dropped values are lost. Apply with a backup.
-- CreateEnum
CREATE TYPE "AuditCategory" AS ENUM ('AUTH', 'USER_MANAGEMENT', 'INCIDENT', 'MAINTENANCE', 'CONNECTOR', 'NETWORK', 'NOTIFICATION', 'CONFIGURATION', 'AI', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE');

-- AlterEnum
ALTER TYPE "AlertKind" ADD VALUE 'traffic_anomaly';

-- AlterEnum
ALTER TYPE "MetricKind" ADD VALUE 'TRAFFIC_THROUGHPUT_MBPS';

-- DropForeignKey
ALTER TABLE "investigation_feedback" DROP CONSTRAINT "investigation_feedback_versionRefId_fkey";

-- DropForeignKey
ALTER TABLE "investigation_versions" DROP CONSTRAINT "investigation_versions_runRefId_fkey";

-- DropForeignKey
ALTER TABLE "maintenance_windows" DROP CONSTRAINT "maintenance_windows_tenantId_fkey";

-- DropIndex
DROP INDEX "fiber_plans_connection_id_idx";

-- DropIndex
DROP INDEX "fiber_plans_tenant_id_idx";

-- DropIndex
DROP INDEX "plan_markers_tenant_id_idx";

-- DropIndex
DROP INDEX "plan_zones_plan_id_idx";

-- DropIndex
DROP INDEX "plan_zones_tenant_id_idx";

-- AlterTable
ALTER TABLE "confirmed_incidents" ADD COLUMN     "severity" "AlertSeverity" NOT NULL;

-- AlterTable
ALTER TABLE "device_events" ADD COLUMN     "deviceId" TEXT,
ADD COLUMN     "deviceKind" TEXT;

-- AlterTable
ALTER TABLE "fiber_plans" DROP CONSTRAINT "fiber_plans_pkey",
DROP COLUMN "connection_id",
DROP COLUMN "tenant_id",
ADD COLUMN     "connectionId" TEXT,
ADD COLUMN     "tenantId" TEXT NOT NULL,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "name" SET DATA TYPE TEXT,
ALTER COLUMN "mime_type" SET DATA TYPE TEXT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3),
ADD CONSTRAINT "fiber_plans_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "plan_markers" DROP CONSTRAINT "plan_markers_pkey",
DROP COLUMN "tenant_id",
ADD COLUMN     "tenantId" TEXT NOT NULL,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "zone_id" SET DATA TYPE TEXT,
ALTER COLUMN "label" SET DATA TYPE TEXT,
ALTER COLUMN "device_kind" SET DATA TYPE TEXT,
ALTER COLUMN "device_id" SET DATA TYPE TEXT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ADD CONSTRAINT "plan_markers_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "plan_zones" DROP CONSTRAINT "plan_zones_pkey",
DROP COLUMN "plan_id",
DROP COLUMN "tenant_id",
ADD COLUMN     "planId" TEXT NOT NULL,
ADD COLUMN     "tenantId" TEXT NOT NULL,
ALTER COLUMN "id" SET DATA TYPE TEXT,
ALTER COLUMN "name" SET DATA TYPE TEXT,
ALTER COLUMN "color" SET DATA TYPE TEXT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ADD CONSTRAINT "plan_zones_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totp_secret" TEXT;

-- CreateTable
CREATE TABLE "geo_zones" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "color" TEXT NOT NULL DEFAULT '#3B82F6',
    "severity" TEXT NOT NULL DEFAULT 'normal',
    "deviceKind" TEXT,
    "deviceId" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geo_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runbooks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "deviceKind" TEXT,
    "deviceId" TEXT,
    "alertKind" TEXT,
    "severity" TEXT,
    "source_incident_id" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "step_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMP(3),
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "runbooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_channels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "min_severity" TEXT NOT NULL DEFAULT 'warning',
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cooldown_seconds" INTEGER NOT NULL DEFAULT 300,
    "last_sent_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "status" INTEGER,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correlation_weights" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "weights" JSONB NOT NULL DEFAULT '{}',
    "sample_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "correlation_weights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "correlation_outcomes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "confirmed" BOOLEAN NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "metric_key" TEXT,
    "actor" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "correlation_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "deviceKind" TEXT,
    "deviceId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "correlated_incident_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "actor" TEXT,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_email" TEXT,
    "actor_role" TEXT,
    "category" "AuditCategory" NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "outcome" "AuditOutcome" NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "on_call_schedules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rotationType" TEXT NOT NULL DEFAULT 'weekly',
    "start_of_week" INTEGER NOT NULL DEFAULT 1,
    "primary_user_id" TEXT,
    "backup_user_id" TEXT,
    "escalation_user_id" TEXT,
    "handoff_time" TEXT NOT NULL DEFAULT '09:00',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "on_call_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "on_call_entries" (
    "id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'primary',
    "start_utc" TIMESTAMP(3) NOT NULL,
    "end_utc" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "on_call_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "geo_zones_tenantId_idx" ON "geo_zones"("tenantId");

-- CreateIndex
CREATE INDEX "geo_zones_deviceKind_deviceId_idx" ON "geo_zones"("deviceKind", "deviceId");

-- CreateIndex
CREATE INDEX "runbooks_tenantId_idx" ON "runbooks"("tenantId");

-- CreateIndex
CREATE INDEX "runbooks_deviceKind_deviceId_idx" ON "runbooks"("deviceKind", "deviceId");

-- CreateIndex
CREATE INDEX "runbooks_alertKind_severity_idx" ON "runbooks"("alertKind", "severity");

-- CreateIndex
CREATE INDEX "notification_channels_tenant_id_enabled_idx" ON "notification_channels"("tenant_id", "enabled");

-- CreateIndex
CREATE INDEX "notification_deliveries_tenant_id_created_at_idx" ON "notification_deliveries"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_deliveries_dedupe_key_channel_id_idx" ON "notification_deliveries"("dedupe_key", "channel_id");

-- CreateIndex
CREATE UNIQUE INDEX "correlation_weights_tenant_id_key" ON "correlation_weights"("tenant_id");

-- CreateIndex
CREATE INDEX "correlation_outcomes_tenant_id_window_start_idx" ON "correlation_outcomes"("tenant_id", "window_start");

-- CreateIndex
CREATE INDEX "correlation_outcomes_tenant_id_group_id_idx" ON "correlation_outcomes"("tenant_id", "group_id");

-- CreateIndex
CREATE INDEX "change_events_tenantId_idx" ON "change_events"("tenantId");

-- CreateIndex
CREATE INDEX "change_events_occurred_at_idx" ON "change_events"("occurred_at");

-- CreateIndex
CREATE INDEX "change_events_deviceKind_deviceId_idx" ON "change_events"("deviceKind", "deviceId");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_category_idx" ON "audit_logs"("tenant_id", "category");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "on_call_schedules_tenant_id_idx" ON "on_call_schedules"("tenant_id");

-- CreateIndex
CREATE INDEX "on_call_schedules_tenant_id_enabled_idx" ON "on_call_schedules"("tenant_id", "enabled");

-- CreateIndex
CREATE INDEX "on_call_entries_schedule_id_start_utc_idx" ON "on_call_entries"("schedule_id", "start_utc");

-- CreateIndex
CREATE INDEX "on_call_entries_user_id_start_utc_idx" ON "on_call_entries"("user_id", "start_utc");

-- CreateIndex
CREATE INDEX "fiber_plans_tenantId_idx" ON "fiber_plans"("tenantId");

-- CreateIndex
CREATE INDEX "fiber_plans_connectionId_idx" ON "fiber_plans"("connectionId");

-- CreateIndex
CREATE INDEX "plan_markers_tenantId_idx" ON "plan_markers"("tenantId");

-- CreateIndex
CREATE INDEX "plan_zones_tenantId_idx" ON "plan_zones"("tenantId");

-- CreateIndex
CREATE INDEX "plan_zones_planId_idx" ON "plan_zones"("planId");

-- AddForeignKey
ALTER TABLE "maintenance_windows" ADD CONSTRAINT "maintenance_windows_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiber_plans" ADD CONSTRAINT "fiber_plans_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiber_plans" ADD CONSTRAINT "fiber_plans_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "nms_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_zones" ADD CONSTRAINT "plan_zones_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_zones" ADD CONSTRAINT "plan_zones_planId_fkey" FOREIGN KEY ("planId") REFERENCES "fiber_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_markers" ADD CONSTRAINT "plan_markers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_markers" ADD CONSTRAINT "plan_markers_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "plan_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geo_zones" ADD CONSTRAINT "geo_zones_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runbooks" ADD CONSTRAINT "runbooks_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_channels" ADD CONSTRAINT "notification_channels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "notification_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correlation_weights" ADD CONSTRAINT "correlation_weights_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "correlation_outcomes" ADD CONSTRAINT "correlation_outcomes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "on_call_schedules" ADD CONSTRAINT "on_call_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "on_call_entries" ADD CONSTRAINT "on_call_entries_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "on_call_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "detected_alerts_tenantId_connectionId_kind_deviceKind_deviceId_" RENAME TO "detected_alerts_tenantId_connectionId_kind_deviceKind_devic_key";

-- RenameIndex
ALTER INDEX "investigation_feedback_tenantId_runId_versionId_authorUserId_la" RENAME TO "investigation_feedback_tenantId_runId_versionId_authorUserI_key";

-- RenameIndex
ALTER INDEX "metric_samples_tenantId_connectionId_deviceKind_deviceId_kind_s" RENAME TO "metric_samples_tenantId_connectionId_deviceKind_deviceId_ki_idx";

