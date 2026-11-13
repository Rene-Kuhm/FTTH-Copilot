# Enterprise Authentication Guide

FTTH-Copilot supports three authentication methods today:

| Method | Status | Best for | Setup complexity |
|--------|--------|----------|-----------------|
| Email + Password | **Implemented** | Development / single tenant | Low |
| OIDC / SSO | **Implemented** (Authorization Code + PKCE S256) | Corporate IdPs (Google Workspace, Azure AD / Entra ID, Keycloak, Okta) | Medium |
| LDAP / Active Directory | **Implemented** — wired to `/api/auth/login` and `/api/auth/ldap/login` | Enterprise with existing AD infrastructure | Medium |

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

FTTH-Copilot implements **OAuth 2.0 Authorization Code + PKCE (S256)** via `openid-client`, issuing the same revocable `ftth_session` cookie and CSRF token as local login.

- **Start flow:** `GET /api/auth/oidc/login`
- **Callback:** `GET /api/auth/oidc/callback`
- **Scope v1:** single IdP per installation bound to one tenant (`OIDC_TENANT_SLUG`).
- **Identity resolution:** matches `(issuer, subject)` in `UserIdentity`; on first login, links to an existing tenant user only when `email_verified === true` and the domain is in `OIDC_ALLOWED_EMAIL_DOMAINS`, or auto-provisions if `OIDC_AUTO_PROVISION=true`.
- **MFA:** if the user has TOTP enabled locally, TOTP verification is still required after the OIDC callback.

### Environment variables

```env
OIDC_ENABLED=true
OIDC_ISSUER=https://idp.example.com/realms/ftth
OIDC_CLIENT_ID=<from your IdP>
OIDC_CLIENT_SECRET=<from your IdP>
OIDC_REDIRECT_URI=https://ftth.example.com/api/auth/oidc/callback
OIDC_TENANT_SLUG=demo-isp
OIDC_ALLOWED_EMAIL_DOMAINS=example.com
OIDC_AUTO_PROVISION=false
OIDC_ROLE_CLAIM=groups
OIDC_ROLE_MAP=noc-admins:ADMIN,noc-ops:OPERATOR
```

When `OIDC_ENABLED=true`, all required variables are validated with Zod at server startup; missing or invalid values fail fast.

### Provider setup

#### Google Workspace

1. In Google Cloud Console → **APIs & Services → Credentials**, create an **OAuth 2.0 Client ID** (Web application).
2. Add Authorized redirect URI: `https://ftth.example.com/api/auth/oidc/callback`.
3. Configure:
   ```env
   OIDC_ENABLED=true
   OIDC_ISSUER=https://accounts.google.com
   OIDC_CLIENT_ID=<google-client-id>
   OIDC_CLIENT_SECRET=<google-client-secret>
   OIDC_REDIRECT_URI=https://ftth.example.com/api/auth/oidc/callback
   OIDC_TENANT_SLUG=your-tenant-slug
   OIDC_ALLOWED_EMAIL_DOMAINS=yourcompany.com
   OIDC_AUTO_PROVISION=false
   ```

#### Microsoft Entra ID (Azure AD)

1. In **Microsoft Entra ID → App registrations → New registration**, set redirect URI (Web) to `https://ftth.example.com/api/auth/oidc/callback`.
2. Under **Token configuration**, add the **groups** claim (if mapping roles via `OIDC_ROLE_MAP`).
3. Configure:
   ```env
   OIDC_ENABLED=true
   OIDC_ISSUER=https://login.microsoftonline.com/<tenant-id>/v2.0
   OIDC_CLIENT_ID=<application-client-id>
   OIDC_CLIENT_SECRET=<client-secret-value>
   OIDC_REDIRECT_URI=https://ftth.example.com/api/auth/oidc/callback
   OIDC_TENANT_SLUG=your-tenant-slug
   OIDC_ALLOWED_EMAIL_DOMAINS=yourcompany.com
   OIDC_ROLE_CLAIM=groups
   OIDC_ROLE_MAP=<group-object-id>:ADMIN,<ops-group-id>:OPERATOR
   ```

#### Keycloak (including local dev profile)

1. Start the synthetic dev Keycloak with `docker compose --profile oidc up -d keycloak` (imports `docker/keycloak/ftth-realm.json` on port `8085`).
2. Configure:
   ```env
   OIDC_ENABLED=true
   OIDC_ISSUER=http://localhost:8085/realms/ftth-demo
   OIDC_CLIENT_ID=ftth-copilot-web
   OIDC_CLIENT_SECRET=ftth-dev-oidc-secret
   OIDC_REDIRECT_URI=http://localhost:3001/api/auth/oidc/callback
   OIDC_TENANT_SLUG=demo
   OIDC_ALLOWED_EMAIL_DOMAINS=ftth-demo.example
   OIDC_AUTO_PROVISION=true
   OIDC_ROLE_CLAIM=groups
   OIDC_ROLE_MAP=noc-admins:ADMIN,noc-ops:OPERATOR
   # Only for development/E2E with a local http:// loopback IdP; NEVER enable in production.
   OIDC_ALLOW_INSECURE_LOOPBACK_ISSUER=true
   ```

### Planned work (v2)

- **Per-tenant OIDC configuration:** storing IdP settings in PostgreSQL with `clientSecret` encrypted via the `@ftth-copilot/db` KMS (instead of installation-wide env vars).
- **IdP MFA trust (`amr` claim):** optionally trusting the `amr` (`mfa`) claim from the IdP to skip the local TOTP prompt.

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
- **OIDC / SSO (`GET /api/auth/oidc/login` + `GET /api/auth/oidc/callback`):** when `OIDC_ENABLED=true`, the login page also offers **Ingresar con SSO** using Authorization Code + PKCE S256.

