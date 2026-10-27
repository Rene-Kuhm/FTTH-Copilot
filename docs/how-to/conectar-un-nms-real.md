# Conectar un NMS real

**Objetivo:** registrar un conector contra el NMS de producción (SmartOLT, Mikrowisp o
MikroTik), verificar que responde y dejar el sistema usando datos reales en vez de
fixtures.

## Requisitos

- Una instancia de FTTH-Copilot corriendo (`pnpm dev` en `http://127.0.0.1:3001`) o
  desplegada.
- Un usuario con rol `OWNER` o `ADMIN`: el permiso `manage_connectors` es el que habilita
  crear, probar y borrar conectores (`apps/web/lib/auth/permissions.ts`).
- La URL base y la API key del NMS.
- La política de red saliente revuelta (ver el paso 3).

## 1. Creá el conector

`POST /api/connectors/create` (`apps/web/app/api/connectors/create/route.ts`). El body se
valida con zod y tiene exactamente esta forma:

```json
{
  "provider": "SMARTOLT",
  "label": "SmartOLT produccion",
  "apiKey": "<api key del NMS>",
  "baseUrl": "https://api.smartolt.com"
}
```

| Campo | Regla |
|---|---|
| `provider` | `SMARTOLT` \| `MIKROWISP` \| `NETSENSE` \| `MIKROTIK` |
| `label` | string, 1–80 caracteres, recortado. Es la clave única junto al tenant y el proveedor |
| `apiKey` | string, 1–500 caracteres, recortado |
| `baseUrl` | URL absoluta; se normaliza sin barra final |

Respuestas:

- `201 {connector}` — creado. Nace con `status: "pending"`.
- `400 {error}` — input inválido o URL que no pasa la política de red (el mensaje es el de
  `UnsafeNmsUrlError`).
- `401` / `403` — sin sesión, o el rol no tiene `manage_connectors`.
- `422 {error:"NetSense todavía no está implementado."}` — `NETSENSE` todavía no tiene
  adaptador; usá `SMARTOLT`, `MIKROWISP` o `MIKROTIK`.

Desde la UI esto es lo mismo: el componente `ConnectorManager`
(`apps/web/components/ConnectorManager.tsx`, montado en `/app`) hace el `POST` con
`csrfFetch` y después llama al endpoint de prueba.

Por línea de comandos, con la cookie de sesión y el token CSRF:

```bash
curl -sS -c /tmp/ftth.cookies -X POST http://127.0.0.1:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@ftth-copilot.local","password":"<tu password>"}'

CSRF=$(awk '$6=="ftth_csrf"{print $7}' /tmp/ftth.cookies)

curl -sS -b /tmp/ftth.cookies -X POST http://127.0.0.1:3001/api/connectors/create \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: ${CSRF}" \
  -d '{"provider":"SMARTOLT","label":"SmartOLT produccion","apiKey":"<api key>","baseUrl":"https://api.smartolt.com"}'
```

El login deja las dos cookies (`ftth_session` y `ftth_csrf`). El middleware exige el header
`X-CSRF-Token` en todo `POST`/`PUT`/`DELETE`/`PATCH` fuera de `/api/auth/*`
(`apps/web/middleware.ts`); sin él la respuesta es `403 {error:"Invalid CSRF token"}`.

## 2. Probá el conector

`POST /api/connectors/[id]/test` (`apps/web/app/api/connectors/[id]/test/route.ts`):

```bash
curl -sS -b /tmp/ftth.cookies -X POST http://127.0.0.1:3001/api/connectors/<connectorId>/test \
  -H "X-CSRF-Token: ${CSRF}"
```

- `200 {ok:true, latencyMs}` — respondió.
- `502 {ok:false, error}` — falló. El texto de `error` dice si fue la URL, las credenciales
  o la política de red.

El test **es el que cambia el estado**: escribe `status: "connected"` si respondió y
`status: "error"` si no, más `lastCheckedAt` y `lastError` (truncado a 500 caracteres).

Ese estado importa más de lo que parece:

- El poller (`runScheduledPoll` en `apps/web/lib/monitoring/scheduler.ts`) sólo recorre
  conexiones con `status: "connected"`.
- `resolveTenantConnector` (`apps/web/lib/connectors/chat-client.ts`) sólo elige
  conexiones `connected`. Sin un test exitoso, el chat no usa ese NMS.

## 3. Revisá la política de red saliente

Toda URL se valida en `packages/connectors/core/src/security.ts` antes de cada request.
Los defaults son restrictivos a propósito:

| Variable | Default | Efecto |
|---|---|---|
| `NMS_ALLOWED_PORTS` | `443` | Lista separada por comas de puertos destino permitidos. Un puerto fuera de la lista se rechaza |
| `NMS_ALLOWED_HOSTS` | vacío | Allowlist exacta de hosts. Vacío ⇒ **no** se aplica allowlist; con valor ⇒ el host tiene que estar en la lista |
| `NMS_ALLOW_HTTP` | `false` | Con `false` (o cualquier valor distinto del literal `true`) el esquema `http:` se rechaza y sólo se acepta `https:` |
| `NMS_ALLOW_PRIVATE_NETWORKS` | `false` | Con `false` se rechazan IPs privadas y hosts que resuelven a IPs privadas |
| `NMS_REQUEST_TIMEOUT_MS` | `10000` | Timeout de cada request al NMS |

Además, sin importar la configuración, siempre se rechaza: `localhost` y `*.localhost`,
URLs con usuario o contraseña embebidos, y URLs base con query string o fragmento.

