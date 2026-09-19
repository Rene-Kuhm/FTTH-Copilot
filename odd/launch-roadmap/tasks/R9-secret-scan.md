# Task: R9 — Secret scanning and credential rotation

## Parent

`launch-roadmap.md`

## Status

done — 2026-09-20

## What

Review repository history with secret scanning and document credential rotation.

## Details

- Run `git secrets` or equivalent scan on the full history.
- Check for any leaked credentials in commits.
- Document the credential rotation procedure.
- If any leaks found: rotate immediately and document as a security fix.

## Deliverable

Scan report, any rotated credentials documented, `SECURITY.md` updated.
