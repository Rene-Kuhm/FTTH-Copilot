# FTTH-Copilot — Roadmap de integraciones pendientes

> **Qué es este documento:** el plan priorizado de TODO lo que falta integrar/implementar en FTTH-Copilot, ordenado por valor y por dependencias. Pensado para retomarlo día a día (cada item es accionable).
>
> **Estado (al 2026-09-04):** las fases A–F del roadmap *evidence-first* están **completas**. Este documento empieza donde terminó: los gaps y la evolución hacia el NOC cognitivo (AIOps).
>
> **Fuente real de este roadmap:** `docs/aiops-roadmap.md`, `docs/evidence-first-roadmap.md`, deuda documentada de Fase F (`packages/eval`, `packages/security`, `packages/connectors`) y el estado verificado del repo (main `ee109d3`).

---

## Leyenda de prioridad

- 🔴 **P0 — Inmediato / deuda abierta:** cierres pendientes del trabajo ya entregado.
- 🟠 **P1 — Alto valor de detección:** lo que más mejora la utilidad para NOC/SOC.
- 🟡 **P2 — Integraciones de conectores / datos.**
- 🔵 **P3 — Escala / AIOps (solo cuando cruzan los gates numéricos).**

Cada item tiene: **objetivo**, **cómo**, **por qué importa**, **dependencia** y **criterio de "hecho"**.

---

## 🟠 P1 — Cerrar la deuda inmediata de Fase F (evaluación + SOC)

> Fácil de arrancar mañana. Son los deferrals que dejamos documentados.

### 1.1 Precision real de la evaluación (corpus etiquetado)
- **Objetivo:** que `precision` deje de ser `'TBD'` y sea un número real en el reporte nightly.
- **Cómo:** el tech lead NOC etiqueta `docs/validation/labels.csv` (esquema ya listo: `case_id, factual_claim_supported, ground_truth_severity, labeled_by, labeled_at`).
- **Por qué importa:** sin ground truth, la métrica de precisión es cosmética; con ella, medimos si el agente "acierta" de verdad.
- **Criterio de hecho:** un run nightly emite `precision: <número>` (no `'TBD'`).
- **Dependencia:** humana (el etiquetador NOC).

### 1.2 Cablear `detectTrafficAnomaly` (SOC) a runtime
- **Objetivo:** activar el detector de anomalía de tráfico (throughput sostenido > umbral → posible CPE comprometido).
- **Cómo:** hoy está **implementado y testeado** (`packages/security/src/traffic.ts`) pero no conectado a datos reales en runtime.
- **Por qué importa:** es el detector SOC pendiente de cablear; cerrar el círculo de la detección.
- **Criterio de hecho:** el flujo SOC emite hallazgos `traffic_anomaly` cuando hay datos de tráfico.
- **Dependencia:** fuente de datos de tráfico por dispositivo.

### 1.3 Export dedicado de métricas (`injection_suspicion_total`)
- **Objetivo:** exponer el contador de sospechas de inyección como export/YAML accionable.
- **Cómo:** hoy se deriva en el job nightly desde `verdict_log` (diseño AD-11); falta un export dedicado.
- **Por qué importa:** dar visibilidad operativa al equipo de seguridad sobre intentos de inyección.
- **Criterio de hecho:** endpoint o artefacto exportado con el total por dimensión (tenant, severidad).

### 1.4 Backfill recompute job para `verdict_log`
- **Objetivo:** reprocesar veredictos antiguos cuando cambie la lógica de clasificación.
- **Cómo:** job que re-corre la clasificación sobre `verdict_log` histórico (la spec lo marca como **MAY**).
- **Por qué importa:** consistencia de auditoría retroactiva.
- **Criterio de hecho:** job ejecutable que actualiza veredictos sin romper la integridad.

---

## 🟡 P2 — Telemetría rica (el gap de datos que "de verdad falta")

> Según `docs/aiops-roadmap.md`: **el problema no es inteligencia, es datos.** Estos items aportan la materia prima de detección temprana.

### 2.1 Recolectar FEC errors (BIP-8)
- **Objetivo:** capturar codewords FEC corregidos/no corregidos por ONT.
- **Por qué importa:** es **el mejor indicador temprano de fibra degradándose** (antes de que caiga RX).
- **Cómo:** extender la ingesta de métricas ópticas.
- **Dependencia crítica:** confirmar que SmartOLT/Mikrowisp exponen los contadores FEC. Si no, sale por SNMP/gNMI (ver 2.3).
- **Criterio de hecho:** el poller recolecta y persiste FEC por ONT; los detectores pueden operar sobre ello.

### 2.2 Métricas ópticas completas por ONT
- **Objetivo:** cubrir RX/TX (ya hay) + **bias current, temperatura y LOS** por ONT.
- **Por qué importa:** diagnostica la salud física de la fibra y del transceptor antes de una falla.
- **Criterio de hecho:** las métricas ópticas completas se recolectan y alimentan detectores + copiloto.

