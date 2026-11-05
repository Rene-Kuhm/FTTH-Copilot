# Enterprise Authentication Guide

FTTH-Copilot supports one authentication method today. The other two exist as libraries only:

| Method | Status | Best for | Setup complexity |
|--------|--------|----------|-----------------|
| Email + Password | **Implemented** | Development / single tenant | Low |
| OIDC / SSO | **Not implemented** — the endpoint returns 501 | Corporate IdPs (Google Workspace, Azure AD, Okta, Keycloak) | — |
| LDAP / Active Directory | **Client and connectivity diagnostic only** — not wired to the login flow | Enterprise with existing AD infrastructure | Medium |

| Method | Best for | Setup complexity |
|--------|----------|-----------------|
| Email + Password | Development / single tenant | Low |
| OIDC / SSO | Corporate IdPs (Google Workspace, Azure AD, Okta, Keycloak) | Medium |
| LDAP / Active Directory | Enterprise with existing AD infrastructure | Medium |

---

## LDAP / Active Directory

LDAP support ships as a **client library and a connectivity diagnostic**. It is **not wired to the login flow**: users do not sign in with their corporate credentials yet, even though group membership maps to FTTH roles. The login route accepts email and password only.

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

### Forcing MFA

To require MFA for all users, set in `.env`:

```env
MFA_REQUIRED=true
```

---

## Combined auth

Today the login page offers one method:
- **Email + Password** — local account

The other two are not selectable: LDAP is not connected to the login flow and OIDC/SSO is not implemented. Enabling `LDAP_ENABLED` or setting `NEXTAUTH_OIDC_ISSUER` does not add them to the login page.

