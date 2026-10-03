# Secret Scan History — FTTH-Copilot

> **Fecha del último scan:** 2026-08-20 (security audit)
> **Alcance:** revisión del historial git, archivos de configuración, workflows CI, y `.gitignore`.

---

## 1. Hallazgos del security audit

La auditoría de seguridad del 2026-08-20 identificó dos secretos en el historial:

### C1 — Cloudflare Tunnel Token expuesto ✅ FIXED

| | |
|---|---|
| **Archivo** | `ecosystem.config.cjs` (ya en `.gitignore`) |
| **Problema** | El token de Cloudflare Tunnel estaba hardcodeado en el archivo, commiteado a git, y empujado a GitHub. Cualquiera con acceso al repo podía registrar un connector en el túnel e interceptar tráfico. |
| **Fix aplicado** | Token movido a `.env` (`CLOUDFLARED_TOKEN`, chmod 600). `ecosystem.config.cjs` ahora lo carga en runtime. |
| **Estado** | ⚠️ **Pendiente de acción manual:** rotar el token en el dashboard de Cloudflare Zero Trust. El token viejo sigue válido y ya está público en el historial de git. |

> ⚠️ **Acción requerida del operador:**
> 1. Ir a [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/)
> 2. Ir a **Networks → Tunnels**
> 3. Seleccionar el túnel existente
> 4. Generar un nuevo token de túnel
> 5. Ponerlo en `CLOUDFLARED_TOKEN` en `.env.prod`
> 6. Eliminar el token viejo del dashboard

### C2 — Secrets fallback inseguros ✅ FIXED

| | |
|---|---|
| **Archivos** | `packages/db/src/auth.ts`, `packages/db/src/crypto.ts` |
| **Problema** | `JWT_SECRET` y `KMS_MASTER_KEY` tenían fallbacks hardcodeados a strings triviales (`dev-secret-key`). Si `.env` no se cargaba en producción, la app firmaba sesiones y cifraba claves API con valores públicamente conocidos. |
| **Fix aplicado** | `resolveSecret()`: lanza error al inicio si la variable no está configurada cuando `NODE_ENV=production`. Dev/test sin cambios. |
| **Estado** | ✅ Resuelto |

---

## 2. Estado actual del repositorio

### 2.1 Archivos sensibles en `.gitignore`

```gitignore
.env                  # variables de entorno
.env.local
.env.*.local
.env.production       # producción
.env.development
*.log
npm-debug.log*
```

### 2.2 Secrets en workflows CI

Los workflows de GitHub Actions usan **solo secrets de test** (no reales):

```yaml
# .github/workflows/ci.yml
JWT_SECRET: e2e-jwt-secret-for-playwright-only
KMS_MASTER_KEY: e2e-kms-master-key-for-playwright-only
```

Ninguna credencial de producción (API keys de LLM, tokens de NMS, contraseñas reales) está en los workflows.

### 2.3 Contribución SNMP — check de sanitización

El template de contribución SNMP (`docs/PULL_REQUEST_TEMPLATE/snmp_contribution.md`) exige:

```
[ ] No community strings, passwords, or SNMPv3 authentication keys are present.
[ ] No public or private IPv4/IPv6 addresses are exposed.
[ ] No customer PII, subscriber names, circuit IDs, or PPPoE credentials.
[ ] Serial numbers masked while keeping 4-character vendor prefix.
```

Script de sanitización disponible: `scripts/sanitize-snmp-capture.ts`.

---

## 3. Política de secretos

### 3.1 Reglas absolutas

| Regla | Detalle |
|---|---|
| **Nunca commitrear credenciales reales** | `.env`, `.env.*`, `*.key`, `*.pem`, `*.pfx` están en `.gitignore` |
| **Nunca hardcodear secrets en código** | Usar variables de entorno o `.env` |
| **Nunca usar valores triviales en producción** | `change-me`, `password`, `secret`, `test-key` no son aceptables |
| **Fail-closed en producción** | `resolveSecret()` lanza error si `JWT_SECRET` o `KMS_MASTER_KEY` no están configurados con `NODE_ENV=production` |
| **Tokens de Cloudflare** | Siempre en `.env`, nunca en archivos de configuración commiteados |

