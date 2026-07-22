# CI/CD Pipeline Scan API

JustScan can now accept container image scan requests from CI/CD systems by using an organization token and the org-scoped pipeline endpoint.

## JustScan CLI (recommended)

Use the `justscan` CLI in CI when possible. It submits the pipeline request, waits for the
server-computed verdict, prints a concise summary, and returns a reliable exit code without
requiring `curl` or `jq`.

```sh
export JUSTSCAN_URL="https://justscan.example.com"
export JUSTSCAN_ORG_ID="00000000-0000-0000-0000-000000000000"
export JUSTSCAN_TOKEN="<pipeline-scoped-org-token>"

justscan scan registry.example.com/my-app:1.2.3 \
  --source github_actions \
  --external-ref "$GITHUB_RUN_ID"
```

The command waits for completion by default. It exits `0` for a pass, `1` for a policy failure,
and `2` for authentication, network, timeout, or scan-execution errors. Use `--no-wait` when a
pipeline only needs to submit a scan asynchronously, or `--output json` for machine-readable
results.

## Recommended auth model

Use a pipeline-scoped org token from the target organization:
- Path: organization `CI/CD` onboarding or `Access` → `Org API Tokens`
- Token scope: `pipeline_scan`
- Resource scope: organization-owned scans only
- Best for: GitHub Actions, GitLab CI, n8n, and other shared automation

Pipeline-scoped tokens can only create and read pipeline scans for their organization. Existing
`org_admin` tokens remain compatible with the pipeline endpoints, but they grant broader
organization API access and should not be placed in CI unless that access is intentional.

Personal tokens are for user-scoped scripting and are not supported by the org pipeline endpoint.

## Trigger a pipeline scan

Endpoint:

```text
POST /api/v1/orgs/:orgId/pipeline-scans
```

Request body:

```json
{
  "image": "registry.example.com/my-app:1.2.3",
  "registry_id": "00000000-0000-0000-0000-000000000000",
  "source": "github_actions",
  "external_ref": "build-1942",
  "callback": {
    "url": "https://automation.example.com/justscan/callback",
    "secret": "replace-me"
  },
}
```

Response:

```json
{
  "scan_id": "11111111-1111-1111-1111-111111111111",
  "status": "accepted",
  "scan_status": "pending",
  "status_url": "https://justscan.example.com/api/v1/orgs/22222222-2222-2222-2222-222222222222/pipeline-scans/11111111-1111-1111-1111-111111111111",
  "scan_url": "https://justscan.example.com/scans/11111111-1111-1111-1111-111111111111"
}
```

## Poll for result

Endpoint:

```text
GET /api/v1/orgs/:orgId/pipeline-scans/:scanId
```

Result shape:

```json
{
  "event": "scan_completed",
  "scan_id": "11111111-1111-1111-1111-111111111111",
  "org_id": "22222222-2222-2222-2222-222222222222",
  "source": "github_actions",
  "external_ref": "build-1942",
  "status": "completed",
  "external_status": "",
  "current_step": "completed",
  "verdict": "fail",
  "critical_count": 0,
  "high_count": 2,
  "medium_count": 5,
  "low_count": 1,
  "unknown_count": 0,
  "image_name": "registry.example.com/my-app",
  "image_tag": "1.2.3",
  "scan_provider": "trivy",
  "scan_url": "https://justscan.example.com/scans/11111111-1111-1111-1111-111111111111",
  "status_url": "https://justscan.example.com/api/v1/orgs/22222222-2222-2222-2222-222222222222/pipeline-scans/11111111-1111-1111-1111-111111111111",
  "callback": {
    "status": "delivered",
    "attempts": 1
  }
}
```

`verdict` values:
- `pending`: scan still running
- `pass`: terminal scan with no configured gate failure
- `fail`: terminal scan failed the configured severity or Xray policy gate
- `error`: terminal scan failed due to scan execution or delivery problems

## Organization pipeline history

Signed-in organization viewers can inspect recent pipeline-triggered scans without an API token:

```text
GET /api/v1/orgs/:orgId/pipeline-scans?page=1&limit=20
```

The response is paginated and includes the image, scan state, CI source, external reference, and callback delivery state. Callback URLs and secrets are never returned.

## Callback behavior

If `callback.url` is set, JustScan sends a `POST` request to that URL after the scan reaches a terminal state.

