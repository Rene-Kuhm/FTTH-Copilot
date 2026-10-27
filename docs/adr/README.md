# Architecture Decision Records

Un ADR registra una decisión de arquitectura **que ya está tomada**, con su contexto, la
decisión en sí y sus consecuencias. No es una propuesta ni una lista de deseos.

Todos los ADRs de este directorio corresponden a decisiones **verificables en el código** de
este repositorio. Cada uno cita los archivos y las líneas donde la decisión está
materializada, así que se puede auditar.

## Formato

Cada ADR tiene tres secciones:

- **Contexto** — qué presión o problema forzaba la decisión.
- **Decisión** — qué se decidió, en presente y en imperativo.
- **Consecuencias** — qué se gana, qué se pierde, y qué queda abierto.

## Índice

| # | Decisión | Estado |
|---|---|---|
| [0001](0001-monorepo-pnpm-turborepo.md) | Monorepo pnpm + Turborepo con paquetes por responsabilidad | Aceptada |
| [0002](0002-postgresql-y-prisma-como-store-unico.md) | PostgreSQL + Prisma como store único | Aceptada |
| [0003](0003-multitenancy-en-la-capa-de-datos.md) | Multi-tenancy estructural en el modelo de datos | Aceptada |
| [0004](0004-nextjs-app-router-como-unica-aplicacion.md) | Next.js App Router como única aplicación web | Aceptada |
| [0005](0005-evidencia-primero-con-envelope-de-procedencia.md) | Evidencia primero: envelope `evidence.provenance.v1` en cada tool | Aceptada |
| [0006](0006-truth-gate-y-abstencion-estricta.md) | TruthGate con abstención asimétrica en modo strict | Aceptada |
| [0007](0007-detectores-puros-separados-de-la-orquestacion.md) | Detectores puros separados de la orquestación con base | Aceptada |
| [0008](0008-adapters-snmp-claveados-por-iana-pen.md) | Adapters SNMP con identidad de vendor anclada en IANA PEN | Aceptada |
| [0009](0009-laya-como-capa-de-decision-rapida.md) | Laya como capa de decisión rápida (System 1) con shadow mode | Aceptada |
| [0010](0010-routing-determinista-de-modos.md) | Selección determinista de modo en el Organic Diagnostic Router | Aceptada |
| [0011](0011-sesion-jwt-en-cookie-con-csrf-y-mfa.md) | Sesión JWT en cookie HttpOnly con CSRF double-submit y MFA TOTP | Aceptada |
| [0012](0012-versiones-inmutables-y-memoria-confirmada.md) | Versiones de investigación inmutables y memoria de incidentes confirmados | Aceptada |
| [0013](0013-abstraccion-de-proveedor-llm-con-fallback.md) | Abstracción de proveedor LLM con cadena de fallback | Aceptada |
| [0014](0014-ingesta-durable-con-spool-en-disco.md) | Ingesta durable con spool en disco y dedup por `ingestId` | Aceptada |
| [0015](0015-observabilidad-prometheus-y-victoriametrics.md) | Observabilidad con exposition Prometheus y VictoriaMetrics | Aceptada |
| [0016](0016-gobernanza-de-fuentes-mib-y-niveles-de-soporte.md) | Gobernanza de fuentes MIB con grados de confianza y niveles de soporte | Aceptada |

## Documento previo

`docs/engineering/ADR-042-laya-decision-layer.md` documenta la decisión de Laya con su
formato original. Este directorio la reindexa como [ADR 0009](0009-laya-como-capa-de-decision-rapida.md)
para que toda decisión viva en el mismo lugar.

## Reglas

- Un ADR no se reescribe cuando la decisión cambia: se marca como **Reemplazada** y se
  escribe uno nuevo que la reemplaza.
- El contexto es histórico: describe la presión del momento, no el estado actual del
  sistema.
- Las consecuencias incluyen las malas, no sólo las buenas.
