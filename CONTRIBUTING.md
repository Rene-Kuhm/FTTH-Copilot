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

Full command reference: [`AGENTS.md` §3](AGENTS.md#3-comandos).

## Working agreement

### Branches

- Branch from the current `main` unless a maintainer provides another base.
- Keep one coherent outcome per branch and pull request.
- Keep generated, temporary, credential, and local environment files out of the repository.

### Commits — Conventional Commits 1.0.0

Commit messages follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/). The format is:

```
<type>[optional scope]: <description>

[optional body]

[optional footers]
```

**Types.** Use the type that describes the intent of the change, not the file it touches.

| Type | Use it for |
|---|---|
| `feat` | A new capability visible to an operator or a consumer of the package. |
| `fix` | A correction of existing behavior. |
| `docs` | Documentation only. |
| `test` | Adding or correcting tests. |
| `refactor` | A change of internal structure with no behavior change. |
| `perf` | A change that improves a measured characteristic. |
| `build` | Build system, dependencies, or workspace configuration. |
| `ci` | CI configuration and workflows. |
| `chore` | Maintenance that fits no other type (including repository hygiene). |
| `revert` | Reverts a previous commit. |

**Scope.** Use the affected workspace or feature area as the scope: `agent-core`, `monitoring`, `eval`, `db`, `shared`, `web`, `snmp`, `laya`, `security`, `soc`, `research`. Omit the scope only when the change genuinely spans the whole repository.

**Description.** Imperative mood, no trailing period, no longer than one line. Describe what the change does, not the process.

```
fix(agent-core): preserve evidence on timeout
feat(monitoring): decode ZTE power-trap OIDs
docs(readme): document the 3-command local setup
```

**Breaking changes.** Mark them with `!` after the type or scope, and explain them in a `BREAKING CHANGE:` footer.

```
feat(shared)!: rename DecisionEvaluation.route to DecisionEvaluation.routeMode

BREAKING CHANGE: the field was renamed. Consumers must read routeMode.
```

**Footers.** Reference the issue and any co-requisite change.

```
fix(db): apply the unique email index losslessly

Refs: #287
```

Do not add `Co-Authored-By` trailers or AI attribution.

### Atomic commits

One commit carries one logical change, and it is reviewable on its own.

- **A commit must be coherent by itself.** It compiles, its tests pass, and the repository is in a working state with it applied. Do not leave a commit that breaks the build for the next one.
- **Separate the behavior from the cleanup.** A bug fix and an unrelated rename belong in different commits, even when they touch the same file.
- **Keep tests and documentation with the behavior.** A commit that changes behavior and omits the test that proves it is incomplete; a commit that changes behavior and omits the documentation that describes it is also incomplete.
- **Do not mix an intent.** Do not bundle "add endpoint" and "change authentication policy" because they were convenient to write together.
- **Squash deliberately.** When a branch accumulates noise commits, squash them into the logical units they represent — not into one commit that hides the shape of the change.
- **Avoid unrelated churn.** Formatting sweeps, dependency bumps, and regenerated files in the same diff as a feature make the feature harder to review than it needs to be.

### Pull requests

Small pull requests are the main defense against unreviewable changes.

- **One outcome per pull request.** A reviewer should be able to read the description and know exactly what behavior changed.
- **Aim for roughly 400 changed lines of reviewable logic.** Beyond that, split by contract, feature, or fixture — the same rule the repository already applies to OLT contributions ([`docs/roadmap-olt-multivendor.md`](docs/roadmap-olt-multivendor.md)). Generated files, migrations, and large fixtures should not hide code changes in the same diff.
- **Split before you push, not after review.** A chain of focused pull requests is cheaper than one large one that stalls.
- **Link the issue** and state the verification evidence in the description: the exact commands run and their outcome.
- **State what you did not run.** A check that was skipped, blocked by the environment, or failed must be written down with its cause. A check that was not run must not be reported as passing.
- **Say what happens next:** migration order, deployment order, rollback plan, or feature flag, whenever the change has one.

## Implementation expectations

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

## Reviews — Conventional Comments

Review comments follow [Conventional Comments](https://conventionalcomments.org/). The prefix states what kind of feedback it is, so the author can triage without guessing.

| Prefix | Meaning | Expectation |
|---|---|---|
| `praise:` | Something worth keeping, done well. | Optional to act on. |
| `nitpick:` | Trivial, optional, non-blocking. | Author may decline. |
| `suggestion:` | A concrete improvement the author can apply. | Non-blocking unless the reviewer says otherwise. |
| `issue:` | A real defect that must be fixed. | Blocking. |
| `question:` | The reviewer does not understand something and needs an answer. | Author answers. |
| `blocking:` | Something that cannot merge as-is. | Blocking. |

Write the comment so it can be acted on without a follow-up round:

```
suggestion: extract the severity mapping into a shared helper so the
notification channels stop redefining it.

issue: this query filters by tenantId only after the join, so a row from
another tenant can be read before the filter applies.

praise: the new test proves the evidence survives a timeout — exactly the
regression we were chasing.
```

Two repository-level conventions complete the review protocol:

- **Blocking review** — state the outcome as `REQUEST CHANGES` when at least one `issue:` or `blocking:` comment is open, and as `APPROVE` when there are none.
- **Scope of a review** — a reviewer is responsible for the correctness, safety, and evidence quality of the change they review. Unrelated pre-existing problems are reported as separate issues, not as blockers of the current pull request.

## Pull request checklist

Before requesting review, confirm that:

- [ ] The issue and scope were approved by a maintainer.
- [ ] The pull request explains the problem and the resulting behavior.
- [ ] The diff contains no unrelated changes or sensitive data.
- [ ] Commits are atomic and follow Conventional Commits 1.0.0.
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

Diagrams are **Mermaid source inside the Markdown**, never images or screenshots. A diagram that cannot be reviewed in a diff cannot be reviewed at all.
