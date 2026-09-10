-- Fase 5 PR #1 — additive maintenance_windows table.
-- Roadmap 5.1 + 5.2: ventana sin recurrencias, alcance explícito,
-- inicio/fin UTC, motivo, autor, estado. Solapamiento determinista:
-- la API rechaza con 409 (no fusión silenciosa).
CREATE TABLE "maintenance_windows" (
    "id"                TEXT NOT NULL,
    "tenantId"          TEXT NOT NULL,
    "title"             TEXT NOT NULL,
    "description"       TEXT,
    "scopeJson"         TEXT NOT NULL,
    "startUtc"          TIMESTAMP(3) NOT NULL,
    "endUtc"            TIMESTAMP(3) NOT NULL,
    "timezone"          TEXT NOT NULL,
    "status"            TEXT NOT NULL DEFAULT 'scheduled',
    "createdByUserId"   TEXT NOT NULL,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL,
    "cancelledAt"       TIMESTAMP(3),
    "cancelledByUserId" TEXT,
    "cancellationReason" TEXT,
    CONSTRAINT "maintenance_windows_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "maintenance_windows_tenantId_fkey"
        FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE INDEX "maintenance_windows_tenantId_status_startUtc_endUtc_idx"
    ON "maintenance_windows"("tenantId", "status", "startUtc", "endUtc");

CREATE INDEX "maintenance_windows_tenantId_startUtc_endUtc_idx"
    ON "maintenance_windows"("tenantId", "startUtc", "endUtc");

-- Backfill: nothing. The table starts empty and grows with operator
-- input. There is no retroactive import from other systems.
