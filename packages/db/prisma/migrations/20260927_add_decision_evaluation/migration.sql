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

-- Postgres requires the table-qualified form for any column that carries an
-- ordering clause. Without it this migration failed with SQLSTATE 42601
-- ("column name must be qualified"), which CI never caught because CI built the
-- schema with `prisma db push` instead of applying migrations.
CREATE INDEX IF NOT EXISTS "decision_evaluations_tenantId_createdAt_idx" ON "decision_evaluations"("tenantId", "decision_evaluations"."createdAt" DESC);
CREATE INDEX IF NOT EXISTS "decision_evaluations_tenantId_eventClass_idx" ON "decision_evaluations"("tenantId", "eventClass");
CREATE INDEX IF NOT EXISTS "decision_evaluations_tenantId_shadow_idx" ON "decision_evaluations"("tenantId", "shadow");

ALTER TABLE "decision_evaluations" ADD CONSTRAINT "decision_evaluations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON TABLE "decision_evaluations" IS 'Laya Decision Layer shadow mode evaluation records (ADR-042)';
COMMENT ON COLUMN "decision_evaluations.shadow" IS 'True when in shadow mode (no routing impact)';
COMMENT ON COLUMN "decision_evaluations.confidence" IS 'JSON object with confidence scores per dimension';
