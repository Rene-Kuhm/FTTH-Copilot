-- Fase 1 — investigation feedback (cognitive investigation roadmap).
-- Adds three tables: investigation_runs, investigation_versions,
-- investigation_feedback. Additive — no destructive change. Down
-- migration drops the three tables.

-- CreateTable
CREATE TABLE "investigation_runs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "connectionId" TEXT,
    "incidentId" TEXT,
    "requestedByUserId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "investigation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigation_versions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runRefId" TEXT,
    "runId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "versionIndex" INTEGER NOT NULL,
    "rulesetVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "snapshotJson" JSONB NOT NULL DEFAULT '{}',
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investigation_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "investigation_feedback" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runRefId" TEXT,
    "versionRefId" TEXT,
    "runId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "observations" TEXT,
    "realCause" TEXT,
    "resolutionEvidence" TEXT,
    "authorUserId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investigation_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "investigation_runs_runId_key" ON "investigation_runs"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "investigation_runs_tenantId_runId_key" ON "investigation_runs"("tenantId", "runId");

-- CreateIndex
CREATE INDEX "investigation_runs_tenantId_requestedAt_idx" ON "investigation_runs"("tenantId", "requestedAt");

-- CreateIndex
CREATE INDEX "investigation_runs_tenantId_incidentId_idx" ON "investigation_runs"("tenantId", "incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "investigation_versions_tenantId_runId_versionIndex_key" ON "investigation_versions"("tenantId", "runId", "versionIndex");

-- CreateIndex
CREATE UNIQUE INDEX "investigation_versions_tenantId_versionId_key" ON "investigation_versions"("tenantId", "versionId");

-- CreateIndex
CREATE INDEX "investigation_versions_tenantId_runId_idx" ON "investigation_versions"("tenantId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "investigation_feedback_tenantId_runId_versionId_authorUserId_label_key" ON "investigation_feedback"("tenantId", "runId", "versionId", "authorUserId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "investigation_feedback_tenantId_feedbackId_key" ON "investigation_feedback"("tenantId", "feedbackId");

-- CreateIndex
CREATE INDEX "investigation_feedback_tenantId_versionId_idx" ON "investigation_feedback"("tenantId", "versionId");

-- CreateIndex
CREATE INDEX "investigation_feedback_tenantId_authorUserId_submittedAt_idx" ON "investigation_feedback"("tenantId", "authorUserId", "submittedAt");

-- AddForeignKey
ALTER TABLE "investigation_runs" ADD CONSTRAINT "investigation_runs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_runs" ADD CONSTRAINT "investigation_runs_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "nms_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_runs" ADD CONSTRAINT "investigation_runs_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_versions" ADD CONSTRAINT "investigation_versions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_versions" ADD CONSTRAINT "investigation_versions_runRefId_fkey" FOREIGN KEY ("runRefId") REFERENCES "investigation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_feedback" ADD CONSTRAINT "investigation_feedback_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_feedback" ADD CONSTRAINT "investigation_feedback_versionRefId_fkey" FOREIGN KEY ("versionRefId") REFERENCES "investigation_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investigation_feedback" ADD CONSTRAINT "investigation_feedback_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
