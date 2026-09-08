-- Fase 1 PR #3 — link ConfirmedIncident to a technician's feedback.
-- Adds the optional `investigationFeedbackId` column on confirmed_incidents
-- as a SOFT reference (no FK). A ConfirmedIncident MUST remain
-- insertable without a feedback, and the deletion of a feedback row
-- MUST NOT cascade into ConfirmedIncident (which is the immutable
-- knowledge base). The application layer validates (tenantId,
-- feedbackId) at insert time.
--
-- Additive — no destructive change. Rollback drops the column and index.

-- AlterTable
ALTER TABLE "confirmed_incidents" ADD COLUMN "investigationFeedbackId" TEXT;

-- CreateIndex
CREATE INDEX "confirmed_incidents_tenantId_investigationFeedbackId_idx" ON "confirmed_incidents"("tenantId", "investigationFeedbackId");
