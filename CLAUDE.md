@AGENTS.md

# CLAUDE.md — FTTH-Copilot

Este archivo es un **remite**: la guía real del repositorio vive en [`AGENTS.md`](AGENTS.md).

| Buscás | Está en |
|---|---|
| Preparación del entorno, build, test, lint, base de datos, SNMP y conformance | [`AGENTS.md` §3 — Comandos](AGENTS.md#3-comandos) |
| Convenciones de código, cambios y documentación | [`AGENTS.md` §4 — Convenciones](AGENTS.md#4-convenciones) |
| Arquitectura resumida y capas del monorepo | [`AGENTS.md` §5 — Arquitectura resumida](AGENTS.md#5-arquitectura-resumida) |
| Superficies que no se tocan sin una decisión explícita | [`AGENTS.md` §6 — Superficies protegidas](AGENTS.md#6-superficies-protegidas) |
| Checklist de entrega | [`AGENTS.md` §7 — Checklist de entrega](AGENTS.md#7-checklist-de-entrega) |
| Mapa completo de módulos, límites y flujo de datos | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| Proceso de contribución, commits y revisiones | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Reporte de vulnerabilidades | [`SECURITY.md`](SECURITY.md) |

Regla específica del subárbol que estés tocando:

- [`apps/web/AGENTS.md`](apps/web/AGENTS.md) — reglas gestionadas de Next.js, para cambios dentro de `apps/web`.

Si una regla de `AGENTS.md` entra en conflicto con una del subárbol, gana la del subárbol, porque es la más específica.
