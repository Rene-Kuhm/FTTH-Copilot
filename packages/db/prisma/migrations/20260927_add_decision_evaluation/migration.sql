-- Migration: Add DecisionEvaluation table for Laya Decision Layer (ADR-042)
-- Created: 2026-09-27

CREATE TABLE IF NOT EXISTS "decision_evaluations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventSource" TEXT,
    "eventRawSummary" TEXT,
    "engine" TEXT NOT NULL DEFAULT 'laya',
    "model" TEXT NOT NULL,
    "modelVersion" TEXT,
    "eventClass" TEXT,
    "severity" TEXT,
    "probableScope" TEXT,
    "suggestedRoute" TEXT,
    "requiresInvestigation" BOOLEAN,
    "confidence" JSONB,
    "latencyMs" INTEGER,
    "actualRoute" TEXT,
    "actualDiagnosis" TEXT,
    "operatorOutcome" TEXT,
    "shadow" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "decision_evaluations_pkey" PRIMARY KEY ("id")
);

-- Matches schema.prisma's @@index([tenantId, createdAt]). The DESC that used to
-- be here was drift from the model, which does not express index ordering.
CREATE INDEX IF NOT EXISTS "decision_evaluations_tenantId_createdAt_idx" ON "decision_evaluations"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "decision_evaluations_tenantId_eventClass_idx" ON "decision_evaluations"("tenantId", "eventClass");
CREATE INDEX IF NOT EXISTS "decision_evaluations_tenantId_shadow_idx" ON "decision_evaluations"("tenantId", "shadow");
-- Present in schema.prisma but never created by this migration.
CREATE INDEX IF NOT EXISTS "decision_evaluations_model_eventClass_idx" ON "decision_evaluations"("model", "eventClass");

ALTER TABLE "decision_evaluations" ADD CONSTRAINT "decision_evaluations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Table and column must be separate quoted identifiers. Writing
-- "decision_evaluations.shadow" makes it one identifier containing a dot, which
-- is what this migration failed on: SQLSTATE 42601, column name must be
-- qualified. CI never ran it, so it was never seen.
COMMENT ON TABLE "decision_evaluations" IS 'Laya Decision Layer shadow mode evaluation records (ADR-042)';
COMMENT ON COLUMN "decision_evaluations"."shadow" IS 'True when in shadow mode (no routing impact)';
COMMENT ON COLUMN "decision_evaluations"."confidence" IS 'JSON object with confidence scores per dimension';
