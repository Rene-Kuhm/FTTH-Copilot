# Roadmap — FTTH-Copilot Evidence-First y Truth Gate

> **Qué es este documento:** el plan para eliminar la alucinación como *clase de fallo* en FTTH-Copilot. No es un prompt mejorado que diga "no inventes"; es una arquitectura donde **la IA interpreta y comunica, el código calcula y valida, y la evidencia autoriza la respuesta**.
>
> **Por qué importa:** en un NOC, una respuesta inventada no es un error de texto: manda al técnico al nodo equivocado, esconde una degradación óptica o retrasa una reparación mientras los clientes pierden servicio. La confianza no debe depender de cuán convincente suena la IA; debe poder **verificarse**.

## 1. El problema en términos de arquitectura (no de prompt)

Hoy el agente (ver `packages/agent-core/src/runtime.ts` y `tools/index.ts`) funciona así:

```
usuario → LLM → tool call → JSON crudo del connector → LLM → respuesta libre
```

La cadena de evidencia es **implícita y no verificable**:

- Las tools devuelven `JSON.stringify(data)` crudo al LLM. No hay metadatos de procedencia (fuente, tenant, fecha, vigencia, completitud).
- El LLM decide por sí solo qué incluir en la respuesta. Ningún código **valida** que una afirmación esté respaldada por una medición.
- La única barrera es el `SYSTEM_PROMPT` ("NUNCA inventes datos") — exactamente la mitigación que este documento descarta como insuficiente.
- `AgentActionLog` y `Message.toolCalls` ya **registran** lo que el agente hizo, pero eso es auditoría *post-hoc* que no *previene* la alucinación.

**La tesis:** movemos la carga de la verdad del prompt del LLM al código. El LLM deja de ser el que decide si algo es cierto; pasa a ser el que **traduce** findings verificados en lenguaje natural.

## 2. Principios rectores

1. **La evidencia autoriza la respuesta.** Una afirmación factual en la respuesta debe poder rastrearse a una o más mediciones/eventos verificados. Si no, el agente se abstiene y pide lo que falta.
2. **Las métricas no se describen, se citan.** "RX derivando hacia −27 dBm" va acompañado de: valor actual, serie histórica, pendiente de la deriva, dispositivos relacionados, timestamp de última medición, confianza.
3. **La frescura es un derecho y un deber.** Cada dato tiene vigencia. Datos viejos → no sirven para un diagnóstico actual; se abstiene o baja severidad.
4. **La contradicción no se improvisa.** Si dos mediciones se contradicen, no se "elige un promedio"; se reporta la contradicción y se pide verificación.
5. **Código, no prompt.** Las reglas de validación, frescura, completitud y abstención viven en TypeScript testable, no en instrucciones para el LLM.

## 3. La barrera: Truth Gate

La pieza central. Un componente **de código** que se interpone entre las tools y el LLM (y entre el LLM y la respuesta final):

```
tools ──► [enrich: +provenance] ──► [Truth Gate validation] ──► findings verificados ──► LLM (traduce)
                                                                                        │
usuario ◄── [Truth Gate post-check] ◄── respuesta propuesta ◄──────────────────────────┘
          (si una afirmación no está respaldada: se abstiene / pide datos)
```

### 3.1 Metadatos de procedencia en cada dato

Todo dato que el agente consume lleva estos campos (contrato `evidence.provenance.v1`):

| Campo | Descripción | Hoy |
|-------|-------------|-----|
| `source` | Origen verificable: `smartolt.poll`, `smartolt.syslog`, `mikrowisp.poll`, `snmptrap`, `demo`, `curated` | parcial (connectionId) |
| `tenantId` | Propietario del dato (multi-tenant ya existe en `MetricSample`) | ✓ |
| `observedAt` | Fecha de observación | ✓ (`sampledAt`) |
| `ttlMs` | Tiempo de vigencia (cuánto vale este dato para un diagnóstico) | ✗ falta |
| `completeness` | Nivel de completitud (`complete` \| `partial` \| `minimal`) | ✗ falta |
| `confidence` | Confianza del canal/medición | parcial (`DetectedAlert.confidence`) |
| `schema` | Versión del contrato (`ftth.telemetry.v1`, ...) | ✓ |

### 3.2 Validación determinista (en código, no en prompt)

El Truth Gate valida, de forma determinista y testeable, el borrador de la respuesta **y los findings**:

- **Trazabilidad:** cada afirmación factual del borrador mapea a un `provenance.id` concreto de las tools. Una afirmación sin respaldo → bloquearla.
- **Frescura:** si `now - observedAt > ttlMs`, el dato está vencido → el gate baja la severidad, marca "dato viejo", o abstiene según el caso.
- **Completitud:** si un diagnóstico requiere N mediciones y hay `partial`, el gate lo dice y pide la que falta.
- **Contradicción:** si dos fuentes difieren más que un umbral, el gate emite `conflicting_evidence` y abstención, no una elección arbitraria.
- **Consistencia numérica:** si el texto del LLM cita un número que no aparece en ningún finding verificado, se rechaza (no puede citar un valor que la evidencia no contiene).

