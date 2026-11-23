# Fuzz testing de parsers y bordes de entrada

**Status**: In Progress (T1 en curso)
**Created**: 2026-11-23
**Branch**: `test/fuzz-parsers`
Fuzzing de parsers y bordes de entrada del monorepo con `fast-check`: syslog,
SNMP traps/OIDs, payloads de conectores y rutas API. Busca crashes, hangs,
ReDoS y fugas, con corpus semilla sintético y reproducción determinista por seed.

## Specs

- **S1** — "25 Fuzz testing: fuzzing de parsers y bordes de entrada (syslog, SNMP
  traps/OIDs, payloads de conectores validados con Zod, rutas API)."
- **S2** — "Usá fast-check o jazzer.js según convenga".
- **S3** — "buscá crashes, hangs, ReDoS y fugas".
- **S4** — "Incluí corpus semilla sintético y reproducción determinista por seed".
- **S5** — "solo fixtures sintéticos (IPs de documentación, tenants inventados), nada
  de datos reales ni secretos".
- **S6** — "no edites superficies protegidas (packages/db/prisma/migrations,
  packages/db/src/generated, research/olt, docs/compatibility-matrix.md,
  packages/eval, golden snapshots, openspec/changes/archive, LICENSE)".
- **S7** — "Todo tenant-aware."
- **S8** — "Si necesitás una dependencia de dev, agregala solo al workspace que la usa
  y justificá."
- **S9** — "Instalá con 'pnpm install --frozen-lockfile --prefer-offline' (si hay que
  cambiar el lockfile, hacelo mínimo)."
- **S10** — "Entregá: pruebas que corran de verdad y pasen (o un fallo real reportado
  con causa exacta, sin ocultarlo), un script/target documentado para correrlas, y
  docs breves en el mismo commit."
- **S11** — "Commit(s) atómicos con Conventional Commits, SIN Co-Authored-By ni
  atribución de IA, SIN push."
- **S12** — "Al final escribí REPORT.md en la raíz del worktree (sin commitear) con:
  qué se agregó, comandos para correrlo, resultados medidos reales, hallazgos/bugs
  encontrados, y qué quedó sin hacer."

## Tasks

| ID | Specs | Ruta | Commit |
|---|---|---|---|
| T1 — Harness compartido `packages/fuzz-harness` (contrato de seed/ruta/corpus, guardia de deadline, guarda anti-crash) + wiring de turbo y del script raíz | S2, S3, S4, S8, S9 | worker | pendiente |
| T2 — Suite de fuzz de syslog en `packages/security` (RFC 3164/5424, `extractSourceIpFromMessage`) + corpus semilla + payloads patológicos ReDoS | S1, S3, S4, S5 | worker | pendiente |
| T3 — Suite de fuzz de SNMP en `packages/monitoring` (OID/PEN, decoder, guard, sanitizer, normalización tenant-aware) + corpus semilla | S1, S3, S4, S5, S7 | worker | pendiente |
| T4 — Suite de fuzz de payloads de conectores (`connectors-smartolt` + `connectors-mikrowisp`) + corpus semilla | S1, S3, S4, S5 | worker | pendiente |
| T5 — Suite de fuzz de rutas API en `apps/web` (rutas con validación Zod sin cobertura) + corpus semilla | S1, S3, S4, S5, S7 | worker | pendiente |
| T6 — Docs breves (`docs/fuzzing.md` + enlace desde la doc de testing) + `REPORT.md` sin commitear | S10, S12 | worker + coordinator | pendiente |

- [ ] T1
- [ ] T2
- [ ] T3
- [ ] T4
- [ ] T5
- [ ] T6

## Log

- **L1** (usuario, 2026-11-23): "25 Fuzz testing: fuzzing de parsers y bordes de entrada
  (syslog, SNMP traps/OIDs, payloads de conectores validados con Zod, rutas API). Usá
  fast-check o jazzer.js según convenga; buscá crashes, hangs, ReDoS y fugas. Incluí
  corpus semilla sintético y reproducción determinista por seed."
- **L2** (evidencia, mapa de superficies): los conectores SmartOLT y Mikrowisp **no**
  usan Zod: validan a mano en `packages/connectors/{smartolt,mikrowisp}/src/schemas.ts`
  y lanzan `SmartoltResponseShapeError` / `MikrowispResponseShapeError`. Zod vive en
  `packages/shared`, `packages/monitoring`, `packages/api-contract` y `apps/web`. La
  spec S1 se cumple fuzzeando (a) la validación manual de los conectores y (b) las rutas
  API con `z.object(...).safeParse(...)`, que es donde el pedido de "validados con Zod"
  realmente aplica.
- **L3** (decisión técnica): se usa `fast-check`, no `jazzer.js`. Razón: las superficies
  objetivo son funciones puras de TypeScript, `fast-check` da shrinking, corpus y
  replay por seed dentro de Vitest sin toolchain nativo, y `jazzer.js` exige
  cobertura guiada por instrumentación con `libFuzzer` — beneficio marginal para
  parsers deterministas y costo de CI alto. El corpus semilla y el replay por
  `FUZZ_SEED` + `FUZZ_PATH` cubren la parte de "fuzzing" que `jazzer.js` daría.
- **L4** (evidencia, ReDoS): el candidato real de backtracking catastrófico es
  `IPV4_RE` en `packages/security/src/source-ip.ts:31-32`: alternación solapada
  (`25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9]`) dentro de un grupo `{3}`. Los regex
  de `packages/shared/src/injection.ts` y `redaction.ts` usan cuantificadores acotados
  sin anidamiento: no son candidatos catastróficos, pero se cubren igual con deadline.
- **L5** (evidencia, superficie SNMP): no existe un decoder BER de bytes puros
  exportado; `decodeSnmpTrap` (`packages/monitoring/src/snmp/decoder.ts:73`) recibe el
  objeto ya parseado de `net-snmp` y tipa la entrada como `unknown`, así que el fuzz
  estructural de objetos arbitrarios es la vía correcta. `extractCommunityFromSnmpBuffer`
  es privado de `receiver.ts:95`.
- **L6** (decisión técnica): el contrato de fuzzing (semilla, ruta de reproducción,
  corridas, corpus, deadline) vive en un workspace dev-only nuevo
  `packages/fuzz-harness`, consumido como `devDependency` por los cinco workspaces que
  tienen suite. Motivo: una sola definición autoritativa de "reproducción determinista
  por seed" en vez de cinco copias que derivan. No agrega dependencias de runtime ni
  toca superficies protegidas.
- **L7** (decisión técnica): "fuga" se operacionaliza en tres formas verificables:
  (a) marcador sintético que aparece en el error o en la respuesta; (b) amplificación
  de tamaño —salida desproporcionada respecto de la entrada—; (c) datos cruzados
  entre tenants. No se interpreta "fuga" como fuga de memoria: los parsers son puros y
  no retienen estado entre entradas.
