# ADR 0006 — TruthGate con abstención asimétrica en modo strict

**Estado:** Aceptada
**Fecha:** 2026-09-03 (Fase B) y 2026-09-04 (Fase C)
**Espejo normativo:** `openspec/specs/truth-gate-classification/spec.md`,
`openspec/specs/strict-mode-abstention/spec.md`

## Contexto

Con el envelope de procedencia en su lugar (ver [ADR 0005](0005-evidencia-primero-con-envelope-de-procedencia.md)),
quedaba la decisión más difícil del producto: **qué hacer** con un envelope clasificado como
dudoso.

La respuesta ingenua —"si la confianza es baja, no respondas"— tiene un problema
operativo: en un NOC, la consulta más común es el estado de un equipo, y un equipo con un
solo campo faltando no vuelve inútil la respuesta. Si el sistema se abstiene ante cualquier
imperfección, los operadores dejan de mirarlo.

El riesgo simétrico también es real: si el sistema nunca se abstiene, el envelope no sirve
para nada y el producto vuelve a ser un LLM que habla con confianza.

## Decisión

Implementar un **clasificador determinista de cuatro dimensiones** (el TruthGate) y una
**política de abstención asimétrica** encima, con dos modos: `observe` y `strict`.

### El clasificador

`packages/evidence/src/truth-gate.ts` clasifica cada envelope en un `VerdictCode`:

| Dimensión | Veredicto | Regla |
|---|---|---|
| Frescura | `stale` | `now > observedAt + ttlMs` |
| Confianza | `low_confidence` | confianza bajo el umbral |
| Completitud | `incomplete` | `completeness != complete` |
| — | `ok` | ninguna de las anteriores |

- Precedencia por severidad: `incomplete > stale > low_confidence > ok`
  (`truth-gate.ts:118-137`).
- El reloj `now` es **inyectable**, lo que hace la clasificación testeable sin esperar.
- La igualdad en el borde **no** es staleness: `now === observedAt + ttlMs` no es `stale`.
- El módulo nunca lanza y nunca bloquea el flujo (`truth-gate.ts:6-9`).

### La política

`packages/evidence/src/abstention-policy.ts:79`:

```text
shouldAbstain(verdicts, mode)
  strict:   hay 'incomplete'             → 'abstain'
            hay 'stale' o 'low_confidence' → 'warn'
            todo 'ok'                     → 'allow'
  observe:  siempre                       → 'allow'
```

La asimetría es el centro de la decisión: **la evidencia incompleta detiene la respuesta; la
evidencia vieja o de baja confianza sólo advierte.**

### El contrato de abstención

Cuando se abstiene, `runAgent` **reemplaza el texto del LLM** por un payload
`ftth.abstention.v1` (`packages/shared/src/contracts.ts`) con `reason`, `claim` (opcional),
`missing`, `available`, `nextStep` (**obligatorio y no vacío**) y `toolsAffected`.

### El modo por defecto y la precedencia

- El default es **`strict`** (`packages/agent-core/src/runtime.ts:129`).
- La precedencia de resolución es **tenant > env > default del módulo**:
  `tenantPolicy.truthGateMode > process.env.TRUTH_GATE_MODE > DEFAULT_TRUTH_GATE_MODE`
  (`runtime.ts:314`). `TRUTH_GATE_MODE` sólo acepta `observe` o `strict`; cualquier otro
  valor cae a `strict` (`apps/web/app/api/chat/route.ts:50`).

## Consecuencias

### Buenas

- **La decisión no la toma el modelo.** El LLM redacta; el código dicta si esa redacción se
  publica. Eso hace que el comportamiento sea auditable y reproducible.
- La asimetría maximiza utilidad: el sistema responde siempre que puede, y se calla sólo
  cuando le falta algo estructural.
- El `nextStep` obligatorio convierte la abstención en una **acción**: el operador sabe
  qué falta para obtener respuesta.
- El modo `observe` permite **desplegar y medir antes de bloquear**: se registra el
  veredicto sin cambiar el flujo, se colecta evidencia de la flota real, y recién después
  se activa `strict`.
- La precedencia por tenant permite que un ISP observe mientras otro exige strict, sin
  redeploy.
- El reloj inyectable convierte la clasificación en una función pura testeable.

### Malas

- **La calidad de la abstención depende de la calidad de `completeness`**, que es una
  metadata declarada a mano (ver [ADR 0005](0005-evidencia-primero-con-envelope-de-procedencia.md)).
  Una tool mal clasificada produce abstenciones falsas.
- `incomplete` es **binario**: una tool que devuelve el 95% de lo esperado pero marca
  `partial` abstiene igual. No hay gradación entre `partial` y `minimal` en la política.
- El modo strict puede **silenciar respuestas que el operador esperaba**, y en un NOC eso
  genera la queja "el sistema no me dice nada". La mitigación es el `nextStep`, pero exige
  que el operador lo lea.
- `low_confidence` y `stale` sólo producen `warn`: si el operador no mira los warnings, la
  advertencia es indistinguible de un `allow`.
- El default `strict` es una apuesta: un sistema recién desplegado que no tenga bien
  calibrada la metadata de sus tools va a parecer "mudo".

### Abiertas

- No hay un veredicto intermedio entre `allow` y `abstain`: el payload de abstención es
  todo o nada.
- La calibración de `confidence` por tool es empírica y no está documentada con datos de
  campo. El harness de evaluación mide `abstentionRate` todas las noches, pero no hay un
  umbral que obligue a recalibrar.