### 3.2 Cómo reportar una exposición de secreto

1. **No hacer commit** de la corrección ni del secreto.
2. Reportar inmediatamente a `security@tecnodespegue.com` o vía GitHub Security Advisories.
3. Rotar la credencial expuesta en el servicio correspondiente.
4. Esperar confirmación antes de cualquier acción pública.

---

## 4. Procedimientos de rotación de credenciales

### 4.1 Resumen rápido

| Credencial | Impacto de rotación | Procedimiento |
|---|---|---|
| `JWT_SECRET` | Invalida todas las sesiones | [Sección 6.2 de production-deployment.md](production-deployment.md#62-rotación-de-credenciales) |
| `KMS_MASTER_KEY` | Invalida todas las claves API cifradas | Recomendar reconectar los NMS después |
| `POSTGRES_PASSWORD` | corta la conexión | Recomendar hacer dump antes |
| `CLOUDFLARED_TOKEN` | corta el túnel | Regenerar en Cloudflare Dashboard |
| `LLM_API_KEY` (MiniMax/DeepSeek/Qwen) | corta el chat agent | Obtener nueva key del provider |

### 4.2 Comando de verificación post-rotación

```bash
# Health general
curl -s http://localhost:3001/api/health

# Health de base
docker compose exec postgres psql -U ftth -d ftth_copilot -c "SELECT 1;"

# Logs por errores de auth/crypto
docker compose logs app --since=5m | grep -E "ERROR|resolveSecret|Unauthorized|jwt"

# Verificar que las sesiones se crean correctamente (login)
curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ftth-copilot.local","password":"<password>"}' \
  -c /tmp/cookies.txt | jq .
```

---

## 5. Prevención

### 5.1 Git hooks (opcional — no implementado)

Para prevenir pushes accidentales de credenciales:

```bash
# Instalar con:
npm install -g pre-commit
pre-commit install
```

El hook ejecuta `git log -1 --name-only` antes de cada push y falla si detecta archivos sensibles.

### 5.2 GitHub Secret Scanning

GitHub tiene secret scanning activado en el repo. Si detecta un secreto conocido (AWS keys, GitHub tokens, etc.) en cualquier push, envía una alerta por email automáticamente. **No cubre:**
- Tokens de Cloudflare Tunnel (no es un provider natively scanned)
- API keys de NMS específicos (SmartOLT, Mikrowisp)
- Claves KMS/JWT custom

### 5.3 Renovación periódica recomendada

| Credencial | Frecuencia recomendada |
|---|---|
| `JWT_SECRET` | Cada 90 días |
| `KMS_MASTER_KEY` | Cada 180 días |
| `POSTGRES_PASSWORD` | Cada 90 días |
| `CLOUDFLARED_TOKEN` | Cada 90 días |
| `METRICS_BEARER_TOKEN` | Cada 180 días |
| API keys de LLM | Según política del provider |

---

## 6. Historial de hallazgos

| Fecha | Hallazgo | Severidad | Estado |
|---|---|---|---|
| 2026-08-20 | Cloudflare Tunnel token en `ecosystem.config.cjs` | Critical | ⚠️ Pendiente: rotar token |
| 2026-08-20 | Fallback inseguro de `JWT_SECRET`/`KMS_MASTER_KEY` | Critical | ✅ Resuelto |
| 2026-08-20 | No se encontraron otros secretos en el historial | — | ✅ Sin hallazgos adicionales |

---

## 7. Acciones pendientes del operador

- [ ] **Rotar el token de Cloudflare Tunnel** en el dashboard de Cloudflare Zero Trust
- [ ] Verificar que el nuevo token está en `CLOUDFLARED_TOKEN` en `.env.prod`
- [ ] Confirmar que el túnel se reconecta correctamente después del restart
- [ ] Considerar activar GitHub Secret Scanning (Settings → Security → Secret scanning → Enable)
