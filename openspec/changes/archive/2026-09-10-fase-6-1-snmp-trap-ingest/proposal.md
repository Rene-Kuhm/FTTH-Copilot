# Fase 6 PR #1 — SNMP Trap Ingestion Catalog, Parser & Normalizer

## Why

Roadmap Fase 6 (6.1 + 6.2 + 6.3 + 6.4 + 6.5):
- 6.1: "Elegir un fabricante/modelo y recopilar MIBs, OIDs, ejemplos autorizados y semántica de traps."
- 6.2: "Documentar versión SNMP, autenticación soportada, red de gestión, remitentes permitidos y asociación administrada remitente → tenant/conexión/equipo. No confiar en un tenant incluido en el payload."
- 6.3: "Evaluar una biblioteca y arquitectura contra documentación oficial vigente. Reutilizar TypeScript si alcanza..."
- 6.4: "Implementar recepción acotada, validación, parsing y normalización al contrato de telemetría vigente. OIDs desconocidos no se convierten en diagnósticos inventados."
- 6.5: "Controlar tasa, concurrencia, cola acotada, duplicados y pérdida de eventos; exponer descartes y salud."

This change introduces pure SNMP trap ingestion fundamentals: canonical MIB/OID catalog (Huawei, ZTE, ITU-T G.984/G.988, RFC 1215/3877), sender IP association mapping, pure trap parsing and normalization into `telemetry.v1` (`source: 'snmp-trap'`), bounded rate control, and an observation-mode UDP receiver disabled by default.

## What changes

1. Canonical SNMP Trap Catalog (`packages/monitoring/src/snmp/catalog.ts`):
   - Known traps for GPON/EPON OLTs: LinkDown, LinkUp, ONU Loss of Signal (LOS), Dying Gasp, Port LOS, coldStart, warmStart.
   - Classification into normalized severity, category, and diagnostic summary without inventing causal claims.
2. Sender Association Registry (`packages/monitoring/src/snmp/mapping.ts`):
   - Strict mapping `senderIp -> { tenantId, connectionId, oltId }`. Never trust tenant IDs in the payload (Rule 6.2).
3. Pure Parser & Normalizer (`packages/monitoring/src/snmp/parser.ts`):
   - Parses SNMP v1 / v2c trap payloads.
   - Normalizes valid traps to `TelemetryEvent` (`source: 'snmp-trap'`).
   - Unknown OIDs normalize to `category: 'unknown_trap'`, `severity: 'info'`, preserving raw varbinds without fabricating diagnoses (Rule 6.4).
4. Ingestion Guard (`packages/monitoring/src/snmp/guard.ts`):
   - Bounded payload size, rate-limiting counter, deduplication buffer (Rule 6.5).
5. UDP Receiver Service (`apps/web/lib/monitoring/snmp.ts`):
   - UDP socket listener (port 1162 / 162), disabled by default (`SNMP_RECEIVER_ENABLED=false`).
   - Observation mode without active alerting in this milestone (Rule 6.7).
6. Comprehensive test suite in `packages/monitoring/tests/snmp/` and `apps/web/tests/lib/monitoring/snmp.test.ts`.
