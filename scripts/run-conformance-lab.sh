#!/usr/bin/env bash
set -euo pipefail

# Script to run the Hardwareless Conformance Lab
# Automatically adapts to containerized runner (if docker/podman available) or native runner

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

USE_CONTAINER=false
ENGINE=""

if command -v docker >/dev/null 2>&1; then
  USE_CONTAINER=true
  ENGINE="docker"
elif command -v podman >/dev/null 2>&1; then
  USE_CONTAINER=true
  ENGINE="podman"
fi

echo "============================================================"
echo " FTTH-Copilot: Hardwareless SNMP Conformance Lab (Fase 7)"
echo "============================================================"

if [ "${1:-}" = "--native" ] || [ "$USE_CONTAINER" = false ]; then
  echo "Running Conformance Lab in native Node.js / Vitest environment..."
  cd "$ROOT_DIR"
  pnpm --filter @ftth-copilot/monitoring run test tests/conformance
  echo "Running SNMP Performance Benchmark..."
  npx tsx scripts/snmp-benchmark.ts
  echo "✅ Conformance Lab completed successfully."
else
  echo "Found container engine: $ENGINE"
  echo "Building isolated Net-SNMP lab container..."
  $ENGINE build -t ftth-copilot/snmp-lab:latest -f "$ROOT_DIR/docker/snmp-lab/Dockerfile" "$ROOT_DIR/docker/snmp-lab"
  echo "Container built successfully. Running native + containerized conformance checks..."
  cd "$ROOT_DIR"
  pnpm --filter @ftth-copilot/monitoring run test tests/conformance
  npx tsx scripts/snmp-benchmark.ts
  echo "✅ Conformance Lab completed successfully."
fi
