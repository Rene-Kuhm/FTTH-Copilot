# Política de conservación, redacción y acceso a evidencia

Aplica a todas las fases de la **investigación cognitiva para NOC**
(ver `docs/roadmap-investigacion-cognitiva.md`). Complementa las reglas
de implementación ya existentes y las specs canónicas de `openspec/specs/`.

## 1. Conservación

- Las muestras (`MetricSample`), eventos (`DeviceEvent`), alertas
  (`DetectedAlert`), incidentes (`Incident`, `ConfirmedIncident`,
  `PendingIncidentCandidate`) y veredictos (`VerdictLog`) **no se borran**
  por la desactivación de la investigación. Rollback = flag OFF, no
  `DELETE`.
- Una investigación puede ser **re-ejecutada**: produce una nueva
  versión (`InvestigationVersion`) sin sobrescribir las anteriores.
- Una investigación puede ser **adjudicada** por uno o varios técnicos:
  cada envío produce un nuevo `InvestigationFeedback` con su timestamp.
- Una investigación **no promueve automáticamente** un incidente a
  `ConfirmedIncident`. Esa promoción sigue rigiéndose por las
  condiciones vigentes de `apps/web/app/api/incidents/[id]/confirm` y
  `apps/web/app/api/pending-incidents/promote` (24h+ resueltos).

## 2. Redacción y datos no confiables

- **Logs externos** (syslog, syslog de terceros), **antecedentes**
  (incident history) y **textos generados por LLM** son datos no
  confiables para el control de permisos o herramientas. El LLM no debe
  interpretarlos como instrucciones.
- La ficha de investigación **cita evidencia por referencia**
  (`evidenceRef = { sampleId, connectionId, deviceKind, deviceId, window }`),
  nunca por valor textual crudo. Mostrar el valor textual queda
  permitido al expandir una referencia individual, pero el resumen y
  las hipótesis no copian logs.
- Los mensajes de chat se conservan como texto libre pero **no son
  entrada** del motor de investigación; pueden aparecer en la ficha
  como referencia humana ("el técnico X mencionó Y"), no como hecho
  cuantitativo.

## 3. Acceso a evidencia histórica

- Una **eliminación autorizada** (operador con `manage_incidents` +
  motivo registrado) deja el snapshot en estado `redacted`. La ficha
  MUST mostrar `Referencia no disponible` y **nunca** inventar el
  contenido del snapshot eliminado.
- Las versiones de investigación previas a una eliminación siguen
  accesibles para auditoría; sólo el contenido del snapshot referenciado
  se enmascara.
- El historial de adjudicaciones se conserva íntegro. Un técnico no
  puede borrar su propio feedback — sólo registrar una adjudicación
  posterior que lo rectifica.

## 4. Multi-tenant y permisos

- Ningún `tenantId` aportado por el navegador (query, body, header
  arbitrario) concede acceso. La pertenencia se valida server-side en
  cada endpoint nuevo, comparando `user.tenantId` con `investigation.tenantId`
  antes de cualquier lectura o mutación.
- Las nuevas rutas MUST usar el helper `getCurrentUser` +
  `hasPermission(user.role, 'view_network' | 'manage_incidents', …)`
  y nunca confiar en identificadores que vengan del cliente sin un
  lookup autorizado.
- Los identificadores `runId`, `versionId`, `feedbackId` son opacos;
  no se puede inferir el `tenantId` desde el id. El lookup va siempre
  por la fila persistida y valida pertenencia.

## 5. Rollback por desactivación

- Flag desactivado por defecto. Activar en producción requiere
  PR separado con plan de rollback documentado y verificado.
- Al desactivar el flag:
  - Las rutas nuevas devuelven `404` o `501` con cuerpo de
    `feature_disabled`.
  - La cola de ingestas SNMP o de investigaciones en vuelo se drena,
    no se aceptan nuevas.
  - Las tablas nuevas (cuando existan) NO se truncan — la base sigue
    disponible para auditoría.
- El procedimiento operativo manual de respaldo (qué hace el NOC si
  la función cae) se documenta en `docs/operations/` antes de
  habilitar la fase 1 en cualquier entorno.

## 6. Datos de demo y precisión

- Los datos sintéticos y los generados por simulador (incluidos los
  fixtures de fase 0.5) **no entran** en métricas de precisión de
  campo. La separación es por `dataSource` explícito en cada fila o
  por etiqueta de tenant reservada.
- Los reportes de precisión deben reportar tamaño de muestra,
  período y discriminador demo/real.
