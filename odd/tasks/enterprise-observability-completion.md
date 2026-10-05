# Enterprise Observability Completion

Feature: close the 11 gaps between the FTTH-Copilot NOC/SOC dashboard prototype and
production enterprise capability.

Branch: `feat/victoriametrics-observability`
Baseline: commit `26d862f` (card redesign complete, typecheck + lint clean, demo stack healthy)

## Non-goals

- No Grafana, no external charting library (pure SVG, as established)
- No managed SaaS dependency; everything self-hosted in the compose stack
- No ML model training pipeline requiring labelled historical data that the demo does not have

## Work units

| # | Task | Effort | Status |
|---|------|--------|--------|
| 1 | Wire SSE `/api/ops/stream` into dashboard, drop 30s polling | Media | pending |
| 2 | Anomaly detection: Robust Binned Community Detection in `packages/analytics` | Alta | pending |
| 3 | ML correlation scoring for situations (anomaly-informed severity) | Alta | pending |
| 4 | Notification channels + dispatcher (Slack / webhook / email) | Media | pending |
| 5 | Threshold management: schema + CRUD API + dashboard panel | Alta | pending |
| 6 | Geographic map: device coordinates + SVG world/region map | Media | pending |
| 7 | PON capacity forecasting (bandwidth, not just memory/LLM) | Media | pending |
| 8 | Escalation policies: schema + engine + auto-runbook attachment | Alta | pending |
| 9 | VictoriaMetrics retention + backup strategy | Baja | pending |
| 10 | Load testing + performance benchmarks (k6) | Baja | pending |

## Commit evidence

(work-unit commits recorded as they land)

## Verification

- `pnpm --filter web typecheck` — 0 errors
- `pnpm --filter web lint` — 0 errors
- `pnpm --filter web build` — success
- demo stack healthy, `/dashboard/metrics` HTTP 200
