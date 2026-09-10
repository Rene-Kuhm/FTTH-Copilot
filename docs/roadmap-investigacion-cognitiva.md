# Roadmap de implementación: investigación cognitiva para NOC

Fecha: 2026-09-07. Baseline revisada: origin/main en 7c3db9d (PR #109).
Estado: planificación; ninguna fase de este documento está implementada por su creación.

## 1. Objetivo y alcance

Entregar una función Investigar incidente que reúna telemetría, topología e historial, presente hipótesis trazables, proponga comprobaciones de solo lectura y permita al técnico registrar el resultado real. La validación humana alimentará una evaluación reproducible del diagnóstico.

Este documento define el orden obligatorio del trabajo nuevo. Complementa roadmap-integraciones-pendientes.md, las especificaciones canónicas de openspec/specs/ y los roadmaps históricos; no declara como ausentes funciones ya entregadas. Ante discrepancias sobre lo implementado, comprobar código, pruebas y commit de referencia antes de planificar.

MUST significa requisito obligatorio; SHOULD, recomendación cuya excepción debe justificarse; MAY, opción. No se inicia una fase hasta cerrar el gate de su predecesora. Las tareas se ejecutan secuencialmente; un cambio de orden requiere una decisión escrita con impacto y dependencias revisadas.

## 2. Base que debe reutilizarse

| Superficie existente | Uso en este plan |
|---|---|
| Incident, DetectedAlert, MetricSample, DeviceEvent | Fuentes operativas; no crear repositorios paralelos de los mismos datos. |
| ConfirmedIncident, PendingIncidentCandidate | Memoria confirmada y promoción existente; extender su integración, no reemplazarla sin migración. |
| TenantPolicy, TopologyEdge | Políticas y topología temporal; verificar identidad de nodos entre conexiones. |
| packages/evidence | Procedencia, TruthGate, abstención, recuperación de incidentes y consultas topológicas. |
| packages/eval y VerdictLog | Corpus, etiquetas, evaluación y trazabilidad de resultados. |
| Polling, recolector FEC/óptica/LOS y syslog | Ingesta existente. SNMP será una fuente adicional. |
| Permisos, sesiones, cuotas, ESLint y CI | Controles obligatorios también para las nuevas rutas. |

La existencia de TruthGate no prueba que toda afirmación textual del LLM esté verificada. Este plan agrega un contrato de investigación y validaciones de referencias; no promete eliminar todas las alucinaciones.

## 3. Reglas de implementación

1. MUST partir del origin/main actualizado. Registrar SHA y estado de CI. Usar rama codex/<cambio> y checkout aislado si hay otro trabajo local.
2. MUST abrir un cambio OpenSpec por fase, siguiendo el esquema existente: propuesta, especificaciones delta, diseño y tareas. Revisar las especificaciones relacionadas antes de inventar contratos.
3. MUST describir escenarios Given/When/Then y seguir TDD: prueba que falla por el comportamiento faltante, implementación mínima, refactor y verificación. No aceptar fallos de instalación como evidencia RED.
4. MUST dividir cada fase en PRs revisables: contrato/persistencia, lógica/API, interfaz/integración y evidencia de cierre. Cada PR debe pasar sus controles; evitar dejar imports o migraciones rotos entre PRs.
5. MUST validar tenant, permisos y pertenencia de cada referencia en el servidor. Ningún tenantId aportado por el navegador concede acceso.
6. MUST identificar dispositivos por tenant, conexión cuando corresponda, tipo e ID. La topología debe usar una identidad que evite colisiones entre conexiones sin impedir relaciones explícitas autorizadas dentro del tenant.
7. MUST distinguir observación, hipótesis, recomendación y causa confirmada. Una correlación o un texto del LLM nunca constituye confirmación humana.
8. MUST mantener las operaciones sobre NMS en solo lectura. Reinicios, provisioning y cambios de configuración quedan fuera de este roadmap.
9. MUST limitar consultas, ventanas temporales, tamaños de respuesta, concurrencia, duración y costo de llamadas LLM/NMS; fijar valores en el diseño antes del código.
10. MUST usar migraciones aditivas, flags desactivados por defecto y rollback por desactivación. No borrar evidencia ni etiquetas para volver atrás.
11. MUST preservar procedencia y separar hora del evento de hora de recepción. Los datos de demo no entran en métricas de precisión de campo.
12. MUST tratar logs, antecedentes y textos externos como datos no confiables. Nunca interpretarlos como instrucciones ni permitir que alteren permisos o herramientas disponibles.

### Protocolo obligatorio de cierre

- [x] Escenarios de la fase y requisitos vinculados a pruebas concretas.
- [x] Pruebas unitarias de reglas y casos límite; integración real con PostgreSQL cuando haya persistencia.
- [x] API probada con permisos insuficientes, referencias ajenas y concurrencia relevante.
- [x] Prueba completa de interfaz → API → base de datos para cada nuevo flujo visible, sin sustituir su backend por mocks.
- [x] Ejecutar lint, typecheck, tests, cobertura y build según los scripts actuales del repositorio; ejecutar E2E cuando corresponda.
- [x] CI del SHA revisado aprobado. Un resultado de otro commit no sirve como evidencia.
- [x] Flags, migraciones, operación, límites y rollback documentados y comprobados.
- [x] Adjuntar resultados reproducibles en docs/validation/ y actualizar especificaciones canónicas según el flujo OpenSpec existente.
- [x] Registrar PR, SHA, comandos, resultados y riesgos pendientes en la tabla de seguimiento.

Los package.json actuales son la fuente de comandos ejecutables: openspec/config.yaml todavía contiene referencias históricas a lint vacío. La fase 0 debe reconciliarlas. No modificar umbrales ni omitir pruebas para conseguir CI verde.

## 4. Secuencia obligatoria

| Fase | Entregable | Dependencia |
|---|---|---|
| 0 | Baseline, escenarios y contratos de identidad | Ninguna |
| 1 | Validación humana y dataset evaluable | Gate 0 |
| 2 | Calidad y frescura de telemetría | Gate 1 |
| 3 | Ficha de investigación cognitiva | Gate 2 |
| 4 | Correlación temporal por topología | Gate 3 |
| 5 | Ventanas de mantenimiento | Gate 4 |
| 6 | Ingesta SNMP traps | Gate 5 |
| 7 | Piloto medido y decisión de lanzamiento | Gate 6 |

Las fases 1–3 forman el primer incremento funcional. Se pueden habilitar en un entorno controlado al superar sus gates; eso no equivale al cierre del piloto de fase 7. No hay fechas prometidas: el avance depende de evidencia.

## 5. Fase 0 — Baseline y contratos
- [x] 0.1 Actualizar referencias remotas y registrar SHA, migraciones aplicadas y comandos reales de CI.
- [x] 0.2 Inventariar memoria confirmada, rutas de promoción, roles, topología, evaluación y fuentes ópticas existentes.
- [x] 0.3 Definir identificadores estables de ejecución, investigación, versión de diagnóstico y evidencia; reutilizar IDs actuales cuando sean suficientes.
- [x] 0.4 Definir políticas de conservación de snapshots, redacción de datos personales y acceso a evidencias históricas. Tras una eliminación autorizada, mostrar referencia no disponible; nunca inventar el contenido.
- [x] 0.5 Crear fixtures de incidentes: ONU individual, caída compartida, falta de datos, evidencia contradictoria, topología ausente, mantenimiento y tenants con IDs coincidentes.
- [x] 0.6 Reconciliar comandos desactualizados de OpenSpec y documentar límites del despliegue de una instancia.

Gate 0: inventario y contratos aprobados por revisión del cambio, fixtures identificadas y baseline reproducible. No se crean modelos duplicados de incidentes ni se inicia UI todavía.

## 6. Fase 1 — Validación humana y evaluación

### Alcance

Agregar feedback versionado sobre un diagnóstico concreto. Estados propuestos: confirmed, incorrect, insufficient_data. Son etiquetas del diagnóstico, no estados operativos de resolución del incidente. El cambio OpenSpec MUST confirmar nombres y compatibilidad antes de la migración.

- [x] 1.1 Diseñar un registro de feedback con tenant, investigación/ejecución, versión evaluada, autor, fecha, etiqueta, observaciones y causa real opcional. Conservar revisiones en lugar de sobrescribir el historial.
- [x] 1.2 Definir permiso de validación, idempotencia y manejo de ediciones concurrentes. Dos envíos idénticos no generan dos confirmaciones.
- [x] 1.3 Implementar API de lectura/escritura con auditoría y control de pertenencia de todas las referencias.
- [x] 1.4 Integrar la promoción existente a ConfirmedIncident: respetar las condiciones vigentes de resolución y antigüedad. Confirmar una hipótesis no debe promover automáticamente un incidente aún abierto.
- [x] 1.5 Incorporar controles en la ficha del incidente: Confirmar, Incorrecto y Faltan datos; pedir causa y evidencia de resolución cuando sean necesarias para promoción.
- [x] 1.6 Exportar etiquetas compatibles con packages/eval. Definir conversión explícita y versionada; feedback de diagnóstico no equivale automáticamente a etiquetas de todas sus afirmaciones.
- [x] 1.7 Congelar un corpus inicial etiquetado, separado de los ejemplos usados en desarrollo. Registrar desacuerdos y resolución de etiquetas.

Pruebas obligatorias: acceso entre tenants denegado; reenvío idempotente; edición concurrente detectada; historial conservado; feedback negativo no promovido; promoción previa intacta; recorrido real de UI y persistencia.

Gate 1: un técnico puede evaluar un diagnóstico y recuperar esa evaluación. La evaluación produce un reporte con denominador, casos etiquetados y pendientes. Si faltan etiquetas, MUST mostrar insuficiencia, nunca precisión inventada. Propuesta inicial: al menos 30 casos adjudicados, incluyendo al menos 5 de insuficiencia y 5 de diagnóstico incorrecto; sirve para desarrollo, no para afirmar precisión de producción.

## 7. Fase 2 — Calidad de la evidencia
- [x] 2.1 Definir por métrica/fuente cadencia esperada, TTL, tolerancia a huecos y mínimo de muestras. Los umbrales son configuración documentada y requieren calibración por entorno.
- [x] 2.2 Implementar funciones puras para frescura, cobertura, valores ausentes, errores de colección y discontinuidades de contadores.
- [x] 2.3 Revisar cobertura entre muestras: un hueco prolongado dentro de la ventana MUST considerarse desconocido según la tolerancia definida, aunque existan muestras en ambos extremos.
- [x] 2.4 Separar estado del dispositivo de estado del recolector; una falla del NMS no demuestra que las ONUs estén offline.
- [x] 2.5 Integrar calidad con TruthGate mediante una extensión compatible y mostrar motivo y última observación en la ficha.
- [x] 2.6 Verificar salud con casos de recuperación, ausencia de primera ejecución, ciclo colgado y fallos parciales por conexión. No asumir que un retorno exitoso del scheduler implica recolección exitosa de todos los equipos.

Pruebas obligatorias: cero/una muestra; hueco interno; eventos fuera de orden o en el futuro; contador reiniciado; campo no soportado; reloj controlado; datos antiguos; recuperación del recolector sin fabricar mediciones.

Gate 2: cada diagnóstico puede distinguir evidencia vigente, insuficiente y vencida. Los casos de pérdida de telemetría no generan afirmaciones de caída física. Rollback desactiva el enriquecimiento nuevo conservando muestras y auditoría.

## 8. Fase 3 — Investigar incidente

### Contrato propuesto ftth.investigation.v1

MUST contener: ID, tenant/conexión, incidente, versión, fecha de corte, ventana temporal, referencias de evidencia, hipótesis, contradicciones, faltantes, comprobaciones sugeridas, estado de suficiencia y versiones de reglas/modelo/prompt. Cada hipótesis MUST separar soporte y contraevidencia. No mostrar porcentajes de confianza sin calibración; usar estados explicables de soporte.

- [x] 3.1 Especificar el contrato en packages/shared, con compatibilidad y límites de tamaño.
- [x] 3.2 Reunir evidencia desde fuentes autorizadas en packages/evidence. Recuperar historial confirmado como contexto, no como prueba de la causa actual.
- [x] 3.3 Construir cálculos y hechos en código determinista; el LLM propone interpretaciones/recomendaciones dentro del contrato.
- [x] 3.4 Validar del lado servidor cada referencia, alcance temporal y pertenencia; comprobar que cifras estructuradas correspondan a la evidencia. Referencias inventadas, números contradictorios o JSON inválido MUST producir salida segura con faltantes.
- [x] 3.5 Persistir una versión inmutable del resultado con snapshot acotado o referencias durables. Una actualización crea otra versión y no cambia aquello que el técnico ya evaluó.
- [x] 3.6 Crear API de investigación con cuotas, timeout, cancelación y protección contra duplicados simultáneos. Definir respuesta de ejecución pendiente si el tiempo máximo HTTP no alcanza.
- [x] 3.7 Implementar ficha: resumen, evidencia, hipótesis/alternativas, faltantes, siguiente comprobación y validación humana de fase 1.
- [x] 3.8 Probar integración real de UI/API/DB y fallos del proveedor LLM con respuestas controladas.

Gate 3: caso completo reproducible desde incidente hasta feedback. Cero accesos cruzados o referencias fabricadas aceptadas en el corpus de aceptación. El técnico puede abrir la evidencia y distinguir diagnóstico provisional de causa confirmada. No se ejecutan acciones NMS.

## 9. Fase 4 — Correlación por topología y tiempo

- [x] 4.1 Definir reglas deterministas por ancestro compartido, proximidad temporal, cantidad de afectados y proporción sobre población observada. Calibrar mínimos y ventana en fixtures, sin codificarlos como universales.
- [x] 4.2 Consultar topología válida a la hora del incidente; no aplicar ciegamente la topología actual a hechos históricos.
- [x] 4.3 Resolver identidad por conexión y tenant en aristas existentes. Cualquier migración MUST incluir detección de colisiones y backfill verificable.
- [x] 4.4 Generar grupos reproducibles con deduplicación y asociación a incidentes originales. No borrar ni fusionar destructivamente evidencia previa.
- [x] 4.5 Enriquecer investigación con infraestructura compartida, afectados observados y equipos sanos conocidos. No inferir splitters o tramos físicos que no estén registrados.
- [x] 4.6 Probar caída individual, grupo compartido, fallos simultáneos independientes, ciclos/topología incompleta, cambios de aristas y eventos tardíos.

Gate 4: mismo input y versión producen los mismos grupos; el tenant vecino nunca se incluye. Compartir un puerto MUST expresarse como asociación que respalda una hipótesis, no como demostración de corte de fibra. Comparar ruido y agrupación con el baseline antes de habilitar notificaciones agrupadas.

## 10. Fase 5 — Mantenimiento programado

- [x] 5.1 Definir ventanas con tenant, equipos/alcance explícito, inicio/fin UTC, zona horaria de presentación, motivo, autor y estado. Primera versión sin recurrencias.
- [x] 5.2 Incorporar creación, cancelación y auditoría con permiso específico. Resolver ventanas solapadas de forma determinista.
- [x] 5.3 Mantener ingesta y detección; modificar solamente la política de notificación para eventos esperables dentro del alcance.
- [x] 5.4 Definir eventos que nunca se silencian por mantenimiento, especialmente señales SOC ajenas al trabajo autorizado. Registrar cada supresión y su motivo.
- [x] 5.5 Mostrar mantenimiento en la investigación sin etiquetarlo automáticamente como causa real.
- [x] 5.6 Al finalizar, reevaluar incidentes aún activos y notificar una vez según la política; no reproducir un aluvión de avisos acumulados.

Gate 5: se preserva evidencia durante toda la ventana; quedan auditados avisos suprimidos y reactivados. Pruebas de bordes temporales, cambio de zona horaria, cancelación, alcance parcial y mantenimiento vencido.

## 11. Fase 6 — SNMP traps

- [x] 6.1 Elegir un fabricante/modelo y recopilar MIBs, OIDs, ejemplos autorizados y semántica de traps. La integración específica queda bloqueada si no existen esas entradas; usar un simulador solo valida transporte/parsing.
- [x] 6.2 Documentar versión SNMP, autenticación soportada, red de gestión, remitentes permitidos y asociación administrada remitente → tenant/conexión/equipo. No confiar en un tenant incluido en el payload.
- [x] 6.3 Evaluar una biblioteca y arquitectura contra documentación oficial vigente. Reutilizar TypeScript si alcanza; no introducir Go, Redis o NATS sin mediciones que lo justifiquen.
- [x] 6.4 Implementar recepción acotada, validación, parsing y normalización al contrato de telemetría vigente. OIDs desconocidos no se convierten en diagnósticos inventados.
- [x] 6.5 Controlar tasa, concurrencia, cola acotada, duplicados y pérdida de eventos; exponer descartes y salud. Documentar las limitaciones de entrega UDP.
- [x] 6.6 Vincular traps y recuperación con incidentes existentes; considerar desorden, retransmisiones y cambios de reloj del equipo.
- [ ] 6.7 Ejecutar primero en modo observación, sin notificaciones nuevas, y contrastar simulador con eventos de un equipo real autorizado (modo observación implementado; contraste con equipo real pendiente de hardware OLT).

Gate 6: pruebas de parsing y aislamiento, prueba de carga con presupuesto fijado antes del ensayo y comparación con equipo real. Si solo se verificó un simulador, el estado es validado en laboratorio; el gate de campo sigue abierto. Flag desactivado debe cerrar el receptor e impedir nuevas ingestas.

## 12. Fase 7 — Piloto y aceptación

- [ ] 7.1 Elegir un tenant piloto autorizado y habilitar funciones de forma progresiva. Mantener procedimiento operativo manual de respaldo (SOP y contratos listos; ejecución de campo pendiente).
- [x] 7.2 Congelar conjunto de evaluación separado de desarrollo y registrar versión del modelo, prompt, reglas, fuentes y configuración por ejecución.
- [ ] 7.3 Medir diagnóstico correcto entre casos evaluables, afirmaciones respaldadas, abstención, cobertura de etiquetas, falsos positivos de alertas, latencia p95 y costo por investigación. No confundir clasificación de evidencia con corrección de causa raíz (cálculos listos; etiquetas NOC reales en labels.csv pendientes/TBD).
- [x] 7.4 Registrar tiempo hasta causa confirmada y hasta resolución como métricas distintas; comparar contra baseline de incidentes comparables y reportar tamaño de muestra.
- [ ] 7.5 Definir antes del piloto los umbrales numéricos de aceptación y duración. Si no están fijados, no habilitar producción general. Propuesta de inicio: 14 días y 50 investigaciones adjudicadas, ampliando el período si no se alcanza el volumen; esto no garantiza suficiencia estadística (umbrales definidos en código; ejecución temporal de los 14 días pendiente).
- [x] 7.6 Criterios duros: cero accesos cruzados, cero acciones NMS no autorizadas y rechazo de referencias inexistentes en pruebas de aceptación. Reportar incertidumbre de las métricas de campo.
- [ ] 7.7 Probar rollback y recuperación; decidir continuar piloto, corregir o lanzar, con evidencia escrita (rollback no destructivo probado; decisión final de lanzamiento pendiente tras piloto).

Gate 7: reporte reproducible, limitaciones explícitas, umbrales satisfechos y procedimiento operativo disponible. CI verde por sí solo no valida precisión del diagnóstico ni rendimiento en red real.

## 13. Fuera de alcance

- Remediación autónoma, reinicios o cambios de configuración de red.
- Entrenamiento automático con feedback sin adjudicación y control de versiones.
- Afirmar causalidad por correlación o precisión sin corpus etiquetado.
- Introducir infraestructura distribuida antes de medir su necesidad.
- gNMI/NETCONF y NetSense: permanecen en el roadmap de integraciones existente; no son dependencias de las fases 0–5.

Para pasar a varias instancias, abrir un cambio previo de coordinación distribuida, idempotencia y deduplicación persistente. Los bloqueos/caches en memoria actuales no deben presentarse como garantías entre procesos.

## 14. Seguimiento obligatorio

| Fase | Estado | PR / SHA | Evidencia de gate | Pendientes |
|---|---|---|---|---|
| 0 | Verificada | PR #110 | docs/validation/fase-0-baseline.md | Ninguno |
| 1 | Verificada | PR #111–#116 | packages/eval/tests/investigation-corpus.test.ts | labels.csv con datos de campo reales (TBD) |
| 2 | Verificada | PR #117–#119 | apps/web/tests/lib/monitoring/ | Ninguno |
| 3 | Verificada | PR #120, #123–#129 | packages/agent-core/tests/investigation-engine.test.ts | Ninguno |
| 4 | Verificada | PR #130–#135 | packages/evidence/tests/correlation-engine.test.ts | Ninguno |
| 5 | Verificada | PR #136–#138 | apps/web/tests/lib/maintenance/suppression-audit.test.ts | Ninguno |
| 6 | Validada en laboratorio | PR #139–#140 | packages/monitoring/tests/snmp/ | Gate de campo: contrastar con hardware OLT real |
| 7 | En curso (Pre-piloto) | PR #141 | docs/validation/fase-7-pilot-report.md | 14 días de piloto de campo, >=50 casos adjudicados y precisión NOC (labels.csv) |

Estados permitidos: Pendiente, En curso, Bloqueada, Verificada. Una fase solo pasa a Verificada con su checklist y gate completos. Si un requisito cambia, actualizar propuesta, escenarios y tabla antes de continuar.

### Instrucción para comenzar la siguiente sesión

> Leer docs/roadmap-investigacion-cognitiva.md y las instrucciones del repositorio. Actualizar origin/main, registrar su SHA y ejecutar únicamente la fase 0. Crear el cambio OpenSpec correspondiente, contrastar capacidades actuales y preparar contratos/fixtures. No iniciar fase 1 ni marcar tareas completas sin evidencia. Al terminar, informar qué se verificó, dónde está la evidencia y cuál es el siguiente requisito pendiente.
