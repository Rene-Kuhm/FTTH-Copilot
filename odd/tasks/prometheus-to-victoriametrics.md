# Feature: Prometheus → VictoriaMetrics Migration

## Meta

- Status: in_progress
- Started: 2026-10-04
- Project: FTTH-Copilot
- Location: /home/tecnodespegue/proyectos/FTTH-Copilot

## Objective

Replace the current Prometheus-based metrics pipeline with VictoriaMetrics as the
time-series store and dashboard layer, keeping the existing `/api/metrics` endpoint
for backward compatibility while enabling VictoriaMetrics as the primary TSDB.

## Problem

FTTH-Copilot currently relies on a Prometheus-compatible `/api/metrics` endpoint
and an internal Next.js dashboard. Prometheus works well for single-node
deployments but has operational overhead for backup, HA, and long-term retention.
VictoriaMetrics provides:
- **Drop-in Prometheus replacement** (same `promscrape` API)
- **10x better compression** and resource efficiency
- **Built-in Grafana-compatible UI** (no separate Grafana needed)
- **Single binary** with built-in alerting and recording rules
- **Native Grafana datasource** (direct integration)

## Why VictoriaMetrics over alternatives

| Criterio | Prometheus | Grafana+Loki | VictoriaMetrics |
|---|---|---|---|
| Storage local | ✅ | ✅ | ✅ |
| Long-term retention | Lento en queries | Complejo (3 stores) | ✅ nativo |
| Alta cardinalidad | ⚠️ | ⚠️ | ✅ |
| Backup integrado | ❌ | ❌ | ✅ (`vmbackup`) |
| UI dashboards | Limitado | Necesita Grafana separado | ✅ Built-in |
| Operational overhead | Bajo | Alto | **Bajo** |
| Kubernetes-native | ✅ | ✅ | ✅ |
| Compatible con Prometheus API | — | Parcial | ✅ 100% |

VictoriaMetrics was chosen because:
1. FTTH-Copilot already exposes Prometheus-format metrics.
2. Single binary replaces Prometheus + Grafana + Long-term storage.
3. Native Grafana datasource means zero UI rework.
4. Free and open-source (AGPL, with commercial support available).

## Scope

### In scope

- Add `victoriametrics` service to `docker-compose.yml` (dev) and `docker-compose.prod.yml`.
- Configure Prometheus-compatible scrape endpoint: `http://app:3001/api/metrics`.
- Replace `prometheus.yml` example with `vmagent.yml` configuration.
- Add `VICTORIAMETRICS_*` variables to `.env.example`.
- Update `docs/production-deployment.md` with VictoriaMetrics section.
- Keep `/api/metrics` endpoint unchanged (Prometheus-compatible output).
- Add `.env` variable to optionally disable internal metrics and rely solely on VM.
- Run functional verification against the demo environment.

### Out of scope

- Migrating historical Prometheus data (no existing Prometheus install).
- Replacing the internal Next.js NOC/SOC dashboard (remains separate, uses API).
- Modifying the Laya Decision Layer metrics or Prometheus format.
- Adding recording rules or alerting rules (future work).
- Replacing PostgreSQL (remains the primary data store).
- Upgrading Phoenix LLM Tracing (OTLP pipeline is separate).

## Constraints

- No data loss: the `/api/metrics` endpoint stays functional during migration.
- Zero-downtime transition: VM scrapes the same endpoint in parallel initially.
- Preserve `METRICS_BEARER_TOKEN` protection (VM supports bearer auth in scrape).
- Keep `docker-compose.prod.yml` compatible with single-node production.
- Do not increase the baseline resource footprint significantly.
- No breaking changes to existing Prometheus scrapers if any exist.

## Architecture

```
Before (current):
  app (:3001) ──▶ /api/metrics ──▶ prometheus (external)

After (target):
  app (:3001) ──▶ /api/metrics ──┬──▶ VictoriaMetrics (:8428)
                                  └──▶ (optional) existing prometheus scraper

  Operator ───▶ http://localhost:3001/dashboard/vm  (VM built-in UI)
             ▶ http://localhost:3001/api/v1/query (Prometheus-compatible API)
```

## Acceptance Criteria

- [ ] `docker-compose.yml` includes `victoriametrics` service with correct scrape config.
- [ ] `docker-compose.prod.yml` includes `victoriametrics` service.
- [ ] VM UI accessible at port 8428 with auth (if bearer configured).
- [ ] VM scrapes `/api/metrics` successfully (visible in VM → Metrics explore).
- [ ] Grafana can add VM as datasource using Prometheus-compatible URL.
- [ ] `METRICS_BEARER_TOKEN` propagates to VM scrape config.
- [ ] `.env.example` documents `VICTORIAMETRICS_*` variables.
- [ ] `docs/production-deployment.md` updated with VM section.
- [ ] Existing Prometheus scrape config example deprecated (or updated to vmagent).
- [ ] Functional verification: metrics visible in VM after demo startup.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass (no breaking changes).

## Task Breakdown

- [ ] VM-1: Add VictoriaMetrics to docker-compose.yml with scrape config.
- [ ] VM-2: Add VictoriaMetrics to docker-compose.prod.yml with persistence.
- [ ] VM-3: Update .env.example with VICTORIAMETRICS_* variables.
- [ ] VM-4: Update docs/production-deployment.md (replace Prometheus section).
- [ ] VM-5: Deprecate/update prometheus.yml example → vmagent.yml.
- [ ] VM-6: Functional verification in demo environment.
- [ ] VM-7: Final checks, commit, PR.

## Progress Log

<!-- commits go here -->
