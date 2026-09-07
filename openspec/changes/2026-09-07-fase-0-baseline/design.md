# Diseño — Fase 0

## Forma de los identificadores

Los tres identificadores (`runId`, `versionId`, `feedbackId`) son
cadenas ASCII opacas de 1 a 64 caracteres del alfabeto `[A-Za-z0-9_-]`.
La decisión de evitar `cuid()` por defecto es porque las fases 1+ pueden
emitir IDs desde múltiples fuentes (HTTP request, cola de background,
replay de un feed externo) y conviene un alfabeto común. La opacidad
garantiza que no se filtre el tenant ni el rowId de Prisma.

## Por qué Zod y no TypeScript interface puro

`packages/shared` ya usa Zod para todos los wire formats existentes
(`ftth.telemetry.v1`, `ftth.finding.v1`, `ftth.verdict-log.v1`,
etc.). Los identificadores de investigación siguen el mismo patrón
para que un productor que se equivoque de versión falle con un
`error TS` o un `ZodError` en runtime, no con un `undefined` silencioso.

`.strict()` rechaza keys desconocidas a nivel raíz, así un productor
que añada un campo nuevo rompe la suite hasta que la spec se actualice.
Esto es deliberado — la spec es el contrato, no el código del productor.

## Por qué fixtures y no tests inline

El roadmap exige que los mismos escenarios sirvan a fases 1, 3 y 5.
Si los fixtures viven dentro de un solo test file, cada fase termina
copiando y mutando hasta que divergen. Centralizarlos en
`packages/evidence/tests/fixtures/incident-investigation.ts` con
exports nombrados (`INVESTIGATION_FIXTURE_TENANT_PRIMARY`, etc.) evita
divergencia accidental y permite que cualquier fase importe los mismos
identificadores.

## Reconciliación de openspec/config.yaml

El PR #107 ya reemplazó los `"echo \"no lint configured\""` por
`eslint .` en cada `package.json`. El `openspec/config.yaml` quedó
desactualizado: declaraba el comando viejo. Reemplazar las 13
ocurrencias por `eslint .` alinea el contrato OpenSpec con el comando
real que ejecuta CI. Sin esta reconciliación, un futuro
`openspec validate` rechazaría el repo contra la realidad.

## Riesgos y rollback

- **Cambio al `contracts.ts`**: añadir tres schemas nuevos no rompe
  código existente (los exports son aditivos). Rollback = revert del
  commit. No hay migración, no hay tabla.
- **Cambio al `config.yaml`**: el archivo es declarativo. Rollback =
  restaurar el `lint` viejo. CI seguirá funcionando con ESLint real
  (PR #107 ya está mergeado).
- **Cambio a `docs/`**: agregar dos documentos. Rollback = borrarlos.
  Ningún side-effect.
