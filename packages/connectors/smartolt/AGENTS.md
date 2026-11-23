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
- **Los eventos no traen FEC.** El stream de eventos avisa de estados y potencias; los contadores
  FEC siguen saliendo de `get_onu_details/{id}`.
- **El token del stream no se loguea.** La URL del stream lleva su propio token en el query; los
  errores y la salud dicen el estado HTTP y el motivo, nunca la URL completa.

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

**El presupuesto es de la cuenta, no de la instancia.** `src/rate-limit-registry.ts` guarda un
guardia por cuenta —clave = URL base + hash SHA-256 de la API key, nunca la key cruda— para que el
cliente nuevo que arma el scheduler en cada tick no reinicie el contador de la hora. Un cliente con
reloj inyectado (`now`/`sleep`) queda fuera del registro: su ventana la mueve otro reloj.

## Eventos en tiempo real (SSE)

`src/events.ts` implementa el stream de octubre 2026:

```
GET /api/onu/get_event_stream?events=<lista>
  → { status: true, response: { url, expires_in: 900 } }
  → abrir `url` (SSE) con `Last-Event-ID: <último id>`
```

Cada frame trae `id`, `event` y `data` (`{"type", "timestamp", "data": {"onus"|"pons"|"olts"}}`).
El stream se cierra a la hora: el cliente vuelve a pedir la URL y se reconecta con el último `id`,
con backoff acotado. Los eventos de control se entregan tipados: `resync` (recargar el estado
actual), `expired` (pedir URL nueva) y `disabled` (la API key se deshabilitó: el loop termina). El
`: ping` de cada 25 s sale como `{ kind: 'ping' }` y es la señal de vida del loop.

| Variable | Default | Qué hace |
|---|---|---|
| `SMARTOLT_EVENT_STREAM_ENDPOINT_PER_HOUR` | `60` | Pedidos de URL por hora y por cuenta (`SmartoltHourlyBudget`, `violationType: 'per_endpoint'`) |
| `SMARTOLT_EVENT_BACKOFF_INITIAL_MS` | `1000` | Primera espera tras una falla del stream |
| `SMARTOLT_EVENT_BACKOFF_MAX_MS` | `60000` | Tope de la espera entre reintentos |
| `SMARTOLT_EVENT_STREAM_ALLOWED_HOSTS` | — | Hosts extra admitidos para la URL del stream (por defecto, sólo el de la API) |

Si el endpoint responde 503 (stream no disponible) o 403 (la clave no es de cliente), el cliente
entrega `{ kind: 'fallback_polling' }` y termina: el poll programado sigue cubriendo la conexión. Un
400 (tipo de evento desconocido) es un error de configuración y sale como `SmartoltEventStreamError`.

**El cuerpo se cancela al reconectar.** Al salir por `expired`, por un error de lectura o porque el
consumidor cortó la iteración, el generador suelta el lock del cuerpo y lo cancela. Sin eso, cada
reconexión deja el socket del stream anterior abierto: la URL vence cada 15 minutos y el stream
cierra a la hora, así que la fuga es un socket por reconexión.

**El apagado no espera el backoff.** La espera entre reintentos y el pedido de la URL se cortan con
el `AbortSignal` del consumidor: `events({ signal })` termina en el momento del aborto y no al
vencer `SMARTOLT_EVENT_BACKOFF_MAX_MS` (60 s) ni el timeout de la petición.

**`disabled` es terminal, y una key rotada necesita un worker nuevo.** `disabled` significa que la
API key se deshabilitó o cambió. La key que el cliente tiene es la que el dueño del loop descifró
al arrancar; pedir otra URL con esa misma key no puede funcionar, así que el cliente no reintenta y
el loop del worker cierra esa conexión. El poll programado sí toma la key nueva, porque arma el
conector en cada tick; el **stream** no vuelve hasta **reiniciar el worker**. Re-leer la key de la
base desde el loop del stream sería un segundo camino de lectura y descifrado por reconexión para
un evento que también puede significar que la clave se deshabilitó de verdad, y no agrega nada
sobre la operación que ya existe: reiniciar el worker, que vuelve a listar las conexiones y a
descifrar la key vigente.

La URL del stream se valida contra el host de la URL base de la API y no contra la política SSRF de
URL base, que rechazaría el query del token y el puerto 8443 del proveedor. Es una decisión
deliberada: el host es el que el operador ya configuró y ya pasó la política.

## Tests de contrato

`contract/smartolt-openapi.subset.json` es un subconjunto de la especificación oficial
(`https://www.smartolt.com/openapi.json`) con sólo los endpoints que el conector llama, más los
ejemplos del cuerpo de cada evento (`eventExamples`, que la spec publica bajo el webhook). Se
regenera con:

```bash
pnpm --filter @ftth-copilot/connectors-smartolt contract:sync
```

`tests/contract.test.ts` corre offline contra ese archivo: falla si el cliente pide una ruta o un
query que la especificación no declara, si el pedido de la URL del stream no está en el contrato, y
si los ejemplos oficiales (respuestas y eventos) dejan de parsear con `src/schemas.ts`. Si el
proveedor cambia la API, el CI falla.

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

`src/index.ts` exporta el cliente (`SmartOltClient`), el cliente del stream
(`SmartoltEventStream`, `SmartoltSseParser`), los errores (`SmartoltRateLimitError`,
`SmartoltPaginationLimitError`, `SmartoltResponseShapeError`, `SmartoltEventStreamError`), la política
de presupuesto (`SMARTOLT_DEFAULT_RATE_LIMIT`, `SmartoltRateGovernor`, `SmartoltHourlyBudget`,
`resolveSmartoltRateLimitConfig`, el registro por cuenta `getAccountRateGovernor` /
`smartoltAccountKey`), el parseo del borde (`parseEventStreamResponse`, `parseSmartoltEventBatch`,
`SMARTOLT_EVENT_TYPES`) y los helpers de paginación (`formatUpdatedSince`,
`resolveSmartoltMaxPages`). Los fixtures siguen exportados (`FIXTURE_OLTS`, `FIXTURE_ONUS`,
`FIXTURE_ONU_DETAILS`). `SMARTOLT_RATE_LIMIT_PER_HOUR` sigue exportada pero está deprecada: vale el
presupuesto de la cuenta, no el tope del export completo. El esqueleto completo lo imprime
`mise run repo-map`.
