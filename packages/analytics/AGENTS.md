# AGENTS.md — `@ftth-copilot/analytics`

> Contexto para agentes que trabajan en este módulo. Las reglas generales del repo están en
> [AGENTS.md](../../AGENTS.md).

## Qué es

Capa L2. Ingesta, agregación y persistencia de series temporales de fibra: potencia, temperatura y
FEC. Incluye el score de correlación, el cálculo de SLA y la retención.

## Qué invariantes cuida

- **Las series son por tenant.** `tenantId` acompaña cada punto y cada consulta.
- **La agregación no inventa resolución.** El bucketing es explícito y no se re-muestrea en
  memoria.
- **La retención es una política, no un borrado oportunista.** Los datos que se borran son los que
  superaron el plazo configurado.

## Cómo se prueba

```bash
pnpm --filter @ftth-copilot/analytics test
```

## Qué no tocar

- `src/ingest.ts` y `src/collect.ts`: son la frontera con la base y con el polling del NOC. Un
  cambio acá mueve datos reales.
- El cálculo de SLA (`src/sla.ts`): el dashboard NOC assume la semántica actual.

## Superficie pública

`src/index.ts` exporta la ingesta, el score de correlación, el SLA, la anomalía y la retención.
El esqueleto completo lo imprime `mise run repo-map`.