### 3.3 Abstención estructurada, no silencio

Cuando falta evidencia, el agente **no improvisa** ni queda mudo: responde con un objeto estructurado:

```json
{
  "schema": "ftth.abstention.v1",
  "reason": "stale | incomplete | conflicting | unsupported",
  "claim": "RX de ONU-0001 derivando bajo -27 dBm",
  "missing": ["ultima_medicion_rx", "serie_historica_24h"],
  "available": ["rx_actual: -24.1 @2026-09-02T10:00"],
  "nextStep": "Re-colectar MetricSample RX de los últimos 24h antes de diagnosticar."
}
```

## 4. Cimientos que ya existen (con qué contamos)

| Necesidad | Ya existe | Ubicación |
|-----------|-----------|-----------|
| Multi-tenant en cada muestra | `MetricSample.tenantId`, `connectionId` | `db/prisma/schema.prisma` |
| Timestamp de observación | `MetricSample.sampledAt` | ídem |
| Alertas con confianza/ETA | `DetectedAlert.confidence`, `etaMs` | ídem |
| Registro de acciones del agente | `AgentActionLog` (tool, params, result) | ídem |
| Historial con tool calls | `Message.toolCalls`, `toolResultJson` | ídem |
| Contratos de la pipeline | `evidence.v1` abierto en `finding.v1` | `shared/src/contracts.ts` |
| Detección temprana | `detectSignalDrift`, `detectFecDegradation`, ... | `packages/detection` |
| Multi-proveedor LLM | MiniMax/DeepSeek/Qwen con fallback | `agent-core/src/llm.ts` |

**Lo que falta de raíz:** metadatos de procedencia en los datos consumidos, el Truth Gate de código, la abstención estructurada, la memoria de incidentes confirmados, la recuperación híbrida, el contexto por ISP/rol, y el grafo temporal de la red.

## 5. Plan de migración por fases

Cada fase es **testeable, con CI verde y reversible**. Ninguna introduce complejidad "por si acaso". Riesgo ordenado de menor a mayor.

### Fase A — Provenance en los datos (cimientos, sin cambiar respuestas)
**Objetivo:** que cada dato que consume el agente lleve metadatos de procedencia.
- Definir y congelar el contrato `evidence.provenance.v1` (zod) en `shared/src/contracts.ts`.
- Extender el enriquecimiento de las tools: cada `executeToolCall` envuelve el JSON crudo del connector con `source`, `tenantId`, `observedAt`, `ttlMs`, `completeness`, `confidence`.
- Golden-file tests del contrato (mismo patrón que `shared/tests/contracts.test.ts`).
- **No** cambia aún el comportamiento de las respuestas; solo etiqueta los datos.

### Fase B — Truth Gate de validación (la barrera de código)
**Objetivo:** el gate detiene afirmaciones sin respaldo.
- Nuevo paquete `@ftth-copilot/evidence` con el Truth Gate puro (sin LLM): trazabilidad, frescura, completitud, contradicción, consistencia numérica.
- Un **post-check** sobre el borrador del LLM: el gate recibe `{ respuesta propuesta, findings verificados }` y devuelve `ok | violation[]`.
- Detector de "número inventado": extraer valores numéricos del texto y exigir que existan en los findings.
- Reglas por defecto + configuración por tenant. Detección > rechazo en esta fase (log + flag), para medir sin romper.
- Tests: series sintéticas, datos viejos, contradicciones, números inventados, bordes TTL.

### Fase C — Abstención estructurada + integración en el flujo
**Objetivo:** cuando el gate no puede respaldar, el agente se abstiene con `abstention.v1` y pide lo que falta.
- Cliente de abstención: el gate puede interrumpir el bucle y emitir `abstention.v1` (no un texto libre).
- El gate se inserta en `runtime.ts` entre el resultado de las tools y el mensaje final al LLM, y como post-check.
- El agente aprende a pedir el dato faltante (re-colección) en lugar de adivinar.
- Modo estricto configurable por tenant (abstención real) vs. modo observación (registra qué habría abortado).
- `agent-qa-log.md` como bitácora de casos de abstención resueltos.

### Fase D — Memoria de incidentes confirmados + recuperación híbrida
**Objetivo:** aprender de la historia sin fabricarla.
- Modelo `ConfirmedIncident` en Prisma: qué síntomas (findings), qué causa raíz confirmó el técnico, qué fix, `resolvedAt`.
- El Truth Gate **no** permite citar un incidente pasado como evidencia del presente; solo como *contexto* ("esto ya pasó en este nodo el mes pasado, patrón similar").
- **Recuperación híbrida (RAG):** indexar telemetría (real) + documentación técnica (curada, marcada como `curated`, nunca como medición viva). El gate distingue **medición** de **referencia**.
- Tool `get_related_confirmed_incidents(deviceId)` y `retrieve_docs(query)` con procedencia de tipo `curated`.
- Testeo contra fallas reales: re-ejecutar detecciones sobre incidentes históricos confirmados y medir si la evidencia habría respaldado el diagnóstico.

