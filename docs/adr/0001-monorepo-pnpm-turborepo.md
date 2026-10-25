# ADR 0001 — Monorepo pnpm + Turborepo con paquetes por responsabilidad

**Estado:** Aceptada
**Fecha:** 2026-08-20 (inicialización del repo)

## Contexto

FTTH-Copilot tiene tres planos de producto —Copiloto conversacional, NOC proactivo y SOC de
seguridad— que comparten autenticación, tenants, conexiones NMS y el mismo modelo de datos.
Por separado, tiene tres proveedores de NMS (SmartOLT, Mikrowisp, MikroTik), un motor SNMP
multi-fabricante, un runtime de agente con herramientas, un harness de evaluación y una
aplicación web con decenas de rutas API.

El riesgo evidente de esa forma es el **copypaste**: el cálculo de uptime, el parseo de
syslog o el contrato de una tool de topología aparecen hoy en tres o cuatro lugares, y
cada copia se desincroniza.

El otro extremo también era un riesgo: un polyrepo con 16 repositorios exige versionar
paquetes entre repos, y una tool nueva del agente cruzaría cuatro fronteras de
despliegue para llegar al mismo PR.

## Decisión

Adoptar un **monorepo pnpm** con **Turborepo** como orquestador de tareas, y organizar el
workspace en **paquetes por responsabilidad de negocio**, no por capa técnica.

- El workspace incluye `apps/*`, `packages/*` y `packages/connectors/*`
  (`pnpm-workspace.yaml:1-4`).
- Cada paquete es privado y publica un único entry point `src/index.ts`
  (por ejemplo `packages/detection/package.json`).
- Las dependencias entre paquetes se declaran con el protocolo `workspace:*`, de modo que un
  cambio en un paquete obliga a reevaluar a sus dependientes.
- Las tareas (`dev`, `build`, `lint`, `typecheck`, `test`, `test:coverage`) se definen una
  vez en `turbo.json` y se ejecutan en todos los paquetes.
- `services/laya` queda **fuera** del workspace: es un servicio Python con su propio
  `Dockerfile`, no un paquete.

La regla de agrupación que sigue al nombre del paquete es: **un paquete por responsabilidad
observable**, y el nombre dice qué hace, no en qué capa vive.

## Consecuencias

### Buenas

- Un cambio en el contrato de una tool o en una función de detección se hace **una vez** y
  llega a todos los que la usan.
- Los tests, el lint y el typecheck se ejecutan con un solo comando sobre todo el repo, y
  el CI no necesita una matriz de repositorios.
- `workspace:*` hace imposible publicar accidentalmente un paquete interno en un registry
  público: todos son `private: true`.
- Turborepo cachea por hash de dependencias: el CI no recompila lo que no cambió.
- El límite entre paquete y paquete es una frontera de API explícita, lo que documenta la
  arquitectura sin necesidad de un documento aparte.

### Malas

- **El grafo de paquetes es ahora una dependencia que hay que mantener.** La regla "una
  dependencia por dirección" es una disciplina, no una herramienta: un `import` cruzando
  una frontera se cuela sin que nada lo frene.
- El bundle de CI crece con el número de paquetes: un cambio en un paquete que nadie usa
  igual dispara el pipeline completo, porque el filtro de Turborepo trabaja a nivel de
  tarea, no de impacto real.
- Los tiempos de `pnpm install` en un workspace con 16 paquetes son sensiblemente mayores
  que los de un repo único, sobre todo en CI frío.
- `services/laya` queda fuera del workspace, así que su Dockerfile y sus requirements no
  tienen la misma trazabilidad de versiones que el resto.

### Abiertas

- El único ciclo del grafo (`shared` ⇄ `evidence`) se resuelve hoy con un `import type` y
  un peer dependency opcional (`packages/shared/package.json:31`). Si alguna vez hace
  falta un ciclo de runtime, esa convención deja de alcanzar y hay que mover el contrato.
- `packages/eval` declara `agent-core` y `db` como dependencias pero no los importa desde
  `src/`: `runAgent` se le inyecta como función. La dependencia declarada es más ancha que
  la real.
