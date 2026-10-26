# AGENTS.md — `@ftth-copilot/monitoring`

> Contexto para agentes que trabajan en este módulo. Las reglas generales del repo están en
> [AGENTS.md](../../AGENTS.md).

## Qué es

Capa L3. El receptor binario SNMP, los adaptadores OLT multi-fabricante, la decodificación
multi-vendor, el catálogo de OIDs y el laboratorio de conformidad.

## Qué invariantes cuida

- **El receptor es un proceso, no una ruta HTTP.** Escucha en UDP (162/1162); el tráfico de
  gestión va por SSH/VPN del operador.
- **La decodificación conserva la evidencia cruda.** El trap original viaja en el envelope aunque
  el adaptador lo interprete.
- **El sender registry es una allowlist.** Un origen no registrado se rechaza y se registra.
- **Los golden snapshots del laboratorio son intocables**: `tests/conformance/golden/` es la
  referencia contra la que se mide cada adaptador nuevo.

## Cómo se prueba

```bash
pnpm --filter @ftth-copilot/monitoring test
pnpm --filter @ftth-copilot/monitoring test:conformance
```

El laboratorio de conformidad compara contra los golden y falla si un adaptador nuevo no está
registrado en la matriz.

## Qué no tocar

- `tests/conformance/golden/` sin una decisión explícita (ver [`ARCHITECTURE.md`](../../ARCHITECTURE.md) §9).
- `src/snmp/` sin actualizar la matriz de compatibilidad: se deriva de las fuentes MIB auditadas.

## Superficie pública

`src/index.ts` exporta los adaptadores OLT, el receptor SNMP, el catálogo de OIDs y los helpers de
correlación. El esqueleto completo lo imprime `mise run repo-map`.
