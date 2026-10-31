# AGENTS.md — `@ftth-copilot/api-contract`

> Contexto para agentes que trabajan en este módulo. Las reglas generales del repo están en
> [AGENTS.md](../../AGENTS.md).

## Qué es

Capa L0. Los **tipos y los validadores de la API HTTP**, generados desde el contrato
[`docs/contract/openapi.yaml`](../../docs/contract/openapi.yaml).

Dos superficies:

- `src/generated/types.ts` — los tipos TypeScript (`ChatRequest`, `Incident`, …).
- `src/generated/schemas.ts` — los esquemas Zod (`ChatRequestSchema`, …) que validan la entrada.

## Qué invariantes cuida

- **Nada de este paquete se escribe a mano.** `src/generated/**` es salida del generador.
  Editarlo a mano se pierde en el próximo `pnpm contract:generate`, y el CI falla si lo
  commiteado no coincide con el contrato.
- **El contrato manda.** Si el código y el contrato discrepan, el que se corrige es el
  contrato: de él salen los tipos que consume el resto del repo.
- **Un tipo duplicado en dos paquetes es un bug.** Si la API necesita un tipo en otro
  módulo, se importa de acá.
- **Los validadores son la frontera.** Un body que no valida no es un body válido: el
  servidor debería usar estos esquemas en vez de reglas escritas a mano.

## Cómo se prueba

```bash
pnpm --filter @ftth-copilot/api-contract test
```

Y el check de sync (contrato ↔ código ↔ artefactos generados):

```bash
pnpm contract:check
```

## Qué no tocar

- `src/generated/**`: se regenera.
- `src/index.ts` es la superficie pública: reexporta lo generado. Si agregás un módulo
  propio, exportalo desde acá.

## Adoptar los validadores en un route handler

El patrón para migrar un endpoint a la validación del contrato:

```ts
import { ChatRequestSchema } from '@ftth-copilot/api-contract';

const parsed = ChatRequestSchema.safeParse(await req.json().catch(() => null));
if (!parsed.success) {
  return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
}
```

La migración es incremental: cada endpoint que se migra deja de tener su propio esquema
Zod y pasa a tener el del contrato.
