# T4 — Fuzz de payloads de conectores (SmartOLT + Mikrowisp)

**Feature**: `odd/tasks/fuzz-parsers.md`
**Specs**: S1, S3, S4, S5
**Ruta**: worker

## Qué hacer

Suite de fuzzing sobre la validación de respuestas de los dos conectores HTTP
(ambos validan a mano, no con Zod — ver L2 de la feature):

SmartOLT (`packages/connectors/smartolt/src/schemas.ts`):

- `parseStatusEnvelope` (:103), `parseOltsResponse` (:115), `parseOnusPageResponse`
  (:134), `parseOltUptimeResponse` (:165), `parseUptimeText` (:202),
  `parseTemperatureText` (:215), `parseEventStreamResponse` (:329),
  `parseSmartoltEventData` (:360), `parseSmartoltEventBatch` (:377).
- Errores permitidos: `SmartoltResponseShapeError` (`errors.ts:88`), y solo cuando
  corresponde `SmartoltRateLimitError` (:32) y `SmartoltPaginationLimitError` (:59).

Mikrowisp (`packages/connectors/mikrowisp/src/schemas.ts`):

- `parseMikrowispRouters` (:129), `parseMikrowispMonitoreo` (:137),
  `parseMikrowispClientes` (:145), `parseMikrowispOdbs` (:153).
- Error permitido: `MikrowispResponseShapeError` (:13).

Guardas obligatorias:

- **Crash**: cualquier otra excepción (por ejemplo `TypeError` al leer
  `.map` sobre un no-array, o `RangeError` por un número no finito) es un crash a
  reportar, no un resultado aceptable.
- **Fuga**: el `SmartoltResponseShapeError` / `MikrowispResponseShapeError` no puede
  contener el payload crudo ni el marcador sintético embebido en la entrada.
- **Límite**: filas y tamaños de entrada se mantienen acotados; la salida no crece
  desproporcionadamente respecto de la entrada.

Corpus semilla sintético en `tests/fuzz/corpus/` de cada conector: respuestas
normales mínimas, respuestas con un campo faltante, con tipos equivocados, con
`status` falso, listas vacías, números no finitos y payloads con marcador sintético.

## Superficie de edición permitida

- `packages/connectors/smartolt/tests/**` (suite y corpus)
- `packages/connectors/mikrowisp/tests/**` (suite y corpus)
- `packages/connectors/smartolt/package.json`,
  `packages/connectors/mikrowisp/package.json` (script `test:fuzz`)

## Fuera de superficie

No tocar `packages/connectors/*/src/**`. No commitear.

## Criterios de aceptación

- `pnpm --filter @ftth-copilot/connectors-smartolt test:fuzz` y
  `pnpm --filter @ftth-copilot/connectors-mikrowisp test:fuzz` pasan.
- El corpus semilla se carga y se ejecuta en cada corrida.
- Ninguna aserción depende de `any` implícito: TypeScript estricto.
