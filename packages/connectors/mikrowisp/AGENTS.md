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

## Tests de contrato

`contract/mikrowisp-openapi.subset.json` es un subconjunto de la especificación del proveedor (el
espejo machine-readable que publica `skmtc.dev/mikrosystem/apis/mikrowisp`, que replica
`docs.mikrosystem.net`) con sólo los endpoints que el conector llama. Se regenera con:

```bash
pnpm --filter @ftth-copilot/connectors-mikrowisp contract:sync
```

La sincronización acepta JSON de hasta 16 MiB y publica el subconjunto de forma atómica en `contract/`.

`tests/contract.test.ts` corre offline contra ese archivo: falla si el cliente llama a una ruta que
el contrato no publica, si manda un parámetro de cuerpo que el endpoint no declara, si omite uno
obligatorio o si los ejemplos oficiales dejan de parsear con `src/schemas.ts`.

## Qué no tocar

- `src/fixtures.ts` sin actualizar el golden de conformance.
- El contrato de `INmsConnector`, que es compartido con SmartOLT y MikroTik.

## Superficie pública

`src/index.ts` exporta `MikrowispClient`, los tipos y los fixtures (`FIXTURE_ROUTERS`,
`FIXTURE_CLIENTES`, `FIXTURE_ONUS`, `FIXTURE_ODBS`). El esqueleto completo lo imprime
`mise run repo-map`.
