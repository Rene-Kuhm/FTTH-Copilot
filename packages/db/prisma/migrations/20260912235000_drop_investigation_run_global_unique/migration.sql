-- Drop the redundant global unique index on runId.
-- The composite unique constraint "investigation_runs_tenantId_runId_key"
-- (tenantId, runId) remains the authoritative invariant, guaranteeing per-tenant
-- uniqueness while allowing multiple tenants to use independent app-supplied runIds.
--
-- Safety: Pre-existing rows could not violate the composite constraint because the global
-- index was strictly narrower than the composite index.
DROP INDEX IF EXISTS "investigation_runs_runId_key";
