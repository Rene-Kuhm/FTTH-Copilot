-- Migration: Add DecisionEvaluation table for Laya Decision Layer (ADR-042)
-- Created: 2026-09-27

-- DecisionEvaluation stores Laya decisions for:
-- - Shadow mode: compare Laya decisions vs actual routing
-- - Benchmark: measure accuracy, precision, recall per class
-- - Fine-tuning: build training dataset from operator-confirmed outcomes
-- - Calibration: track confidence vs actual outcome

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

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS "decision_evaluations_tenantId_createdAt_idx"
    ON "decision_evaluations"("tenantId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "decision_evaluations_tenantId_eventClass_idx"
    ON "decision_evaluations"("tenantId", "eventClass");

CREATE INDEX IF NOT EXISTS "decision_evaluations_tenantId_shadow_idx"
    ON "decision_evaluations"("tenantId", "shadow");

CREATE INDEX IF NOT EXISTS "decision_evaluations_model_eventClass_idx"
    ON "decision_evaluations"("model", "eventClass");

-- Foreign key constraint
ALTER TABLE "decision_evaluations"
    ADD CONSTRAINT "decision_evaluations_tenantId_fkey"
    FOREIGN KEY ("tenantId")
    REFERENCES "tenants"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;

-- Comments
COMMENT ON TABLE "decision_evaluations" IS 'Laya Decision Layer shadow mode evaluation records (ADR-042)';
COMMENT ON COLUMN "decision_evaluations.shadow" IS 'True when in shadow mode (no routing impact)';
COMMENT ON COLUMN "decision_evaluations.confidence" IS 'JSON object with confidence scores per dimension';
