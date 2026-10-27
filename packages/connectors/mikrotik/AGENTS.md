# AGENTS.md — `@ftth-copilot/connectors-mikrotik`

> Contexto para agentes que trabajan en este módulo. Las reglas generales del repo están en
> [AGENTS.md](../../AGENTS.md).

## Qué es

Capa L1. El adaptador MikroTik RouterOS v7: REST con fallback a la API binaria (puerto 8728), y
credenciales cifradas guardadas en PostgreSQL.

## Qué invariantes cuida

- **El fallback es explícito:** REST primero, API binaria solo cuando REST no está disponible. El
  orden no se invierte sin una decisión.
- **Las credenciales se descifran en el momento de usarlas** (vía `@ftth-copilot/security` y
  `@ftth-copilot/db`) y no se persisten en claro.
- **El egreso pasa por `@ftth-copilot/connectors-core`**, igual que los otros adaptadores.

## Cómo se prueba

```bash
pnpm --filter @ftth-copilot/connectors-mikrotik test
```

## Qué no tocar

- `src/adapter.ts` sin revisar el golden de conformance: el adaptador traduce la API de RouterOS a
  los tipos canónicos de NMS.
- La lógica de descifrado de credenciales: es superficie de secreto.

## Superficie pública

`src/index.ts` exporta el cliente, el adaptador y los fixtures (`FIXTURE_INTERFACES`,
`FIXTURE_SFP_METRICS`, `FIXTURE_PPPOE_SESSIONS`, `FIXTURE_BGP_SESSIONS`).
El esqueleto completo lo imprime `mise run repo-map`.
