# AGENTS.md — `@ftth-copilot/connectors-mikrowisp`

> Contexto para agentes que trabajan en este módulo. Las reglas generales del repo están en
> [AGENTS.md](../../AGENTS.md).

## Qué es

Capa L1. El adaptador Mikrowisp: cliente HTTP de producción y fixtures de laboratorio.

## Qué invariantes cuida

- **No habla directo con la base.** Toda salida pasa por `@ftth-copilot/connectors-core` (política
  SSRF).
- **El token de Mikrowisp es un secreto.** Va en header, nunca en logs, errores ni fixtures.
- **Los fixtures son sintéticos**, con topología de laboratorio y no de un cliente real.

## Cómo se prueba

```bash
pnpm --filter @ftth-copilot/connectors-mikrowisp test
```

## Qué no tocar

- `src/fixtures.ts` sin actualizar el golden de conformance.
- El contrato de `INmsConnector`, que es compartido con SmartOLT y MikroTik.

## Superficie pública

`src/index.ts` exporta `MikrowispClient`, los tipos y los fixtures (`FIXTURE_ROUTERS`,
`FIXTURE_CLIENTES`, `FIXTURE_ONUS`, `FIXTURE_ODBS`). El esqueleto completo lo imprime
`mise run repo-map`.
