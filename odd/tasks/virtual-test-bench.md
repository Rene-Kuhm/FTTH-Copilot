# Virtual Test Bench

**Status**: In Progress (T1–T3 hechos; T4 es una entrega separada; T5–T6 pendientes)
**Created**: 2026-11-07
**Branch**: `feat/virtual-test-bench`
Banco de pruebas virtual para probar FTTH-Copilot contra protocolos y datos reales
sin hardware físico, y el conector de SmartOLT al día con la API de octubre 2026.

## Specs

- **S1** — Paso 1: "un banco virtual en Docker Compose, con BBSim, snmpsim con las
  capturas reales y MikroTik CHR, levantado con un solo comando."
- **S2** — Las capturas de LibreNMS "son GPL-3: se descargan al correr el test y no
  se copian al repo."
- **S3** — Paso 2: "Reescribir el conector de SmartOLT con la API nueva: eventos en
  tiempo real, paginación, límite real de 1000 llamadas por hora y respeto de los 429."
- **S4** — Paso 2: "Agregar los tests de contrato contra las specs de SmartOLT y
  Mikrowisp." Si el proveedor cambia la API, "el CI falla".
- **S5** — FEC: "con un presupuesto de ~600 llamadas por hora y empezando por las ONUs
  que los eventos marcan degradadas, el primer barrido pasa de semanas a horas."
- **S6** — Paso 3: "Un conector OpenOLT para BBSim." Entrega separada, "después de
  los pasos 1 y 2" (L1).
- **S7** — Paso 4: "Un script que provoca fallas en el banco virtual y anota qué
  esperaba": "un corte de fibra en un PON (`LOS`)", "un corte de energía en un barrio
  (varios `DYING_GASP` juntos)", "una ONU degradándose de a poco, con potencia que cae
  en snmpsim", "un ataque de fuerza bruta contra el CHR". "Eso llena `labels.csv` solo."
- **S8** — Paso 5: "Esto no es L3 [...] Propongo un nivel intermedio, por ejemplo
  'L2+ con capturas reales reproducidas', y unificar las dos definiciones de L3 que
  hoy se contradicen."

## Tasks

| ID | Specs | Ruta | Commit |
|---|---|---|---|
| T1 — Banco virtual en Compose (`pnpm lab:up`, `lab:check`, `lab:down`) + docs | S1, S2 | worker | fe87af9 |
| T2 — Cliente SmartOLT: límite configurable (1000/h), 429 + `Retry-After`, paginación con `updated_since`; tests de contrato SmartOLT y Mikrowisp | S3, S4 | worker | 2ed296f, 2235472 |
| T3 — Eventos SSE de SmartOLT y presupuesto FEC que prioriza ONUs degradadas | S3, S5 | worker | ver L8 |
| T4 — Conector OpenOLT contra BBSim (entrega/PR separada) | S6 | pendiente | — |
| T5 — Escenarios con verdad conocida que llenan `labels.csv` | S7 | pendiente (después de T1 y T4) | — |
| T6 — Nivel L2+ y definición única de L3 | S8 | pendiente | — |

- [x] T1
- [x] T2
- [x] T3
- [ ] T4
- [ ] T5
- [ ] T6

## Log

- **L1** (usuario, 2026-11-07): "hagamos esto  1. ¿Arranco? Si me das el OK, armo
  odd/tasks/virtual-test-bench.md con estos pasos y empiezo por el 1 (banco virtual) y
  el 2 (SmartOLT). Son los que más rinden. 2. ¿El conector OpenOLT entra en este plan?
  Es la pieza más grande (un fabricante nuevo) y la que más valor de producto agrega.
  Mi recomendación es sí, pero como entrega separada después de los pasos 1 y 2."
- **L2** (evidencia): spec oficial `https://www.smartolt.com/openapi.json` (octubre
  2026): presupuesto de 1000 llamadas/h y 15/s; 429 con `Retry-After`; SSE en
  `GET /api/onu/get_event_stream` (60 llamadas/h, máx. 15 streams); `get_all_onus_details`
  sin `page` = 15/h, con `page`+`updated_since` cuenta contra el presupuesto general.
  El conector hoy asume 15/h global (`packages/connectors/smartolt/src/client.ts:27`).
- **L3** (decisión técnica): en T3 se implementa solo SSE. El webhook necesita un
  endpoint público entrante con autenticación propia (superficie de seguridad) y queda
  fuera de esta entrega.
