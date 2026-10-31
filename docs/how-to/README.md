# How-to

Documentación de **ejecución**: recetas que resuelven una tarea concreta y dan los comandos
exactos para copiarlos y pegarlos. Cada receta asume que ya conocés el producto —qué es un
tenant, un conector NMS, una alerta— y sólo cubre *cómo se hace*, no *por qué el sistema
está armado así*.

Para consultar *qué existe* (variables, endpoints, modelos) está
[Reference](../reference/); para entender *por qué* está [Explanation](../explanation/).

| Documento | Qué resuelve |
|---|---|
| [Conectar un NMS real](conectar-un-nms-real.md) | Registrar un conector SmartOLT / Mikrowisp / MikroTik contra el NMS de producción, probarlo y saber cómo se guardan las credenciales |
| [Habilitar NOC y SOC](habilitar-noc-y-soc.md) | Encender los planos de vigilancia: poller de métricas, ciclo de vida de alertas, canales de notificación, receptor syslog y auditoría de firmware |
| [Usar el mock NMS](usar-el-mock-nms.md) | Levantar el NMS simulado en `:5515` y apuntar un conector real a él, sin hardware |
| [Probar sin hardware](probar-sin-hardware.md) | Ejercitar los cuatro planos (NOC, SOC, NMS, SNMP) con datos sintéticos y un Postgres local |
| [Agregar soporte de un OLT nuevo](agregar-soporte-de-un-olt-nuevo.md) | Implementar un adapter SNMP para un fabricante: contrato, fuentes, fixtures, golden files y gates de CI |
| [Agregar un endpoint de la API](agregar-un-endpoint-de-la-api.md) | Escribir una ruta en `apps/web/app/api/**` con sesión, permiso, aislamiento por tenant, CSRF, cuota y auditoría |
| [Desplegar en producción](desplegar-en-produccion.md) | Levantar el stack con Docker Compose (con o sin Caddy), aplicar migraciones y crear el primer usuario admin |
| [Backup y restauración](backup-y-restauracion.md) | Respaldar y restaurar PostgreSQL, respaldar VictoriaMetrics y recuperar las claves que no se pueden regenerar |
| [Correr el harness de evaluación](correr-el-harness-de-evaluacion.md) | Ejecutar el harness adversarial de `packages/eval`, producir el reporte de métricas y cerrar el loop de feedback |
