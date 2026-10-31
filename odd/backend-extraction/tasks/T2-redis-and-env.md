# Task: T2 — Redis service and env wiring

## Parent

`odd/tasks/backend-extraction.md`

## Status

done — 2026-10-31 (compose files; `.env.example` bloqueado por el sandbox, las variables quedaron en `docs/demo-env-template.md` y `docs/worker.md`)

## Spec

S2, S6, S9

## What

Add a self-hosted `redis` service to `docker-compose.yml`,
`docker-compose.demo.yml` and `docker-compose.prod.yml`, and document
`REDIS_URL` and `BACKEND_MODE=embedded` in `.env.example`.

Redis is the only new infrastructure component (S2) and it must be self-hosted
(no SaaS). `BACKEND_MODE` defaults to `embedded` so the current behavior is
unchanged until T15 (S6, S15).

## Route

inline (orchestrator)

## Deliverable

`docker compose config` valid for the three compose files; `.env.example`
documents the new variables.
