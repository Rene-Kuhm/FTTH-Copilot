-- Fase F — verdict_log persistence surface for `AgentResult.verdicts`.
--
-- One row per (message, tool-call verdict) emitted by the chat route after
-- `runAgent` returns with a non-empty `verdicts` array. Mirrors the
-- `VerdictLog` Prisma model exactly (columns + indexes + FKs). `injectionSuspicion`
-- is the fast-filter bit used by the nightly
-- `injection_suspicion_total` metric; rows are filterable on either code
-- or severity without a JSON cast because both columns are enum-typed.
--
-- Additive — no destructive change. Down migration drops the table and
-- the two new enums (VerdictCode + VerdictSeverity). Existing rows are
-- untouched. CI applies the migration via the existing service container.
--
-- See openspec/changes/fase-f-eval-injection/specs/confirmed-incident-memory/spec.md.

-- CreateEnum
CREATE TYPE "VerdictCode" AS ENUM ('ok', 'low_confidence', 'stale', 'incomplete');

-- CreateEnum
CREATE TYPE "VerdictSeverity" AS ENUM ('ok', 'info', 'warning', 'critical');

-- CreateTable
CREATE TABLE "verdict_log" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "conversationId" TEXT,
    "toolName" TEXT NOT NULL,
    "code" "VerdictCode" NOT NULL,
    "severity" "VerdictSeverity" NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "injectionSuspicion" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "verdict_log_pkey" PRIMARY KEY ("id")
);

-- Indexes: AD-6 (per-tenant, by observedAt), per-tenant + code/observedAt
-- for fast-filter queries on the `__injection_suspicion__` derivation,
-- per-messageId for recompute idempotency (see design.md §Risks).
CREATE INDEX "verdict_log_tenantId_observedAt_idx" ON "verdict_log"("tenantId", "observedAt");
CREATE INDEX "verdict_log_tenantId_code_observedAt_idx" ON "verdict_log"("tenantId", "code", "observedAt");
CREATE INDEX "verdict_log_messageId_idx" ON "verdict_log"("messageId");

-- AddForeignKey
ALTER TABLE "verdict_log" ADD CONSTRAINT "verdict_log_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "verdict_log" ADD CONSTRAINT "verdict_log_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;