# Topología y tenants

Dos conceptos que atraviesan todo el producto: **cómo se modela la red** y **cómo se aísla
un ISP de otro**.

## La jerarquía de la red

La topología de un FTTH no es un grafo libre: es una jerarquía fija de cinco niveles.

```text
OLT
 └─ PON_PORT
     └─ SPLITTER
         └─ CTO
             └─ ONU
```

Ese es el enum `TopologyNodeKind` (`packages/db/prisma/schema.prisma:125`). La jerarquía
importa porque define qué preguntas tiene sentido hacer:

- **Hacia arriba** (`get_topology_path`): ¿de qué OLT cuelga esta ONU? ¿por qué splitter?
- **Hacia abajo** (`get_downstream_clients`): ¿qué ONUs dependen de este splitter? Si se
  cae el splitter, el radio de impacto son todas.

Las dos direcciones no son el mismo grafo. Una ONU tiene un camino único hacia arriba
(árbol), pero un splitter tiene muchas ONUs debajo (grafo dirigido con fan-out).

## Las aristas tienen fecha de vencimiento

La tabla `TopologyEdge` (`packages/db/prisma/schema.prisma:631`) no es una tabla de
relaciones: es una tabla de **hechos temporales**.

```text
parentKind, parentId  ──▶  childKind, childId
validFrom, validTo?          (validTo = NULL significa vigente)
source
```

El contrato del schema `ftth.topology-edge.v1` (`packages/shared/src/contracts.ts`)
impone que `validTo > validFrom` cuando está presente, y rechaza los self-loops y los kinds
desconocidos.

**Por qué expiración blanda y no borrado:** el parpadeo de un equipo produce
reconfiguraciones de topología que van y vienen. Si borraras la arista, no tendrías forma
de saber que hace 10 minutos esa ONU estaba en otro splitter. Con `validTo`, la arista
"caducada" sigue ahí, y las consultas que operan "ahora" la filtran.

`source` registra de dónde salió el hecho, que no siempre es el NMS: puede ser una
importación, un plan de fibra cargado manualmente o un escaneo SNMP.

## La topología es una herramienta de lectura, no una escritura

Las tools de topología son **de sólo lectura**: suben y bajan por las aristas vigentes y
devuelven el resultado. El modelo de `TopologyEdge` no tiene ninguna forma de que el agente
"arregle" la topología: no hay tool de escritura, y el único camino para mutar datos de red
es la API de planes de fibra, que es una operación de usuario explícita.

Cuando el grafo está vacío, el resultado es un veredicto `incomplete`, no un "sin
incidencias". Un grafo vacío significa "no sabemos", y el TruthGate tiene que poder
distinguir eso de "no hay nada".

## El álgebra es pura

`packages/evidence/src/topology.ts` implementa la lógica sin tocar la base:

- `bfsDownstream(edges, rootKind, rootId)` — las ONUs alcanzables, excluyendo las aristas
  con `validTo != null`.
- `bfsAncestors(edges, leafKind, leafId)` — la cadena hacia arriba, sin incluir la hoja.
- `topologyPath(edges, kind, id)` — la ruta completa.

Que sea puro tiene una consecuencia concreta: los tests de topología no necesitan Postgres,
y el mismo código sirve tanto para el chat como para la correlación de situaciones.

## Correlación topológica

`packages/analytics/src/correlation-score.ts` puntúa una "situación": un conjunto de
eventos correlacionados por topología **y** tiempo, con una confianza aprendida.

Los pesos son **logísticos y aprendidos por tenant**: `CorrelationWeight`
(`schema.prisma:992`) guarda un `Json` de pesos por tenant, y `CorrelationOutcome`
(`schema.prisma:1008`) guarda cada evaluación (grupo, si fue confirmado, ventana, métrica,
actor). El loop `updateWeights` ajusta los coeficientes con las salidas confirmadas.

Es un modelo pequeño y explicable: `scoreSituation` devuelve no sólo un número, sino
`topContributions` — qué señales suman o restan. En un producto donde una decisión
automática puede generar una visita técnica, un score sin explicación no es
accionable.

## Todo es tenant-scoped

El aislamiento entre ISPs es **estructural**, no aplicado en la capa de aplicación.

### La raíz

`Tenant` (`schema.prisma:156`) es la raíz de todo. `slug` es único y sirve para
subdominios y URLs. 31 modelos llevan `tenantId` con `onDelete: Cascade`: borrar el tenant
borra su historia.

Seis modelos no llevan `tenantId` y se alcanzan transitivamente:

| Modelo | Se alcanza por |
|---|---|
| `Session` | `userId` |
| `RateLimitBucket` | `userId` |
| `Message` | `conversationId` |
| `OnCallEntry` | `scheduleId` |
| `AuthRateLimit` | sin FK, a propósito (comentario `schema.prisma:454-458`) |
| `Tenant` | — |

`AuthRateLimit` es la excepción deliberada: el contador de fuerza bruta existe **antes** de
que el atacante se identifique, así que no puede estar atado a un usuario.

### Las claves compuestas incluyen el tenant

Todas las unicidades de negocio llevan `tenantId` primero: `[tenantId, email]`,
`[tenantId, provider, label]`, `[tenantId, connectionId, kind, deviceKind, deviceId]`,
`[tenantId, connectionId, deviceKind, deviceId]`, `[tenantId, sourceIncidentId]`,
`[tenantId, runId]`, `[tenantId, evidenceId]`.

Eso permite que dos ISP distintos tengan un `deviceId` con el mismo nombre —y de hecho la
tienen— sin colisionar.

### Las referencias blandas, y por qué

Varias columnas parecen no tener foreign key. No es un olvido:

| Columna | Por qué es blanda |
|---|---|
| `ConfirmedIncident.investigationFeedbackId` | borrar un feedback **no** debe borrar el conocimiento acumulado |
| `ConfirmedIncident.sourceIncidentId` | el incidente de origen puede haberse purgado; la KB sobrevive |
| `InvestigationRun.incidentId` | el incidente es contexto, no parte del run |
| `InvestigationVersion.runRefId` | las versiones se consultan por `runId` blando |
| `TopologyEdge.parentId` / `childId` | son identificadores externos del NMS, no filas propias |
| `PlanMarker.deviceId`, `GeoZone.deviceId` | Ídem: identificadores de red externos |
| `OnCallEntry.userId` | referencia al usuario sin cascada destructiva |

### Las FKs opcionales usan `SetNull`

Las ocho FKs `connectionId` (en `Conversation`, `MetricSample`, `DetectedAlert`, `Incident`,
`DeviceEvent`, `ConfirmedIncident`, `InvestigationRun`, `FiberPlan`), más
`PlanMarker.zoneId` y `ConfirmedIncident.confirmedByUserId`, usan `onDelete: SetNull`.

Borrar un conector NMS no puede borrar la historia de métricas que se recolectó con ese
conector. La fila queda con `connectionId = NULL` y conserva el dato.

### En la capa de aplicación

El filtro por tenant se aplica en cada query, no en un middleware global. Cuando un recurso
no pertenece al tenant, la API responde **404**, no 403: un 403 confirmaría que el recurso
existe. `GET /api/incidents/[id]` lo hace explícito
(`apps/web/app/api/incidents/[id]/route.ts:38-45`).

## En una línea

La topología es un grafo dirigido con aristas que caducan, y el tenant es el único eje por
el que se puede consultar: el aislamiento no es una convención, es parte del modelo de
datos.
