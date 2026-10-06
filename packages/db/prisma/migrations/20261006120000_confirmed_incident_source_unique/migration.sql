-- One confirmed incident per source incident.
--
-- Both the confirm route and the promote loop decide "has this already been
-- confirmed?" by reading and then writing, so two concurrent requests can both
-- see nothing and both insert. The uniqueness rule the code already assumes
-- was never expressed in the schema.
--
-- Existing duplicates are collapsed first, keeping the earliest row by
-- createdAt and breaking ties on id so the choice is deterministic. The
-- removal is reported through RAISE NOTICE rather than done silently.

DO $$
DECLARE
  duplicate_groups integer;
BEGIN
  SELECT COUNT(*) INTO duplicate_groups FROM (
    SELECT 1 FROM "ConfirmedIncident"
    WHERE "sourceIncidentId" IS NOT NULL
    GROUP BY "tenantId", "sourceIncidentId"
    HAVING COUNT(*) > 1
  ) duplicates;

  IF duplicate_groups > 0 THEN
    RAISE NOTICE 'Collapsing % confirmed incident group(s) with duplicates', duplicate_groups;

    DELETE FROM "ConfirmedIncident" duplicate
    USING "ConfirmedIncident" keeper
    WHERE duplicate."tenantId" = keeper."tenantId"
      AND duplicate."sourceIncidentId" = keeper."sourceIncidentId"
      AND duplicate."sourceIncidentId" IS NOT NULL
      AND (
        duplicate."createdAt" > keeper."createdAt"
        OR (
          duplicate."createdAt" = keeper."createdAt"
          AND duplicate."id" > keeper."id"
        )
      );
  END IF;
END $$;

-- Nullable, so rows without a source incident are unaffected: Postgres treats
-- NULLs as distinct inside a unique index.
CREATE UNIQUE INDEX "ConfirmedIncident_tenantId_sourceIncidentId_key"
  ON "ConfirmedIncident"("tenantId", "sourceIncidentId");
