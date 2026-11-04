#!/bin/bash
# Arranque del worker de fondo para los despliegues sin Docker (PM2).
#
# El worker corre desde la raíz del repo: los packages del workspace se
# resuelven desde ahí, y `pnpm --filter` necesita el workspace entero. La
# ruta se arma sola a partir de la de este script, así que el único camino
# que hay que editar en el `ecosystem.config.cjs` es el de este fichero.
set -euo pipefail

cd "$(dirname "$0")/../.."

# `pnpm` es lo que arranca el worker (`node --import tsx src/index.ts`).
# Si no está en el PATH, el proceso muere con un mensaje inútil en vez de
# con uno que diga qué falta: PM2 sólo reenvía su propio entorno, y el
# shell que lo lanzó puede no tener el PATH del login.
if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm no está en el PATH: el worker se arranca con pnpm (pnpm install && pnpm --filter @ftth-copilot/worker start)" >&2
  exit 1
fi

exec pnpm --filter @ftth-copilot/worker start
