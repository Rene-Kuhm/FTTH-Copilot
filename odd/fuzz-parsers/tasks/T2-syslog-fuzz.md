# T2 — Fuzz de syslog (`packages/security`)

**Feature**: `odd/tasks/fuzz-parsers.md`
**Specs**: S1, S3, S4, S5
**Ruta**: worker

## Qué hacer

Suite de fuzzing sobre la superficie syslog de `packages/security`:

- `parseSyslogMessage(line: string): ParsedSyslog | null`
  (`packages/security/src/syslog.ts:30`): RFC 3164 y RFC 5424, prioridad `<0..191>`,
  facility 0..23, severity 0..7, timestamp, hostname, tag, mensaje.
- `extractSourceIpFromMessage(message: string, fallback?: string | null)`
  (`packages/security/src/source-ip.ts:49`).
- `buildSyslogMessage` (`packages/security/src/syslog-build.ts:14`) si aporta casos de
  borde propios.

Cada entrada fuzzeada debe cumplir: o devuelve un resultado con los invariantes de
rango, o devuelve `null`, o lanza una excepción de las permitidas. Cualquier otra
excepción es un crash a reportar.

Guardas obligatorias:

- **ReDoS**: `IPV4_RE` (`source-ip.ts:31-32`) es el candidato real de backtracking
  catastrófico. Suite dedicada con payloads patológicos (runs largos de dígitos,
  puntos, espacios) y `expectWithinDeadline`.
- **Crash**: entradas arbitrarias que hoy podrían producir `TypeError`/`RangeError`
  por campos `undefined`/no-numéricos.
- **Fuga**: el mensaje de error o el resultado no deben contener el marcador sintético
  embebido en la entrada.

Corpus semilla sintético en `packages/security/tests/fuzz/corpus/`: IPs de
documentación (`192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24`), mensajes RFC 3164
y RFC 5424, líneas truncadas, prioridades fuera de rango y payloads patológicos.

## Superficie de edición permitida

- `packages/security/tests/**` (suite y corpus)
- `packages/security/package.json` (script `test:fuzz`)

## Fuera de superficie

No tocar `packages/security/src/**`. No tocar superficies protegidas. No commitear.

## Criterios de aceptación

- `pnpm --filter @ftth-copilot/security test:fuzz` pasa.
- La suite corre con `FUZZ_SEED` por defecto determinista y con `FUZZ_PATH` reproduce
  el caso exacto.
- El corpus semilla se carga y se ejecuta en cada corrida.
