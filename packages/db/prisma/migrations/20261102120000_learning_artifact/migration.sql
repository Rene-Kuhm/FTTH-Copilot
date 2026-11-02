-- Freeze the learning dataset per tenant (learning loop, task T0.5).
--
-- A snapshot is append-only: freezing means storing, not rewriting. The
-- `snapshotHash` is the hash of the content (content + window + code
-- version), so two runs over the same data produce the same hash and a
-- different dataset produces a different one.
--
-- Additive: it creates one new table and one new enum and touches nothing
-- existing. The down path is dropping the table and the enum.

CREATE TYPE "LearningArtifactKind" AS ENUM ('snapshot');

CREATE TABLE IF NOT EXISTS "learning_artifacts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "LearningArtifactKind" NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "codeVersion" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "learning_artifacts_pkey" PRIMARY KEY ("id")
);

-- Matches schema.prisma's @@unique([tenantId, kind, snapshotHash]): re-freezing
-- the same dataset does not create a second row, and a different dataset
-- coexists with the previous one.
CREATE UNIQUE INDEX IF NOT EXISTS "learning_artifacts_tenantId_kind_snapshotHash_key"
    ON "learning_artifacts"("tenantId", "kind", "snapshotHash");

CREATE INDEX IF NOT EXISTS "learning_artifacts_tenantId_kind_createdAt_idx"
    ON "learning_artifacts"("tenantId", "kind", "createdAt");

ALTER TABLE "learning_artifacts"
    ADD CONSTRAINT "learning_artifacts_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMENT ON TABLE "learning_artifacts" IS 'Learning loop artifacts: frozen datasets and their content hash';
COMMENT ON COLUMN "learning_artifacts"."snapshotHash" IS 'Hash of the frozen content (content + window + code version)';