### 2.3 Colector SNMP traps
- **Objetivo:** recibir traps SNMP de OLTs/ONTs (eventos que el polling HTTP no ve).
- **Por qué importa:** los traps capturan eventos push en tiempo real.
- **Escala:** si hay picos de traps que Node no absorbe → separar a collector (ver 3.1).
- **Criterio de hecho:** receptor SNMP ingesta traps y los normaliza a `telemetry.v1`.

### 2.4 Streaming gNMI/NETCONF (futuro)
- **Objetivo:** telemetría push estructurada desde el NMS.
- **Por qué importa:** telemetría en streaming en lugar de polling.
- **Dependencia:** soporte del NMS; es el siguiente paso tras SNMP.
- **Criterio de hecho:** una fuente gNMI/NETCONF se integra al pipeline.

---

## 🟡 P2 — Integración de conectores

### 2.5 NetSense
- **Objetivo:** implementar el adaptador NetSense.
- **Cómo:** el `provider` ya está en el schema (`SMARTOLT | MIKROWISP | NETSENSE`); falta el adaptador que hoy se rechaza explícitamente y **nunca** usa mocks.
- **Por qué importa:** cerrar el tercer NMS del modelo.
- **Criterio de hecho:** `/api/connectors/create` acepta `NETSENSE` y el copiloto consume datos reales de NetSense.
- **Dependencia:** un NMS NetSense real / especificación de su API.

---

## 🔵 P3 — Escala / NOC cognitivo (AIOps) — SOLO con gates numéricos

> **Regla de oro:** no se introduce un servicio nuevo "por si acaso". El roadmap define disparadores numéricos. **Realidad:** un ISP regional genera decenas a cientos de eventos/seg → PostgreSQL + TypeScript lo absorbe con holgura. El "millones" es escala carrier.

### 3.1 Collector de ingesta dedicado (Go)
- **Disparador:** > ~1.000 eventos/seg sostenidos, o picos de SNMP traps que Node no absorbe con headroom.
- **Cómo:** proceso separado que normaliza a `telemetry.v1`.
- **Criterio de hecho:** la ingesta cambia de etapa sin cambiar contrato de salida (modo sombra primero).

### 3.2 Correlación cross-device (Rust/Polars)
- **Disparador:** series temporales > ~50M filas y latencia de correlación > umbral.
- **Cómo:** correlacionar hallazgos entre dispositivos (un OLT que explica la caída de muchos clientes).
- **Criterio de hecho:** emite `finding.v1` solo confirmados, con latencia dentro del umbral.

### 3.3 Orquestación cognitiva Python (opcional)
- **Disparador:** necesidad real del ecosistema Python (no "porque es el estándar").
- **Cómo:** detrás del mismo contrato de la capa cognitiva actual (TS/`agent-core`).
- **Criterio de hecho:** el rol cognitivo mantiene `action.v1` igual que hoy.

### 3.4 Bus de eventos (Redis/NATS)
- **Disparador:** más de un servicio consumiendo los mismos eventos.
- **Cómo:** sustituir el acoplamiento directo por un bus + schemas (`telemetry.v1`, `finding.v1`, `action.v1`).
- **Criterio de hecho:** dos o más servicios consumen de los mismos topics sin romper contrato.

---

## Resumen ejecutivo del roadmap

| Prioridad | Item | Esfuerzo | Tipo |
|-----------|------|----------|------|
| 🟠 P1.1 | Precision real (corpus etiquetado) | humano | evaluación |
| 🟠 P1.2 | Cablear `detectTrafficAnomaly` | Bajo | SOC |
| 🟠 P1.3 | Export `injection_suspicion_total` | Bajo | observabilidad |
| 🟠 P1.4 | Backfill `verdict_log` | Medio | auditoría |
| 🟡 P2.1 | FEC errors (BIP-8) | Medio | telemetría |
| 🟡 P2.2 | Ópticas completas por ONT | Medio | telemetría |
| 🟡 P2.3 | Colector SNMP traps | Medio–Alto | ingesta |
| 🟡 P2.4 | Streaming gNMI/NETCONF | Alto (futuro) | ingesta |
| 🟡 P2.5 | NetSense | Medio | conector |
| 🔵 P3.x | Collector Go / Polars / Python / Bus | — | SOLO con gates |

---

## Recomendación de arranque (mañana)

1. **P1.2 (`detectTrafficAnomaly`)** — es el más rápido y cierra un detector ya hecho (esfuerzo bajo, alto impacto de "cerrar el círculo").
2. **P1.3 (export `injection_suspicion_total`)** — también bajo, da visibilidad inmediata.
3. **P1.1 (corpus etiquetado)** — arrancar en paralelo, pero depende del tech lead NOC.
4. Luego decidir entre **P2.1 (FEC)** y **P2.5 (NetSense)** según qué NMS real esté disponible.

---

*Roadmap de integraciones pendientes · FTTH-Copilot · 2026-09-04 · Ubicación en repo: `docs/roadmap-integraciones-pendientes.md` (copia local de trabajo: `/home/tecnodespegue/Documentos/roadmap-integraciones-ftth-copilot.md`)*
