#!/usr/bin/env bash
# Runs the UI quality suites (axe, visual regression and the browser matrix)
# inside the official Playwright image, the same one .github/workflows/ui-quality.yml
# uses. The visual references depend on the system fonts, so they are generated
# there and never on a developer machine.
#
# Usage:
#   scripts/ui-quality-docker.sh check    # a11y + visual + compat (default)
#   scripts/ui-quality-docker.sh update   # regenerate the visual references
#
# Needs Docker. The tree is copied to a temporary directory and the container
# runs as the current user, so nothing in the repo ends up owned by root.
set -euo pipefail

MODE="${1:-check}"
IMAGE="${PLAYWRIGHT_IMAGE:-mcr.microsoft.com/playwright:v1.65.1-noble}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

case "$MODE" in
  check|update) ;;
  *) echo "usage: $0 [check|update]" >&2; exit 2 ;;
esac

rsync -a --exclude node_modules --exclude .next --exclude test-results \
  --exclude .git --exclude .turbo "$ROOT"/ "$WORK"/

docker run --rm --ipc=host -u "$(id -u):$(id -g)" \
  -e HOME=/tmp/home -e CI=1 -e UIQ_MODE="$MODE" \
  -e DATABASE_URL=postgresql://ftth:ftth@127.0.0.1:5432/ftth_copilot_e2e \
  -e JWT_SECRET=e2e-jwt-secret-for-playwright-only \
  -e KMS_MASTER_KEY=e2e-kms-master-key-for-playwright-only \
  -e ENABLE_TEST_AUTH_BYPASS=true \
  -v "$WORK":/work -w /work "$IMAGE" bash -c '
    set -euo pipefail
    mkdir -p /tmp/home /tmp/npm-global
    npm i -g --prefix /tmp/npm-global pnpm@11.22.0 >/dev/null
    export PATH=/tmp/npm-global/bin:$PATH
    pnpm install --frozen-lockfile
    pnpm --filter @ftth-copilot/web build:e2e
    pnpm --filter @ftth-copilot/web exec playwright install chromium firefox webkit
    if [ "$UIQ_MODE" = update ]; then
      pnpm --filter @ftth-copilot/web test:visual:update
    else
      pnpm --filter @ftth-copilot/web test:a11y
      pnpm --filter @ftth-copilot/web test:visual
      pnpm --filter @ftth-copilot/web test:e2e:compat
    fi
  '

if [ "$MODE" = update ]; then
  SNAP=apps/web/e2e/visual/screens.spec.ts-snapshots
  cp "$WORK/$SNAP"/*.png "$ROOT/$SNAP"/
  echo "References updated in $SNAP. Review the images before committing them."
fi