Headers:

```text
Content-Type: application/json
User-Agent: JustScan-Pipeline-Callback/1.0
X-JustScan-Signature: sha256=<hex digest>
```

`X-JustScan-Signature` is included only when `callback.secret` is set. The signature is an HMAC-SHA256 digest of the raw request body using the provided secret.

Delivery behavior:
- only sent for terminal scans
- retries up to 5 times with backoff
- callback status is visible from the polling endpoint

## Supported source values

- `generic`
- `justscan_cli` (used automatically by the JustScan CLI)
- `github_actions`
- `gitlab_ci`
- `n8n`

## Blocking CI behavior

Triggering a scan only confirms that JustScan accepted it. A blocking CI integration must poll the
returned `status_url` until `verdict` is `pass`, `fail`, or `error`, then map that verdict to the
pipeline exit code. The organization `CI/CD` tab generates complete provider-specific templates.

Shell-based templates require `curl`, `jq`, and a masked or encrypted `JUSTSCAN_ORG_TOKEN` secret.

## GitHub Actions example

```yaml
name: security-scan

on:
  push:
    branches: [main]

jobs:
  justscan:
    runs-on: ubuntu-latest
    steps:
      - name: Scan with JustScan
        env:
          JUSTSCAN_ORG_TOKEN: ${{ secrets.JUSTSCAN_ORG_TOKEN }}
          IMAGE_REF: ${{ vars.IMAGE_REF }}
        run: |
          response="$(curl -fsS -X POST "${JUSTSCAN_URL}/api/v1/orgs/${JUSTSCAN_ORG_ID}/pipeline-scans" \
            -H "Authorization: Bearer ${JUSTSCAN_ORG_TOKEN}" \
            -H "Content-Type: application/json" \
            -d '{
              "image": "'"${IMAGE_REF}"'",
              "source": "github_actions",
              "external_ref": "'"${GITHUB_RUN_ID}"'"
            }')"
          status_url="$(printf '%s' "$response" | jq -r '.status_url')"
          deadline=$(( $(date +%s) + 1800 ))
          while [ "$(date +%s)" -lt "$deadline" ]; do
            result="$(curl -fsS "$status_url" -H "Authorization: Bearer ${JUSTSCAN_ORG_TOKEN}")"
            verdict="$(printf '%s' "$result" | jq -r '.verdict')"
            case "$verdict" in
              pass) exit 0 ;;
              fail|error) printf '%s\n' "$result" | jq; exit 1 ;;
            esac
            sleep 5
          done
          exit 1
```

## GitLab CI example

```yaml
justscan:
  image: alpine:3.20
  before_script:
    - apk add --no-cache curl jq
  script:
    - |
      response="$(curl -fsS -X POST "${JUSTSCAN_URL}/api/v1/orgs/${JUSTSCAN_ORG_ID}/pipeline-scans" \
        -H "Authorization: Bearer ${JUSTSCAN_ORG_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{
          \"image\": \"${CI_REGISTRY_IMAGE}:${CI_COMMIT_SHA}\",
          \"source\": \"gitlab_ci\",
          \"external_ref\": \"${CI_PIPELINE_ID}\"
        }")"
      status_url="$(printf '%s' "$response" | jq -r '.status_url')"
      deadline=$(( $(date +%s) + 1800 ))
      while [ "$(date +%s)" -lt "$deadline" ]; do
        result="$(curl -fsS "$status_url" -H "Authorization: Bearer ${JUSTSCAN_ORG_TOKEN}")"
        verdict="$(printf '%s' "$result" | jq -r '.verdict')"
        case "$verdict" in
          pass) exit 0 ;;
          fail|error) printf '%s\n' "$result" | jq; exit 1 ;;
        esac
        sleep 5
      done
      exit 1
```

## n8n example

Use an HTTP Request node:
- Method: `POST`
- URL: `https://justscan.example.com/api/v1/orgs/<org-id>/pipeline-scans`
- Auth header: `Authorization: Bearer <org-token>`
- Body JSON:

```json
{
  "image": "registry.example.com/my-app:latest",
  "source": "n8n",
  "external_ref": "workflow-42",
  "callback": {
    "url": "https://n8n.example.com/webhook/justscan-result",
    "secret": "replace-me"
  }
}
```
