# JustScan

A self-hosted Docker image vulnerability scanner powered by [Trivy](https://github.com/aquasecurity/trivy) or Artifactory Xray.

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
- [Trivy](https://trivy.dev/latest/getting-started/installation/) installed and on `$PATH` for local Trivy scans

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
| `scanner.enable_trivy` | Enable local Trivy scans. Set to `false` for Artifactory Xray-only deployments | `true` |
| `scanner.trivy_path` | Path to Trivy binary | `trivy` |
| `scanner.enable_grype` | Enable Grype augmentation for local Trivy scans | `false` |
| `scanner.grype_path` | Path to Grype binary | `grype` |
| `scanner.timeout` | Legacy fallback for the local scanner command timeout in seconds | `600` |
| `scanner.command_timeout_seconds` | Local scanner command timeout in seconds for Trivy, Grype, and SBOM execution | `7200` |
| `scanner.progress_heartbeat_seconds` | How often long-running scans refresh their liveness timestamp while work is still active | `30` |
| `scanner.stale_timeout_seconds` | Fail a scan only after this many seconds without recorded progress | `7200` |
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
  command_timeout_seconds: 7200
  progress_heartbeat_seconds: 30
  stale_timeout_seconds: 7200
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

When running from the default Trivy-enabled Docker images, JustScan refreshes Trivy's vulnerability DB and Java DB on container startup and again before scans whenever the cached DBs exceed `scanner.db_max_age_hours`. The cache is stored under `/app/data/trivy-cache`, so it survives container restarts when `/app/data` is persisted.

For Artifactory Xray-only deployments, use the scannerless backend image by setting `JUSTSCAN_BACKEND_IMAGE_PREFIX=backend-minimal` and setting `scanner.enable_trivy: false` plus `scanner.enable_grype: false` in `deploy/docker-compose/backend-config.yaml`. Keep the default `backend` image if any registry should run local Trivy scans.

JustScan can also augment Java findings for Maven packages using the free OSV API. To avoid unnecessary outbound calls and stay within public-service limits, package/version query results are cached locally in the database and refreshed using the same cache window configured by `vuln_kb.cache_days`.

---

## Helm

The Kubernetes chart lives at `deploy/helm/justscan` for local development and is released as an OCI Helm chart in GHCR on every Git tag release.

### Prerequisites

- Kubernetes 1.24+
- Helm 3.8+
- Access to `ghcr.io/justlabv1/charts/justscan` and `ghcr.io/justlabv1/justscan` if the repository or packages are private

If GHCR access is private, log in first:

```bash
helm registry login ghcr.io -u YOUR_GITHUB_USER
```

### Install from the released chart

Create a values file such as `justscan-values.yaml`:

```yaml
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: scan.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: justscan-tls
      hosts:
        - scan.example.com

backend:
  image:
    # Leave empty to use backend-<chart appVersion>.
    # Use backend-minimal-1.2.3 for Artifactory Xray-only deployments.
    tag: ""
  secrets:
    jwtSecret: "replace-with-a-long-random-secret"
    encryptionKey: "replace-with-32-random-characters"
  config:
    allowOrigins:
      - "https://scan.example.com"
    oidc:
      enabled: false

  persistence:
    enabled: true
    size: 10Gi

postgresql:
  enabled: true
  auth:
    password: "replace-with-a-db-password"
```

Install a released chart version:

```bash
helm install justscan oci://ghcr.io/justlabv1/charts/justscan \
  --version 1.2.3 \
  --namespace justscan \
  --create-namespace \
  -f justscan-values.yaml
```

Upgrade an existing release:

```bash
helm upgrade justscan oci://ghcr.io/justlabv1/charts/justscan \
  --version 1.2.3 \
  --namespace justscan \
  -f justscan-values.yaml
```

### Publish a chart-only release

If you need to publish a new Helm chart version without building or releasing a new app version, run the `Release` workflow manually from GitHub Actions.

- Set `chart_version` to the new Helm chart version you want to publish.
- Set `app_version` to the existing app release whose image tags the chart should keep using.

Example: publish chart version `1.2.4` while still deploying app image tags from `1.2.3`.

The workflow will package and push `oci://ghcr.io/justlabv1/charts/justscan:1.2.4` with `appVersion=1.2.3`, so the chart still defaults to `backend-1.2.3` and `frontend-1.2.3` unless you override the image tags explicitly.

### Install from the chart in this repository

```bash
helm dependency build deploy/helm/justscan
helm install justscan deploy/helm/justscan \
  --namespace justscan \
  --create-namespace \
  -f justscan-values.yaml
```

### Helm chart behavior and required values

- Released chart packages automatically default `backend.image.tag` to `backend-<chart appVersion>` and `frontend.image.tag` to `frontend-<chart appVersion>`. Override either tag only if you need to pin a different image.
- For Artifactory Xray-only deployments, set `backend.image.tag` to `backend-minimal-<version>` and set `backend.config.scanner.enableTrivy=false` plus `backend.config.scanner.enableGrype=false`.
- `backend.secrets.jwtSecret` is required for all non-trivial deployments.
- `backend.secrets.encryptionKey` should be a random 32-character string. It is used to encrypt registry credentials at rest.
- `postgresql.auth.password` is required when `postgresql.enabled=true`.
- When `postgresql.enabled=true`, the backend automatically uses `postgresql.auth.database`, `postgresql.auth.username`, and the Bitnami PostgreSQL password secret. You only need `backend.config.database.*` for external databases.
- `backend.secrets.dbPassword` is required when `postgresql.enabled=false` and you connect to an external PostgreSQL instance.
- `backend.config.allowOrigins` must include the URL users open in their browser.
- If `backend.config.oidc.enabled=true`, also set `backend.secrets.oidcClientSecret`, `backend.config.oidc.issuerUrl`, `backend.config.oidc.clientId`, and either `backend.config.oidc.redirectUri` or `ingress.enabled=true` with a valid host.
- If your OIDC provider or another outbound HTTPS dependency uses a private or self-signed CA, set `backend.customCAs.configMapName` and/or `backend.customCAs.secretName` to mount PEM CA files into the backend container.
- `backend.persistence.enabled=true` is recommended for production so Trivy DB and cache data survive pod restarts.

### Supported chart configuration

Important values exposed by the chart include:

- `imagePullSecrets` for private image or chart pulls from GHCR
- `nameOverride`, `fullnameOverride`, and `serviceAccount.name` for release naming and service account control
- `backend.config.scanner.enableTrivy`, `backend.config.scanner.trivyPath`, `backend.config.scanner.grypePath`, `backend.config.scanner.enableGrype`, `backend.config.scanner.timeout`, `backend.config.scanner.commandTimeoutSeconds`, `backend.config.scanner.progressHeartbeatSeconds`, `backend.config.scanner.staleTimeoutSeconds`, `backend.config.scanner.concurrency`, `backend.config.scanner.dbMaxAgeHours`, and `backend.config.scanner.enableOsvJavaAugmentation`
- `backend.config.oidc.debug`, `backend.config.oidc.adminGroups`, `backend.config.oidc.adminRoles`, `backend.config.oidc.groupsClaim`, and `backend.config.oidc.rolesClaim`
- `backend.customCAs.configMapName`, `backend.customCAs.secretName`, and `backend.customCAs.bundlePath` for custom trust anchors used by OIDC and other outbound TLS calls
- `backend.persistence.existingClaim`, `backend.persistence.size`, and `backend.persistence.storageClass`
- `frontend.config.apiUrl` if the frontend must call a different backend URL than the in-cluster service

### Custom CA example

If your OIDC provider uses a self-signed or private CA, create a ConfigMap or Secret with the PEM certificate and reference it from the chart.

Example with a ConfigMap:

```bash
kubectl create configmap justscan-oidc-ca \
  --from-file=oidc-ca.crt=./oidc-ca.crt \
  --namespace justscan
```

```yaml
backend:
  customCAs:
    configMapName: justscan-oidc-ca
```

Example with a Secret:

```bash
kubectl create secret generic justscan-oidc-ca \
  --from-file=oidc-ca.crt=./oidc-ca.crt \
  --namespace justscan
```

```yaml
backend:
  customCAs:
    secretName: justscan-oidc-ca
```

The backend entrypoint builds a combined CA bundle from the system trust store plus the mounted files and exports it through `SSL_CERT_FILE` before JustScan starts. Restart the backend pod after updating the referenced ConfigMap or Secret.

Show the full values schema:

```bash
helm show values oci://ghcr.io/justlabv1/charts/justscan --version 1.2.3
```

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
- If you are using the `backend-minimal` image, use registries configured for Artifactory Xray and keep local Trivy scanning disabled

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
