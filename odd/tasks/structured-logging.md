# Structured Logging

**Status**: In progress
**Created**: 2026-10-31
**Branch**: `feat/structured-logging`
**Scope**: un único logger JSON en `packages/shared`, con niveles, `tenantId` y
`correlationId`, y la migración de los `console.*` de `packages/*`,
`services/worker` y `apps/web`. `scripts/` queda como está.

---

## Problema

Hoy los logs son `console.*` con texto libre y prefijos a mano
(`[scheduler] tick threw`, `[Laya] Shadow call failed:`). Tres consecuencias:

1. **No se pueden filtrar ni agregar.** Un NOC que quiere ver "todo lo que pasó
   con el tenant X en la última hora" tiene que hacer grep sobre prosa. No hay
   nivel, no hay `tenantId`, no hay forma de seguir una petición o un job.
2. **No hay control de ruido.** `LOG_LEVEL` está en `.env.example` y en
   `turbo.json`, pero ningún código lo lee: los `console.warn` salen siempre.
3. **Es fácil filtrar un secreto.** Varios sitios pasan el objeto `error`
   entero (`console.warn('[Laya] Shadow call failed:', error)`), y un error de
   red puede traer una URL con credenciales. Y el mensaje de error del receptor
   SNMP embebe el valor de la community: en un test se vio
   `Local community not found for message with community rogue-unauthorized-community`.

## Qué se hace

1. `packages/shared/src/logger.ts`: `createLogger({ name })` →
   `debug/info/warn/error(msg, fields?)` y `child(bindings)`. Salida: una línea
   JSON (`time`, `level`, `name`, `msg`, bindings y campos). Nivel por
   `LOG_LEVEL` (`debug|info|warn|error|silent`, default `info`).
2. `packages/shared/src/redaction.ts`: el redactor de secretos que hoy vive en
   `agent-core/src/telemetry/redaction.ts`, movido a `shared`. `agent-core` lo
   re-exporta con el comportamiento idéntico (sus tests son la prueba).
3. El logger aplica además una redacción propia de log: claves de **community
   SNMP** y de **datos de clientes**, y patrones en texto (community en un
   mensaje de error, emails).
4. Migración de los `console.*` de código de producción.
5. Regla ESLint `no-console` (error) con excepción para `scripts/`.

## Por qué

- Un solo formato y un solo punto de redacción hacen que "no se loguean
  secretos" sea una propiedad que un test puede verificar, no una convención.
- El redactor tiene que vivir en `shared` porque `shared` es la base: si el
  logger trajera su propia copia habría dos redactores de secretos que
  divergen con el tiempo.

## Non-goals

- No se toca `scripts/`, `packages/db/prisma/seed.ts` ni
  `packages/eval/scripts/*`: ahí `console` es la salida de una CLI.
- No se propaga el contexto con `AsyncLocalStorage`. Ver Decisiones.
- No se agrega transporte, rotación ni envío a un colector: stdout/stderr, que
  es lo que el compose y el runtime ya recogen.
- No se cambia el formato de la línea de política de tenant (ver Decisiones).

## Decisiones

- **Logger propio, no pino.** `shared` hoy depende solo de `zod`. La
  redacción que este repo necesita (patrones en texto, community SNMP) hay que
  escribirla igual: `redact` de pino trabaja por rutas de clave, no por
  patrones en el texto de un mensaje. Lo que pino aportaría (JSON, niveles,
  child) son ~150 líneas. Next.js empaqueta las dependencias de servidor por
  defecto y ofrece `serverExternalPackages` para excluirlas; los transportes de
  pino usan worker threads y suelen necesitar esa excepción — **no verificado en
  este repo**, y es un costo de configuración que el logger propio no tiene. Se
  reevalúa pino si aparece la necesidad de transportes o rotación.
- **Contexto explícito (`child`), no `AsyncLocalStorage`.** `node:async_hooks`
  en `shared` rompería cualquier bundle de Edge que importe `shared`, y el
  middleware de la web corre en Edge. Una ruta hace
  `const log = logger.child({ correlationId, tenantId })` y lo pasa hacia abajo.
  El worker usa el id del job como `correlationId`.
- **Los errores se serializan** (`name`, `message`, `stack` truncado) y pasan
  por el redactor. Nunca se vuelca el objeto crudo.
- **Línea de política de tenant: no se migra.** `agent-core/src/runtime.ts`
  emite `[ftth-copilot/tenant-policy] tenant=<id> knob=<name> resolved=<value>`,
  y ese formato es contrato de `openspec/specs/tenant-policy/spec.md`, afirmado
  carácter por carácter en `runtime.test.ts`. Migrarlo es cambiar una spec.
  Queda con `console.info` y una excepción de lint justificada; **necesita
  decisión**.
- **Redacción: nombres de clave y patrones de texto.** Claves: las que ya
  cubría `agent-core` + community/claves SNMPv3 + datos de cliente (`email`,
  `phone`, `telefono`, `movil`, `cedula`, `dni`, `address`, `direccion`,
  `nombre`, etc.). Patrones: URL con credenciales, bearer/basic, community en un
  mensaje, email.

## Tareas

- [ ] T1 Mover el redactor a `shared` y que `agent-core` lo re-exporte sin
      cambiar su comportamiento.
- [ ] T2 Logger en `shared`, con tests (formato, niveles, `child`,
      serialización de errores).
- [ ] T3 Tests de que el logger **no** emite secretos, communities SNMP ni
      datos de clientes (por clave y por texto).
- [ ] T4 Migrar `packages/*` y adaptar los tests que espían `console`.
- [ ] T5 Migrar `services/worker` y `apps/web` (rutas y lib), con
      `correlationId` en las rutas.
- [ ] T6 Regla `no-console`, con excepciones.
- [ ] T7 Gates + PR.

## Rollback

Es un cambio de formato de salida: se revierte el commit. No hay migración, ni
variable nueva (se reutiliza `LOG_LEVEL`), ni cambio de contrato de API.
