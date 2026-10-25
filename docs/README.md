# Documentación de FTTH-Copilot

Esta documentación sigue el modelo [Diátaxis](https://diataxis.fr): cuatro tipos de
documento, con propósitos distintos, que **no** se mezclan.

| Tipo | Responde a | Para quién | Cuándo elegirlo |
|---|---|---|---|
| **Tutorial** | *"¿Cómo aprendo a hacer esto?"* | Alguien que no conoce el producto | La primera vez, de principio a fin |
| **How-to** | *"¿Cómo hago esta tarea concreta?"* | Alguien que ya conoce el producto | Cuando hay que resolver un problema real |
| **Reference** | *"¿Qué existe y qué parámetro tiene?"* | Alguien que va a consultar | Cuando se busca un dato exacto |
| **Explanation** | *"¿Por qué está armado así?"* | Alguien que va a mantenerlo | Antes de tomar una decisión técnica |

Las **decisiones de arquitectura** que sostienen el sistema están registradas aparte, en
[ADR](adr/), con contexto, decisión y consecuencias.

## Las cuatro secciones

### 📘 Tutorials — aprender

Caminos paso a paso, con un objetivo concreto y un resultado verificable.

- [El demo en un comando](tutorials/tutorial-1-el-demo-en-un-comando.md) — levantar todo
  con Docker y ver el dashboard con datos (5 min).
- [Tu primera consulta](tutorials/tutorial-2-tu-primera-consulta.md) — qué pasa realmente
  cuando le preguntás algo al chat (10 min).
- [Entorno local](tutorials/tutorial-3-entorno-local.md) — Postgres + `pnpm dev` para tocar
  el código (15 min).
- [Una investigación de punta a punta](tutorials/tutorial-4-una-investigacion.md) — pedir
  un diagnóstico formal y leer sus hipótesis y sus versiones (15 min).

→ [Índice de tutorials](tutorials/README.md)

### 🛠 How-to — hacer

Recetas que resuelven una tarea concreta, con los comandos exactos.

- [Conectar un NMS real](how-to/conectar-un-nms-real.md)
- [Habilitar NOC y SOC](how-to/habilitar-noc-y-soc.md)
- [Usar el mock NMS](how-to/usar-el-mock-nms.md)
- [Probar sin hardware](how-to/probar-sin-hardware.md)
- [Agregar soporte de un OLT nuevo](how-to/agregar-soporte-de-un-olt-nuevo.md)
- [Agregar un endpoint de la API](how-to/agregar-un-endpoint-de-la-api.md)
- [Desplegar en producción](how-to/desplegar-en-produccion.md)
- [Backup y restauración](how-to/backup-y-restauracion.md)
- [Correr el harness de evaluación](how-to/correr-el-harness-de-evaluacion.md)

→ [Índice de how-to](how-to/README.md)

### 📖 Reference — consultar

Catálogos exactos, sin explicaciones.

- [Configuración](reference/configuracion.md) — todas las variables de entorno.
- [API HTTP](reference/api-http.md) — todos los endpoints, con guard y forma de respuesta.
- [Línea de comandos](reference/linea-de-comandos.md) — scripts de `package.json` y de
  `scripts/`.
- [Modelo de datos](reference/modelo-de-datos.md) — modelos Prisma, enums y relaciones.
- [Paquetes internos](reference/paquetes.md) — los 12 paquetes del workspace.
- [Contenedores y CI](reference/contenedores-y-ci.md) — compose, imágenes y workflows.

→ [Índice de reference](reference/README.md)

### 💡 Explanation — entender

Por qué el sistema es como es.

- [Arquitectura](explanation/arquitectura.md) — los tres planos y los dos pipelines.
- [Evidencia y Truth Gate](explanation/evidencia-y-truth-gate.md) — por qué una respuesta
  sin evidencia no se publica.
- [Investigación cognitiva](explanation/investigacion-cognitiva.md) — cómo se produce un
  diagnóstico defendible.
- [Ciclo de vida de las alertas](explanation/ciclo-de-vida-de-alertas.md) — por qué una
  alerta es un estado y no un evento.
- [Routing y Laya](explanation/routing-y-laya.md) — los tres modos del router y la capa de
  decisión rápida.
- [Topología y tenants](explanation/topologia-y-tenants.md) — la jerarquía OLT→ONU con
  validez temporal y el aislamiento por tenant.

→ [Índice de explanation](explanation/README.md)

### 🏛 ADRs — decisiones

Un registro numerado por decisión, con contexto, decisión y consecuencias.

→ [Índice de ADRs](adr/README.md)

## Documentos anteriores

Esta estructura no reemplaza a la documentación que ya existía en el repo: la complementa.
Los documentos siguientes cubren material que no encaja en las cuatro categorías —roadmaps,
reportes de validación, auditorías y estudios de caso— y siguen vigentes:

| Documento | Qué es |
|---|---|
| [`aiops-roadmap.md`](aiops-roadmap.md) | Roadmap cognitivo: fases del AIOps |
| [`evidence-first-roadmap.md`](evidence-first-roadmap.md) | Roadmap de evidencia primero |
| [`roadmap-integraciones-pendientes.md`](roadmap-integraciones-pendientes.md) | Integraciones planificadas |
| [`roadmap-olt-multivendor.md`](roadmap-olt-multivendor.md) | Roadmap de soporte multi-vendor |
| [`roadmap-investigacion-cognitiva.md`](roadmap-investigacion-cognitiva.md) | Roadmap de la investigación |
| [`compatibility-matrix.md`](compatibility-matrix.md) | Matriz de compatibilidad por vendor (generada) |
| [`conformance-benchmark.md`](conformance-benchmark.md) | Benchmark de conformidad SNMP |
| [`benchmarks.md`](benchmarks.md) | Benchmarks del producto |
| [`security-audit.md`](security-audit.md) / [`security/`](security/) | Auditoría de seguridad y retención |
| [`validation/`](validation/) | Baselines, reportes de piloto y logs de QA |
| [`operations/`](operations/) | SOP del piloto y plan de fallback |
| [`engineering/`](engineering/) | Análisis de Laya y tracker de FEC |
| [`quickstart.md`](quickstart.md) / [`walkthrough.md`](walkthrough.md) | Guías rápidas originales |
| [`production-deployment.md`](production-deployment.md) | Guía de despliegue original |
| [`testing-without-hardware.md`](testing-without-hardware.md) | Guía original de pruebas sin hardware |
| [`contributing-snmp.md`](contributing-snmp.md) | Guía original de contribución SNMP |
| [`procedimiento-fuentes-mibs.md`](procedimiento-fuentes-mibs.md) | Procedimiento de gobernanza de fuentes MIB |
| [`distribution.md`](distribution.md) / [`android-build.md`](android-build.md) / [`tauri-desktop-build.md`](tauri-desktop-build.md) | Distribución y builds desktop/mobile |
| [`product-wedge.md`](product-wedge.md) / [`case-study-synthetic.md`](case-study-synthetic.md) | Posicionamiento y caso de uso |

## Convenciones

- Los documentos están en **español**, con voseo rioplatense.
- Las referencias técnicas, nombres de variables, endpoints, rutas de archivo y comandos se
  mantienen en su forma original.
- Las citas `path:line` apuntan al código: si una línea cambia, la referencia hay que
  actualizarla.
- Cuando un documento describe una limitación o una discrepancia, la dice explícitamente en
  lugar de ocultarla.
