# AGENTS.md — `@ftth-copilot/agent-core`

> Contexto para agentes que trabajan en este módulo. Las reglas generales del repo están en
> [AGENTS.md](../../AGENTS.md).

## Qué es

Capa L3. **El único paquete que llama al LLM.** Organic Diagnostic Router, motor de investigación,
registro de herramientas, prompts, cliente LLM con cadena de fallback y trazas OTLP.

## Qué invariantes cuida

- **El router decide cuánto razona, no cuánto inventa.** `direct` no llama al LLM; `assisted` hace
  una llamada; `investigation` hace hasta seis. El modo se decide antes de cualquier llamada.
- **La abstención no se reescribe.** El texto del LLM llega byte a byte; la TruthGate y el canal de
  advertencia van aparte.
- **El fallback de proveedor es determinista y observable.** Si el proveedor primario falla, se
  cambia de proveedor y queda registrado.
- **El presupuesto de tokens y de costo se acumula y se reporta** (`tokens`, `costUsd`,
  `latencyMs`).

## Cómo se prueba

```bash
pnpm --filter @ftth-copilot/agent-core test
```

Los tests usan MSW: **el CI no llama a ningún LLM**.

## Qué no tocar

- `src/adaptive-router.ts` y `src/diagnostic-router.ts`: la clasificación de la consulta es la
  decisión de producto; cambiarla cambia el costo y la latencia.
- `src/llm.ts` sin revisar la cadena de fallback: una caída del proveedor tiene que seguir siendo
  un fallo controlado.
- Los prompts (`src/prompts/`) sin su test: son contrato con el modelo, no texto libre.

## Superficie pública

`src/index.ts` exporta `runAgent`, los routers, el motor de investigación, el registro de
herramientas y el cliente LLM. El esqueleto completo lo imprime `mise run repo-map`.
