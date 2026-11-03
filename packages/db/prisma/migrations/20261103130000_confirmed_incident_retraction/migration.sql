-- La retracción de un incidente confirmado (learning loop, task T1.2, D2).
--
-- `ConfirmedIncident` es inmutable por diseño: para corregirla sin romper esa
-- garantía, la retracción es una fila aparte y append-only. La fila retractada
-- queda fuera del recall, del entrenamiento y del índice, pero sigue en la
-- base para auditoría.
--
-- `incidentId` es una referencia blanda (sin FK a `confirmed_incidents`), por
-- la misma razón que `ConfirmedIncident.investigationFeedbackId`: la KB es
-- inmutable y su borrado no tiene que arrastrar la auditoría. La aplicación
-- valida `(tenantId, incidentId)` al insertar.
--
-- Aditiva: crea una tabla y sus índices. No toca ninguna tabla existente.

CREATE TABLE IF NOT EXISTS "confirmed_incident_retractions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "retractedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "confirmed_incident_retractions_pkey" PRIMARY KEY ("id")
);

-- Matches schema.prisma's @@unique([tenantId, incidentId]): retractar dos
-- veces es un error de la aplicación, no dos filas.
CREATE UNIQUE INDEX IF NOT EXISTS "confirmed_incident_retractions_tenantId_incidentId_key"
    ON "confirmed_incident_retractions"("tenantId", "incidentId");

CREATE INDEX IF NOT EXISTS "confirmed_incident_retractions_tenantId_createdAt_idx"
    ON "confirmed_incident_retractions"("tenantId", "createdAt");

ALTER TABLE "confirmed_incident_retractions"
    ADD CONSTRAINT "confirmed_incident_retractions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "confirmed_incident_retractions"
    ADD CONSTRAINT "confirmed_incident_retractions_retractedByUserId_fkey"
    FOREIGN KEY ("retractedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMENT ON TABLE "confirmed_incident_retractions" IS 'Append-only retraction log of immutable confirmed incidents (learning loop D2)';
COMMENT ON COLUMN "confirmed_incident_retractions"."incidentId" IS 'Soft reference to confirmed_incidents.id; no FK by design';
COMMENT ON COLUMN "confirmed_incident_retractions"."reason" IS 'Why the operator retracted the confirmed incident';
