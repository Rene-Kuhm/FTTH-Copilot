# AGENTS.md — `@ftth-copilot/connectors-smartolt`

> Contexto para agentes que trabajan en este módulo. Las reglas generales del repo están en
> [AGENTS.md](../../AGENTS.md).

## Qué es

Capa L1. El adaptador SmartOLT: cliente HTTP de producción y fixtures de laboratorio.

## Qué invariantes cuida

- **No habla directo con la base.** Pasa por `@ftth-copilot/connectors-core`, que es donde vive la
  política SSRF.
- **Las credenciales nunca viajan en el log ni en el error.** Vienen del descifrado del paquete
  `db` y se usan solo como header de autorización.
- **Los fixtures son sintéticos.** Nombres de OLT y de ONU de laboratorio, jamás datos de un
  cliente real.

## Cómo se prueba

```bash
pnpm --filter @ftth-copilot/connectors-smartolt test
```

Los tests del cliente de producción corren contra el mock HTTP; los del NMS mock, contra el
servidor local de laboratorio.

## Qué no tocar

- `src/fixtures.ts` sin actualizar el golden de conformance: los fixtures son la entrada de las
  pruebas de laboratorio.
- El contrato de `INmsConnector`: lo implementan también Mikrowisp y MikroTik.

## Superficie pública

`src/index.ts` exporta el cliente (`SmartoltClient`), los tipos y los fixtures (`FIXTURE_OLTS`,
`FIXTURE_ONUS`, `FIXTURE_ONU_DETAILS`). El esqueleto completo lo imprime `mise run repo-map`.
