# AGENTS.md — `@ftth-copilot/detection`

> Contexto para agentes que trabajan en este módulo. Las reglas generales del repo están en
> [AGENTS.md](../../AGENTS.md).

## Qué es

Capa L0. Algoritmos estadísticos **puros** para deriva óptica y térmica: línea de base con mediana
y MAD, tendencia, crossings, flapping, degradación FEC, drifting óptico y de temperatura.

## Qué invariantes cuida

- **Funciones puras.** Sin I/O, sin base de datos y **sin `Date.now()` implícito**: el tiempo entra
  como parámetro (`now`, `horizonDays`). Es lo que los hace testeables y auditables.
- **Determinismo.** Misma entrada y mismo reloj ⇒ misma salida. Sin aleatoriedad sin semilla.
- **Devuelven `null` cuando no hay hallazgo**, no un "sin anomalía" positivo: el llamador decide.

## Cómo se prueba

```bash
pnpm --filter @ftth-copilot/detection test
```

Los tests fijan el reloj explícitamente. Un cambio que introduce `Date.now()` tiene que romperlos.

## Qué no tocar

- La fórmula de anomalía (mediana + MAD) y sus umbrales: `packages/eval` y los tableros NOC asumen
  la semántica actual.
- `src/types.ts`: los tipos de hallazgo son parte del contrato con `evidence` y `alerts`.

## Superficie pública

`src/index.ts` exporta los detectores (`detectBaselineAnomaly`, `detectFecDegradation`,
`detectFlapping`, `detectLosEvents`, `detectOpticalDrift`, `detectTemperatureDrift`) y los tipos de
muestra. El esqueleto completo lo imprime `mise run repo-map`.
