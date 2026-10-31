# AGENTS.md — `@ftth-copilot/alerts`

> Contexto para agentes que trabajan en este módulo. Las reglas generales del repo están en
> [AGENTS.md](../../AGENTS.md).

## Qué es

Capa L2. El ciclo de vida de las alertas: deduplicación, agrupamiento, cooldown, escalado y
despacho a Webhooks, Telegram, Slack (Block Kit), WhatsApp y Ntfy.

## Qué invariantes cuida

- **El cooldown evita el spam, no el aviso.** Una alerta nueva dentro del cooldown se deduplica;
  una escalada por severidad se entrega igual.
- **Los secretos de destino no se filtran.** El webhook, el token de Telegram y la URL de Ntfy
  se redactan antes de loguear (`redactSecrets`).
- **El despachador es idempotente por clave de deduplicación**: reintentar el mismo evento no
  manda dos mensajes.

## Cómo se prueba

```bash
pnpm --filter @ftth-copilot/alerts test
pnpm --filter @ftth-copilot/alerts test:integration   # requiere Postgres
```

## Qué no tocar

- `src/dedup.ts` y `src/group.ts`: son la razón por la que el NOC no recibe 500 mensajes por una
  sola caída.
- `src/notify.ts` sin revisar la redacción de secretos: los destinos son credenciales.

## Superficie pública

`src/index.ts` exporta el manager, el runner, la deduplicación, la correlación y los constructores
de payload por canal. El esqueleto completo lo imprime `mise run repo-map`.
