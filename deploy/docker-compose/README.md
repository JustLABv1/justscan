# JustScan — Docker Compose Deployment

Deploys JustScan as three containers: **PostgreSQL**, **backend** (Go; Trivy-enabled by default), and **frontend** (Next.js).

## Prerequisites

- Docker 24+ with Docker Compose v2 (`docker compose version`)
- Ports `3000` and `8080` available on the host (configurable via `.env`)
- For pulling images from GHCR on a private repo: `docker login ghcr.io -u YOUR_GITHUB_USER`

## Quick Start

### 1. Configure environment

```bash
cd deploy/docker-compose
cp .env.example .env
```

Edit `.env`:

| Variable | Description |
|---|---|
| `POSTGRES_PASSWORD` | PostgreSQL password |
| `BACKEND_JWT_SECRET` | Long random string for signing sessions |
| `BACKEND_ENCRYPTION_KEY` | 64-character hex encryption key |
| `BACKEND_ALLOW_ORIGINS` | Comma-separated browser origins, such as `https://scan.example.com` |
| `JUSTSCAN_VERSION` | Image tag to deploy, e.g. `v1.2.3` (default: `latest`) |
| `JUSTSCAN_BACKEND_IMAGE_PREFIX` | Backend image prefix. Use `backend-minimal` for Artifactory Xray-only deployments (default: `backend`) |

The Compose deployment configures the backend exclusively through environment variables. The image contains safe non-secret defaults; do not bind-mount a configuration file into `/etc/justscan`.

> **Note on `NEXT_PUBLIC_API_URL`:** The published frontend image has
> `http://localhost:8080` baked in, which works for local deployments.
> For a remote server where the backend is on a different URL, build the
> frontend locally: comment out the `image:` line in `docker-compose.yml`,
> uncomment the `build:` block, set `NEXT_PUBLIC_API_URL` in `.env`, and
> run `docker compose up --build -d`.

### Large local-image uploads

The bundled Nginx configuration streams archive uploads to the backend, allows the multipart
framing around JustScan's 5 GiB archive limit, and waits up to two hours for the backend response.
After pulling a JustScan update that changes `nginx/nginx.conf`, apply it to the running proxy:

```bash
docker compose restart nginx
```

If a separate reverse proxy or Kubernetes ingress sits in front of JustScan, configure its request
body limit to at least 6 GiB, disable request buffering where supported, and set read/send timeouts
to at least two hours.

### 2a. Optional: configure OIDC

JustScan supports OIDC providers such as Keycloak and Authentik.

Configure OIDC through the administrator UI after first login. Keep secrets out of a Compose file; inject any optional backend secret as a `BACKEND_*` environment variable.

Important details:

- Register `oidc.redirect_uri` in your OIDC provider exactly as shown above.
- Set `BACKEND_ALLOW_ORIGINS` to the public frontend URL. After a successful OIDC login, JustScan redirects to its first listed origin plus `/auth/oidc/callback`.
- `local_auth.enabled: true` keeps password login enabled alongside OIDC.
- `local_auth.enabled: false` makes the deployment OIDC-only and disables local login and self-registration.
- Existing local users are automatically linked to OIDC on first login when their OIDC email matches the local account email.
- Admin access is assigned from `oidc.admin_groups` and `oidc.admin_roles`, and is re-evaluated on every OIDC login.

### 2b. Optional: use the Artifactory Xray-only backend image

When every registry is configured with the `artifactory_xray` scan provider, the backend does not need local Trivy or Grype binaries. Use the minimal backend image to avoid shipping those scanners:

```env
JUSTSCAN_BACKEND_IMAGE_PREFIX=backend-minimal
JUSTSCAN_VERSION=v1.2.3
```

Also disable local scanner support in `.env`:

```env
BACKEND_SCANNER_ENABLE_TRIVY=false
BACKEND_SCANNER_ENABLE_GRYPE=false
```

