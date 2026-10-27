# Modelo C4 de FTTH-Copilot

La arquitectura dibujada del repo vive acá, como **código**: un único archivo D2
del que salen las vistas C4 y sus SVG renderizados.

| Archivo | Qué es |
|---|---|
| [`model.d2`](model.d2) | El modelo. Es la **única** fuente: las vistas son `layers` del mismo archivo. |
| [`views/context.svg`](views/context.svg) | Vista de Contexto de sistema. |
| [`views/container.svg`](views/container.svg) | Vista de Contenedores. |
| [`views/component.svg`](views/component.svg) | Vista de Componentes de `apps/web`. |
| [`views/dataflow.svg`](views/dataflow.svg) | Flujo de datos: de las fuentes a la evidencia, a los tres planos y a la salida. |

## Renderizar

`d2` está fijado a la versión 0.9.0 por [`mise.toml`](../../mise.toml), así que
el render es reproducible. Desde la raíz del repo:

```bash
pnpm c4:render   # renderiza todas las vistas en docs/architecture/c4/views/
pnpm c4:check    # falla si lo commiteado no coincide con lo que renderiza el modelo
```

Los dos scripts de arriba son los que usa el CI. Por debajo, `d2` se invoca una
vez por vista:

```bash
d2 validate docs/architecture/c4/model.d2

d2 --target layers.context   docs/architecture/c4/model.d2 docs/architecture/c4/views/context.svg
d2 --target layers.container docs/architecture/c4/model.d2 docs/architecture/c4/views/container.svg
d2 --target layers.component docs/architecture/c4/model.d2 docs/architecture/c4/views/component.svg
d2 --target layers.dataflow  docs/architecture/c4/model.d2 docs/architecture/c4/views/dataflow.svg
```

Los comandos se ejecutan **desde la raíz del repo** y escriben siempre en
`docs/architecture/c4/views/`. `d2 validate` tiene que responder `Success!` antes
de tocar los SVG: si el modelo no compila, los SVG que quedan en disco son de
la versión anterior y el diff de CI miente.

El SVG de `d2` es determinista con la misma versión: renderizar dos veces el
mismo target da archivos byte a byte idénticos. Eso permite que CI verifique
que los SVG commiteados están al día con el modelo: `pnpm c4:check` renderiza
en un directorio temporal y compara byte a byte, sin tocar el worktree.

> `d2` embebe la tipografía en base64 dentro del SVG, así que los archivos
> pesan entre 28 KB y 37 KB y no dependen de las fuentes instaladas en la
> máquina.

## Las vistas

| Vista | Target | Qué muestra | Nodos |
|---|---|---|---|
| Contexto | `layers.context` | El sistema `FTTH-Copilot` (software system) rodeado de las personas que lo usan y de los sistemas externos de los que depende: NMS (SmartOLT, Mikrowisp, MikroTik), traps SNMP, syslog, proveedores LLM, PostgreSQL, VictoriaMetrics, canales de notificación y Arize Phoenix. | 13 |
| Contenedores | `layers.container` | Las unidades ejecutables y desplegables del sistema, dentro del marco `FTTH-Copilot`: `apps/web`, `packages/agent-core`, Laya, `packages/soc`, `packages/monitoring`, `packages/analytics`, `packages/alerts`, `packages/db`, `packages/connectors/*` y los dos receptores UDP (SNMP y syslog). | 21 + marco |
| Componentes | `layers.component` | La descomposición de **un** contenedor, `apps/web`: middleware, route handlers, auth/RBAC, capa de chat, capa de ops y métricas, acceso a datos y orquestación en runtime, más sus dependencias (`packages/agent-core`, `packages/shared` + `services/laya`, `packages/db`, `packages/connectors/*`). | 14 + marco |
| Flujo de datos | `layers.dataflow` | Cómo circula el dato: fuentes (NMS, traps SNMP, syslog) → ingesta y evidencia con procedencia → los tres planos (NOC, SOC, Copiloto) → salida al operador, con PostgreSQL en el centro. | 26 + 6 marcos |

