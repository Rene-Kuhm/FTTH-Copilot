-- Durable ingest: stable id per received event so a spool retry is
-- deduplicated rather than inserted twice.
--
-- Postgres treats NULLs as distinct in unique indexes, so rows written before
-- this migration (ingest_id IS NULL) are all allowed.
CREATE UNIQUE INDEX "DeviceEvent_ingestId_key" ON "DeviceEvent"("ingestId");