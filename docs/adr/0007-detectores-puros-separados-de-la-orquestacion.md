# ADR 0007 — Detectores puros separados de la orquestación

**Estado:** Aceptada
**Fecha:** 2026-08-21 (migraciones `20260821070000_add_detected_alerts`,
`20260821080000_add_incidents`)

## Contexto

El NOC del producto se define por su promesa: **saber qué se va a romper antes de que se
rompa**. Eso significa, en la práctica, correr detectores sobre series temporales de métricas
en cada ciclo de poll.

Los detectores que hacen falta no son triviales: deriva de señal con predicción de
umbral de cruce, deriva de temperatura, flapping, tormenta de reinicios, anomalía contra
línea base con mediana y MAD, degradación de FEC, degradación óptica y pérdida de señal.

Cada uno de esos detectores necesita **decidir un umbral**, y cada umbral necesita una
prueba de que en el borde hace lo que dice. Un detector que no tiene una serie sintética
para el borde de su umbral es un detector que nadie va a poder cambiar sin miedo.

El problema de acoplamiento: si el detector vive pegado a la base de datos, probarlo exige
Postgres, y probarlo en paralelo exige una base por proceso. Con siete detectores y un CI
que corre en cada push, eso es inviable.

## Decisión

Separar en dos capas con una frontera tajante:

- **`@ftth-copilot/detection` y `@ftth-copilot/security` no dependen de nada** — ni de
  workspace, ni de base, ni de red. Son funciones puras que reciben series y devuelven
  findings. Sus `package.json` declaran `dependencies: {}`.
- **`@ftth-copilot/alerts` y `@ftth-copilot/soc` son la orquestación**: leen de la base,
  persisten, notifican. Reciben Prisma mockeado y `fetch` inyectado en los tests.

En concreto:

- `packages/alerts/src/runner.ts:25` (`runDetectors`) delega en el paquete de detección.
- `packages/alerts/src/group.ts:9` (`groupRows`) pivota filas planas de `MetricSample` en
  series por dispositivo antes de detectar. `LOS_SECONDS_TOTAL` tiene serie propia, porque
  `detectLosEvents` necesita un contador monotónico y no valores instantáneos
  (`group.ts:73-79`).
- `packages/alerts/src/dedup.ts:59` (`reconcile`) implementa el ciclo de vida del estado de
  la alerta.
- `packages/alerts/src/correlate.ts:18` (`correlateAlerts`) agrupa alertas activas en
  incidentes cuando hay ≥2 kinds distintos en el mismo equipo.
- `packages/alerts/src/manager.ts:191` (`runDetection`) es el único orquestador: lee
  samples, agrupa, detecta, reconcilia, hace upsert, notifica y correlaciona.
- Los canales de notificación reciben `fetchImpl` inyectable
  (`packages/alerts/src/notify.ts`), lo que permite testear la entrega sin red.

La regla de paquete se hizo explícita en el propio `package.json`: los paquetes de
detectores **no** pueden declarar dependencias de workspace.

## Consecuencias

### Buenas

- **Los detectores se prueban con series sintéticas**, sin base ni red, y cubren umbrales
  y bordes de forma exhaustiva. El paquete `security` llega a 32 tests con 100% de
  statements.
- El CI puede correr la suite de detección en paralelo y en segundos.
- La estadística compartida (`median`, `mad`, `fitTrend`, `predictThresholdCrossing` en
  `packages/detection/src/stats.ts`) está en un solo lugar y con una sola semántica.
- Un detector nuevo es **un archivo y un test**: no hay que tocar la orquestación.
- `runDetection` se puede testear con Prisma mockeado, así que la persistencia y la
  notificación quedan cubiertas sin tocar hardware.
- La frontera paquete-detector / paquete-orquestador documenta la arquitectura sin
  necesidad de un diagrama.

### Malas

- **Los detectores no conocen el contexto de negocio.** `detectSignalDrift` no sabe si la
  ONU es de un cliente crítico ni si hay una ventana de mantenimiento activa. Esa
  información se aplica después, en la orquestación.
- La **frontera es una convención, no una barrera**: nada impide que un detector importe
  Prisma mañana. Sólo la convención y el `package.json` lo impiden.
- `groupRows` es una transformación que conoce el schema de `MetricSample` (nombres de
  columnas, tipos de enum). Un cambio en el enum obliga a revisar el pivoteo, que no
  tiene types que lo adviegue porque vive en el paquete de orquestación.
- Los detectores que dependen de umbrales por vendor (por ejemplo, la degradación óptica)
  necesitan esos umbrales por parámetro: si no se los pasa, el default es una política
  implícita.
- La mockeación de Prisma en los tests de orquestación es un **doble**: si el modelo real
  cambia y el mock no, el test pasa y producción falla.

### Abiertas

- `detectTrafficAnomaly` está implementado y testeado, pero los conectores todavía no
  exponen throughput por ONU, así que no corre en runtime. El detector y el dato no
  llegaron juntos.
- Los umbrales por familia de OLT para la degradación óptica están embebidos en el
  detector en vez de venir de la tabla de fuentes (`research/olt/<vendor>/`), que es donde
  vive el resto de la configuración por vendor.
