# Contributing to FTTH-Copilot

Thank you for your interest in improving FTTH-Copilot. Contributions are reviewed against operational safety, evidence quality, tenant isolation, and the repository's proprietary licensing model.

## Before you contribute

FTTH-Copilot is **not an open-source project**. Public access is provided for technical review and evaluation; it does not grant permission to copy, modify, or distribute the software.

Before preparing code or documentation:

1. Read [`LICENSE`](LICENSE).
2. Open an issue that describes the problem, intended outcome, and evidence.
3. Wait for explicit written approval from the repository owner or a maintainer.
4. Confirm any contribution or licensing terms that apply to your work.

This guide does not grant rights to the software and does not replace a separate written agreement. Unsolicited pull requests may be closed without review.

## Choose the right contribution path

### General product or maintenance change

Use the repository's issue templates when proposing a bug fix, product change, documentation update, or maintenance task. Keep the scope narrow enough to verify independently.

Your proposal should include:

- the operator or engineering problem;
- the expected behavior;
- affected packages, applications, or documents;
- security and multi-tenant implications;
- a verification plan;
- migration or rollback needs, when applicable.

### SNMP source, capture, or OLT adapter

Use the dedicated **SNMP Source or Capture Contribution** issue template and follow [`docs/contributing-snmp.md`](docs/contributing-snmp.md). These contributions require provenance, licensing information, sanitization, fixtures, and conformance evidence.

Never upload raw operational captures. Remove community strings, authentication material, IP and MAC addresses, subscriber data, circuit identifiers, hostnames, and unique serial payloads before sharing any artifact.

## Development setup

### Requirements

- Node.js 22 or newer
- pnpm 11 or newer
- PostgreSQL 16 or newer, or Docker with Docker Compose

### Local environment

```bash
pnpm install
pnpm run setup
pnpm dev
```

The setup assistant creates local configuration, applies database migrations, and seeds the development tenant. Do not reuse development credentials or generated secrets in a production environment.

## Working agreement

### Branches and commits

- Branch from the current `main` unless a maintainer provides another base.
- Keep one coherent outcome per branch and pull request.
- Use conventional commit messages, for example `fix(agent-core): preserve evidence on timeout`.
- Do not add `Co-Authored-By` trailers or AI attribution.
- Keep generated, temporary, credential, and local environment files out of the repository.

### Implementation expectations

- Preserve strict tenant boundaries in every query, event, cache key, and persisted reference.
- Prefer deterministic calculations for facts and measurements; use language models only for bounded interpretation.
- Keep source evidence and provenance attached to vendor-specific behavior.
- Do not introduce active SNMP remediation or network writes without explicit design approval.
- Add or update tests with the behavior they protect.
- Update user-facing and operational documentation in the same change.
- Avoid unrelated formatting, refactoring, dependency, or generated-file churn.

### Data and fixtures

Only synthetic or fully sanitized data may be committed. Use documentation address ranges, fabricated tenant identifiers, and non-production credentials. If you cannot prove an artifact is safe to publish, do not attach it.

For SNMP material, use the repository sanitizer and then inspect the output manually:

```bash
pnpm sanitize:snmp -- <input> <output>
```

Sanitization reduces risk; it does not transfer responsibility for reviewing the artifact before publication.

## Verification

Run the smallest relevant checks while developing, then run the applicable repository checks before requesting review:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage-check
pnpm build
```

Run end-to-end tests when the user journey, API behavior, authentication, or persistence changes:

```bash
pnpm test:e2e
```

SNMP and OLT contributions also require:

```bash
pnpm check:sources
pnpm check:conflicts
pnpm check:contribution
pnpm test:conformance
```

Record every failed, skipped, or environment-blocked check in the pull request. A check that was not run must not be reported as passing.

## Pull request checklist

Before requesting review, confirm that:

- [ ] The issue and scope were approved by a maintainer.
- [ ] The pull request explains the problem and the resulting behavior.
- [ ] The diff contains no unrelated changes or sensitive data.
- [ ] Tests and documentation cover the changed behavior.
- [ ] Tenant isolation and authorization were considered.
- [ ] Database, configuration, deployment, and rollback effects are documented.
- [ ] Verification evidence lists exact commands and outcomes.
- [ ] Vendor evidence includes source, license, model, firmware, and confidence level where relevant.
- [ ] The change complies with [`LICENSE`](LICENSE).

Maintainers may request a smaller scope, additional evidence, security review, field validation, or changes to the delivery sequence before accepting a contribution.

## Security reports

Do not report suspected vulnerabilities in a public issue or pull request. Follow [`SECURITY.md`](SECURITY.md) and establish a private reporting channel before sharing exploit details, secrets, customer data, or operational identifiers.

## Documentation

Documentation should lead with the reader's outcome, distinguish current behavior from planned work, and link claims to evidence. Keep public product positioning in [`README.md`](README.md) and [`ROADMAP.md`](ROADMAP.md); place detailed engineering records under [`docs/`](docs/).
