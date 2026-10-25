# El ciclo de vida de las alertas

Una tempting lectura de "alerta" es "evento que se dispara". El sistema está diseñado
alrededor de la idea contraria: **una alerta es un estado que evoluciona en el tiempo**, y
casi todo el código del paquete `alerts` existe para evitar que el operador reciba la misma
notificación quince veces.

## Por qué importa

El poller corre cada 15 minutos por defecto. Un detector de deriva de señal va a encontrar
la misma señal degradada en cada corrida. Si cada hallazgo creara una alerta nueva y cada
alerta disparara una notificación, un solo problema físico generaría 96 páginas por día.

El diseño evita eso en tres capas: **deduplicación**, **cooldown** y **correlación**.

## Capa 1 — los detectores

Los detectores viven en `@ftth-copilot/detection` y son **funciones puras**: reciben una
serie temporal y devuelven findings. No hacen I/O, no conocen la base, no conocen el reloj.

| Detector | Señal | Umbral |
|---|---|---|
| `detectSignalDrift` | RX derivando hacia abajo | cruza −27 dBm ⇒ ONU offline, con ETA |
| `detectTemperatureDrift` | temperatura derivando hacia arriba | cruza 60 °C |
| `detectFlapping` | conexión intermitente | alternancia rápida online/offline |
| `detectRebootStorm` | reinicios repetidos | N reinicios en ventana |
| `detectBaselineAnomaly` | desviación contra la línea base | mediana + MAD robusta |
| `detectFecDegradation` | FEC corregidos/incorregidos creciendo | ratio contra la ventana |
| `detectOpticalDegradation` | bias o temperatura de ONT fuera de banda | umbrales por OLT/vendor |
| `detectLosEvents` | contador `LOS_SECONDS_TOTAL` creciendo 24 h | Δ ≥ 1 s ⇒ warning; Δ ≥ 30 s ⇒ critical |

Todos apoyan en la estadística de `packages/detection/src/stats.ts`: `median`, `mad`,
`fitTrend` y `predictThresholdCrossing`.

## Capa 2 — `reconcile`: de finding a estado

`packages/alerts/src/dedup.ts:59` es el corazón del ciclo de vida.

La clave de un finding es `kind:deviceKind:deviceId` (`dedup.ts:9`). Contra esa clave, el
algoritmo hace cuatro cosas:

```text
finding nuevo      → abre la alerta y notifica de inmediato
finding coincidente → refresca lastSeenAt
                      la severidad sube, pero NUNCA baja
                      una alerta acknowledged sigue acknowledged
sin finding         → si está stale, se resuelve (después de ALERT_RESOLVE_AFTER_MS)
```

La severidad es ascendente y monotónica (`SEVERITY_ORDER`, `dedup.ts:3`). Una alerta que
subió a `critical` no vuelve a `warning` porque un finding posterior fue menos severo: eso
ocultaría una degradación que empeoró y luego se estabilizó.

El `acknowledged` es un estado terminal-ish (`dedup.ts:110`): una alerta que el técnico ya
vio no se reabre ni se re-notifica por el mismo finding. Si el problema sigue, sigue
`acknowledged` hasta resolverse.

La notificación se dispara sólo en tres casos (`dedup.ts:129-137`):

1. Escaló la severidad.
2. Escaló por edad (la alerta lleva demasiado tiempo sin ack).
3. Se agotó el cooldown.

### Los tres relojes

| Variable | Default | Significado |
|---|---|---|
| `ALERT_COOLDOWN_MS` | 1 h | No se re-notifica la misma alerta antes de este intervalo |
| `ALERT_RESOLVE_AFTER_MS` | 24 h | Una alerta abierta sin finding coincidente se resuelve |
| `ALERT_ESCALATE_AFTER_MS` | 4 h | Una alerta `warning` sin ack sube a `critical` |

El escalado por edad es el que evita que un técnico en guardia nunca vea una alerta
"menos grave": a las 4 horas sin ACK, deja de ser warning pase lo que pase.

## Capa 3 — correlación: de alerta a incidente

`correlateAlerts` (`packages/alerts/src/correlate.ts:18`) agrupa las alertas **activas** (no
resueltas) por dispositivo y forma **un** incidente cuando hay al menos `minKinds` (default
2) kinds de alerta distintos en el mismo equipo (`correlate.ts:30-33`).

La severidad del incidente es la máxima de sus alertas, y su ventana temporal es la unión de
los `firstSeenAt..lastSeenAt` de cada una (`correlate.ts:39-46`).

El resultado se persiste con un upsert sobre la clave única
`(tenantId, connectionId, deviceKind, deviceId)` (`packages/alerts/src/manager.ts:117-122`),
y las alertas quedan enlazadas al incidente (`manager.ts:152-161`).

**Por qué importa:** una ONU con deriva de señal + flapping + reinicios es **un problema**
(una visita técnica), no tres alertas separadas. El NOC ve una unidad de trabajo.

## El agrupamiento previo

Antes de correr detectores, `groupRows` (`packages/alerts/src/group.ts:9`) pivota las filas
planas de `MetricSample` en series por dispositivo. Es una transformación pura: los
detectores reciben series, no filas.

`LOS_SECONDS_TOTAL` tiene su propia serie dedicada, porque `detectLosEvents` necesita un
contador monotónico y no una serie de valores instantáneos (`group.ts:73-79`).

## La orquestación completa

`runDetection` (`packages/alerts/src/manager.ts:191`) es el único lugar que junta todo:

```text
leer samples del tenant
  → groupRows (pivot a series)
  → runDetectors (findings puros)
  → reconcile (dedup/cooldown/escalado/resolución)
  → upsert de DetectedAlert
  → notify (webhook / Telegram / Slack / WhatsApp)
  → correlateAndPersist (upsert de Incident + enlace de alertas)
```

Los canales de notificación reciben `fetchImpl` inyectable, lo que permite testear la
entrega sin red real.

## SLA: cuánto estuvo disponible

El sistema también rinde cuentas. `computeUptime`
(`packages/analytics/src/sla.ts:81`) toma las muestras de estado (`online|offline|degraded`)
de una ventana, rellena el primer tramo con el estado de la primera muestra y extiende el
último hasta el fin de la ventana.

La API expone dos campos que distinctions importante:

- `uptimePercent` — el porcentaje de disponibilidad.
- `coveragePercent` — **cuánto de la ventana hay datos**.

Un `uptimePercent: 100` sobre un `coveragePercent` de 3 no significa "el equipo estuvo
disponible todo el día": significa que hubo tres muestras y las tres dieron bien. Por eso
`GET /api/sla` devuelve `uptimePercent: null` cuando no hay datos suficientes, en lugar de
un número engañoso.

## Dónde queda cada cosa

| Salida | Dónde vive |
|---|---|
| Hallazgo (finding) | en memoria, dentro del ciclo de detección |
| Alerta deduplicada | `DetectedAlert` |
| Incidente | `Incident` |
| SLA | `GET /api/sla` |
| Timeline unificado | `GET /api/ops/events` (alertas + incidentes + eventos de device + cambios) |
| Notificación enviada | `NotificationDelivery`, con `dedupeKey` |

## En una línea

El detector dice "esto se está degradando"; el reconciliador dice "sigue siendo el mismo
problema y nadie lo tomó"; el correlacionador dice "es un solo problema con tres síntomas";
y el SLA dice cuánto tiempo estuvimos ciegos.
