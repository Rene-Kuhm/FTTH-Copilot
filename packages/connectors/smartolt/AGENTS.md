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
- **El presupuesto de llamadas se respeta.** La API de octubre 2026 da 1.000 llamadas por hora y
  15 por segundo, y corta con 429 + `Retry-After`. El cliente pagina siempre
  (`page`/`page_size=100`): el export completo sin `page` tiene su propio tope de 15 por hora.
- **`get_olts` no es un heartbeat.** La propia API lo prohíbe; el ping va a `get_zones`.

## Presupuesto y paginación

| Variable | Default | Qué hace |
|---|---|---|
| `SMARTOLT_RATE_LIMIT_PER_HOUR` | `1000` | Llamadas por hora antes de negarse a llamar |
| `SMARTOLT_RATE_LIMIT_PER_SECOND` | `15` | Guardia por segundo (espera el hueco) |
| `SMARTOLT_MAX_RETRY_AFTER_MS` | `30000` | Espera máxima que se acepta de un `Retry-After`; más que eso falla rápido |
| `SMARTOLT_RATE_LIMIT_MAX_RETRIES` | `2` | Reintentos de un 429 antes de fallar |
| `SMARTOLT_MAX_PAGES` | `50` | Tope de páginas por lectura de inventario (falla, no trunca) |

Un 429 que pide más espera que el tope, o el presupuesto agotado, sale como
`SmartoltRateLimitError` (`code: 'RATE_LIMIT'`, `violationType`, `retryAfterSeconds`), que
`isRateLimitError` de `connectors-core` reconoce. Quien orquesta decide cuándo volver.

## Tests de contrato

`contract/smartolt-openapi.subset.json` es un subconjunto de la especificación oficial
(`https://www.smartolt.com/openapi.json`) con sólo los endpoints que el conector llama. Se regenera
con:

```bash
pnpm --filter @ftth-copilot/connectors-smartolt contract:sync
```

`tests/contract.test.ts` corre offline contra ese archivo: falla si el cliente pide una ruta o un
query que la especificación no declara, y si los ejemplos oficiales dejan de parsear con
`src/schemas.ts`. Si el proveedor cambia la API, el CI falla.

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

`src/index.ts` exporta el cliente (`SmartOltClient`), los errores (`SmartoltRateLimitError`,
`SmartoltPaginationLimitError`, `SmartoltResponseShapeError`), la política de presupuesto
(`SMARTOLT_DEFAULT_RATE_LIMIT`, `resolveSmartoltRateLimitConfig`), los helpers de paginación
(`formatUpdatedSince`, `resolveSmartoltMaxPages`) y los fixtures (`FIXTURE_OLTS`, `FIXTURE_ONUS`,
`FIXTURE_ONU_DETAILS`). `SMARTOLT_RATE_LIMIT_PER_HOUR` sigue exportada pero está deprecada: vale
el presupuesto de la cuenta, no el tope del export completo. El esqueleto completo lo imprime `mise run repo-map`.
