#!/bin/sh
# VictoriaMetrics single-node entrypoint wrapper.
#
# Why this exists: the single-node binary loads `-promscrape.config` as a
# Prometheus YAML file and does NOT expand environment variables inside it.
# The image has no `envsubst`, so we render the variable fields with `awk`
# before exec'ing the server.
#
# Rendered fields:
#   __SCRAPE_TARGET__        -> VICTORIAMETRICS_SCRAPE_TARGET (default app:3001)
#   __WORKER_SCRAPE_TARGET__ -> VICTORIAMETRICS_WORKER_SCRAPE_TARGET (optional)
#   __METRICS_BEARER_TOKEN__  -> METRICS_BEARER_TOKEN (optional; blank omits auth)
#   __DEPLOY_ENV__           -> DEPLOY_ENV (default development)
set -eu

TEMPLATE="${VM_SCRAPE_TEMPLATE:-/etc/victoriametrics/scrape.yml.tmpl}"
RENDERED="${VM_SCRAPE_RENDERED:-/tmp/victoriametrics-scrape.yml}"
WORKER_TEMPLATE="${VM_WORKER_SCRAPE_TEMPLATE:-/etc/victoriametrics/scrape-worker.yml.tmpl}"
WORKER_RENDERED="${VM_WORKER_SCRAPE_RENDERED:-/tmp/victoriametrics-scrape-worker.yml}"
BINARY="${VM_BINARY:-/victoria-metrics-prod}"

TARGET="${VICTORIAMETRICS_SCRAPE_TARGET:-app:3001}"
WORKER_TARGET="${VICTORIAMETRICS_WORKER_SCRAPE_TARGET:-}"
TOKEN="${METRICS_BEARER_TOKEN:-}"
DEPLOY_ENV="${DEPLOY_ENV:-development}"

# Renders one template. The first argument is the value that replaces
# __SCRAPE_TARGET__ and __WORKER_SCRAPE_TARGET__; the second is the template
# and the third is the file to write.
#
# The comments of the template are copied verbatim: they name the
# placeholders, and substituting them there would leave the rendered file
# saying something different from what it documents.
render() {
  awk -v target="$1" -v token="$TOKEN" -v denv="$DEPLOY_ENV" '
    /^[ \t]*#/ { print; next }
    {
      gsub(/__SCRAPE_TARGET__/, target)
      gsub(/__WORKER_SCRAPE_TARGET__/, target)
      gsub(/__METRICS_BEARER_TOKEN__/, token)
      gsub(/__DEPLOY_ENV__/, denv)
      print
    }
  ' "$2" > "$3"
}

render "$TARGET" "$TEMPLATE" "$RENDERED"

# The scrape configs go first and the arguments the caller passed stay at the
# end. `set --` prepends without losing them.
set -- -promscrape.config="$RENDERED" "$@"

# The worker scrape config is a SECOND file, and it is only passed to
# VictoriaMetrics when the worker is deployed and reachable. A deployment
# without a worker must not show a target that is permanently down.
if [ -n "$WORKER_TARGET" ]; then
  render "$WORKER_TARGET" "$WORKER_TEMPLATE" "$WORKER_RENDERED"
  set -- -promscrape.config="$WORKER_RENDERED" "$@"
fi

# NOTE: single-node VictoriaMetrics does NOT evaluate recording or alerting
# rules — it only exposes -streamAggr.config (downsampling) and can proxy rule
# APIs to an external vmalert. Rules live in docker/victoriametrics-alerts.yml
# and are executed by the separate `vmalert` service. See docker-compose.demo.yml
# (profile: alerts) or docker-compose.prod.yml.

# -dryRun makes a config error fail fast and loudly instead of a crash loop.
if [ "${VM_CONFIG_DRYRUN:-0}" = "1" ]; then
  exec "$BINARY" "$@" -promscrape.config.dryRun
fi

exec "$BINARY" \
  -storageDataPath="${VM_STORAGE_DATA_PATH:-/storage}" \
  -retentionPeriod="${VM_RETENTION_PERIOD:-1}" \
  -httpListenAddr="${VM_HTTP_LISTEN_ADDR:-:8428}" \
  -loggerLevel="${VM_LOG_LEVEL:-INFO}" \
  "$@"
