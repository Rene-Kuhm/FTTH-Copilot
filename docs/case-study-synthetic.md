# Case Study — FTTH-Copilot v0.1.0

## Synthetic Reproducible Benchmark: Offline-ONU Diagnosis

> **Uso:** este documento es un benchmark reproducible para evaluadores. Todos los datos son
> sintéticos. Cada paso puede reproducirse en el entorno demo con `./scripts/run-demo.sh`.
>
> **Tiempo estimado para reproducir:** 10–15 minutos
>
> **Datos:** todos sintéticos. Banners `DEMO · DATOS SINTÉTICOS` visibles en la UI.

---

## Escenario de referencia

**Contexto:** ISP mediano operando en el Área Metropolitana de Buenos Aires.
- **5 OLTs** en distintos POPs
- **~42 ONUs** en поле de clientes
- **NMS:** SmartOLT (configurado como mock en demo)

**Escenario de falla:** A las 06:15 UTC del día 12, el NOC recibe alertas de clientes sin servicio en la zona de Quilmes (POP Este).

---

## Configuración del entorno de prueba

### 1. Levantá el demo

```bash
./scripts/run-demo.sh
# Esperá ~2 min hasta ver "✓ Demo data seeded"
```

### 2. Iniciá sesión

```
URL:    http://localhost:3001
Email:  admin@ftth-copilot.local
Pass:   demo12345
```

### 3. Verificá que los datos están cargados

Navegá a **Dashboard > Alertas**. Deberías ver:

| Alerta | Severidad | Dispositivo | Descripción |
|---|---|---|---|
| ONU offline | 🔴 Critical | ONU-001 | ONU offline — LOS acumulado 18h |
| ONU offline | 🔴 Critical | ONU-002 | ONU offline — misma ventana que ONU-001 |
| Señal degradada | 🟡 Warning | ONU-005 | RX en -26.5 dBm, cayendo |
| OLT temperatura | 🟡 Warning | OLT-Este-01 | 68 °C — temperatura elevada |

---

## Caso de prueba 1 — Consulta de estado de OLT

**Pregunta del operador:** `"¿Cuál es el estado de OLT-Norte-01?"`

### Pasos para reproducir

1. Andá al chat de FTTH-Copilot
2. Escribí: `estado de OLT-Norte-01`
3. Esperá la respuesta

### Respuesta esperada

```
[DEMO] Resultado de get_olt_detail:
{
  "id": "OLT-Norte-01",
  "name": "OLT-Norte-Principal",
  "vendor": "Huawei",
  "firmware": "V800R018C10",
  "status": "online",
  "temperatureCelsius": 42,
  "onusConnected": 11,
  "location": "POP Norte - BsAs"
}
```

### Métricas observadas

| Métrica | Valor | Notes |
|---|---|---|
| Modo del router | `direct` | Clasificado como `routine_topology` |
| LLM calls | **0** | Sin invocación al modelo |
| Tool calls | 1 | `get_olt_detail` |
| Latencia | **~3 ms** | Medido en captura real |
| TruthGate verdict | `ok` | `fresh-complete` |

### ¿Por qué importa?

> Una consulta que antes requería `LLM → tool → LLM → respuesta` se resuelve como
> `tool → respuesta` en milisegundos. Para una flota de 20 operadores consultando
> estado y potencia cada minuto, el ahorro en tokens LLM es inmediato y medible.

---

## Caso de prueba 2 — Diagnóstico de corte de planta externa

**Pregunta del operador:** `"¿Cuáles ONUs están offline y por qué?"`

### Pasos para reproducir

1. En el chat, escribí: `¿Cuáles ONUs están offline?`
2. Esperá la respuesta
3. Luego escribí: `¿Cuál es la causa de los cortes en OLT-Este?`

### Respuesta esperada (primera consulta)

```
Las siguientes ONUs tienen status=offline:
- ONU-001: Martinez, Juan — Alsina 342 (OLT-Este-01)
- ONU-002: Garcia, Maria — Alsina 458 (OLT-Este-01)
- ONU-003: Lopez, Carlos — Rawson 112 (OLT-Oeste-01)
- ONU-004: Rodriguez, Ana — Rawson 234 (OLT-Oeste-01)
```

### Respuesta esperada (segunda consulta — causa raíz)

```
Evidence gated

No pude respaldar el diagnóstico: el identificador
get_onus_with_low_signal no figura en el NMS.
Verificá el identificador (ID, SN o filtro) y volvé a intentar.
```

### Análisis del resultado

La plataforma:
1. **Identifica las 4 ONUs offline** → respuesta directa ✅
2. **Detecta correlación temporal** → 2 ONUs offline en la misma ventana (OLT-Este) ✅
3. **TruthGate activa abstención** → no inventa causa raíz cuando falta evidencia ✅

### Métricas observadas

| Métrica | Valor | Notes |
|---|---|---|
| Modo del router | `assisted` → `investigation` | Escaló según la intención |
| LLM calls | 4 | Driver determinístico |
| Verdicts | 2 × `ok`, 1 × `incomplete` | `get_onus_with_low_signal` parcial |
| Abstención | ✅ Sí | El sistema no inventó splitter/CTO |

### ¿Qué hizo el TruthGate?

```
get_olt_detail         → ok (fresh-complete)
list_onus              → ok (fresh-complete)
get_onus_with_low_signal → incomplete (partial-completeness)
```

El sistema verificó que `list_onus` devuelve los datos completos. La herramienta
`get_onus_with_low_signal` fue marcada como `incomplete`, lo que activó la
abstención antes de cualquier afirmación sobre causa raíz.

---

