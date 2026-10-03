# Task: R3 — Docker Compose demo

## Parent

`launch-roadmap.md`

## Status

done — 2026-09-20

## What

Add a Docker Compose demo with synthetic data and a demo account.

## Details

- Extend `docker-compose.yml` to include the full app + postgres + seed data.
- Include a seeded demo account (admin/demo credentials).
- Pre-populate synthetic ONUs in offline/degraded states for the demo.
- No real NMS credentials required.

## Deliverable

Updated `docker-compose.yml`, demo seed script or migration, and `.env.demo` example.