- **L4** (entorno): Docker 29.9.2 y `/dev/kvm` disponibles en la máquina de desarrollo
  (CHR necesita KVM).
- **L5** (entrega): el corte supera las ~400 líneas por PR. Estrategia: PRs
  encadenadas. PR 1 = T1 (banco, fe87af9). PR 2 = T2 (SmartOLT 2ed296f + Mikrowisp
  2235472, con las correcciones de la verificación integradas). PR 3 = T3. PR 4 = T4 (OpenOLT).
- **L6** (verificación independiente de T1–T2): S1–S4 PASS. Hallazgos corregidos:
  `lab:up` fallaba 1 de 3 veces porque el chequeo del password nuevo de CHR no
  reintentaba (`scripts/lab/chr-bootstrap.ts`); una página vacía antes de
  `total_items` truncaba el inventario en silencio (ahora `SmartoltResponseShapeError`,
  con test); el ejemplo de `snmpget` de la doc apuntaba al puerto del host desde
  dentro del contenedor.
- **L7** (pendiente del usuario): `.env.example` no se pudo escribir porque el harness
  bloquea `.env*`. Las variables están en `packages/connectors/smartolt/AGENTS.md`.
  Las respuestas se validan con parsers propios y no con Zod, porque agregar `zod`
  a los conectores requiere `pnpm install`.
- **L8** (T3): cliente SSE de SmartOLT (`get_event_stream`, `Last-Event-ID`, `resync`,
  `expired`, `disabled`, 503/403 → polling), presupuesto compartido por cuenta (clave =
  URL base + hash de la API key) y el loop `smartolt-events` en el worker, apagado por
  defecto (`SMARTOLT_EVENTS_ENABLED=false`). Persiste por `persistSamples`, el mismo
  camino que el poll. FEC: `FEC_RATE_LIMIT_PER_HOUR` por defecto 600; sin
  `FEC_FAN_OUT_PER_CYCLE` el corte del tick es la parte del presupuesto que le toca
  (600 por tick de 1 h). Este defecto lo encontró el parent (RED: el default seguía en
  8 por tick). Las ONUs degradadas por eventos van primero. Commits: los dos que
  siguen a 2235472.
- **L9** (pendiente): native review bloqueada por `lens_context_budget_exceeded`
  (6.391 líneas). Hay que revisar por slice (un worktree por commit) o desactivarla
  para este clon. Decisión del usuario.
- **L10** (verificación independiente de T3): S5 PASS (4.000 ONUs en 7 ticks de 1 h,
  degradadas primero, sin mezcla entre tenants). S3 PARTIAL por dos bloqueantes,
  corregidos con RED/GREEN: el cuerpo SSE anterior no se cancelaba al reconectar (fuga
  de sockets) y `stop()` no cortaba el backoff ni el pedido de la URL. También: liveness
  por conexión que corta y reconecta un stream mudo; sin conexiones vivas el loop figura
  `inactive` y no `hung`; `disabled` sigue siendo terminal y rotar la key pide reiniciar
  el worker (documentado).
- **L11** (usuario, 2026-11-07): "Revisar commit por commit (lo que recomiendo). Me
  autorizás a crear worktrees temporales dentro de .git/ y le paso al revisor un commit
  por vez. El commit de T1 es el de mayor riesgo, porque cambia el entorno y el CI."
- **L12** (review de T1): worktree `.git/review-wt/t1-lab` en fe87af9 (2.108 líneas, sí
  entra en el límite). Lineage `review-fa38c72acd3f5551` abierta, en `reviewing` y
  esperando a los 3 revisores. La corrida falló antes de revisar con un 429 del
  proveedor: "Token Plan usage limit reached". No se envió nada y no se reintentó.
- **L13** (usuario): pasar `review-risk` a `deepseek/deepseek-flash`. Hecho en
  `~/.gentle-shell/config/gentle-ai/profiles.json`, con backup en
  `profiles.json.bak-20261107-review-risk`. Al relanzar los 3 revisores volvió el
  mismo 429 de MiniMax ("Token Plan usage limit reached"). Lo más probable es que esta
  sesión de Pi haya congelado el ruteo de modelos al arrancar, así que el cambio pide
  reiniciar Pi. Además, `models.json` no declara ningún proveedor `deepseek`. La
  lineage `review-fa38c72acd3f5551` sigue abierta en reviewing y no se reintentó.
