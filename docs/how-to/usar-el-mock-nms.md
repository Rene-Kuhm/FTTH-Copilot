# Usar el mock NMS

**Objetivo:** levantar el NMS simulado que trae el repo, apuntar un conector "live" a él y
comprobar que el sistema lee inventario y telemetría sin ningún equipo físico.

## Requisitos

- Node ≥ 22 y pnpm 11.22.0 (los requisitos del workspace).
- Para probar la parte SOC: un `SYSLOG_TENANT_ID` válido (ver
  [Habilitar NOC y SOC](habilitar-noc-y-soc.md)).

## 1. Levantar el mock

```bash
pnpm test:mock-nms
```

Levanta un servidor HTTP en `:5515` (`scripts/mock-nms.ts`) que responde con las **formas
reales** de SmartOLT y Mikrowisp. El puerto se cambia con la variable `MOCK_NMS_PORT`:

```bash
MOCK_NMS_PORT=5516 pnpm test:mock-nms
```

## 2. Rutas que sirve

El mock enruta por prefijo de URL: `/smartolt/...` devuelve formas SmartOLT y
`/mikrowisp/...` formas Mikrowisp. Cualquier otro prefijo devuelve `404` con
`{error:"unknown provider; prefix with /smartolt/ or /mikrowisp/"}`.

| Ruta | Método | Forma de la respuesta |
|---|---|---|
| `/smartolt/api/system/get_olts` | GET o POST | `{status:true, response:[{id:'OLT-MOCK-1', name:'Mock OLT 1', ip:'10.0.0.1'}]}` |
| `/smartolt/api/onu/get_all_onus_details` | GET o POST | `{status:true, onus:[{unique_external_id:'ONU-MOCK-1', sn:'SNMOCK0001', olt_id:'OLT-MOCK-1', name:'Cliente Mock', status:'online', signal:'-21.5', signal_1490:'2.0', ...}]}` |
| `/mikrowisp/GetRouters` | POST | `{estado:'exito', routers:[{id:'RT-MOCK-1', nombre:'Mock Router', ip:'10.0.0.1', estado:'activo'}]}` |
| `/mikrowisp/GetMonitoreo` | POST | `{estado:'exito', equipos:[{id:'EQ-MOCK-1', nombre:'Mock ONU', equipo:'Mock', ip:'10.0.0.2', estado:1}]}` |

Los fixtures que se devuelven están en `packages/connectors/smartolt/src/fixtures.ts` y
`packages/connectors/mikrowisp/src/fixtures.ts`; el match por ruta está en
`packages/connectors/*/src/mock-nms.ts` (por `includes` sobre el path sin el prefijo).

Cualquier otra ruta devuelve `404` con `{status:false}` (SmartOLT) o `{estado:'error'}`
(Mikrowisp). Por eso el mock **no** cubre `get_olt_detail/{id}` ni `get_onu_detail/{id}`:
el conector funciona para inventario y listado, no para el detalle por OLT.

## 3. Relajar la política de red para destinos locales

El guard anti-SSRF (`packages/connectors/core/src/security.ts`) **rechaza** la URL del mock
tal como está, porque es `http:` a una IP privada en un puerto no estándar. Para este
caso puntual:

```env
NMS_ALLOW_HTTP=true
NMS_ALLOW_PRIVATE_NETWORKS=true
NMS_ALLOWED_PORTS=5515
```

`NMS_ALLOWED_HOSTS` puede quedar vacío: con la lista vacía no se aplica allowlist.

> Estos tres flags relaxan la política **para todos los destinos NMS** del proceso, no sólo
> para el mock. Lo correcto en un entorno de pruebas es limitarlos al entorno local y no
> subirlos a producción. En producción, el NMS real debe ser HTTPS y, si está en la red
> interna del ISP, `NMS_ALLOW_PRIVATE_NETWORKS=true` con `NMS_ALLOWED_HOSTS` restringido a
> su host.

Estos flags se leen **en cada request** (`assertStaticUrlPolicy` los consulta cada vez),
así que no hace falta reiniciar el proceso para que surtan efecto. Lo que sí exige
reinicio es cualquier flag de arranque de los planos de vigilancia (ver
[Habilitar NOC y SOC](habilitar-noc-y-soc.md)).

## 4. Guardar el conector con la baseUrl correcta

La baseUrl que hay que guardar **termina en el prefijo del proveedor y sin barra final**:

| Proveedor | `baseUrl` exacta |
|---|---|
| `SMARTOLT` | `http://127.0.0.1:5515/smartolt` |
| `MIKROWISP` | `http://127.0.0.1:5515/mikrowisp` |

El cliente de SmartOLT pide `/api/system/get_olts` relativo a la base, y el de Mikrowisp
`/GetRouters`; el mock reescribe el prefijo y devuelve la forma correspondiente. Si la
baseUrl no termina en `/smartolt` o `/mikrowisp`, el mock devuelve 404. Una barra final
(`.../smartolt/`) no rompe nada: `assertSafeNmsBaseUrl` la quita al normalizar, pero la
forma canónica es sin barra.

Creación por API (mismo mecanismo que el de producción, ver
[Conectar un NMS real](conectar-un-nms-real.md)):

