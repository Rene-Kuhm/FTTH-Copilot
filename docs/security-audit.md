# Security Audit — FTTH-Copilot

**Date:** 2026-08-20
**Scope:** Auth/crypto libs, auth + chat + users + export API routes, deployment config.
**Method:** Manual code review of server-rendered Next.js app (App Router) + Prisma + JWT sessions.

## Hardening follow-up

The following repository-side items were subsequently addressed:

- Chat now requires an active database-backed session, the `chat` permission, and atomic PostgreSQL-backed per-user minute/day quotas shared by every app instance.
- `getCurrentUser()` and `/api/auth/me` verify that the hashed JWT still exists in `Session` and has not expired, so logout revokes the token server-side.
- Connector URLs enforce HTTPS/public-network policy, optional hostname and port allowlists, DNS validation, and request timeouts.
- API 500 responses no longer return raw provider or database error messages.
- The simulated `reboot_ont` action was removed until a real connector operation and server-side authorization protocol exist.

The Cloudflare credential rotation remains an external operational action. Repository code cannot verify that it was completed in the Cloudflare dashboard.

---

## Critical — FIXED

### C1. Live Cloudflare Tunnel token committed to git
- **File:** `ecosystem.config.cjs`
- **Issue:** The `cloudflared` tunnel token was hardcoded in the PM2 config, which is tracked in git and pushed to `github.com/Rene-Kuhm/FTTH-Copilot`. Anyone with the token can register their own connector to the tunnel and intercept/inject traffic for the exposed hostname.
- **Fix:** Token moved to git-ignored `.env` (`CLOUDFLARED_TOKEN`, chmod 600). `ecosystem.config.cjs` now loads it at config-eval time and passes it via the `TUNNEL_TOKEN` env var (equivalent to `--token`). Verified: tunnel re-registered successfully after restart.
- **REQUIRED FOLLOW-UP (cannot be done from the server):** Rotate the tunnel token in the Cloudflare Zero Trust dashboard. The old token remains valid and is already public in git history.

### C2. Insecure fallback secrets could silently run in production
- **Files:** `packages/db/src/auth.ts` (JWT_SECRET), `packages/db/src/crypto.ts` (KMS_MASTER_KEY)
- **Issue:** Both fell back to hardcoded dev strings when the env var was missing. Since the app runs with `NODE_ENV=production` under PM2, a missing/unloaded `.env` would have silently signed sessions and encrypted NMS API keys with publicly-known keys → trivial token forgery and ciphertext decryption.
- **Fix:** Added `resolveSecret()` guard: throws at startup if the variable is unset when `NODE_ENV=production`. Dev/test behavior unchanged.

### C3. IDOR on conversation export (cross-user read within tenant)
- **File:** `apps/web/app/api/conversations/[id]/export/route.ts`
- **Issue:** Conversations were scoped by `tenantId` only. Any OPERATOR/MEMBER could export any colleague's conversations by iterating IDs, despite the permission model granting them only `view_own_conversations`.
- **Fix:** Users without `view_all_conversations` (OWNER/ADMIN) are now additionally scoped by `userId`; others get a 404.

### C4. Missing privilege checks on connector create/delete
- **File:** `apps/web/lib/connectors/server.ts` (used by `/api/connectors/create`, `/api/connectors/[id]`)
- **Issue:** Any authenticated tenant user (incl. OPERATOR/MEMBER) could create or delete tenant-wide NMS connections — breaking chat for the whole tenant — because only authentication was checked, not `manage_connectors`.
- **Fix:** `createConnector()` / `deleteConnector()` now require the `manage_connectors` permission. Note: denial surfaces as 401/404 through existing route mappings rather than an explicit 403; acceptable for now, worth normalizing later.

---

## Verified — no issue found

| Check | Result |
|---|---|
| SQL injection | Safe. All queries go through Prisma parameterized APIs; the search filter uses `contains: q` as a bound value, not string interpolation. |
| JWT leakage in logs/responses | Safe. Tokens are only set as `HttpOnly` cookies; `logRequest()` logs method/path/status/duration only. |
| XSS in chat messages | Safe. No `dangerouslySetInnerHTML` anywhere in `apps/web`; React escapes rendered message content. |
| CORS | No permissive CORS headers are configured; browsers enforce same-origin for API reads. OK for current single-origin deployment. |
| Password storage | bcrypt cost 12. Session tokens stored as SHA-256 hashes. |
| Input validation | Zod schemas on all audited endpoints (email/password/name lengths, message ≤ 8000 chars, role enums). |
| Privilege escalation (users API) | Solid. `manage_users` required; only OWNER can create OWNERs or change/delete roles; self-role-change and self-delete blocked; target scoped to same tenant. |

---

## Documented — not fixed (nice-to-have / tradeoffs)

