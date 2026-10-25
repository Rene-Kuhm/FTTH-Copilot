# Explanation

Documentación de **comprensión**: explica *por qué* el sistema está armado así, qué
significado tienen los conceptos y cómo se relacionan las piezas. No es una guía de
pasos ni una tabla de parámetros.

| Documento | Qué explica |
|---|---|
| [Arquitectura](arquitectura.md) | Los tres planos de producto, los dos pipelines de datos y el mapa de paquetes |
| [Evidencia y Truth Gate](evidencia-y-truth-gate.md) | Por qué toda respuesta del agente lleva procedencia, y qué pasa cuando la evidencia es dudosa |
| [Investigación cognitiva](investigacion-cognitiva.md) | Cómo el motor de investigación produce un diagnóstico defendible y qué garantiza |
| [Ciclo de vida de las alertas](ciclo-de-vida-de-alertas.md) | Por qué una alerta es un estado y no un evento, y cómo se correlacionan en incidentes |
| [Routing y Laya](routing-y-laya.md) | Los tres modos del Organic Diagnostic Router y la capa de decisión rápida |
| [Topología y tenants](topologia-y-tenants.md) | La jerarquía OLT→ONU con validez temporal, y por qué todo es tenant-scoped |

Las decisiones concretas que sostienen estas explicaciones están registradas como ADRs en
[docs/adr](../adr/).
