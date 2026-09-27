-- Migration: add_fiber_plan
-- Fiber optic plan viewer: plans, logical zones, and interactive markers.
-- Georeferencing strategy: operator-defined logical zones (no GPS required).

-- 1. FiberPlan: metadata for an uploaded plan image or PDF.
CREATE TABLE "fiber_plans" (
    id              VARCHAR(30)  PRIMARY KEY DEFAULT cuid(),
    tenant_id       VARCHAR(30)  NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    connection_id   VARCHAR(30)  REFERENCES "nms_connections"("id") ON DELETE SET NULL,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    file_url        TEXT         NOT NULL,
    mime_type       VARCHAR(100) NOT NULL,
    width_px        INTEGER,
    height_px       INTEGER,
    file_size_bytes BIGINT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX "fiber_plans_tenant_id_idx"          ON "fiber_plans"("tenant_id");
CREATE INDEX "fiber_plans_connection_id_idx"       ON "fiber_plans"("connection_id");

-- 2. PlanZone: a logical zone within a plan (e.g. "Zona Norte", "Barrio El Progreso").
-- Operators create zones and assign markers to them.
CREATE TABLE "plan_zones" (
    id          VARCHAR(30)  PRIMARY KEY DEFAULT cuid(),
    tenant_id   VARCHAR(30)  NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    plan_id     VARCHAR(30)  NOT NULL REFERENCES "fiber_plans"("id") ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    color       VARCHAR(7)   NOT NULL DEFAULT '#6366F1', -- hex, e.g. #6366F1
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX "plan_zones_tenant_id_idx" ON "plan_zones"("tenant_id");
CREATE INDEX "plan_zones_plan_id_idx"   ON "plan_zones"("plan_id");

-- 3. PlanMarker: a pin placed on the plan, optionally tied to a topology node.
-- x_percent / y_percent are 0–100 floats so they're resolution-independent.
-- device_kind / device_id link the marker to the FTTH topology.
CREATE TABLE "plan_markers" (
    id          VARCHAR(30) PRIMARY KEY DEFAULT cuid(),
    tenant_id   VARCHAR(30) NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    zone_id     VARCHAR(30) REFERENCES "plan_zones"("id") ON DELETE SET NULL,
    label       VARCHAR(255) NOT NULL,
    device_kind VARCHAR(20),  -- 'OLT' | 'PON_PORT' | 'SPLITTER' | 'CTO' | 'ONU' — TopologyNodeKind values
    device_id   VARCHAR(255),
    x_percent   FLOAT        NOT NULL,  -- 0.0 to 100.0
    y_percent   FLOAT        NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX "plan_markers_tenant_id_idx"   ON "plan_markers"("tenant_id");
CREATE INDEX "plan_markers_zone_id_idx"     ON "plan_markers"("zone_id");
CREATE INDEX "plan_markers_device_kind_idx" ON "plan_markers"("device_kind");
CREATE INDEX "plan_markers_device_id_idx"  ON "plan_markers"("device_id");