1. **Auth endpoint rate limiting:** chat is protected by a shared PostgreSQL quota, but `/api/auth/login` and `/api/auth/signup` still need an IP/account-based brute-force limiter at the edge.
2. **CSRF relies on `SameSite=Lax` only.** Lax blocks cross-site POST cookie attachment, which covers classic form CSRF for this JSON-only API, but there are no CSRF tokens. Acceptable for the current architecture; revisit if any GET becomes state-changing.
3. **User enumeration:** signup returns 409 for existing emails; login returns faster for unknown emails than wrong passwords (no bcrypt run). Standard tradeoff; mitigations add UX friction.
4. **Predictable tenant slugs:** signup suffix uses `Math.random()`. Slugs aren't secrets, but `crypto.randomBytes(4)` would be free to change.
5. **Global email uniqueness vs per-tenant check:** `/api/users` POST checks uniqueness within tenant only; the schema enforces it globally, so a colliding email yields an unhandled P2002 → 500 instead of 409.
6. **Secret rotation:** `KMS_MASTER_KEY` rotation isn't supported (single derived key, IV stored but unused for key rotation). Plan envelope encryption before storing real production NMS keys.

---

## Files changed

| File | Change |
|---|---|
| `ecosystem.config.cjs` | Token loaded from `.env` via `TUNNEL_TOKEN` |
| `.env` (server-local, git-ignored) | Added `CLOUDFLARED_TOKEN` |
| `packages/db/src/auth.ts` | Production fail-fast for `JWT_SECRET` |
| `packages/db/src/crypto.ts` | Production fail-fast for `KMS_MASTER_KEY` |
| `apps/web/app/api/conversations/[id]/export/route.ts` | Per-user scoping unless `view_all_conversations` |
| `apps/web/lib/connectors/server.ts` | `manage_connectors` permission gate |

Backups of every replaced file were left next to the original with a `.bak-audit` suffix.

---

# Security review — 2026-08-30 (NOC/SOC)

**Scope:** new NOC/SOC surface added after the first audit — detection, alerts, monitoring, security, soc, analytics, the syslog receiver, the new API routes (predictions/incidents/sla/security/access), connectors, crypto and auth.

## Findings and disposition

| ID | Severity | Hallazgo | Estado |
|----|----------|----------|--------|
| H1 | Alto | `login`/`signup` sin rate limiting (fuerza bruta / enumeración) | FIXED — buckets `AuthRateLimit` + `checkAuthQuota`/`recordAuthAttempt` (PR #44) |
| M2 | Medio | Receptor syslog sin tope de tamaño ni tasa (DoS por inundación UDP) | FIXED — `truncateSyslogMessage` + `createRateWindowCounter` (PR #44) |
| M3 | Medio | Retención de métricas global (un tenant purga datos de todos) | FIXED — `deleteSamplesBefore`/`runRetention`/`pollConnections` ahora por tenant |
| L4 | Bajo | DNS rebinding (check-then-connect sin pin de IP) en conectores NMS | Documented — riesgo residual aceptado; ver `security.ts` |
| L5 | Bajo | `x-forwarded-for` guardado tal cual (spoofeable) en `Session.ipAddress` | FIXED — se usa `extractClientIp` (primer hop) |
| L6 | Bajo | Columna `encryptionMeta` (IV) muerta: `decryptApiKey` la ignoraba | FIXED — columna eliminada + migración `drop_nms_connection_encryption_meta` |
| L7 | Bajo | Slug de tenant con `Math.random()` (predecible) | FIXED — `crypto.randomBytes` |
| L8 | Bajo | `console.error` logueaba el email (PII) en auth | FIXED — se quitó el email/tenantName del log |
| L9 | Bajo | `ALERT_WEBHOOK_URL` es config de confianza (SSRF solo si se hace per-tenant) | Documented — ver `notify.ts` |
| L10 | Bajo | `lastSeenAt`/`uptimeSeconds` hardcodeados en el path real de Mikrowisp | FIXED — se dejan `undefined` en vez de fabricar datos |
| L11 | Bajo | Fallback a fixtures demo en producción si `DEMO_MODE_ENABLED=true` | FIXED — fail-closed: sin fallback a demo en `NODE_ENV=production` |

## Verified — no issue found

| Check | Result |
|---|---|
| XSS | Safe. No `dangerouslySetInnerHTML`/`eval`/`innerHTML`; React escapa el contenido renderizado (incluye mensajes syslog). |
| SQL injection | Safe. Todas las consultas nuevas usan Prisma parametrizado; no hay `$queryRaw`/`$executeRaw`. |
| SSRF (NMS) | Safe. `assertSafeNmsRequestUrl` se ejecuta en cada request con `redirect: 'error'`, timeout y re-resolución DNS. |
| Crypto | Safe. AES-256-GCM, IV aleatorio, auth tag, fail-fast en producción sin secret. |
| IDOR en rutas nuevas | Safe. predictions/incidents/sla/security-access/alerts/connectors/conversations verifican auth + permiso + scope por `tenantId` (y `userId` donde corresponde). |
| Secrets en logs | Safe. `logRequest` solo registra method/path/status/duration; sin secretos ni tokens. |
