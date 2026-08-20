# FTTH-Copilot

> Agente de IA sobre SmartOLT/Mikrowisp que da diagnóstico en lenguaje natural y reportes automáticos para ISPs, **sin reemplazar el NMS existente**.

FTTH-Copilot es una capa de IA que se monta **encima** del NMS del ISP (SmartOLT, Mikrowisp, NetSense). Lee datos vía REST y agrega lo que esas plataformas no tienen: diagnóstico en lenguaje natural, reportes automáticos y un asistente conversacional para técnicos.

---

## Estado actual

**Fase 1 — MVP técnico interno (en progreso).**

Esta entrega es una **demo local** con datos mockeados de SmartOLT. El agente responde preguntas de diagnóstico usando fixtures realistas de la API pública. Sin UI de producción, sin auth, sin deploy público todavía.

---

## Stack

| Capa | Tecnología |
|---|---|
| Lenguaje | TypeScript 5.7 |
| Monorepo | pnpm workspaces + Turborepo |
| Frontend | Next.js 15 (App Router) + Tailwind CSS |
| Backend (cuando esté) | Node.js + Fastify (próxima fase) |
| LLM | Anthropic Claude (`claude-sonnet-4-6`) |
| Connector | Mock fixtures (SmartOLT real en fase posterior) |
| Tests | Vitest (próxima fase) |

---

## Estructura del monorepo

```
ftth-copilot/
├── apps/
│   └── web/                    # Next.js 15 + Tailwind — UI de chat
├── packages/
│   ├── agent-core/             # Claude tool-calling loop + prompts
│   ├── connectors/
│   │   ├── core/               # INmsConnector interface
│   │   └── smartolt/           # Adapter de SmartOLT (mock por ahora)
│   └── shared/                 # Tipos compartidos
├── docs/
│   └── api-samples/smartolt/   # Respuestas reales capturadas
└── ...
```

---

## Quick start

### Requisitos

- Node.js >= 22
- pnpm >= 11

### Setup

```bash
# 1. Instalar dependencias
pnpm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env y poner tu ANTHROPIC_API_KEY

# 3. Levantar la app en modo dev
pnpm dev
```

Abrí [http://localhost:3000](http://localhost:3000) y empezá a chatear con el agente.

---

## Scripts

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Levanta todos los paquetes en modo watch |
| `pnpm build` | Compila todos los paquetes |
| `pnpm lint` | Corre ESLint en todo el monorepo |
| `pnpm typecheck` | Corre `tsc --noEmit` en todo |
| `pnpm test` | Corre tests (Vitest) |
| `pnpm clean` | Limpia artefactos + node_modules |

---

## Variables de entorno

Ver [`.env.example`](./.env.example).

Las mínimas para arrancar:

- `ANTHROPIC_API_KEY` — key de Anthropic (obligatoria)
- `SMARTOLT_USE_MOCK=true` — usa fixtures en vez de la API real

---

## Roadmap

- [x] **Fase 0** — Scaffold del monorepo + agente Claude con tool-calling mock
- [ ] **Fase 1** — Capturar respuestas reales de SmartOLT API, validar con 10 preguntas de diagnóstico
- [ ] **Fase 2** — Auth multi-tenant + UI pulida + tests E2E + deploy staging
- [ ] **Fase 3** — Piloto con 1-3 ISPs reales + reportes automáticos + facturación

Ver [PROJECT_GUIDE.md](./PROJECT_GUIDE.md) (cuando esté en el repo) para la guía completa.

---

## Licencia

Privado — todos los derechos reservados a TecnoDespegue / René Kuhm.
