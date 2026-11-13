# Enterprise Authentication Guide

FTTH-Copilot supports one authentication method today. The other two exist as libraries only:

| Method | Status | Best for | Setup complexity |
|--------|--------|----------|-----------------|
| Email + Password | **Implemented** | Development / single tenant | Low |
| OIDC / SSO | **Not implemented** — the endpoint returns 501 | Corporate IdPs (Google Workspace, Azure AD, Okta, Keycloak) | — |
| LDAP / Active Directory | **Implemented** — wired to `/api/auth/login` and `/api/auth/ldap/login` | Enterprise with existing AD infrastructure | Medium |

| Method | Best for | Setup complexity |
|--------|----------|-----------------|
| Email + Password | Development / single tenant | Low |
| OIDC / SSO | Corporate IdPs (Google Workspace, Azure AD, Okta, Keycloak) | Medium |
| LDAP / Active Directory | Enterprise with existing AD infrastructure | Medium |

---

## LDAP / Active Directory

LDAP authentication is wired to `POST /api/auth/ldap/login` (using corporate `username` + `password`) and as a fallback in `POST /api/auth/login` when `LDAP_ENABLED=true`. Directory groups are mapped to FTTH-Copilot roles via shared `mapGroupsToRole()` (`@ftth-copilot/security`), and users are provisioned or updated in the tenant configured by `LDAP_TENANT_SLUG`.

### How it works

1. Service account (bind DN) authenticates to LDAP/AD to search for the user
2. User's entry is located via `LDAP_USER_FILTER`
3. FTTH binds as the user to verify the password
4. Group memberships (`memberOf`) are extracted and mapped to FTTH roles
5. FTTH creates or updates the user record in the local database

### Configuration

Set these environment variables:

```env
# Enable LDAP
LDAP_ENABLED=true
LDAP_TENANT_SLUG=demo-isp

# Server
LDAP_URL=ldap://ldap.example.com:389
# For LDAPS (TLS):
LDAP_URL=ldaps://ldap.example.com:636

# Service account (must have read access to user search base)
LDAP_BIND_DN=cn=ftth-ro,ou=service,dc=example,dc=com
LDAP_BIND_PASSWORD=service_account_password

# User search
LDAP_SEARCH_BASE=ou=users,dc=example,dc=com

# Filter to find users (use {username} as placeholder)
# For OpenLDAP:
LDAP_USER_FILTER=(uid={username})
# For Active Directory:
LDAP_USER_FILTER=(sAMAccountName={username})

# Attribute mapping
LDAP_EMAIL_ATTR=mail
LDAP_NAME_ATTR=cn
LDAP_GROUP_ATTR=memberOf

# Role mapping (LDAP group CN -> FTTH role)
LDAP_ROLE_MAP=CN=NOC-Admins:OWNER,CN=NOC-Ops:ADMIN,CN=NOC-Members:OPERATOR
```

### Role mapping

The default mapping:

| LDAP Group (CN) | FTTH Role |
|-----------------|-----------|
| `CN=NOC-Admins,OU=Groups,...` | OWNER |
| `CN=NOC-Ops,OU=Groups,...` | OPERATOR |
| `CN=NOC-Members,OU=Groups,...` | MEMBER |

Higher roles take precedence. If a user belongs to multiple groups, the highest-privilege role wins.

### Diagnostic endpoint

Admins can test LDAP connectivity without authenticating:

```
GET /api/auth/ldap-test
```

Requires OWNER or ADMIN role. Returns:

```json
{ "ok": true, "details": "Connected to ldap://... as cn=ftth-ro,... | Search base: ou=users,dc=example,dc=com" }
```

### First login

On first LDAP login, FTTH-Copilot creates a local user record linked to the LDAP DN. Subsequent logins update the local record with current group memberships.

---

## OIDC / SSO

Configure NextAuth to use a generic OIDC provider:

> [!WARNING]
> **OIDC / SSO is not implemented.** `apps/web/app/api/auth/[...nextauth]/route.ts` returns **501** and no `next-auth` dependency is installed. The variables below are the ones a future implementation would read; setting them today does not enable SSO.
```env
NEXTAUTH_URL=https://ftth.example.com
NEXTAUTH_SECRET=<generate with: openssl rand -base64 32>

NEXTAUTH_OIDC_ISSUER=https://accounts.google.com
NEXTAUTH_OIDC_CLIENT_ID=<from your IdP>
NEXTAUTH_OIDC_CLIENT_SECRET=<from your IdP>
```

IdPs a future implementation would target:
- Google Workspace
- Azure Active Directory
- Okta
- Keycloak
- Auth0
- Any OIDC-compliant provider

---

## MFA / TOTP

After login, users can enable TOTP-based MFA in **Configuración → Seguridad**.

Requires any TOTP-compatible app (Google Authenticator, Authy, 1Password, etc.).

### Mandatory MFA per tenant

`OWNER` or `ADMIN` users can enforce TOTP MFA for every user in their tenant via `TenantPolicy.requireMfa`:

```http
GET /api/security/mfa-policy
PUT /api/security/mfa-policy
Content-Type: application/json

{ "requireMfa": true }
```

When `requireMfa` is `true` for a tenant:
- Users who have not enrolled TOTP receive `403` with `code: "MFA_SETUP_REQUIRED"` and a short-lived `tempToken` (usable with `POST /api/auth/mfa/setup` via `Authorization: Bearer <tempToken>` and `POST /api/auth/mfa/verify`).
- Each `tempToken` is single-use once MFA verification succeeds and is locked after **5 invalid TOTP attempts** on `POST /api/auth/mfa/verify` (tracked per token in `auth_rate_limits` until token expiry; subsequent attempts with that `tempToken` return `401`, even with a valid code).
- `POST /api/auth/mfa/disable` rejects requests with `403` so users cannot disable MFA while the tenant policy requires it.

---

## Combined auth

- **Email + Password (`POST /api/auth/login`):** authenticates local accounts and falls back to LDAP when `LDAP_ENABLED=true`.
- **LDAP / Active Directory (`POST /api/auth/ldap/login`):** authenticates corporate `username` + `password` against `LDAP_URL`, provisions/syncs the user in `LDAP_TENANT_SLUG`, and enforces user and tenant MFA policies.
- **OIDC / SSO:** not implemented on this branch (see Phase 1).