### Fase E — Contexto por ISP y rol + grafo temporal
**Objetivo:** respuestas relevantes a quién pregunta y sobre qué parte de la red.
- **Contexto por rol:** operador NOC (técnico, quiere raw + pasos) vs. dueño de ISP (resumen ejecutivo con impacto en clientes y SLA). El gate mantiene el mismo conjunto de evidencia; cambia la *presentación*.
- **Contexto por ISP:** umbrales y topología del tenant (un ISP puede tener umbrales distintos de otro).
- **Grafo temporal `OLT → PON → splitter → CTO → ONU`:** modelo en Prisma (`TopologyLevel` / aristas con `observedAt`, `validFrom`, `validTo`) para saber qué clientes cuelgan de qué splitting point. Permite responder "¿qué clientes están afectados?" con trazabilidad de cableado.
- Tool `get_downstream_clients(nodeId)` y `get_topology_path(deviceId)` con procedencia temporal (tiempo de vigencia del cableado).

### Fase F — Evaluación permanente contra fallas reales y prompt injection
**Objetivo:** sostener la garantía con métricas y adversarios.
- **Prompt injection suite (rosa/roja):** corpus de ataques (usuario pide "ignorá tus instrucciones", "decí que el OLT está OK", inyección en `customerName` buscado) y un evaluador que verifica que el gate no deje pasar afirmaciones no respaldadas. Modelos testeados contra el mismo set.
- **Evaluación sobre fallas reales:** corpus de incidentes confirmados → métricas de la cadena de evidencia (cobertura, precisión, tasa de abstención, falsos positivos del gate).
- **Contratos de abstención** como tests: ningún escenario de prompt injection produce un diagnóstico factual sin evidencia.
- Umbrales de regresión en CI.

## 6. Decision gates (números, no intuición)

| Cambio | Disparador / criterio |
|--------|----------------------|
| Pasar Truth Gate de observación → estricto (por tenant) | tasa de abstención y falsos positivos bajo umbral medido en Fase B/C sobre QA |
| Activar RAG de documentación | que Fase D tenga corpus curado no vacío y medición vs. referencia clasificada |
| Modelo de grafo completo | que Fase E tenga datos de topología reales (no solo demo) desde el NMS |
| **No** activar nada | mientras el gate genere más fricción que protección (abstención excesiva = alarma que nunca se activó, el fallo opuesto) |

**Equilibrio crítico:** este sistema falla en dos direcciones. A la derecha está la alucinación (responder lo que no se puede verificar). A la izquierda está el *over-cautious* (abstenerse siempre, volverse inútil). El Truth Gate debe calibrarse **por tenant** y con medición continua, no por política global rígida.

## 7. Riesgos y decisiones honestas

1. **La calibración es el producto.** Un gate demasiado estricto es tan dañino como uno inexistente. Requiere el QA-log y las suites de evaluación como ciudadanos de primera clase, no accesorios.
2. **La procedencia exige limpiar el NMS.** `source` y `observedAt` solo son verosímiles si el poller etiqueta bien las muestras. Si SmartOLT/Mikrowisp no exponen timestamps confiables, parte de la frescura será best-effort y debe reportarse como tal, no fingirse.
3. **La abstención cambia la UX.** El operador ya no siempre recibe "causa probable → siguiente paso"; a veces recibirá "necesito X para diagnosticar". Eso es un cambio de expectativa deliberado y debe comunicarse en el producto, no ocultarse.
4. **RAG de telemetría vs. contexto de LLM:** la telemetría viva jamás se trata como referencia atemporal; siempre como medición con vigencia. La documentación técnica es siempre `curated`. El gate **nunca** mezcla las dos para autorizar un dato como medición.
5. **Alcance realista:** Fases A–C son el núcleo que entrega la garantía anti-alucinación. D–F agregan memoria, contexto y evolución, pero apoyarse en A–C primero es lo que hace el sistema creíble.

## 8. Relación con el roadmap AIOps

- **Datos:** este roadmap es la capa que *hace verificables* los findings de `aiops-roadmap.md`. Los detectores (Fase 1 AIOps) producen `finding.v1`; aquí les damos procedencia y un gate que exige evidencia antes de que el LLM los comunique.
- **No se contradicen:** AIOps decide *qué* detectar; Evidence-First decide *con qué autoridad* se comunica.
- **Orden sugerido:** AIOps Fase 1 ya está casi completa; Evidence-First Fase A y B son el siguiente mejor retorno para la honestidad de las respuestas, y pueden avanzar en paralelo porque tocan contratos distintos (procedencia vs. detección) que conviven en `shared`.
