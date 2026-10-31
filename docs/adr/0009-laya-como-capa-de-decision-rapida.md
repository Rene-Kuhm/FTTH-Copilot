# ADR 0009 — Laya como capa de decisión rápida (System 1) con shadow mode

**Estado:** Aceptada
**Fecha:** 2026-09-27
**Documento original:** `docs/engineering/ADR-042-laya-decision-layer.md`

## Contexto

FTTH-Copilot tiene un Organic Diagnostic Router que elige entre `direct`, `assisted` e
`investigation` según señales de la consulta del operador. Es determinista y rule-based.

La propuesta de diseño era agregar **Laya** como una capa de decisión no autoregresiva que
clasifica eventos de red (alarmas, métricas) *antes* de invocar el pipeline generativo. La
premisa: la mayoría de los eventos son casos obvios —corte de fibra, falla de
alimentación— y clasificarlos barato libera al LLM para lo que de verdad necesita
investigación.

La forma obvia de implementarlo era un microservicio Python con FastAPI, como propone el
documento original, por "desacoplamiento".

## Decisión

Implementar Laya como **módulo TypeScript dentro del proceso Node**, y promoverlo a
microservicio sólo si aparece una justificación concreta (GPU dedicado o múltiples
clientes).

### Topología inicial

- La implementación primaria vive en `packages/shared/src/laya-expert-system.ts`, como
  `FTTHExpertClassifier`. Es un clasificador rule-based por keywords: cuenta coincidencias
  por clase, desempata por prioridad y deriva la confianza como
  `min(0.95, 0.5 + (score/max_possible)*0.45)`.
- Las clases de evento son `CONGESTION`, `DEVICE_FAULT`, `MASS_OUTAGE`, `NORMAL`,
  `OPTICAL_DEGRADATION`, `OPTICAL_FAULT`, `POWER_FAULT`, `UNKNOWN`, `UPLINK_FAULT`, cada
  una con su severidad (`EVENT_CLASS_SEVERITY`), scope probable
  (`EVENT_CLASS_SCOPE`) y si requiere investigación
  (`EVENT_CLASS_REQUIRES_INVESTIGATION`).
- `services/laya/` es un **espejo REST** del módulo TypeScript, no la fuente de verdad. Su
  propio docstring lo dice (`services/laya/app.py:8-9`).

### Modos y flags

- `LAYA_ENABLED` es el master switch, apagado por defecto. `LAYA_MODE` elige el modo:
  `disabled`, `shadow`, `assisted`, `automatic`.
- `shadow` **registra** cada decisión en `DecisionEvaluation` sin cambiar la ruta.
  `assisted` inyecta `eventClass` en el router cuando la confianza supera el umbral.
  `automatic` permite que la decisión de Laya tome la ruta.
- `LAYA_FAIL_OPEN=true` (default): si Laya no responde o excede el timeout, el pipeline
  sigue su curso normal y se registra `fallback` en vez de una decisión.
- `LAYA_SUGGEST_ROUTE=false` (default) es lo que separa `shadow` de `assisted`: sin él,
  Laya registra pero no sugiere.

### Persistencia

Cada decisión se guarda en `DecisionEvaluation`
(`packages/db/prisma/schema.prisma:554`), con `eventClass`, `severity`, `confidence`,
`latencyMs`, `actualRoute`, `operatorOutcome` y el flag `shadow`. La tabla existe para
**medir** contra lo que el operador hizo realmente, y para alimentar el dataset de
entrenamiento cuando haya suficientes ejemplos.

## Consecuencias

### Buenas

- **Sin latencia interna, sin red, sin autenticación interna.** Un clasificador rule-based
  que corre en proceso no puede ser el punto de falla del producto.
- El **fail-open** hace que la failure de Laya nunca pueda dejar al NOC sin responder.
- El modo `shadow` permite **validar antes de delegar**: se despliega, se colectan miles de
  decisiones reales con su veredicto contra la ruta que el sistema tomó de todos modos, y
  recién después se pasa a `assisted`. Es el orden correcto para un componente que
afecta decisiones.
- La tabla `DecisionEvaluation` convierte "Laya acierta el 94%" en una afirmación
  **medible**: cada fila tiene `suggestedRoute` y `actualRoute`.
- El kill switch (`LAYA_ENABLED=false`) revierte todo sin redeploy.
- El microservicio quedó disponible para el caso que lo justifique, y `services/laya` está
  en los compose de demo y producción detrás de un profile opt-in.

### Malas

- **El microservicio es una segunda implementación** de la misma lógica de clasificación, en
  otro lenguaje. Puede divergir del módulo TypeScript sin que nada lo detecte.
- El modo `shadow` **no cambia nada**, y en el peor caso el equipo cree que Laya está
  influyendo cuando no lo está.
- La clasificación por keywords es **específica de un idioma y de un vocabulario**. No hay
  modelo entrenado: el 94,4% de accuracy que menciona el docstring del módulo es sobre un
  corpus acotado.
- `LAYA_MODEL` y `LAYA_MODEL_VERSION` existen en la configuración, pero el clasificador
  actual es rule-based: la configuración sugiere un modelo que no está en uso.
- `DecisionEvaluation` es una tabla que **crece sin retención**: cada decisión de Laya
  escribe una fila, y no hay política de purga como la que existe para `MetricSample`.
- Agregar el microservicio al compose de producción agrega una dependencia de red entre
  la app y un componente que puede degradar en fail-open.

### Abiertas

- El número de decisiones necesarias para entrenar un modelo no está fijado. El docstring
  original menciona "≥5000 ejemplos reales" como umbral, pero no hay un gate que lo
  compruebe.
- No hay medición publicada de la tasa de acierto de Laya contra `operatorOutcome`.
- `LAYA_MODEL` / `LAYA_MODEL_VERSION` deberían retiring o pasar a tener efecto real.

## Nota de implementación

Un audit de runtime del 2026-10-07 encontró que la capa estaba construida, testeada y
documentada pero **inalcanzable desde el producto en ejecución**: `recordLayaDecision` no
estaba exportado desde `packages/shared/src/index.ts`, `layaMetrics` no tenía ningún
escritor, y por lo tanto `toPrometheusFormat()` emitía cabeceras y **cero muestras**. El
panel `/dashboard/laya` mostraba siempre "Sin decisiones registradas aún" e instruía
poner `LAYA_ENABLED=true`, lo que no cambiaba nada.

El PR #297 cerró tres defectos: el cliente parseaba una forma de respuesta que el servicio
nunca devolvía (toda decisión caía a `UNKNOWN` registrándose como `success`), `shadow`
registraba `success` antes de llamar al servicio, y `laya-integration`/`laya-client` no eran
alcanzables desde el paquete.

La lección que queda registrada: **un componente con su propia tabla, sus propias métricas y
su propio panel puede estar completamente desconectado y parecer funcionando**, porque
"el dashboard muestra vacío" es indistinguible de "todavía no pasó nada".