> **Guarda anti-SSRF.** `assertSafeNmsBaseUrl` valida la URL al guardar el conector y
> `assertSafeNmsRequestUrl` re-valida la política de red **en cada request**, incluida la
> resolución DNS. El riesgo residual aceptado —y documentado en el propio módulo— es una
> carrera de DNS rebinding entre la resolución y el `fetch`; el código la acepta a
> propósito porque la URL base la configura un usuario con `manage_connectors`, no input no
> confiado. No expongas `manage_connectors` a operadores sin confianza y no pongas el NMS
> detrás de un host cuyo DNS controle un tercero.

Consecuencia práctica: un NMS en la red interna del ISP (IP `10.x`, `192.168.x`) necesita
`NMS_ALLOW_PRIVATE_NETWORKS=true`, y un NMS en un puerto no estándar necesita ese puerto en
`NMS_ALLOWED_PORTS`.

## 4. Guardá las credenciales (y sabé qué se guarda)

La API key nunca se devuelve: `GET /api/connectors` responde con la proyección de
`publicConnector` (`apps/web/lib/connectors/server.ts`), que incluye `id`, `provider`,
`label`, `baseUrl`, `status`, `lastCheckedAt`, `lastError` y `createdAt`, pero **no** la
clave.

En la base, la fila `NmsConnection` guarda la clave en `encryptedKey`
(`packages/db/prisma/schema.prisma`):

- Cifrado **AES-256-GCM** (`packages/db/src/crypto.ts`).
- La clave maestra se deriva con **SHA-256** de `KMS_MASTER_KEY`.
- El blob es base64 con el layout `iv (12 bytes) || ciphertext || authTag (16 bytes)`.
- `KMS_MASTER_KEY` es obligatoria en producción: sin ella el proceso **se niega a
  arrancar** (`resolveSecret` en `packages/db/src/crypto.ts`).

Si `KMS_MASTER_KEY` cambia o se pierde, la clave almacenada deja de descifrar y el conector
falla con *"No se pudieron descifrar las credenciales del conector. Volvé a configurarlo."*
Hay que volver a cargar la API key.

## 5. Usá el proveedor correcto

| Proveedor | Cómo viaja la credencial | Rutas que llama |
|---|---|---|
| `SMARTOLT` | Header `X-Token: <api key>` (`packages/connectors/smartolt/src/client.ts`) | `/api/system/get_olts`, `/api/onu/get_all_onus_details`, `/api/system/get_olt_detail/{id}` |
| `MIKROWISP` | `token` dentro del body JSON, en requests `POST` (`packages/connectors/mikrowisp/src/client.ts`) | `/GetRouters`, `/GetMonitoreo` |
| `MIKROTIK` | El campo `apiKey` guarda `{"username":"...","password":"..."}` en JSON, o `usuario:clave`, o sólo la clave. `baseUrl` aporta host, puerto y si usa TLS (`https:`) (`apps/web/lib/connectors/chat-client.ts`) | API REST de RouterOS |

Para SmartOLT, la `baseUrl` es la raíz del tenant de SmartOLT (por ejemplo
`https://acme.smartolt.com`) — el cliente ya agrega el prefijo `/api/...`. Para Mikrowisp,
`baseUrl` es la raíz de la API (por ejemplo `https://demo.mikrowisp.com/api/v1`).

## Cómo verificar

```bash
# 1. Estado del conector (nunca expone la api key)
curl -sS -b /tmp/ftth.cookies http://127.0.0.1:3001/api/connectors

# 2. El panel usa el conector "connected"
curl -sS -b /tmp/ftth.cookies http://127.0.0.1:3001/api/dashboard
```

`GET /api/connectors` devuelve `{user, connectors, demoMode}`. `demoMode` vale `true`
cuando `DEMO_MODE_ENABLED=true`; si además no hay ningún conector `connected`, el chat cae a
fixtures.

## Troubleshooting

- **El test responde `502` con "La URL del NMS debe usar HTTPS."** → el NMS está en `http:`.
  Seteá `NMS_ALLOW_HTTP=true` **sólo** si es un destino controlado, o usá HTTPS.
- **El test responde `502` con "El host del NMS no está incluido en NMS_ALLOWED_HOSTS."** →
  agregá el host a `NMS_ALLOWED_HOSTS` (lista separada por comas, sin esquema ni puerto).
- **El test responde `502` con "El puerto 8080 no está permitido para conexiones NMS."** →
  agregá el puerto a `NMS_ALLOWED_PORTS`.
- **El test responde `502` con "La URL del NMS no puede apuntar a una red privada."** →
  el NMS está en una IP RFC1918: `NMS_ALLOW_PRIVATE_NETWORKS=true`, o expónlo por un nombre
  público.
- **El test responde `502` con "La URL del NMS no puede apuntar a localhost."** → el
  hostname es `localhost` o termina en `.localhost`. Es un rechazo incondicional: usá la IP
  o el hostname real del NMS.
- **El conector queda `connected` pero el chat sigue con fixtures** → el chat resuelve el
  conector por `resolveTenantConnector`, que exige `status: "connected"`. Si la fila se
  editó a mano y quedó en otro estado, volvé a correr el test.
- **Después de un restart el conector falla con "No se pudieron descifrar las
  credenciales"** → `KMS_MASTER_KEY` cambió desde que se guardó la clave. Volvé a cargar la
  API key.
- **`403 {error:"Insufficient permissions"}`** → el rol es `OPERATOR`/`MEMBER`; hace falta
  `OWNER` o `ADMIN`.
- **`403 {error:"Invalid CSRF token"}`** → falta el header `X-CSRF-Token` o no coincide con
  la cookie `ftth_csrf`.
