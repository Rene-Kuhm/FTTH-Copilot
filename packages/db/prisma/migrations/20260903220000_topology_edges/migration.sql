-- Fase E — temporal topology (single-edge model).
-- One row per directed parent → child edge in the FTTH hierarchy
-- (OLT → PON_PORT → SPLITTER → CTO → ONU). Temporal validity via
-- `validFrom` (default now()) + nullable `validTo`. Soft-expiry: BFS
-- helpers and Prisma reads both filter `validTo: null`.
--
-- Additive — no destructive change. Down migration drops the table and
-- the TopologyNodeKind enum. CI applies the migration via the existing
-- service container. Empty rows preserve Fase D behavior byte-identically.
--
-- See openspec/changes/fase-e-tenant-topology/specs/temporal-topology/spec.md.

-- CreateEnum
CREATE TYPE "TopologyNodeKind" AS ENUM ('OLT', 'PON_PORT', 'SPLITTER', 'CTO', 'ONU');

-- CreateTable
CREATE TABLE "topology_edges" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentKind" "TopologyNodeKind" NOT NULL,
    "parentId" TEXT NOT NULL,
    "childKind" "TopologyNodeKind" NOT NULL,
    "childId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "topology_edges_pkey" PRIMARY KEY ("id")
);

-- Indexes: BFS reads filter by parent or child for a given tenant.
CREATE INDEX "topology_edges_tenantId_parentKind_parentId_validTo_idx" ON "topology_edges"("tenantId", "parentKind", "parentId", "validTo");
CREATE INDEX "topology_edges_tenantId_childKind_childId_validTo_idx" ON "topology_edges"("tenantId", "childKind", "childId", "validTo");

-- AddForeignKey
ALTER TABLE "topology_edges" ADD CONSTRAINT "topology_edges_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;