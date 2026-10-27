# Contrato de la API HTTP

> **Qué es este documento:** la fuente única de verdad de la API HTTP de FTTH-Copilot.
> acá se define cada ruta, cada parámetro, cada cuerpo de request y cada respuesta.
> Todo lo demás que habla de la API se **genera** desde este archivo.

## El contrato

[`openapi.yaml`](openapi.yaml) es un documento [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0).
Cubre las 61 rutas y las 86 operaciones que implementa `apps/web/app/api/**`.

De ese archivo salen, por generación:

| Artefacto | Qué es | Cómo se regenera |
|---|---|---|
| [`docs/reference/api-http.md`](../reference/api-http.md) | La referencia de la API, con método, guard, parámetros, cuerpos y respuestas | `pnpm contract:generate` |
| [`packages/api-contract/src/generated/types.ts`](../../packages/api-contract/src/generated/types.ts) | Los tipos TypeScript del contrato | `pnpm contract:generate` |
| [`packages/api-contract/src/generated/schemas.ts`](../../packages/api-contract/src/generated/schemas.ts) | Los esquemas Zod que validan la entrada | `pnpm contract:generate` |

## Por qué un contrato y no un documento

Antes de esto la API estaba descrita en dos lugares a la vez: la referencia de
`docs/reference/api-http.md` y los route handlers. Se desincronizaban sin que
nadie se enterara: un endpoint nuevo no aparecía en la referencia, y un
parámetro que había cambiado seguía documentado como estaba.

Con el contrato hay una sola fuente y dos guards:

1. **El CI regenera y compara.** `pnpm contract:check` vuelve a producir los tres
   artefactos y falla si lo commiteado no coincide. Si editás el contrato y no
   regenerás, el build se pone rojo.
2. **El CI compara el contrato con el código.** El mismo check recorre
   `apps/web/app/api/**`, deduce la ruta y los métodos de cada handler, y falla
   si hay una ruta que el contrato no declara o una operación del contrato que
   el código no implementa. Un endpoint nuevo sin documentar rompe el build.

Los dos checks son herméticos: leen el repo y no dependen de la red.

## Cómo se cambia la API

1. Editá `openapi.yaml`.
2. `pnpm contract:generate` — regenera la referencia, los tipos y los validadores.
3. `pnpm contract:check` — confirma que el contrato y el código coinciden.
4. Si agregás una ruta, agregala también en el route handler: el check de
   paridad va a exigir que estén los dos lados.

Para inventariar las rutas que implementa el código (useful antes de escribir
el contrato, o para ver qué falta declarar):

```bash
pnpm exec tsx scripts/extract-api-routes.ts
```

El orden importa: el contrato manda. Si el código y el contrato discrepan, el
primer lugar que hay que tocar es el contrato, porque es el que genera los
tipos y los validadores que consume el resto del repo.

## Convenciones del contrato

- **Los nombres son los del código.** Rutas, parámetros y propiedades se llaman
  como en los route handlers, para que el contrato y el código se puedan leer
  en paralelo.
- **Las descripciones están en español** porque alimentan la referencia, que es
  documentación.
- **El guard va explícito.** Cada operación declara su permiso con
  `x-permission` o sus roles con `x-roles`. El generador lo traduce a la
  columna *Guard* de la referencia.
- **Las respuestas de error usan los esquemas comunes** (`Error`,
  `RateLimitedError`, `ConflictError`, …) para que el cliente pueda tratarlas
  de una sola forma.
- **Lo que el contrato no dice, no está garantizado.** La sección final de la
  referencia lista las observaciones verificadas en el código que el contrato
  no cubre (por ejemplo, que la forma del 401 no es uniforme).

## Ver también

- [`docs/reference/api-http.md`](../reference/api-http.md) — la referencia generada.
- [`packages/api-contract/AGENTS.md`](../../packages/api-contract/AGENTS.md) — el paquete de tipos y validadores.
- [`docs/architecture/c4/README.md`](../architecture/c4/README.md) — el otro "como código" del repo: la arquitectura C4.
