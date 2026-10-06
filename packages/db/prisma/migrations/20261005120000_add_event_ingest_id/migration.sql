-- Durable ingest: stable id per received event so a spool retry is
-- deduplicated rather than inserted twice.
--
-- Postgres treats NULLs as distinct in unique indexes, so rows written before
-- this migration (ingest_id IS NULL) are all allowed.
-- The Prisma model is DeviceEvent but @@map sends it to device_events; SQL must use the
-- mapped table name.
CREATE UNIQUE INDEX "device_events_ingestId_key" ON "device_events"("ingestId");