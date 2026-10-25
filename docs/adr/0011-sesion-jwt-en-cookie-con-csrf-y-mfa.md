# ADR 0011 — Sesión JWT en cookie HttpOnly con CSRF double-submit y MFA TOTP

**Estado:** Aceptada
**Fecha:** 2026-08-20 en adelante (migraciones `20260820054804_init`,
`20260830100000_add_auth_rate_limits`, `20260830140000_add_role_admin_operator`)

## Contexto

El producto maneja credenciales de API de NMS y datos de red de clientes. El acceso lo
hacen técnicos de campo, con teléfonos y notebooks, a veces desde redes de hotel y desde
el navegador del cliente. El modelo de roles tiene cuatro niveles: `OWNER`, `ADMIN`,
`OPERATOR`, `MEMBER`.

Dos hechos presionaron el diseño:

1. El producto se **embarca como PWA, APK y binario de escritorio**. Un token en
   `localStorage` es accesible desde cualquier XSS y no sirve para un cliente nativo que
   habla con la API por HTTPS.
2. El producto se instala en **redes de ISP**, con acceso a la red del cliente y a
   credenciales de NMS. Un login sin límite de intentos es un diccionario de contraseñas
   contra una base que además da acceso a la red del cliente.

El riesgo de CSRF es el espejo: si la sesión viaja en una cookie, cualquier sitio puede
disparar acciones con la sesión del operador.

## Decisión

### Sesión

- Token **JWT HS256** con TTL de 7 días (`packages/db/src/auth.ts:21-22`, `issueToken` en
  `:65`).
- La base guarda **el hash SHA-256 del token**, no el token
  (`Session.tokenHash`, `schema.prisma:237`, `hashToken` en `auth.ts:92`). Un dump de la
  base no sirve para hacerse pasar por un usuario.
- La cookie es `ftth_session` (`auth.ts:23`) con atributos `httpOnly`, `sameSite: 'lax'`,
  `path: '/'`, `maxAge` de una semana y `secure` derivado de `SESSION_COOKIE_SECURE` o, en
  su defecto, de `NODE_ENV === 'production'` (`packages/db/src/cookies.ts:10-26`).
- **La validación es doble**: el JWT se verifica **y** se comprueba que exista la fila
  `prisma.session` vigente, con `session.userId === claims.sub` y
  `session.user.tenantId === claims.tenantId`
  (`apps/web/lib/auth/server.ts:388-402`). Revocar una sesión en la base la invalida de
  inmediato, sin esperar a que expire el token.
- El secreto se resuelve **de forma perezosa** (`auth.ts:11-13`), para que el build de
  Next.js no necesite variables de entorno; pero en producción **lanza** si falta
  (`auth.ts:26-29`). Lo mismo para `KMS_MASTER_KEY` (`packages/db/src/crypto.ts:23-26`).

### Contraseñas

- **bcrypt con coste 12** (`packages/db/src/auth.ts:20`, `hashPassword` en `:55`).

### CSRF

- Patrón **double-submit cookie**: cookie `ftth_csrf` con 32 bytes aleatorios en hex
  (`apps/web/lib/auth/csrf.ts:21`, `generateCsrfToken` en `:46`), atributos
  `Path=/; SameSite=Strict; Max-Age=86400` (`:106`).
- La cookie **no es `HttpOnly`** a propósito: el token no es una credencial, tiene que ser
  legible por JS para que el cliente lo reenvíe. La comparación de validación es en tiempo
  constante (`csrf.ts:55`).
- El middleware exige el header `X-CSRF-Token` en `POST/PUT/DELETE/PATCH`, con excepción
  para `/api/auth/*` (`apps/web/middleware.ts:127`).
- El generador usa **Web Crypto**, no `node:crypto`, porque el middleware corre en el
  runtime Edge (`csrf.ts:29-39`).

### Anti brute-force

- Cuota de **ventana fija**, con dos claves: `login:email:<normalizado>` y
  `login:ip:<ip>` (`packages/db/src/auth-rate-limit.ts:59-63`). Se chequea **antes** de
  cualquier acceso a la base (`apps/web/lib/auth/server.ts:231-244`).
- El contador vive en `AuthRateLimit`, que **no tiene FK a usuario ni a tenant**, a
  propósito: el atacante todavía no está identificado (`schema.prisma:454-458`).