Keep using the default `backend` image if any registry should still run local Trivy scans.

### 3. Build and start

```bash
docker compose up --build -d
```

This builds both images and starts all services. On first run, the backend automatically runs database migrations.

### 4. Open the app

- Application: http://localhost
- Documentation: http://localhost/docs (or https://justscan.justlab.app/docs before deployment)
- Backend API: http://localhost/api/v1

---

## Day-to-day operations

```bash
# View logs
docker compose logs -f

# Logs for a specific service
docker compose logs -f backend

# Stop all services
docker compose down

# Stop and remove volumes (WARNING: deletes all data)
docker compose down -v

# Rebuild after code changes
docker compose up --build -d

# Rebuild only the frontend (e.g. after changing NEXT_PUBLIC_API_URL)
docker compose build frontend
docker compose up -d frontend
```

---

## Configuration reference

### Environment variables (`.env`)

| Variable | Required | Default | Description |
|---|---|---|---|
| `POSTGRES_PASSWORD` | Yes | — | PostgreSQL password |
| `BACKEND_JWT_SECRET` | Yes | — | Session-signing secret |
| `BACKEND_ENCRYPTION_KEY` | Yes | — | 64-character hex encryption key |
| `BACKEND_ALLOW_ORIGINS` | Yes | — | Comma-separated CORS origins |
| `JUSTSCAN_VERSION` | No | `latest` | Image tag to pull, e.g. `v1.2.3` |
| `JUSTSCAN_BACKEND_IMAGE_PREFIX` | No | `backend` | Backend image prefix. Set to `backend-minimal` for Artifactory Xray-only deployments |
| `NEXT_PUBLIC_API_URL` | No* | `http://localhost:8080` | Backend URL seen by the browser — only used when building locally |
| `BACKEND_PORT` | No | `8080` | Host port for the backend |
| `FRONTEND_PORT` | No | `3000` | Host port for the frontend |

### Backend configuration

The backend is configured through its `BACKEND_*` environment variables. Key settings to review:

| Setting | Description |
|---|---|
| `BACKEND_ALLOW_ORIGINS` | CORS origins — **must match the frontend URL** |
| `BACKEND_SCANNER_ENABLE_TRIVY` | Enable local Trivy scans; set to `false` for `backend-minimal` |
| `BACKEND_SCANNER_ENABLE_GRYPE` | Enable Grype augmentation; must be `false` for `backend-minimal` |
| `BACKEND_SCANNER_CONCURRENCY` | Number of parallel Trivy scan workers (default: 2) |
| `BACKEND_SCANNER_COMMAND_TIMEOUT_SECONDS` | Local scanner command timeout (default: 7200) |
| `BACKEND_SCANNER_SCAN_CACHE_CLEANUP_HOURS` | Scan-cache cleanup interval (default: 24; `0` disables) |
| `BACKEND_VULN_KB_NVD_API_KEY` | Optional NVD API key for faster CVE enrichment |
| `BACKEND_LOG_LEVEL` | `debug`, `info`, `warn`, or `error` |

---

## Upgrading

```bash
# Pull latest code, then rebuild
git pull
docker compose up --build -d
```

---

## Troubleshooting

**Backend exits immediately**
Check that `.env` has the required backend variables:
```bash
docker compose logs backend
```

**Frontend shows "Failed to fetch" errors**
- Verify `NEXT_PUBLIC_API_URL` in `.env` points to a URL reachable from the browser
- Verify `BACKEND_ALLOW_ORIGINS` includes your frontend URL
- Rebuild the frontend image after any change to `NEXT_PUBLIC_API_URL`:
  ```bash
  docker compose build frontend && docker compose up -d frontend
  ```

**Database connection refused**
The backend waits for PostgreSQL to be healthy before starting. If it still fails:
```bash
docker compose logs postgres
```

**Port conflicts**
Change `BACKEND_PORT` or `FRONTEND_PORT` in `.env`, then restart.
