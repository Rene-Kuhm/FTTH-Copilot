# Walkthrough — FTTH-Copilot v0.1.0

> **Duración:** ~3 minutos de lectura · **Video:** [`ftth-copilot-demo-16x9.mp4`](assets/ftth-copilot-demo-16x9.mp4) (37 s, 16:9)
>
> **Datos en este walkthrough:** todos sintéticos. Cada pantalla lleva el banner
> `DEMO · DATOS SINTÉTICOS`.

---

## Escenario de demo

El video demuestra dos casos de uso del Organic Diagnostic Router sobre los fixtures de SmartOLT:

| Caso | Consulta | Modo | LLM calls |
|---|---|---|---|
| **DIRECT** | "¿Estado de OLT-Norte-01?" | `direct` | 0 |
| **INVESTIGATION** | "¿Cuál es la causa raíz de la caída de RX en OLT-Este-01?" | `investigation` | 4 |

Los datos vienen de `packages/connectors/smartolt/src/fixtures.ts` (42 ONUs, 5 OLTs, escenarios de falla embebidos).

---

## Caso 1 — DIRECT: consulta de estado en 0 llamadas LLM

### Lo que pasa

1. El operador escribe: **"estado de OLT-Norte-01"**
2. El Adaptive Router clasifica la intención como `routine_topology` → modo `direct`
3. Se ejecuta una sola tool call: `get_olt_detail(oltId: "OLT-NORTE-01")`
4. La respuesta llega en **3 ms** sin invocar al LLM

### Respuesta emitida

```
[DEMO] Resultado de get_olt_detail:
{
  "id": "OLT-Norte-01",
  "name": "OLT-Norte-Principal",
  "ip": "10.0.1.10",
  "vendor": "Huawei",
  "status": "online",
  "temperatureCelsius": 42,
  "onusConnected": 11,
  "location": "POP Norte - BsAs"
}
```

### Evidence envelope (TruthGate)

```json
{
  "schema": "evidence.provenance.v1",
  "source": "smartolt.demo",
  "observedAt": "2026-09-17T22:17:39.038Z",
  "ttlMs": 3600000,
  "completeness": "complete",
  "confidence": 1,
  "data": { ... }
}
```

**Verdict: `ok` — `fresh-complete`**

El TruthGate verifica que la respuesta proviene de datos frescos y completos del mock de SmartOLT. El operador ve el dato directamente, no una interpretación.

### Qué aprender

> Una consulta que antes necesitaba `LLM → tool → LLM → respuesta` se resuelve como
> `tool → respuesta` en milisegundos. Para flotas de operadores consultando estado y
> potencia, el ahorro de tokens es inmediato.

---

## Caso 2 — INVESTIGATION: diagnóstico con abstención

### Lo que pasa

1. El operador escribe: **"¿Cuál es la causa raíz de la caída progresiva de RX en OLT-Este-01?"**
2. El Adaptive Router detecta intención de diagnóstico multi-fuente → modo `investigation`
3. Se invocan 4 tool calls:
   - `list_onus(oltId: "OLT-Este-01")` → **verdict: ok**
   - `get_olt_detail(oltId: "OLT-Este-01")` → **verdict: ok**
   - `get_onus_with_low_signal(threshold: -25)` → **verdict: incomplete**
4. El TruthGate observa que `get_onus_with_low_signal` devuelve `completeness: partial`
5. El sistema se **abstiene** en lugar de inventar una causa raíz

### Verdicts observados

| Tool | Verdict | Razón |
|---|---|---|
| `list_onus` | `ok` | datos frescos y completos |
| `get_olt_detail` | `ok` | OLT-Este-01: 68 °C, online, 8 ONUs |
| `get_onus_with_low_signal` | `incomplete` | la herramienta no completó con suficiente confianza |

### Abstención emitida

```
Evidence gated

No pude respaldar el diagnóstico: el identificador
get_onus_with_low_signal no figura en el NMS.
Verificá el identificador (ID, SN o filtro) y volvé a intentar.
```

**El sistema no inventa un splitter, un CTO ni una causa física.**
Conservó los datos, verificó la evidencia, y emitió un `nextStep` verificable.

### Qué aprender

> El TruthGate rechaza la respuesta antes de que llegue al operador cuando la
> evidencia no sostiene la afirmación. Esto no es un error: es el comportamiento
> correcto de un sistema que prioriza la corrección sobre la completitud.

---

## Menú de consultas de demo

Probá estas consultas en el chat del entorno demo:

| Consulta | Modo esperado | Respuesta |
|---|---|---|
| `estado de OLT-Norte-01` | `direct` | OLT online, 42 °C, 11 ONUs |
| `potencia RX de ONU-001` | `direct` | -999 (offline), historial de LOS |
| `¿Cuáles ONUs están offline?` | `assisted` | Lista filtrada por status=offline |
| `¿Cuál es la causa raíz del corte en OLT-Este?` | `investigation` | Abstención si falta evidencia |
| `¿Qué pasó ayer con ONU-005?` | `assisted` | Historial + tendencia de señal |
| `¿Cómo funciona el diagnóstico?` | `llm_agent` | Explicación del sistema |

---

## El mensaje conceptual del video

```
AI when needed.
Deterministic when possible.
Abstain when evidence is insufficient.
```

- **AI when needed:** cuando la pregunta requiere causa raíz, correlación temporal o topológica.
- **Deterministic when possible:** consultas de estado y potencia se responden sin LLM.
- **Abstain when insufficient:** el sistema se niega a inventar diagnóstico cuando la evidencia no alcanza.

---

## Archivos de evidencia

Los JSON de captura que sustentan el video están en el repositorio hermano
[`tecnodespegue-landing/demo-evidence/`](https://github.com/Rene-Kuhm/tecnodespegue-landing/tree/main/demo-evidence):

| Archivo | Contenido |
|---|---|
| `direct-fixed.json` | Captura del caso DIRECT (commit `a7f8c48`) |
| `direct-fixed.capture.log` | Log de la ejecución determinística |
| `investigation.json` | Captura del caso INVESTIGATION (commit `c95614b`) |
| `fixture-inventory.json` | Inventario completo de fixtures usados |
| `manifest.json` | Metadata, limitaciones y fidelidad del guion |

### Limitaciones documentadas de esta captura

- La selección de tools del caso INVESTIGATION fue conducida por un driver LLM determinístico de test, no por un provider externo.
- No hay cifra de tokens ni costo disponible.
- No se proveyó un provider de topología, por lo que la captura no afirma una causa raíz específica de splitter o CTO.
- La síntesis propuesta por el caso INVESTIGATION fue atenuada por TruthGate y no presentada como respuesta final.

---

## Próximo paso

¿Querés medir vos mismo? Arrancá el demo:

```bash
./scripts/run-demo.sh
# Abrí http://localhost:3001
# Email: admin@ftth-copilot.local
# Contraseña: demo12345
```

Y probá las consultas del menú de arriba.
