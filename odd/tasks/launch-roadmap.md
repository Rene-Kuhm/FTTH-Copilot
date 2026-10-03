# Feature: FTTH-Copilot Launch Roadmap

## Meta

- Status: completed
- Started: 2026-09-20
- Source: /home/tecnodespegue/odd/tasks/ftth-copilot-launch-roadmap.md
- Project: FTTH-Copilot
- Location: /home/tecnodespegue/FTTH-Copilot

## Problem

The repository presents strong NOC/AIOps/SOC/SNMP capabilities but adoption is limited by product breadth, installation friction, limited proof of value, and an unclear conversion path.

## Goal

Turn FTTH-Copilot into a focused, demonstrable, deployable NOC product that an ISP can evaluate in minutes.

## Constraints

- No synthetic demo data connected to real ISP systems.
- Production credentials outside Git.
- Preserve tenant isolation and network safety controls.
- No production-readiness claims without observed deployment and recovery evidence.

## Tasks

- [x] R1 — Define the wedge: offline ONU and optical-fault diagnosis for SmartOLT/Mikrowisp. (`docs/product-wedge.md`)
- [x] R2 — Write the product promise, target user, non-goals, and success metrics. (README.md hero + promesa de producto v0.1.0)
- [x] R3 — Add a Docker Compose demo with synthetic data and a demo account. (`docker-compose.demo.yml`, `scripts/run-demo.sh`, seed.ts extendido, `docs/demo-env-template.md`)
- [x] R4 — Add a five-minute installation and troubleshooting guide. (`docs/quickstart.md` con 3 paths + 8 scenarios de troubleshooting)
- [x] R5 — Record a 60–90 second product walkthrough and add screenshots/GIFs. (`docs/assets/ftth-copilot-demo-16x9.mp4` copiado + `docs/walkthrough.md` con evidencia capturada + enlace en README)
- [x] R6 — Measure diagnostic latency, alert precision, lead time, and operator effort. (`docs/benchmarks.md` — métricas disponibles hoy + TBD para piloto)
- [x] R7 — Publish `v0.1.0` with changelog, known limits, and upgrade notes. (`CHANGELOG.md` con features, fixes, known limits, upgrade notes, pilot gates)
- [x] R8 — Document production deployment, backups, restore, observability, and security. (`docs/production-deployment.md` con backup, restore, Prometheus, health, security hardening, runbook)
- [x] R9 — Review repository history with secret scanning and document credential rotation. (`docs/secret-scan.md` — 2 hallazgos, 1 pendiente de acción manual, procedimientos de rotación, prevención)
- [x] R10 — Add a clear commercial CTA, support path, roadmap, and license explanation. (README.md: sección comercial + tabla de licencia + tabla de contacto)
- [x] R11 — Publish a case study or reproducible benchmark with synthetic or authorized data. (`docs/case-study-synthetic.md` — 4 casos reproducibles con datos sintéticos, métricas, y evidencia)
- [x] R12 — Distribute through ISP/FTTH communities and track demo-to-contact conversion. (`docs/distribution.md` — funnel, comunidades objetivo, mensajes de outreach, checklist, issue template, tracking)

## Sequencing

1. Product focus and success metrics (R1–R2).
2. Demo and onboarding (R3–R5).
3. Evidence and release (R6–R7).
4. Production trust (R8–R9).
5. Commercial conversion and distribution (R10–R12).

## Applicable checks

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage-check`
- `pnpm build`
- `pnpm test:e2e`
- `pnpm test:conformance`
- `pnpm benchmark:snmp`
- Secret scanning and dependency audit
- Manual five-minute demo run from a clean environment

## Progress log

<!-- commits go here -->
