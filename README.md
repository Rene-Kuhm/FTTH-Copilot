# FTTH-Copilot — Diagnóstico de red FTTH en lenguaje natural

Agente de IA que se conecta a tu NMS (SmartOLT, Mikrowisp, NetSense) y te explica en español qué está pasando en tu red. **No reemplaza el NMS** — agrega una capa conversacional encima.

## Quick path

1. `pnpm install`
2. `cp .env.example .env` y completá `MINIMAX_API_KEY`
3. `pnpm dev` → abrí `http://localhost:3001`
4. Escribí una pregunta de FTTH en el chat → el agente elige la tool correcta y te contesta

## Details

| Área | Estado |
|---|---|
| Estado actual | MVP demo end-to-end con mocks de SmartOLT (3 OLTs, 7 ONUs, valores realistas) |
| LLM | MiniMax-M3 (Anthropic-API-compatible, 1M context) |
| Frontend | Next.js 16.3.1 + Tailwind 4.3.3 |
| Tests | Vitest, 96.34% lines en `packages/connectors/smartolt` |
| CI | GitHub Actions · lint + typecheck + tests + build · `CI Success` required |
| Repo | Público, sin secrets en la historia (gitleaks clean) |
| Multi-tenant | No todavía (fase 2) |

## Estructura

```
apps/web/                    → Next.js 15 + chat UI
packages/agent-core/         → tool-calling loop contra MiniMax-M3
packages/connectors/
  ├─ core/                   → interface INmsConnector (provider-agnostic)
  └─ smartolt/               → SmartOLT adapter (mock por ahora)
packages/shared/             → tipos compartidos
```

## Quick path 2 — verificar el setup

```bash
pnpm typecheck        # 5/5 paquetes verde
pnpm test:unit        # 9 tests, todos verde
pnpm build            # 3 rutas generadas
```

## Variables de entorno

Mínimas (ver `.env.example`):

| Variable | Requerida | Notas |
|---|---|---|
| `MINIMAX_API_KEY` | sí | Key del LLM (Anthropic-API-compatible) |
| `SMARTOLT_USE_MOCK` | no, default `true` | `false` para usar API real (no implementado todavía) |

## Roadmap

| Fase | Estado | Outcome |
|---|---|---|
| 0 — Validación con ISP | pendiente | 3+ ISPs confirman interés y precio |
| 1 — MVP demo | **en progreso** | Demo end-to-end con mocks |
| 2 — MVP producto | pendiente | Auth multi-tenant + UI pulida + deploy staging |
| 3 — Piloto pago | pendiente | 1+ ISP paga y retiene 30 días |
| 4 — Escalado | pendiente | Segundo connector, reducción costo LLM |

## Checklist para el próximo paso

- [ ] Conectar el `SmartOltClient` con un sandbox real del ISP
- [ ] Escribir los 10 escenarios de diagnóstico manual (QA log del agente)
- [ ] Definir el tier de precios usando el feedback de los ISPs pilotos

## Licencia

Privado — todos los derechos reservados a TecnoDespegue / René Kuhm.

## Next step

Terminá el demo de la **Quick path**, abrí una conversación con una pregunta de tu red real, y guardá el log. Eso te da los 10 escenarios de QA que la guía pide antes de Fase 1 → 2.
