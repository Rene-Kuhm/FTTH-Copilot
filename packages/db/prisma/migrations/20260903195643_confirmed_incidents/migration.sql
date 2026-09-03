-- Fase D — confirmed-incident memory (sparse-first hybrid RAG).
-- Adds two tables: confirmed_incidents (knowledge base) and
-- pending_incident_candidates (chat-route write gate for agent promotion).
-- Additive — no destructive change. Down migration drops both tables and
-- the ConfirmedBy + PendingIncidentStatus enum types.

-- CreateEnum
CREATE TYPE "ConfirmedBy" AS ENUM ('operator', 'agent', 'system');

-- CreateEnum
CREATE TYPE "PendingIncidentStatus" AS ENUM ('pending', 'promoted', 'rejected');

-- CreateTable
CREATE TABLE "confirmed_incidents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT,
    "deviceKind" "DeviceKind" NOT NULL,
    "deviceId" TEXT NOT NULL,
    "sourceIncidentId" TEXT,
    "sourceTool" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "symptoms" JSONB NOT NULL,
    "rootCause" TEXT NOT NULL,
    "fix" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3) NOT NULL,
    "confirmedBy" "ConfirmedBy" NOT NULL,
    "confirmedByUserId" TEXT,
    "searchTokens" TEXT NOT NULL,
    "embedding" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "confirmed_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_incident_candidates" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sourceIncidentId" TEXT,
    "summary" TEXT NOT NULL,
    "toolCallsJson" JSONB NOT NULL,
    "runSessionId" TEXT,
    "proposedConfirmedAt" TIMESTAMP(3) NOT NULL,
    "status" "PendingIncidentStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_incident_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "confirmed_incidents_tenantId_deviceKind_deviceId_idx" ON "confirmed_incidents"("tenantId", "deviceKind", "deviceId");

-- CreateIndex
CREATE INDEX "confirmed_incidents_tenantId_resolvedAt_idx" ON "confirmed_incidents"("tenantId", "resolvedAt");

-- CreateIndex
CREATE INDEX "confirmed_incidents_tenantId_connectionId_idx" ON "confirmed_incidents"("tenantId", "connectionId");

-- CreateIndex
CREATE INDEX "pending_incident_candidates_tenantId_status_idx" ON "pending_incident_candidates"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "confirmed_incidents" ADD CONSTRAINT "confirmed_incidents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "confirmed_incidents" ADD CONSTRAINT "confirmed_incidents_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "nms_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "confirmed_incidents" ADD CONSTRAINT "confirmed_incidents_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_incident_candidates" ADD CONSTRAINT "pending_incident_candidates_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;