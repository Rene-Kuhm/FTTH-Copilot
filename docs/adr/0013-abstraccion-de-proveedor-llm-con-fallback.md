# ADR 0013 — Abstracción de proveedor LLM con cadena de fallback

**Estado:** Aceptada
**Fecha:** 2026-08-20 en adelante (`packages/agent-core/src/llm.ts`)

## Contexto

El agente necesita un LLM. En el mundo real de un ISP, ese LLM no es siempre el mismo:

- El cliente puede tener su propio contrato con un proveedor, y exigir que el tráfico no
  salga de su red.
- Los proveedores de inferencia tienen outages y límites de tasa. Un 429 o un 5xx en
  middle de un incidente de red es exactamente el peor momento para devolver un error al
  operador.
- Los modelos cambian de nombre y de disponibilidad sin avisar. Un modelo descontinuado
  rompe el producto de un día para el otro.
- El desarrollo y el CI **no pueden depender de una API key de pago**: el workflow de
  evaluación corre todas las noches sin credenciales.

Al mismo tiempo, el sistema necesita hablar con APIs que **no son iguales**: unas tienen
el formato de mensajes de Anthropic, otras el de OpenAI. Y necesita **saber** con qué
proveedor respondió, para medir latencia, tokens y costo por proveedor.

## Decisión

Definir una **interfaz de cliente LLM propia**, con implementaciones para los dos formatos
de API dominantes, y una **cadena de fallback** configurable por entorno.

- La interfaz vive en `packages/agent-core/src/llm.ts`, con implementaciones estilo
  Anthropic (`@anthropic-ai/sdk`) y estilo OpenAI (`openai`), ambas ya declaradas como
  dependencias del paquete.
- El proveedor se elige con `LLM_PROVIDER` (`llm.ts:350`), entre `minimax`, `deepseek` y
  `qwen`. **Si hay `LLM_FALLBACK`, el fallback tiene prioridad** sobre `LLM_PROVIDER`
  (`llm.ts:350`).
- La cadena de fallback es una **lista separada por comas** y sólo actúa ante errores
  **transitorios**: 429, 5xx y errores de red (`llm.ts:339-355`). Un error de validación o
  de autenticación **no** hace fallback: la cadena entera fallaría igual y sólo se
  retrasaría el error real.
- Cada proveedor tiene su propia base URL y su propio modelo por defecto:
  `MINIMAX_BASE_URL` (`https://api.minimax.io/anthropic`), `DEEPSEEK_BASE_URL`
  (`https://api.deepseek.com/v1`), `QWEN_BASE_URL`
  (`https://dashscope.aliyuncs.com/compatible-mode/v1`), con `*_MODEL` por defecto.
- **Una API key con placeholder se considera inválida**: si contiene `your-key-here` o
  `replace-with`, el proveedor se salta (`llm.ts:360-366`). Así, un `.env` copiado del
  ejemplo no produce un proveedor que falla en tiempo de request.
- Sin proveedor configurado, `createLlmClient` lanza `No hay proveedor LLM configurado`
  (`llm.ts:427-429`).
- El motor de investigación tiene su propio **fallback determinista**:
  `buildDeterministicHypotheses` (`packages/agent-core/src/investigation-engine.ts:58`) se
  invoca cuando no hay LLM, cuando el resultado viene vacío o cuando la llamada falla
  (`:324`, `:336`, `:313-314`).
- La telemetría mide por proveedor: `ftth_copilot_llm_requests_total`,
  `ftth_copilot_llm_tokens_total`, `ftth_copilot_llm_latency_seconds_total` y
  `ftth_copilot_llm_fallback_events_total`.

## Consecuencias

### Buenas

- **El proveedor es un detalle de configuración**, no de código: cambiar de proveedor no
  toca el agente.
- El fallback convierte un outage de proveedor en una **degradación** en vez de un
  incidente para el cliente.
- **El CI corre sin credenciales**: el harness de evaluación es keyless porque el motor
  tiene fallback determinista. Es lo que permite el workflow `eval-nightly.yml`.
- **El placeholder se trata como clave inválida**: el fallo aparece en el arranque, no en
  la primera consulta de un operador.
- La distinción entre errores transitorios y permanentes evita **encadenar fallos**:
  una API key incorrecta falla una vez y se reporta, en vez de probar tres proveedores.
- Las métricas por proveedor permiten **decidir con datos** a cuál moverse y cuánto cuesta
  cada uno.
- El fallback determinista del motor de investigación garantiza que el producto **sigue
  diagnosticando** sin depender de un tercero.

### Malas

- **Dos implementaciones de cliente** (Anthropic y OpenAI) que mantener, con dos estilos de
  streaming, de errores y de conteo de tokens.
- La precedencia "`LLM_FALLBACK` gana sobre `LLM_PROVIDER`" es **sorprendente**: quien
  configure ambos esperando que el primario domine va a obtener el contrario. La regla está
  documentada en el código, pero no en ningún `.env.example`.
- El fallback **cuesta latencia**: reintentar ante un 5xx con el timeout por defecto
  (`NMS_REQUEST_TIMEOUT_MS` es para el NMS; el del LLM es propio) puede duplicar el tiempo
  de respuesta de una consulta.
- El fallback **cambia el modelo que responde**, lo que rompe la reproducibilidad de las
  investigaciones: dos versiones del mismo incidente pueden tener `modelVersion` distinto
  por un outage. La versión lo registra, lo cual salva la auditabilidad, pero no la
  comparabilidad.
- Los defaults de modelo (`MiniMax-M3`, `deepseek-chat`, `qwen-plus`) **envejecen**: un
  nombre de modelo descontinuado rompe el producto sin que ningún test lo detecte.
- El salto de proveedor **cambia el comportamiento del modelo** (distintas herramientas,
  distinto formato de tool call). La abstracción unifica la interfaz, no las capacidades.

### Abiertas

- No hay un **budget de tokens o de costo** por request ni por tenant. `AgentResult` expone
  `tokens` y `costUsd`, pero no hay un corte.
- El timeout del LLM no está expuesto como variable de entorno, a diferencia del timeout del
  NMS.
- No hay un test que verifique que la cadena de fallback se comporta como se documenta
  frente a cada tipo de error.
