# AGENTS.md — `@ftth-copilot/soc`

> Contexto para agentes que trabajan en este módulo. Las reglas generales del repo están en
> [AGENTS.md](../../AGENTS.md).

## Qué es

Capa L3. El perímetro SOC: orquestación de la ingesta perimetral, correlación de accesos anómalos,
auditoría de firmware con trazabilidad por tenant, autenticación LDAP/AD y notificación.

## Qué invariantes cuida

- **La auditoría es append-only y con tenant.** `auditConnector`, `auditAuth` y `auditIncident`
  registran quién hizo qué, sobre qué recurso, de qué tenant y con qué resultado.
- **El mapeo de roles de LDAP es explícito** (`LDAP_ROLE_MAP`): un grupo sin mapear no es admin.
- **La deduplicación de notificaciones es por huella**, no por texto: el mismo evento con
  timestamps distintos no genera dos avisos.
- **Los secretos se redactan antes de notificar** (`redactSecrets`).

## Cómo se prueba

```bash
pnpm --filter @ftth-copilot/soc test
```

## Qué no tocar

- `src/audit.ts`: la traza de auditoría es evidencia de seguridad; no se le agregan campos sin
  decisión.
- `src/auth-ldap.ts`: los cambios de mapeo de roles affectan el control de acceso de `apps/web`.
- `src/notify.ts` sin revisar la redacción de secretos.

## Superficie pública

`src/index.ts` exporta la ingesta SOC, la auditoría, la autenticación LDAP y los constructores de
notificación. El esqueleto completo lo imprime `mise run repo-map`.
