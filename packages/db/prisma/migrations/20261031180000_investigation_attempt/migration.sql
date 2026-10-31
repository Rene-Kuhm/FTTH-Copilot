-- Identify the investigation attempt in flight (task T12, unit 7b).
--
-- An InvestigationRun row is reused across attempts (one row per incident),
-- so neither `requestedAt` (written once, at creation) nor an update keyed by
-- (tenantId, runId) can tell attempts apart. Two bugs followed from that: the
-- stale sweep expired runs that were still running, and a late attempt could
-- overwrite the state of a newer one.
--
-- Additive and nullable: nothing existing is rewritten except the backfill
-- below, and the down path is dropping the two columns and the index.
ALTER TABLE "investigation_runs" ADD COLUMN "currentVersionId" TEXT;
ALTER TABLE "investigation_runs" ADD COLUMN "attemptStartedAt" TIMESTAMP(3);

-- Rows already stuck in `pending` (the bug this change fixes) have no attempt
-- recorded. Backfilling the start of the attempt from the last write lets the
-- stale sweep see them with a single condition, instead of carrying a special
-- case for legacy rows forever. Their currentVersionId stays NULL on purpose:
-- no attempt can claim them, so they can only leave `pending` by expiring.
UPDATE "investigation_runs"
SET "attemptStartedAt" = "updatedAt"
WHERE "status" = 'pending' AND "attemptStartedAt" IS NULL;

CREATE INDEX "investigation_runs_status_attemptStartedAt_idx"
  ON "investigation_runs"("status", "attemptStartedAt");
