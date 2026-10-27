# ADR 0004 — Next.js App Router como única aplicación web

**Estado:** Aceptada
**Fecha:** 2026-08-20 (inicialización del repo)

## Contexto

El producto expone tres superficies de usuario:

1. El **Copiloto**: chat de diagnóstico, dashboard, incidentes, planes de fibra.
2. El **NOC**: incidentes, predicciones, SLA, timeline de cambios.
3. El **SOC**: accesos, auditoría, hallazgos de seguridad.

Además necesita una API consumible por clientes externos, un PWA instalable en el
teléfono del técnico, un APK Android y un binario de escritorio Tauri.

La alternativa obvia —un backend Node/Express separado y un frontend SPA— duplicaba la
autenticación, el CORS, la definición de tipos y el despliegue. Con la mitad de los
problemas del producto concentrados en "el operador pregunta al NMS y recibe una respuesta",
la oportunidad de fusionar la API y la UI en un solo proceso es grande.

Al mismo tiempo, el sistema tiene que **no ser una app web más**: corre en instalaciones
de ISP, a veces detrás de un proxy inverso, y a veces compilado a estático para el
escritorio.

## Decisión

Usar **Next.js con App Router como única aplicación web**, que sirve a la vez la UI y la
API, y apuntar a **cero lógica de negocio en los route handlers**.

- `apps/web` es la única aplicación del workspace. Corre Next.js 16 con React 19.
- Las rutas de API viven en `apps/web/app/api/**/route.ts` y **reenvuelven** funciones de
  `apps/web/lib/`, que es donde vive la lógica. Por ejemplo
  `apps/web/app/api/auth/login/route.ts:3-5` es un wrapper de
  `handleLogin` (`apps/web/lib/auth/server.ts:223`).
- Los componentes de UI están en `apps/web/components/`, y los helpers de dominio en
  `apps/web/lib/`.
- El servidor se puede compilar en **standalone** (`NEXT_OUTPUT_MODE=standalone`,
  `apps/web/next.config.mjs:15`) para el contenedor de producción, o en **estático**
  (`NEXT_OUTPUT_MODE=export`) para las builds de escritorio y mobile.
- Tauri y Capacitor consumen la misma app: Tauri reescribe el bundle a una URL de
  desarrollo con `scripts/prepare-tauri-webview.mjs`, y Capacitor empaqueta el build
  estático (`apps/web/capacitor.config.ts`).
- La lógica de negocio vive en **paquetes**, no en `apps/web`: el chat, los detectores y la
  evidencia están en `packages/`, y la app sólo orquesta y serializa.

## Consecuencias

### Buenas

- **Una sola autenticación, una sola sesión, un solo CORS.** El cookie de sesión sirve para
  la UI y para la API.
- La lógica de negocio en paquetes es **testeable sin servidor**: los tests del agente
  inyectan `runAgent` y `fetchImpl` en lugar de levantar HTTP.
- El mismo código sirve para web, PWA, APK y escritorio. No hay una segunda implementación
  del cliente.
- El build standalone produce una imagen de Docker pequeña y sin `node_modules` completo
  (`Dockerfile:48-76`).
- La lógica en `lib/` separada de los route handlers hace que los handlers sean legibles:
  son adaptadores thin entre HTTP y funciones.

### Malas

- **El middleware corre en el runtime Edge**, no en Node. Eso condiciona qué se puede
  usar allí: por eso la verificación de JWT del middleware usa `jose` y no
  `jsonwebtoken`, y por eso el generador de CSRF usa Web Crypto y no `node:crypto`
  (`apps/web/lib/auth/csrf.ts:29-39`).
- El `JWT_SECRET` se **inlinea en el bundle Edge en tiempo de build**
  (`Dockerfile:30`, `apps/web/next.config.mjs:33`). El valor queda dentro del artefacto
  desplegado, no sólo en el entorno de runtime. Cambiarlo exige reconstruir la imagen.
- El middleware **no autentica las rutas de API**: sólo clasifica, aplica CSRF y rate
  limit (`apps/web/middleware.ts:94`). Cada handler tiene que resolver la sesión y el
  permiso por su cuenta. Es una fuente conocida de inconsistencia: hoy `GET
  /api/maintenance-windows` no chequea permiso mientras `POST` sí.
- El runtime Edge impone límites: `jsonwebtoken` y parte de la lógica de Prisma no están
  disponibles ahí, y `packages/db/src/auth.ts` resuelve el secreto de forma **perezosa**
  (`auth.ts:11-13`) para que el build no necesite variables de entorno.
- App Router con handlers por archivo produce un árbol de rutas grande: 67 archivos de
  `route.ts` para 89 handlers, y el directorio `app/api` es el mayor del repo.

### Abiertas

- El bundle está fragmentado en muchos paquetes, lo que hace el análisis de dependencias
  menos obvio que en una app monolítica.
- La build de Android y la de Tauri dependen de variables `NEXT_PUBLIC_*` que se congelan
  en build time: la misma app no puede apuntar a dos ambientes sin dos builds.
