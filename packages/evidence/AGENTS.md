# AGENTS.md — `@ftth-copilot/evidence`

> Contexto para agentes que trabajan en este módulo. Las reglas generales del repo están en
> [AGENTS.md](../../AGENTS.md).

## Qué es

Capa L1. La capa de evidencia: normalización de señales crudas, el sobre de investigación con
procedencia y frescura, el **TruthGate** y la política de abstención.

## Qué invariantes cuida

- **La evidencia conserva su procedencia.** Fuente, marca de tiempo y calidad viajan con la señal;
  un hallazgo sin procedencia no es evidencia.
- **Abstenerse sin evidencia es un resultado correcto.** El TruthGate devuelve `incomplete` y la
  abstención; nunca "rellena" el hueco con una hipótesis.
- **La abstención no reescribe la respuesta.** En modo `warn` el texto del LLM se entrega
  byte a byte: el canal de advertencia es observabilidad, no edición.
- **Todo es tenant-aware.** `tenantId` es parte de los envelopes y de las claves de correlación.

## Cómo se prueba

```bash
pnpm --filter @ftth-copilot/evidence test
```

`tests/` cubre el gate, la política de abstención y la correlación topológica.

## Qué no tocar

- Los modos del TruthGate (`allow` / `warn` / `abstain`) sin una decisión de diseño: el gate
  adversarial de `packages/eval` mide exactamente ese comportamiento.
- Los `schema: "evidence.provenance.v1"` y `ftth.abstention.v1`: son contratos de wire.

## Superficie pública

`src/index.ts` exporta el TruthGate, la política de abstención, el recolector de evidencia y la
correlación topológica. El esqueleto completo lo imprime `mise run repo-map`.