El conteo no incluye el marco del sistema (`FTTH-Copilot` en la vista de
contenedores, `apps/web` en la de componentes): en el SVG el marco es una caja
más, dibujada con trazo discontinuo.

Cada nodo lleva dos líneas: la primera es la **ruta real del repo**
(`apps/web`, `packages/agent-core`, `packages/monitoring/src/snmp/receiver.ts`)
y la segunda qué hace. Un lector puede mapear cualquier caja al código sin
consultar otro documento.

## Cómo editar el modelo

1. Editá [`model.d2`](model.d2). Las vistas son `layers: { context, container, component, dataflow }`.
2. `d2 validate docs/architecture/c4/model.d2` → `Success!`.
3. `pnpm c4:render`.
4. Revisá el diff: el SVG es código generado, se commitea junto al modelo.
5. `pnpm c4:check` confirma que lo commiteado coincide con el modelo.

### Reglas que el modelo respeta

- **Paleta C4 en `classes:`.** `persona` (`#08427b`), `software-system`
  (`#1168bd`), `external-system` (`#999999`), `container` (`#438dd5`),
  `component` (`#85bbf0`), `store` (cilindro) y `boundary` (el marco del
  sistema). Todo lo que se comparte entre las capas vive en `classes:`;
  un nodo nuevo se define con `class: <nombre>` y no con estilos sueltos.
- **Referencias cualificadas.** Un nodo anidado se referencia siempre con su
  prefijo (`ftth-copilot.web`). Si se omite, `d2` crea un nodo nuevo en la raíz
  de la capa y el diagrama queda duplicado sin avisar.
- **Layout determinista.** Layout por defecto (`dagre`), sin `elk` (necesita
  Java) y sin `--sketch`. `grid-columns` se usa en las capas de contenedores y
  componentes: sin él, `dagre` pone los once contenedores del sistema en una
  fila de más de 4000 px que al escalarse a pantalla quedan ilegibles.
- **Sin `link:` a URLs externas ni iconos.** El SVG tiene que ser reproducible
  byte a byte.
- **Sin `vars` dependientes del entorno.**

### Limitaciones conocidas de `d2` v0.9

- **`vars:` no se sustituye dentro de `layers:`.** `var(x)` dentro de una capa
  se renderiza literal. Por eso las etiquetas de los nodos están escritas
  inline y las `vars:` de la raíz se usan solo en la escena raíz (la leyenda
  de la paleta). Para compartir texto entre capas hay que copiarlo.
- **`var()` tampoco funciona en `style`.** Los colores de `classes:` están
  escritos como hex literales.
- **La etiqueta de una persona se dibuja fuera de la figura**, así que
  `persona` usa texto azul oscuro (`#08427b`) en vez de blanco: en blanco
  quedaría invisible sobre el fondo del canvas.
- **`near` no se puede usar con nodos que son celdas de un `grid`.** Por eso
  el layout se resuelve con `grid-columns` y no con restricciones de vecindad.

## Cómo se relaciona con el resto de la documentación

Este modelo reemplaza los diagramas Mermaid de arquitectura embebidos en
[`ARCHITECTURE.md`](../../ARCHITECTURE.md), [`README.md`](../../README.md) y
[`AGENTS.md`](../../AGENTS.md). El contenido narrativo sigue ahí: el modelo C4
responde **dónde está cada cosa**, el Markdown responde **por qué**. Los
diagramas que no son de arquitectura (árboles de decisión, secuencias) siguen
siendo Mermaid dentro del Markdown.

Fuentes de verdad del modelo:

| Fuente | Qué aporta al modelo |
|---|---|
| [`ARCHITECTURE.md`](../../ARCHITECTURE.md) | Mapa de módulos por capas L0..L5, límites entre paquetes, flujo de datos, Organic Diagnostic Router y Laya. |
| [`AGENTS.md`](../../AGENTS.md) §5 | Resumen de arquitectura por capas (WEB → MOTORS → SERVICES → DATA → CORE). |
| [`docs/architecture.md`](../../architecture.md) | Pipelines NOC y SOC, Laya Decision Layer, TruthGate y modelo mental. |
| `packages/*/package.json` | Nombres reales de los paquetes: nada de contenedores inventados. |
