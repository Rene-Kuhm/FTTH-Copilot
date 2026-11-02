# Bloque A — Tipado de Prisma en las consultas de `apps/web`

**Status**: Done
**Created**: 2026-10-31
**Branch**: `fix/prisma-where-types`
**Scope**: reemplazar los `any` explícitos en las consultas de Prisma de
`apps/web` por los tipos generados (`Prisma.<Model>WhereInput`), empezando por
`app/api/ops/runbooks/route.ts` y `lib/maintenance/suppression-audit.ts`, y
dejar una regla de lint que impida nuevos `any` explícitos.

---

## Problema

Dos rutas arman filtros de Prisma a mano y los tipan como `any`. El
compilador no puede verificar nada de ellos: un campo mal escrito, un enum
fuera de dominio o una condición con la forma equivocada pasan el typecheck y
fallan **en runtime**, contra la base.

En `app/api/ops/runbooks/route.ts` el `any` esconde un bug real: la ruta
acepta `deviceKind` del query string validado contra
`topologyNodeKindSchema` (que incluye `CTO`, `PON_PORT`, `SPLITTER`), pero
`ConfirmedIncident.deviceKind` es el enum `DeviceKind`, que sólo tiene `OLT` y
`ONU`. Con `any` compila; contra la base, Prisma **lanza**. O sea: pedir
runbooks con `deviceKind=CTO` devuelve un 500 hoy.

En `lib/maintenance/suppression-audit.ts` el `any` está en una interface local
`PrismaLike` que modela el cliente con `create(args: any)` y
`findMany(args: any)`: el mock de los tests puede devolver cualquier cosa y el
typecheck no dice nada.

## Qué se hace

1. `app/api/ops/runbooks/route.ts`:
   - `orConditions` → `Prisma.RunbookWhereInput[]`
   - `runbookWhere` → `Prisma.RunbookWhereInput`
   - `confirmedWhere` → `Prisma.ConfirmedIncidentWhereInput`
   - el `deviceKind` que se le pasa a `confirmedIncident` tiene que ser un
     `DeviceKind` válido; si no lo es, la condición se omite en vez de
     provocar un error de Prisma.
2. `lib/maintenance/suppression-audit.ts`:
   - `PrismaLike` tipada con los `Args`/`Return` reales de Prisma
     (`Prisma.AgentActionLogCreateArgs`, `Prisma.AgentActionLogFindManyArgs`).
   - `Record<string, any>` → `Record<string, unknown>`.
3. Una regla de ESLint que impida `any` explícito nuevo en `apps/web`. Si la
   regla rompe código existente, se reporta cuántos hay y dónde, sin arreglar
   todo de una: el tipado de las consultas es el objetivo, no la cola.

## Por qué

- Un filtro de Prisma sin verificar es un 500 esperando el momento en que
  alguien combine un valor que el modelo no acepta.
- La regla de lint hace que el arreglo no se revierta: sin ella, el próximo
  `any` vuelve a entrar por la puerta de atrás.

## Non-goals

- No se tipan todos los `any` de `apps/web`: es un trabajo incremental, y esta
  tarea deja la puerta cerrada para los nuevos.
- No se cambia ningún comportamiento observable salvo el 500 que el tipado
  destapa (un `deviceKind` que no es un `DeviceKind` deja de romper la ruta).
- No se toca el schema.

## Decisiones

- El `any` de `PrismaLike` se reemplaza por los tipos de **argumentos** de
  Prisma (`Prisma.AgentActionLogCreateArgs`), no por los tipos de retorno: el
  mock de los tests tiene que poder devolver filas que no son `AgentActionLog`
  (por ejemplo, un `id` de prueba), y atar el retorno al modelo real haría
  que los tests mintieran.
- La regla de lint se aplica a `apps/web` con `no-explicit-any` en **error**,
  pero se mide primero cuántos `any` explícitos hay: si son pocos y están
  acotados, se arreglan en el mismo PR; si son muchos, se reporta el conteo y
  la lista, y la regla queda para el código nuevo.

## Tareas

- [x] T1 Tipar `app/api/ops/runbooks/route.ts` con `Prisma.*WhereInput` y
      resolver el `deviceKind` que no es un `DeviceKind` válido.
- [x] T2 Tipar `lib/maintenance/suppression-audit.ts` (`PrismaLike`, el
      `Record<string, any>`).
- [x] T3 Tests de contrato de las dos rutas: los filtros que llegan a Prisma
      y la respuesta.
- [x] T4 Regla de lint contra `any` explícito en `apps/web`, con el conteo de
      los que ya existen.
- [x] T5 Gates completos + PR.

## Log

- **L1** (2026-10-31) — El tipado destapó un bug real: `ConfirmedIncident.
  deviceKind` es el enum `DeviceKind` (`OLT`, `ONU`) y la ruta acepta cualquier
  kind de topología (`CTO`, `PON_PORT`, `SPLITTER`). Con `any` compilaba; contra
  la base, Prisma **lanza**. Comprobado contra Postgres: `deviceKind: 'CTO'`
  produce `Invalid confirmedIncident.findMany() invocation`. O sea, pedir
  runbooks con `deviceKind=CTO` devolvía **500** y nadie lo había visto.
  Arreglo: el kind se filtra contra el enum generado (`isDeviceKind`) y, si no
  es un `DeviceKind`, la condición se omite. El filtro de runbooks **no**
  cambia: `Runbook.deviceKind` es texto, así que `CTO` es un filtro legítimo
  ahí. Mutación: revirtiendo el guard, el test nuevo falla.
- **L2** (2026-10-31) — La regla de lint contra `any` explícito�iba a romper
  más de lo previsto: sólo había **2** `any` reales en el código de `apps/web`
  (los otros 3 aciertos de `grep` eran la palabra "any" en comentarios). Se
  arreglaron los 2 y la regla quedó en **error**. Los 3 errores que dejó la
  regla eran en tests: dos `mockPrisma as any` que ya no hacía falta (la firma
  tipada los acepta) y un `args: any` en un mock de `planZone.create`.
- **L3** (2026-10-31) — `PrismaLike` se partió en `PrismaAuditWriter` y
  `PrismaAuditReader`: escribir sólo necesita `create` y leer sólo
  `findMany`. Con una sola interfaz, cada caller (y cada doble de test)
  tenía que implementar la mitad que no usa, que es exactamente por lo que los
  tests usaban `as any`.
- **L4** (2026-10-31) — El `any` de `IncidentsPanel.tsx` era el otro `any`
  real: el plan de fibra llega `unknown` del fetch y se pasaba a `any` para
  que el visor lo aceptara. Ahora hay un guard mínimo (`isFiberPlan`) que
  comprueba lo que el visor necesita (`id`, `name`, `zones`) antes de
  renderizar, en vez de un cast a ciegas.

## Rollback

El cambio es de tipos: se revierte el commit. La regla de lint se puede
desactivar sin tocar el código si rompe algo que no estaba previsto.