```bash
curl -sS -b /tmp/ftth.cookies -X POST http://127.0.0.1:3001/api/connectors/create \
  -H 'Content-Type: application/json' \
  -H "X-CSRF-Token: ${CSRF}" \
  -d '{"provider":"SMARTOLT","label":"Mock SmartOLT","apiKey":"cualquiera","baseUrl":"http://127.0.0.1:5515/smartolt"}'
```

El campo `apiKey` es obligatorio para el schema pero el mock no lo valida: poné cualquier
string no vacío.

> **Orden importante:** la URL se valida **en el momento de crearla**, no cuando se prueba.
> Si los flags de red del paso 3 todavía no están seteados, el `POST` devuelve
> `400 {error:"La URL del NMS debe usar HTTPS."}` y el conector ni siquiera se crea.

## 5. Probar el conector contra el mock

```bash
curl -sS -b /tmp/ftth.cookies -X POST http://127.0.0.1:3001/api/connectors/<id>/test \
  -H "X-CSRF-Token: ${CSRF}"
```

Debe responder `200 {ok:true, latencyMs}`. El `ping()` del cliente SmartOLT llama
`/api/system/get_olts`; el de Mikrowisp, `/GetRouters`.

En la terminal donde corre el mock vas a ver la traza de cada request:

```text
<-- GET /smartolt/api/system/get_olts  ->  200
```

## 6. `DEMO_MODE_ENABLED` y su diferencia con el mock

`DEMO_MODE_ENABLED` y el mock NMS son dos cosas distintas:

| | `DEMO_MODE_ENABLED=true` | `pnpm test:mock-nms` |
|---|---|---|
| Dónde vive la data | Fixtures del paquete del conector, dentro del proceso | Un servidor HTTP aparte, en `:5515` |
| Cómo se alcanza | Automático, sin configurar nada | Hay que crear un conector con la `baseUrl` apuntando al mock |
| Qué ejercita | La capa de negocio con datos fijos | El cliente HTTP real: URL, headers, parseo de respuesta, errores |

`DEMO_MODE_ENABLED` **sólo** aplica cuando `NODE_ENV !== 'production'`
(`apps/web/lib/connectors/chat-client.ts`): es el fallback cuando el tenant no tiene
ningún conector en estado `connected`. En producción el flag se ignora y el sistema falla
con *"No hay un conector NMS validado"* en vez de servir datos simulados.

Además, `GET /api/connectors` expone `demoMode: true` cuando
`DEMO_MODE_ENABLED === 'true'`, para que la UI lo muestre.

## 7. Del lado SOC: el escenario syslog

El mock NMS cubre el plano NOC. Para el plano SOC, el equivalente es el emisor de syslog
(`scripts/send-syslog.ts`), que manda 6 fallos de autenticación desde la misma IP, 1 acceso
y 1 cambio de configuración por UDP:

```bash
# Con el receptor habilitado (ver "Habilitar NOC y SOC")
SYSLOG_RECEIVER_ENABLED=true SYSLOG_TENANT_ID=<tenant-id> pnpm dev

# En otra terminal
pnpm test:syslog

# Con destino explícito
SYSLOG_HOST=10.0.0.5 SYSLOG_PORT=5514 pnpm test:syslog
```

| Variable | Default | Efecto |
|---|---|---|
| `SYSLOG_HOST` | `127.0.0.1` | Host destino |
| `SYSLOG_PORT` | `5514` | Puerto UDP destino |

Los mensajes que envía están en `buildSocScenarioMessages()`
(`packages/security/src/syslog-build.ts`).

## Cómo verificar

```bash
# El dashboard lee del conector live
curl -sS -b /tmp/ftth.cookies http://127.0.0.1:3001/api/dashboard

# El origen de los datos en la respuesta
# -> "dataSource": { "mode": "live", "provider": "SMARTOLT", ... }
```

`mode: "live"` (y no `"demo"`) confirma que el sistema está usando el conector contra el
mock, no fixtures.

## Troubleshooting

- **El mock devuelve `404 {"error":"unknown provider; prefix with /smartolt/ or
  /mikrowisp/"}`** → la `baseUrl` no termina en `/smartolt` ni `/mikrowisp`.
- **El `POST /api/connectors/create` devuelve `400` con "La URL del NMS debe usar
  HTTPS."** → falta `NMS_ALLOW_HTTP=true` (la URL del mock es `http:`).
- **El `POST /api/connectors/create` devuelve `400` con "El puerto 5515 no está permitido
  para conexiones NMS."** → falta `NMS_ALLOWED_PORTS=5515`.
- **El `POST /api/connectors/create` devuelve `400` con "La URL del NMS no puede apuntar a
  una red privada."** → falta `NMS_ALLOW_PRIVATE_NETWORKS=true` (`127.0.0.1` es privada).
- **El test devuelve `502` con el mismo mensaje de HTTPS o de puerto** → los flags se
  cambiaron después de crear el conector y la política se reevalúa en cada request: el
  error ahora aparece en el test, no en la creación.
- **El panel sigue mostrando datos de demo después de crear el conector** → el conector
  quedó en `status: "pending"`; corré el test del conector para que pase a `connected`.
- **"El conector no tiene una URL base configurada."** → el `baseUrl` se guardó vacío.
- **El mock responde bien por curl pero el conector falla** → el mock escucha en
  `0.0.0.0`, pero verificá que no haya un proceso usando el puerto 5515 y que el firewall
  no bloquee el loopback.
