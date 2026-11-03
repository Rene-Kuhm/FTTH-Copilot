-- El interruptor del learning loop por tenant (learning loop, task T1.1).
--
-- `TenantPolicy` suma dos knobs (D10):
--
--   - `learningMode`: `off` (default) → `shadow` → `active`. El default es
--     `off` a propósito: desplegar el código no cambia lo que ve el
--     operador. `shadow` calcula la salida aprendida y la registra al lado
--     de la actual, pero el usuario sigue viendo la actual.
--   - `learningArtifactPins`: qué versión de cada artefacto aprendido usa el
--     tenant. Es lo que hace posible el rollback sin deploy: se vuelve el
--     pin a la versión anterior, o se deja el modo en `off`.
--
-- Aditiva: crea un enum y agrega dos columnas. No toca ni reescribe ninguna
-- fila existente — la columna nueva tiene default, así que la tabla sigue
-- siendo válida para los tenants que ya tienen política.

CREATE TYPE "LearningMode" AS ENUM ('off', 'shadow', 'active');

ALTER TABLE "tenant_policies"
    ADD COLUMN IF NOT EXISTS "learningMode" "LearningMode" NOT NULL DEFAULT 'off';

ALTER TABLE "tenant_policies"
    ADD COLUMN IF NOT EXISTS "learningArtifactPins" JSONB;

COMMENT ON COLUMN "tenant_policies"."learningMode" IS 'Learning loop mode: off (default) | shadow | active';
COMMENT ON COLUMN "tenant_policies"."learningArtifactPins" IS 'Artifact version pinned per learning layer (l1, l2, l3)';
