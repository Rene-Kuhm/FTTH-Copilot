-- Fase E — per-tenant policy envelope (1:1 with Tenant).
-- One row per Tenant; absent → byte-identical to Fase C/D. Per-tenant wins
-- over env over module default. See
-- openspec/changes/fase-e-tenant-topology/specs/tenant-policy/spec.md.
--
-- Additive — no destructive change. Down migration drops the table and
-- the TruthGateMode enum. CI applies the migration via the existing
-- service container. Empty rows preserve Fase D behavior byte-identically.

-- CreateEnum
CREATE TYPE "TruthGateMode" AS ENUM ('observe', 'strict');

-- CreateTable
CREATE TABLE "tenant_policies" (
    "tenantId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "retrievalLimit" INTEGER,
    "retrievalSinceDays" INTEGER,
    "truthGateMode" "TruthGateMode",
    "abstainOnCodes" JSONB,
    "promotionMinAgeMs" INTEGER,
    "lastEvaluatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_policies_pkey" PRIMARY KEY ("tenantId")
);

-- AddForeignKey
ALTER TABLE "tenant_policies" ADD CONSTRAINT "tenant_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;