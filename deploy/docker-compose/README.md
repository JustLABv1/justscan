# JustScan — Docker Compose Deployment

Deploys JustScan as three containers: **PostgreSQL**, **backend** (Go + Trivy), and **frontend** (Next.js).

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
| `POSTGRES_PASSWORD` | Database password — must also be set in `backend-config.yaml` |
| `JUSTSCAN_VERSION` | Image tag to deploy, e.g. `v1.2.3` (default: `latest`) |

### 2. Configure the backend

Edit `backend-config.yaml` and replace all `change-me-in-production` placeholders:

| Setting | Description |
|---|---|
| `database.password` | Must match `POSTGRES_PASSWORD` in `.env` |
| `jwt.secret` | Long random string — `openssl rand -hex 32` |
| `encryption.key` | 64-char hex string — `openssl rand -hex 32` |
| `allow_origins` | Must include the URL users open in their browser for the frontend |

> **Note on `NEXT_PUBLIC_API_URL`:** The published frontend image has
> `http://localhost:8080` baked in, which works for local deployments.
> For a remote server where the backend is on a different URL, build the
> frontend locally: comment out the `image:` line in `docker-compose.yml`,
> uncomment the `build:` block, set `NEXT_PUBLIC_API_URL` in `.env`, and
> run `docker compose up --build -d`.

### 3. Build and start

```bash
docker compose up --build -d
```

This builds both images and starts all services. On first run, the backend automatically runs database migrations.

### 4. Open the app

- Frontend: http://localhost:3000
- Backend API: http://localhost:8080/api/v1

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
| `POSTGRES_PASSWORD` | Yes | — | PostgreSQL password (must match `backend-config.yaml`) |
| `JUSTSCAN_VERSION` | No | `latest` | Image tag to pull, e.g. `v1.2.3` |
| `NEXT_PUBLIC_API_URL` | No* | `http://localhost:8080` | Backend URL seen by the browser — only used when building locally |
| `BACKEND_PORT` | No | `8080` | Host port for the backend |
| `FRONTEND_PORT` | No | `3000` | Host port for the frontend |

### Backend configuration (`backend-config.yaml`)

All backend settings live here — edit this file directly. Key settings to review:

| Setting | Description |
|---|---|
| `allow_origins` | CORS allowed origins — **must match your frontend URL** |
| `scanner.concurrency` | Number of parallel Trivy scan workers (default: 2) |
| `scanner.timeout` | Per-scan timeout in seconds (default: 600) |
| `vuln_kb.nvd_api_key` | Optional NVD API key for faster CVE enrichment |
| `log_level` | `debug`, `info`, `warn`, or `error` |

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
Check that `backend-config.yaml` exists in this directory and that all required env vars are set:
```bash
docker compose logs backend
```

**Frontend shows "Failed to fetch" errors**
- Verify `NEXT_PUBLIC_API_URL` in `.env` points to a URL reachable from the browser
- Verify `allow_origins` in `backend-config.yaml` includes your frontend URL
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
