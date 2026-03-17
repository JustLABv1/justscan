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
| `encryption.key` | Key for encrypting registry credentials at rest. Should be a 32-char string. | `""` |
| `vuln_kb.nvd_api_key` | NVD API key for enriched CVE data (optional, see [Getting an NVD API key](#getting-an-nvd-api-key)) | `""` |
| `vuln_kb.cache_days` | How long to cache NVD data | `7` |

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

encryption:
  key: "replace-with-32-char-encryption-key"

vuln_kb:
  nvd_api_key: ""
  cache_days: 7
```

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
