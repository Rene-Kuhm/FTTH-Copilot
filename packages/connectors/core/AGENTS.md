# AGENTS.md — `@ftth-copilot/connectors-core`

> Contexto para agentes que trabajan en este módulo. Las reglas generales del repo están en
> [AGENTS.md](../../AGENTS.md).

## Qué es

Capa L0. La interfaz común de NMS (`INmsConnector`) y **la política de seguridad SSRF**: allowlists
de host y puerto, bloqueo de rangos privados y de metadatos de nube.

## Qué invariantes cuida

- **Es el único lugar donde se aplica la política SSRF.** Ningún adaptador de NMS valida su propia
  URL: todos pasan por acá.
- **Fail-closed.** Una URL no permitida se rechaza; nunca se degrada a "permitido por defecto".
- **Las excepciones de red privada son opt-in explícito** (`NMS_ALLOW_PRIVATE_NETWORKS`,
  `NMS_ALLOW_HTTP`): sin esos flags, una IP privada se bloquea.
- **Los tipos canónicos de NMS viven acá.** Un conector no redefine `OltSummary` ni `OnuSummary`.

## Cómo se prueba

```bash
pnpm --filter @ftth-copilot/connectors-core test
```

`tests/security.test.ts` cubre la matriz de allowlist y de rangos privados: si agregás un caso, la
tabla de tests es la que lo prueba.

## Qué no tocar

- `src/security.ts` sin revisar el impacto en `packages/monitoring` (receptor SNMP) y en los tres
  adaptadores: un cambio acá cambia el comportamiento de todas las salidas a la red.
- Los tipos de `src/index.ts`: son el contrato que consumen `agent-core`, `analytics` y `monitoring`.

## Superficie pública

`src/index.ts` exporta `INmsConnector`, los tipos de red, `assertSafeNmsBaseUrl`,
`assertSafeNmsRequestUrl` y `isRateLimitError`. El esqueleto completo lo imprime `mise run repo-map`.
