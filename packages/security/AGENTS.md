# AGENTS.md — `@ftth-copilot/security`

> Contexto para agentes que trabajan en este módulo. Las reglas generales del repo están en
> [AGENTS.md](../../AGENTS.md).

## Qué es

Capa L0. El perímetro SOC: analizador de paquetes syslog (RFC 3164/5424), clasificadores de
ataques, auditoría de firmware contra CVEs conocidas y el guard de tráfico de red.

## Qué invariantes cuida

- **Funciones puras.** El parser de syslog no abre sockets ni consulta la base: recibe bytes y
  devuelve eventos.
- **RFC 3164 y RFC 5424 primero.** El parser tiene que aceptar ambos formatos y el que usa el
  fixture del receptor UDP.
- **La fuente es evidencia, no veredicto.** Devuelve señales; la correlación y la severidad las
  decide `packages/soc` y `packages/alerts`.

## Cómo se prueba

```bash
pnpm --filter @ftth-copilot/security test
```

## Qué no tocar

- `src/syslog.ts` y `src/syslog-build.ts` sin actualizar el golden del receptor: el formato del
  paquete es el contrato con `apps/web` y con el proceso que escucha en el puerto UDP.
- Los umbrales de los clasificadores: los cubre el corpus adversarial de `packages/eval`.

## Superficie pública

`src/index.ts` exporta el parser y los clasificadores (`parseSyslogMessage`, `runSecurityDetection`,
`buildSecurityPayload`, `runFirmwareAudit`, `checkSourceIp`, …). El esqueleto completo lo imprime
`mise run repo-map`.
