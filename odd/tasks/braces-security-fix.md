# Task: Monitor `braces` DoS Fix

**ID**: BRACES-1
**Status**: pending
**Created**: 2026-10-05
**Priority**: high

## Problem

`braces@3.0.3` es vulnerable a stack-exhaustion DoS (GHSA-vfj7-8cjw-p6xm).

- **Vulnerable**: `<=3.0.3`
- **Patched**: `>=3.0.4` (not released yet)
- **Impact**: Transitivo vía `fast-glob` → `micromatch` → `braces`

## Current State

Override temporal en `.npmrc` aplicado para `brace-expansion` (vulnerable también, pero fix disponible).

No se puede parchear `braces` porque `>=3.0.4` no existe en npm.

## Action

Checkear periódicamente hasta que salga el fix:

```bash
npm view braces versions --json | grep -E '"3\.0\.[4-9]'
```

Cuando esté disponible:

1. Agregar override en `.npmrc`:
   ```
   override:braces>=3.0.4
   ```

2. Regenerar lockfile:
   ```bash
   rm pnpm-lock.yaml && pnpm install
   ```

3. Verificar:
   ```bash
   pnpm why braces  # debe mostrar >=3.0.4
   pnpm audit       # no debe mostrar braces
   ```

4. Commit:
   ```bash
   git add .npmrc pnpm-lock.yaml
   git commit -m 'fix(deps): override braces to >=3.0.4 (patch DoS)'
   ```

5. Abrir PR y merge

## Links

- [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
- [braces npm](https://www.npmjs.com/package/braces)