- El store es **inyectable** (`auth-rate-limit.ts:18`), lo que permite testear la cuota sin
  esperas.

### MFA

- **TOTP** con secreto Base32 cifrado en reposo (`User.totpSecret`,
  `schema.prisma:217`) y `mfaEnabled` (`schema.prisma:218`).
- El login devuelve `{mfaRequired: true, tempToken}` en vez de sesión
  (`apps/web/lib/auth/server.ts:271-286`); el token temporal dura 5 minutos
  (`packages/db/src/auth.ts:71-72`).
- El setup genera el secreto **sin activarlo**: la activación ocurre al verificar
  (`apps/web/app/api/auth/mfa/setup/route.ts`).

### Autorización

- `Role` y `Permission` viven en `apps/web/lib/auth/permissions.ts:14-30`, **sin importar
  `@ftth-copilot/db`** (sólo tipos), para que el módulo funcione igual en cliente y en
  servidor.
- `MEMBER` es un alias de `OPERATOR` (`schema.prisma:20`).
- Los permisos de API y la jerarquía de roles del middleware son **distintos**: el
  middleware aplica su jerarquía (OWNER 4 > ADMIN 3 > OPERATOR/MEMBER 2) sólo a rutas de
  página (`apps/web/middleware.ts:101`).

### LDAP / Active Directory

- Backend opcional en `packages/soc/src/auth-ldap.ts`, con `ldapts`, filtro RFC-2254
  configurable (`LDAP_USER_FILTER`, default `(uid={username})`) y mapeo de grupos a roles
  (`LDAP_ROLE_MAP`).

## Consecuencias

### Buenas

- **La cookie HttpOnly blinda el token ante XSS**, que es el ataque más común en una app
  con datos de sesión.
- **El hash en base hace que un dump no sirva para impersonar**: hay que robar el token en
  tránsito, no sólo leer la tabla.
- La **doble validación** (JWT + fila) permite revocar sesiones al instante. Es lo que
  hace que "cerrar sesión en todos lados" sea una operación de una fila.
- El **fail-fast de secretos en producción** elimina la clase de incidente más grave:
  arrancar en producción con un secreto de desarrollo.
- El **double-submit cookie** protege contra CSRF sin.token de sesión en el cuerpo ni en un
  header oculto: el atacante no puede leer la cookie del sitio víctima.
- La **cuota por email y por IP** cubre los dos ataques:Credential stuffing (muchas
  cuentas, una IP) y fuerza bruta (una cuenta, muchas IPs).
- El **almacenamiento inyectable** de la cuota permite tests deterministas.
- MFA con TOTP es un segundo factor **sin servidor**, sin SMS y sin dependencias externas.
- El RBAC sin dependencias permite calcular permisos en el cliente y en el servidor con el
  mismo código.

### Malas

- **La sesión es stateful en la base**: cada request autenticado consulta `sessions`. Con
  volumen alto, eso es una tabla que crece y una query por request.
- El secret se **inlinea en el bundle Edge** en build (`Dockerfile:30`), así que el valor
  es parte del artefacto y cambiarlo exige reconstruir.
- `sameSite: 'lax'` **no** bloquea el CSRF por sí solo: por eso hace falta el double-submit
  explícito.
- La **exención de CSRF para `/api/auth/*`** es amplia: incluye `POST /api/auth/mfa/verify`,
  que setea la cookie de sesión y **no** setea la cookie de CSRF. Un usuario que entra por
  MFA queda sin token de CSRF hasta el próximo login completo.
- `AuthRateLimit` **no tiene FK**, lo que exige limpiar por `expiresAt` y no por relación.
- TOTP sin copia de seguridad de códigos: perder el teléfono es perder el segundo factor.
- El **mismo `Role` sirve para el RBAC de la API y para la jerarquía de páginas**, pero con
  reglas distintas. Es una fuente de confusión: `ADMIN` puede operar pero no ejecutar
  acciones, y el middleware no lo sabe.

### Abiertas

- La cookie de sesión no tiene `__Host-` ni `__Secure-` como prefijo, que daría garantías
  adicionales al navegador.
- No hay rotación de refresh token: la sesión dura 7 días y se invalida cerrándola.
- `Session` no tiene `tenantId`: el aislamiento se deriva del `userId`. Correcto, pero
  significa que "filtrar por tenant" no es una regla uniforme en el modelo de datos.
