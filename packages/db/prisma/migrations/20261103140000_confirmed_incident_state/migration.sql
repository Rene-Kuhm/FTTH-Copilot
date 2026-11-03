-- El estado de un incidente confirmado dentro de la KB (learning loop, task
-- T1.4, D3).
--
-- Una fila con instrucciones embebidas no se rechaza en silencio: queda
-- `quarantined` y requiere revisión humana para entrar a la KB. La fila sigue
-- en la base (la KB es append-only y auditable), pero el recall la filtra.
--
-- Aditiva: crea un enum y agrega una columna con default. Las filas
-- existentes quedan en `active`, que es exactamente su comportamiento de hoy.

CREATE TYPE "ConfirmedIncidentState" AS ENUM ('active', 'quarantined');

ALTER TABLE "confirmed_incidents"
    ADD COLUMN IF NOT EXISTS "state" "ConfirmedIncidentState" NOT NULL DEFAULT 'active';

COMMENT ON COLUMN "confirmed_incidents"."state" IS 'active: the row is part of the KB; quarantined: held for human review (learning loop D3)';
