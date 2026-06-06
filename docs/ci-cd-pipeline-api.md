# CI/CD Pipeline Scan API

JustScan can now accept container image scan requests from CI/CD systems by using an organization token and the org-scoped pipeline endpoint.

## Recommended auth model

Use an org token from the target organization:
- Path: `Org API Tokens`
- Scope: organization-owned scans only
- Best for: GitHub Actions, GitLab CI, n8n, and other shared automation

Personal tokens still work for user-scoped scripting, but they are not the recommended choice for shared pipelines.

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
  "verdict": {
    "fail_on_severity": "high",
    "fail_on_scan_error": true,
    "fail_on_xray_block": true
  }
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
- `github_actions`
- `gitlab_ci`
- `n8n`

## GitHub Actions example

```yaml
name: security-scan

on:
  push:
    branches: [main]

jobs:
  trigger-justscan:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger JustScan
        run: |
          curl -fsS -X POST "${JUSTSCAN_URL}/api/v1/orgs/${JUSTSCAN_ORG_ID}/pipeline-scans" \
            -H "Authorization: Bearer ${JUSTSCAN_ORG_TOKEN}" \
            -H "Content-Type: application/json" \
            -d '{
              "image": "'"${IMAGE_REF}"'",
              "source": "github_actions",
              "external_ref": "'"${GITHUB_RUN_ID}"'",
              "callback": {
                "url": "'"${CALLBACK_URL}"'",
                "secret": "'"${JUSTSCAN_CALLBACK_SECRET}"'"
              }
            }'
```

## GitLab CI example

```yaml
justscan:
  image: curlimages/curl:8.8.0
  script:
    - |
      curl -fsS -X POST "${JUSTSCAN_URL}/api/v1/orgs/${JUSTSCAN_ORG_ID}/pipeline-scans" \
        -H "Authorization: Bearer ${JUSTSCAN_ORG_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{
          \"image\": \"${CI_REGISTRY_IMAGE}:${CI_COMMIT_SHA}\",
          \"source\": \"gitlab_ci\",
          \"external_ref\": \"${CI_PIPELINE_ID}\"
        }"
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
