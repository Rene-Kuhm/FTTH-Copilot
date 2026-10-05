#!/bin/sh
# VictoriaMetrics single-node entrypoint wrapper.
#
# Why this exists: the single-node binary loads `-promscrape.config` as a
# Prometheus YAML file and does NOT expand environment variables inside it.
# The image has no `envsubst`, so we render the two variable fields with
# `awk` before exec'ing the server.
#
# Rendered fields:
#   __SCRAPE_TARGET__        -> VICTORIAMETRICS_SCRAPE_TARGET (default app:3001)
#   __METRICS_BEARER_TOKEN__  -> METRICS_BEARER_TOKEN (optional; blank omits auth)
#   __DEPLOY_ENV__           -> DEPLOY_ENV (default development)
set -eu

TEMPLATE="${VM_SCRAPE_TEMPLATE:-/etc/victoriametrics/scrape.yml.tmpl}"
RENDERED="${VM_SCRAPE_RENDERED:-/tmp/victoriametrics-scrape.yml}"

TARGET="${VICTORIAMETRICS_SCRAPE_TARGET:-app:3001}"
TOKEN="${METRICS_BEARER_TOKEN:-}"
DEPLOY_ENV="${DEPLOY_ENV:-development}"

awk -v target="$TARGET" -v token="$TOKEN" -v denv="$DEPLOY_ENV" '
  {
    gsub(/__SCRAPE_TARGET__/, target)
    gsub(/__METRICS_BEARER_TOKEN__/, token)
    gsub(/__DEPLOY_ENV__/, denv)
    print
  }
' "$TEMPLATE" > "$RENDERED"

# NOTE: single-node VictoriaMetrics does NOT evaluate recording or alerting
# rules — it only exposes -streamAggr.config (downsampling) and can proxy rule
# APIs to an external vmalert. Rules live in docker/victoriametrics-alerts.yml
# and are executed by the separate `vmalert` service. See docker-compose.demo.yml
# (profile: alerts) or docker-compose.prod.yml.

# -dryRun makes a config error fail fast and loudly instead of a crash loop.
if [ "${VM_CONFIG_DRYRUN:-0}" = "1" ]; then
  exec /victoria-metrics-prod -promscrape.config="$RENDERED" \
    -promscrape.config.dryRun
fi

exec /victoria-metrics-prod \
  -storageDataPath="${VM_STORAGE_DATA_PATH:-/storage}" \
  -retentionPeriod="${VM_RETENTION_PERIOD:-1}" \
  -httpListenAddr="${VM_HTTP_LISTEN_ADDR:-:8428}" \
  -loggerLevel="${VM_LOG_LEVEL:-INFO}" \
  -promscrape.config="$RENDERED" \
  "$@"
