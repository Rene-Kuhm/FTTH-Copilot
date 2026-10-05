# CSRF Client Header Fix

**Status**: In Progress
**Created**: 2026-10-05
**Origin**: Regresión introducida por PR #274 (SEC-010)

## Problema

La protección CSRF mergeada en #274 es inconsistente y rompe toda la app en producción:

1. La cookie `ftth_csrf` se emite con `HttpOnly`, así que el JavaScript del
   navegador **no puede leerla**.
2. El middleware exige el header `X-CSRF-Token` con el mismo valor.
3. Ningún cliente envía ese header: no hay wrapper global de `fetch`, ni
   interceptores, ni helper. Los 13 componentes que hacen mutaciones mandan
   solo `Content-Type`.

`validateCsrfToken()` recibe `tokenHeader = null` y retorna `false`, así que
toda mutación contra `/api/*` (excepto `/api/auth/*`, exenta por diseño)
responde **403 Invalid CSRF token**.

En `main`: crear zonas, incidentes, O.N.D.A.s, usuarios y subir planos de
fibra no funcionan.

## Por qué los tests no lo detectaron

- Los 421 tests unitarios pasan, pero **ninguno importa `middleware.ts`**: tiene
  cero cobertura.
- Los 38 E2E pasan, pero las únicas mutaciones reales van a `/api/auth/*`
  (exenta) o a la ruta probe, donde el header se pasa a mano.

La gate nunca se ejercitó con una mutación real de cliente. Es el mismo modo de
fallo que las expectativas falsas del E2E anterior, ahora en la capa de
integración.

## Por qué `HttpOnly` está equivocado acá

En double-submit cookie el token **no es un secreto**. La protección viene de que
un atacante cross-site no puede leer la cookie de la víctima ni escribir un
header custom. Marcar la cookie `HttpOnly` impide que el cliente complete el
handshake y deja la defensa fail-closed frente al propio tráfico legítimo. Es la recomendación de OWASP: `HttpOnly` corresponde a la cookie de
**sesión** (`ftth_session`, que sí lo tiene y debe seguir teniéndolo).

## Solución

1. Quitar `HttpOnly` de la cookie CSRF, conservando `Path=/` y `SameSite=Strict`.
2. Agregar un helper único que lea la cookie y anexe `X-CSRF-Token`, para que no
   dependa de que cada call site recuerde hacerlo.
3. Migrar los 13 componentes con mutaciones al helper.
4. Cubrir la brecha de tests.

## Tareas

- [ ] T1 Quitar `HttpOnly` de la cookie CSRF y documentar el criterio
- [ ] T2 Helper de cliente `csrfFetch()`
- [ ] T3 Test de guarda que falle si una mutación no pasa por el helper (RED)
- [ ] T4 Migrar los 13 componentes al helper
- [ ] T5 Tests del middleware: sin header → 403, con header → pasa
- [ ] T6 Verificación completa y actualización del doc de security

## Criterio de cierre

Una mutación real de cliente contra una ruta existente debe dejar de responder
403, y debe quedar un test que falle si alguien reintroduce una mutación sin el
header.

## Notas

- `ftth_session` mantiene `HttpOnly`: esa sí es una credencial.
- El cambio es compatible hacia atrás: si el header falta, la gate rechaza, así
  que un cliente viejo sigue fallando en vez de quedar abierto.