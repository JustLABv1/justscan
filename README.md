# JustScan

A self-hosted Docker image vulnerability scanner powered by [Trivy](https://github.com/aquasecurity/trivy).

## Architecture

| Service | Tech | Default Port |
|---|---|---|
| Backend | Go (Gin) | `8080` |
| Frontend | Next.js | `3000` |
| Database | PostgreSQL 15+ | `5432` |

---

## Quick Start

### Prerequisites

- Go 1.22+
- Node.js 20+ / pnpm
- PostgreSQL 15+
- [Trivy](https://trivy.dev/latest/getting-started/installation/) installed and on `$PATH`

### 1. Database

Create a database and user:

```sql
CREATE DATABASE justscan;
CREATE USER justscan WITH PASSWORD 'yourpassword';
GRANT ALL PRIVILEGES ON DATABASE justscan TO justscan;
```

### 2. Backend configuration

Copy and edit the config file:

```bash
cp services/backend/config/config.yaml services/backend/config/config.local.yaml
```

Edit `config.yaml` with your values (see [Configuration Reference](#configuration-reference) below).

### 3. Start the backend

```bash
cd services/backend
go run main.go
```

### 4. Start the frontend

```bash
cd services/frontend
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and register the first user.

If you plan to use OIDC, configure it before first login using the section below. When `local_auth.enabled` is set to `false`, the `/login` and `/register` password-based endpoints are disabled and users must sign in through your OIDC provider.

---

## Configuration Reference

`services/backend/config/config.yaml`

### Required fields

| Key | Description | Example |
|---|---|---|
| `jwt.secret` | **Required.** Secret key used to sign and verify JWT tokens. Must be a long random string. If `null` or empty, authentication will fail. | `"a-very-long-random-secret-key-32chars"` |
| `database.server` | PostgreSQL host | `localhost` |
| `database.port` | PostgreSQL port | `5432` |
| `database.name` | Database name | `justscan` |
| `database.user` | Database user | `postgres` |
| `database.password` | Database password | `postgres` |

### Optional fields

| Key | Description | Default |
|---|---|---|
| `port` | HTTP listen port | `8080` |
| `log_level` | Log verbosity: `debug`, `info`, `warn`, `error` | `info` |
| `allow_origins` | CORS allowed origins (list) | `["http://localhost:3000"]` |
| `scanner.trivy_path` | Path to Trivy binary | `trivy` |
| `scanner.timeout` | Max scan duration in seconds | `600` |
| `scanner.concurrency` | Number of concurrent scans | `2` |
| `scanner.db_max_age_hours` | Maximum age of each Trivy DB before JustScan refreshes it automatically | `24` |
| `scanner.enable_osv_java_augmentation` | Query the free OSV API for additional Maven/Java advisories and merge them into scan results | `true` |
| `encryption.key` | Key for encrypting registry credentials at rest. Should be a 32-char string. | `""` |
| `vuln_kb.nvd_api_key` | NVD API key for enriched CVE data (optional, see [Getting an NVD API key](#getting-an-nvd-api-key)) | `""` |
| `vuln_kb.cache_days` | How long to cache NVD data | `7` |
| `oidc.enabled` | Enable OIDC single sign-on | `false` |
| `oidc.issuer_url` | OIDC issuer URL from your provider | `""` |
| `oidc.client_id` | OIDC client ID | `""` |
| `oidc.client_secret` | OIDC client secret. Prefer an environment variable in production. | `""` |
| `oidc.redirect_uri` | Public backend callback URL registered in your OIDC provider | `""` |
| `oidc.scopes` | Requested OIDC scopes | `["openid", "email", "profile"]` |
| `oidc.admin_groups` | Group names that should map to the JustScan `admin` role | `[]` |
| `oidc.admin_roles` | Role names that should map to the JustScan `admin` role | `[]` |
| `oidc.groups_claim` | Claim name containing group memberships | `"groups"` |
| `oidc.roles_claim` | Claim name containing role memberships | `"roles"` |
| `local_auth.enabled` | Keep local username/password auth enabled alongside OIDC | `true` |

### Example `config.yaml`

```yaml
log_level: info
port: 8080

database:
  server: localhost
  port: 5432
  name: justscan
  user: postgres
  password: postgres

jwt:
  secret: "replace-this-with-a-long-random-secret-minimum-32-characters"

allow_origins:
  - "http://localhost:3000"

scanner:
  trivy_path: trivy
  timeout: 600
  concurrency: 2
  db_max_age_hours: 24
  enable_osv_java_augmentation: true

encryption:
  key: "replace-with-32-char-encryption-key"

vuln_kb:
  nvd_api_key: ""
  cache_days: 7

oidc:
  enabled: false
  issuer_url: ""
  client_id: ""
  client_secret: ""
  redirect_uri: ""
  scopes: ["openid", "email", "profile"]
  admin_groups: []
  admin_roles: []
  groups_claim: "groups"
  roles_claim: "roles"

local_auth:
  enabled: true
```

## OIDC Configuration

JustScan supports OpenID Connect providers such as Keycloak, Authentik, Okta, Azure AD, and Google Workspace.

### What to configure

Set these values in `services/backend/config/config.yaml` or via `BACKEND_...` environment variables:

```yaml
oidc:
  enabled: true
  issuer_url: "https://auth.example.com/application/o/justscan/"
  client_id: "justscan"
  client_secret: "replace-me"
  redirect_uri: "https://scan.example.com/api/v1/auth/oidc/callback"
  scopes: ["openid", "email", "profile"]
  admin_groups:
    - "justscan-admins"
  admin_roles: []
  groups_claim: "groups"
  roles_claim: "roles"

local_auth:
  enabled: true
```

### Required URLs

- `oidc.redirect_uri` must be the public backend callback URL and must exactly match the redirect URI registered in your OIDC provider.
- The frontend URL must be listed in `allow_origins`.
- Put your primary frontend URL first in `allow_origins`. After a successful OIDC login, JustScan redirects the browser to the first `allow_origins` entry plus `/auth/oidc/callback`.

Example:

```yaml
allow_origins:
  - "https://scan.example.com"

oidc:
  redirect_uri: "https://scan.example.com/api/v1/auth/oidc/callback"
```

### Role mapping

- Users are granted the JustScan `admin` role when any entry in `oidc.admin_groups` matches the configured `groups_claim`.
- Users are also granted the JustScan `admin` role when any entry in `oidc.admin_roles` matches the configured `roles_claim`.
- Role mapping is evaluated on every OIDC login. Removing a user from the configured group or role removes their JustScan admin privileges on their next login.

### User provisioning behavior

- If a user signs in through OIDC for the first time and no account exists for the OIDC `sub` claim, JustScan checks for an existing local account with the same email address.
- If the email matches an existing local account, JustScan automatically links that account to the OIDC identity.
- If no matching email exists, JustScan creates a new local user record automatically.
- OIDC-created users do not use a local password.

### Local auth and OIDC together

- `local_auth.enabled: true`: both local login and OIDC login are available.
- `local_auth.enabled: false`: users must sign in through OIDC; password login and self-registration are disabled.

### Provider examples

- Keycloak: use the realm issuer URL, for example `https://keycloak.example.com/realms/justscan`
- Authentik: use the provider issuer URL shown in the Authentik application/provider settings
- Azure AD / Entra ID: use the OpenID issuer for your tenant and app registration

### Environment variable overrides

All config values can be overridden via environment variables using the `BACKEND_` prefix with `.` replaced by `_`:

| Config key | Environment variable |
|---|---|
| `jwt.secret` | `BACKEND_JWT_SECRET` |
| `database.server` | `BACKEND_DATABASE_SERVER` |
| `database.port` | `BACKEND_DATABASE_PORT` |
| `database.name` | `BACKEND_DATABASE_NAME` |
| `database.user` | `BACKEND_DATABASE_USER` |
| `database.password` | `BACKEND_DATABASE_PASSWORD` |
| `encryption.key` | `BACKEND_ENCRYPTION_KEY` |
| `oidc.enabled` | `BACKEND_OIDC_ENABLED` |
| `oidc.issuer_url` | `BACKEND_OIDC_ISSUER_URL` |
| `oidc.client_id` | `BACKEND_OIDC_CLIENT_ID` |
| `oidc.client_secret` | `BACKEND_OIDC_CLIENT_SECRET` |
| `oidc.redirect_uri` | `BACKEND_OIDC_REDIRECT_URI` |
| `oidc.scopes` | `BACKEND_OIDC_SCOPES` |
| `oidc.admin_groups` | `BACKEND_OIDC_ADMIN_GROUPS` |
| `oidc.admin_roles` | `BACKEND_OIDC_ADMIN_ROLES` |
| `oidc.groups_claim` | `BACKEND_OIDC_GROUPS_CLAIM` |
| `oidc.roles_claim` | `BACKEND_OIDC_ROLES_CLAIM` |
| `local_auth.enabled` | `BACKEND_LOCAL_AUTH_ENABLED` |

---

## Frontend configuration

The frontend uses a single environment variable:

| Variable | Description | Default |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | Backend base URL | `http://localhost:8080` |

Create `services/frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8080
```

---

## Docker Compose

```bash
docker compose up -d
```

The compose file starts PostgreSQL, the backend, and the frontend together.

When running from the published Docker images, JustScan now refreshes Trivy's vulnerability DB and Java DB on container startup and again before scans whenever the cached DBs exceed `scanner.db_max_age_hours`. The cache is stored under `/app/data/trivy-cache`, so it survives container restarts when `/app/data` is persisted.

JustScan can also augment Java findings for Maven packages using the free OSV API. To avoid unnecessary outbound calls and stay within public-service limits, package/version query results are cached locally in the database and refreshed using the same cache window configured by `vuln_kb.cache_days`.

---

## Common issues

### 401 Unauthorized on all protected endpoints

**Cause:** `jwt.secret` is `null` or empty in `config.yaml`.
**Fix:** Set `jwt.secret` to a non-empty random string (minimum 32 characters recommended) and restart the backend. Any previously issued tokens will be invalidated and users will need to log in again.

### Cannot connect to database

**Check:**
- PostgreSQL is running on the configured host/port
- The database and user exist with correct permissions
- `database.password` is correct

### Scans stuck in `pending`

**Check:**
- `trivy` is installed and accessible at the path configured in `scanner.trivy_path`
- Run `trivy --version` to verify

---

## Getting an NVD API key

The NVD (National Vulnerability Database) API key is used to enrich CVE entries with additional metadata from [nvd.nist.gov](https://nvd.nist.gov). It is **optional** — JustScan and Trivy will still scan and report vulnerabilities without it, but CVE details may be less complete.

The key is **free** and provided by NIST (the US National Institute of Standards and Technology).

### Steps

1. Go to **[https://nvd.nist.gov/developers/request-an-api-key](https://nvd.nist.gov/developers/request-an-api-key)**
2. Enter your email address and submit the form
3. NIST will email you an API key within a few minutes
4. Set it in your config:

```yaml
vuln_kb:
  nvd_api_key: "your-key-here"
  cache_days: 7
```

Or via environment variable:

```bash
export BACKEND_VULN_KB_NVD_API_KEY="your-key-here"
```

### Rate limits

Without a key: **5 requests / 30 seconds**
With a key: **50 requests / 30 seconds**

For most self-hosted deployments the unauthenticated limit is sufficient. If you scan many images or refresh the CVE cache frequently, get a key to avoid rate limiting.

---

### Registry credentials not saving

**Check:**
- `encryption.key` is set in the config. Credentials are encrypted at rest using this key.
- If the key is empty, encryption will fail silently.

### Frontend shows CORS errors

**Check:**
- Your frontend origin is listed in `allow_origins` in `config.yaml`
- Example: if the frontend runs on port `3000`, add `"http://localhost:3000"` to the list