## Caso de prueba 3 — Detección de degradación de señal

**Pregunta del operador:** `"¿Cuál es el estado de la ONU de Fernandez, Pedro?"`

### Datos del escenario

La ONU-005 (Fernandez, Pedro, Rivadavia 1800) tiene:
- `rxPowerDbm`: -26.5 dBm (límite operativo: -27 dBm)
- `uptime`: 864,000 s (10 días)
- `temperatureCelsius`: 48

### Pasos para reproducir

1. Escribí en el chat: `¿Cuál es el estado de la ONU de Fernandez, Pedro?`

### Respuesta esperada

```
[ONU-005] Fernandez, Pedro — Rivadavia 1800
Estado: degraded
RX Power: -26.5 dBm (cerca del límite de -27 dBm)
TX Power: 2.8 dBm
ONT Temperature: 48 °C
Uptime: 10 días
```

### Alerta asociada

La alerta `predicted_low_signal` ya está creada en el dashboard:

```
Título:      Señal degradada: Fernandez, Pedro
Severidad:   Warning
Descripción: Potencia RX en -26.5 dBm (límite -27 dBm).
             Señal en caída: alcanzaría el umbral en ~3 días.
ETA:         3 días
Confidence:  0.72
```

---

## Caso de prueba 4 — Diagnóstico de OLT con temperatura elevada

**Pregunta del operador:** `"¿Qué está pasando con OLT-Este?"`

### Datos del escenario

OLT-Este-01 opera a 68 °C — por encima del umbral de 60 °C.

### Pasos para reproducir

1. Escribí en el chat: `¿Qué está pasando con OLT-Este?`

### Respuesta esperada

```
[OLT-Este-01] OLT-Este-Cobertura
Estado: online
Temperatura: 68 °C (umbral de alerta: 60 °C)
Proveedor: Huawei / MA5800-X7
Firmware: V100R019C10
ONUs conectadas: 8
Ubicación: POP Este - Quilmes

⚠️ La temperatura de la OLT está elevada. Hay 2 ONUs offline
en este OLT que pueden estar asociadas a un problema térmico.
```

### Alerta asociada

```
Título:      OLT con temperatura elevada: OLT-Este-Cobertura
Severidad:   Warning
Descripción:  OLT-Este a 68 °C (límite 60 °C).
             Temperatura en ascenso — riesgo de degradación
             térmica si continúa.
ETA:         7 días
Confidence:  0.65
```

---

## Resumen de métricas del benchmark

| Caso | Modo | LLM calls | Tool calls | Latencia | TruthGate | Abstuvo? |
|---|---|---|---|---|---|---|
| Estado de OLT | `direct` | **0** | 1 | ~3 ms | `ok` | No |
| ONUs offline | `assisted` | 1–2 | 1 | < 50 ms | `ok` | No |
| Causa raíz (fallida) | `investigation` | 4 | 4 | < 100 ms | 2×`ok`, 1×`incomplete` | ✅ Sí |
| Degradación señal | `direct` | 0 | 1 | ~3 ms | `ok` | No |
| OLT temperatura | `direct` | 0 | 1 | ~3 ms | `ok` | No |

---

## Comandos de verificación automatizada

### Tests unitarios de detección

```bash
pnpm test --filter @ftth-copilot/detection
# Valida: detectLosEvents, detectSignalDrift, detectTemperatureDrift
# Resultado esperado: todos passing
```

### Benchmark SNMP (latencia, throughput)

```bash
pnpm benchmark:snmp
# Valida: p95 < 50ms, throughput > 100 events/sec
# Resultado esperado: PASS en todos los thresholds
```

### Tests de evaluación (intention classifier)

```bash
pnpm test --filter @ftth-copilot/eval
# Valida: accuracy ≥ 0.95, false-routings = 0
# Resultado esperado: 253 tests passing
```

### Tests E2E (Playwright)

```bash
pnpm test:e2e
# Valida: UI del chat, dashboard, alertas
# Requiere: chromium instalado
```

---

## Archivos de evidencia utilizados

Los JSON de captura que sostienen este benchmark están en:
[`tecnodespegue-landing/demo-evidence/`](https://github.com/Rene-Kuhm/tecnodespegue-landing/tree/main/demo-evidence)

| Archivo | Caso | Commit |
|---|---|---|
| `direct-fixed.json` | Caso 1 — Estado OLT | `a7f8c48` |
| `investigation.json` | Caso 2 — Causa raíz | `c95614b` |
| `fixture-inventory.json` | Inventario completo | — |

---

## Limitaciones de este benchmark

| Limitación | Descripción |
|---|---|
| **Datos sintéticos** | Los valores de ONUs y OLTs son fixtures, no de un ISP real |
| **Sin topología física** | El benchmark no incluye la jerarquía OLT → PON → Splitter → CTO → ONU |
| **LLM calls del caso 2** | Las 4 LLM calls fueron conducidas por un driver determinístico de test, no un provider externo |
| **Sin costo real de tokens** | Los costos de inferencia son aproximados |
| **Sin piloto real** | Las métricas de operator effort reduction y lead time improvement requieren un piloto con técnicos NOC |

---

## Próximo paso para evaluadores

¿Los resultados de este benchmark coinciden con lo que necesitás para tu ISP?

1. **Sí →** Pedí una sesión técnica guiada con tus escenarios reales
2. **Necesito más →** Corré `pnpm benchmark:snmp` y `pnpm test --filter @ftth-copilot/detection` para más evidencia
3. **Quiero integrar →** Leé [`docs/production-deployment.md`](production-deployment.md) y contactá para una licencia de evaluación
