# Security Policy

FTTH-Copilot processes network telemetry, credentials, tenant-scoped evidence, and operator actions. Security reports must therefore be handled privately and must not expose customer or infrastructure data.

## Report a vulnerability privately

**Do not open a public issue, discussion, or pull request for a suspected vulnerability.**

1. Use GitHub's **Report a vulnerability** action on this repository if it is available to you.
2. If private vulnerability reporting is unavailable, contact the [repository owner](https://github.com/Rene-Kuhm) through a private channel listed on the owner's profile and request a secure reporting channel.
3. Share technical details only after a private channel has been established.

Do not send production credentials, SNMP community strings, private keys, access tokens, subscriber data, complete packet captures, or unredacted operational logs. Use synthetic values and the minimum evidence needed to reproduce the problem.

## What to include

A useful report contains:

- a concise description of the vulnerability and potential impact;
- the affected commit, branch, endpoint, package, or configuration;
- prerequisites and a minimal reproduction using synthetic data;
- observed and expected behavior;
- tenant-isolation, confidentiality, integrity, or availability impact;
- safe supporting evidence, such as redacted logs or a minimal test;
- any known workaround or containment step;
- whether the issue has been disclosed anywhere else.

Please avoid destructive proof-of-concept activity. A deterministic test or bounded reproduction is preferred over extraction, persistence, lateral movement, or service disruption.

## Scope

Security-relevant areas include, but are not limited to:

- authentication, session revocation, authorization, and role enforcement;
- cross-tenant reads, writes, inference context, caching, or evidence references;
- secret storage, KMS usage, log redaction, and credential exposure;
- SSRF, unsafe outbound NMS connections, and cloud metadata access;
- prompt injection that bypasses deterministic controls or exposes protected data;
- TruthGate, provenance, or evidence-integrity bypasses;
- SNMP, syslog, ASN.1, webhook, and vendor payload parsing;
- denial of service, unbounded queues, replay, or rate-limit bypass;
- dependency, build, CI, deployment, container, and supply-chain weaknesses;
- unsafe defaults that could enable production demo data or active network changes.

Reports about third-party services should identify the FTTH-Copilot integration behavior that creates the risk. Availability problems without a security impact, feature requests, and unsupported deployment changes may be redirected to the normal issue process.

## Supported versions

The project does not currently publish a stable release line or long-term support matrix. Security reports are assessed against the latest code on `main`. Older snapshots, forks, and modified deployments may no longer reflect current controls.

This statement is not a promise that `main` is suitable for production. Deployment suitability depends on the documented configuration, authorized field validation, and the operator's own risk assessment.

## Response process

The maintainers will handle reports through the established private channel and will, as appropriate:

1. confirm receipt and request missing reproduction details;
2. validate impact without exposing reporter or operator data;
3. classify affected components and containment options;
4. prepare and verify a correction;
5. coordinate disclosure after affected users have a reasonable path to remediation.

Response and remediation times depend on severity, reproducibility, affected environments, and coordination needs. This repository does not promise a fixed service-level agreement.

## Coordinated disclosure

Please keep the report private until the repository owner confirms that disclosure is safe. Public credit can be coordinated with the reporter, but no attribution or disclosure details will be published without agreement.

The owner may request additional time when a correction requires vendor coordination, field equipment, migration work, or validation across multiple OLT families. The goal is to disclose enough information for operators to act without publishing unnecessary exploitation detail.

## Safe research boundaries

Authorization to view this repository is not authorization to test a live deployment, ISP, OLT, NMS, tenant, user account, or third-party service.

Do not:

- access or modify data that is not yours;
- test against production systems without the operator's written permission;
- degrade service, exhaust resources, or trigger network changes;
- retain or redistribute secrets, personal data, packet captures, or proprietary vendor material;
- use social engineering, physical attacks, or credential stuffing;
- publish an unpatched vulnerability or operational exploit path.

Use a local environment, synthetic fixtures, and documentation address ranges wherever possible. Stop testing and report immediately if you encounter real customer data or credentials.

## Operational security guidance

Repository users remain responsible for secure deployment. At minimum:

- keep `DEMO_MODE_ENABLED=false` in production;
- configure strong, unique secrets and protect `KMS_MASTER_KEY`;
- restrict NMS egress and explicitly control private-network access;
- expose SNMP and syslog listeners only on authorized management networks;
- enable authentication for metrics where the endpoint is reachable outside a trusted boundary;
- apply database migrations and dependency updates through reviewed workflows;
- monitor audit records, collector health, rejected events, and rate limits;
- never commit `.env` files, credentials, or production captures.

See [`README.md`](README.md#seguridad-y-políticas-de-aislamiento) for the current control summary and [`docs/security-audit.md`](docs/security-audit.md) for the repository's technical audit record.

## License

This policy does not grant permission to copy, modify, use, or distribute FTTH-Copilot. The proprietary terms in [`LICENSE`](LICENSE) remain authoritative.
