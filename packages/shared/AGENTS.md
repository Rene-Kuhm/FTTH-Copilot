# AGENTS.md — `@ftth-copilot/shared`

> Contexto para agentes que trabajan en este módulo. Las reglas generales del repo están en
> [AGENTS.md](../../AGENTS.md).

## Qué es

Capa L0. Los **contratos canónicos**: esquemas Zod, tipos de telemetría, el sobre de abstención y el
Expert System de Laya con su cliente y sus métricas.

## Qué invariantes cuida

- **Un tipo duplicado en dos paquetes es un bug.** Si un esquema Zod se necesita en otro módulo, se
  define acá y se importa: no se copia.
- **Los `schema: "ftth.*.v1"` son contratos de wire.** Cambiar su forma rompe clientes y las
  aserciones de `packages/eval`. Se agrega una versión nueva, no se edita la vigente.
- **`packages/shared/src/index.ts` es la superficie pública.** `tests/index-exports.test.ts` falla si
  un export desaparece: si sacás un símbolo, actualizá ese test en el mismo commit.
- **Nada de I/O.** Este paquete no toca base, red ni reloj del sistema.

## Cómo se prueba

```bash
pnpm --filter @ftth-copilot/shared test
```

## Qué no tocar

- Los esquemas con versión (`ftth.telemetry.v1`, `ftth.abstention.v1`, `ftth.verdict-log.v1`).
- `src/laya-*.ts`: el Expert System es la referencia de la decisión FTTH; su copia Python en
  `services/laya` tiene que seguir en sincronía con este código.
- `src/design-system/`: tokens y tipos de UI compartidos por `apps/web`.

## Superficie pública

`src/index.ts` reexporta `contracts`, `laya-expert-system`, `laya-metrics`, `laya-shadow`,
`laya-client` e `laya-integration`. El esqueleto completo lo imprime `mise run repo-map`.
