#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# FTTH-Copilot — Demo launcher
# ─────────────────────────────────────────────────────────────────────────────
# Usage:
#   ./scripts/run-demo.sh          # starts demo from scratch
#   ./scripts/run-demo.sh down     # stops demo
#   ./scripts/run-demo.sh reset    # stops and removes all data
#
# Prerequisites:
#   - Docker and Docker Compose installed
#   - Port 5432 (postgres) and 3001 (app) free
#
# What it does:
#   1. Creates .env from the demo template if missing
#   2. Builds the Docker image
#   3. Starts postgres, runs migrations, seeds demo data, starts app
#   4. Prints demo credentials
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.demo.yml"
ENV_FILE="$ROOT_DIR/.env"

# ── Actions ──────────────────────────────────────────────────────────────────

case "${1:-start}" in
  start)
    echo "🚀 Starting FTTH-Copilot demo..."

    # Create .env from template if missing
    if [[ ! -f "$ENV_FILE" ]]; then
      echo "📄 Creating .env from template..."
      # Extract the bash block from docs/demo-env-template.md
      awk '
        /^```bash$/ { in_block=1; next }
        in_block && /^```$/ { exit }
        in_block { print }
      ' "$ROOT_DIR/docs/demo-env-template.md" > "$ENV_FILE"
      echo "✓ .env created at $ENV_FILE"
      echo "  Edit it to change the demo admin password (SEED_ADMIN_PASSWORD)"
    else
      echo "✓ Using existing .env"
    fi

    # Build and start
    echo "🔨 Building Docker image..."
    docker compose -f "$COMPOSE_FILE" build

    echo "📦 Starting services..."
    docker compose -f "$COMPOSE_FILE" up --remove-orphans

    ;;

  down)
    echo "🛑 Stopping demo..."
    docker compose -f "$COMPOSE_FILE" down
    echo "✓ Demo stopped"
    ;;

  reset)
    echo "⚠️  Resetting demo (removes all data)..."
    docker compose -f "$COMPOSE_FILE" down -v
    rm -f "$ENV_FILE"
    echo "✓ Demo data removed. Run without args to restart."
    ;;

  logs)
    docker compose -f "$COMPOSE_FILE" logs -f
    ;;

  *)
    echo "Usage: $0 {start|down|reset|logs}"
    exit 1
    ;;
esac
