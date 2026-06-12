import type { PipelineSource, PipelineVerdictConfig } from './api/pipeline';

export type CIProvider = 'github_actions' | 'gitlab_ci' | 'generic' | 'n8n';

export interface CITemplateConfig {
  provider: CIProvider;
  publicURL: string;
  orgId: string;
  timeoutMinutes: number;
  verdict: PipelineVerdictConfig;
  callbackURL?: string;
  callbackSecretVariable?: string;
}

function sourceForProvider(provider: CIProvider): PipelineSource {
  return provider === 'generic' ? 'generic' : provider;
}

function requestJSON(config: CITemplateConfig, imageExpression: string, externalRef: string): string {
  const callbackArg = config.callbackURL ? ` \\
  --arg callback_url "${config.callbackURL}"` : '';
  const callback = config.callbackURL
    ? `,
    callback: {url: $callback_url, secret: ${config.callbackSecretVariable || '""'}}`
    : '';
  return `jq -n \\
  --arg image "${imageExpression}" \\
  --arg external_ref "${externalRef}"${callbackArg} \\
  '{
    image: $image,
    source: "${sourceForProvider(config.provider)}",
    external_ref: $external_ref,
    verdict: {
      fail_on_severity: "${config.verdict.fail_on_severity}",
      fail_on_scan_error: ${config.verdict.fail_on_scan_error},
      fail_on_xray_block: ${config.verdict.fail_on_xray_block}
    }${callback}
  }'`;
}

function pollingScript(config: CITemplateConfig, tokenVariable: string): string {
  const timeoutSeconds = Math.max(1, config.timeoutMinutes) * 60;
  return `deadline=$(( $(date +%s) + ${timeoutSeconds} ))
while [ "$(date +%s)" -lt "$deadline" ]; do
  result="$(curl -fsS "$status_url" -H "Authorization: Bearer ${tokenVariable}")"
  verdict="$(printf '%s' "$result" | jq -r '.verdict')"
  echo "JustScan verdict: $verdict"
  case "$verdict" in
    pass) exit 0 ;;
    fail|error)
      printf '%s\\n' "$result" | jq
      exit 1
      ;;
  esac
  sleep 5
done
echo "Timed out waiting for JustScan after ${config.timeoutMinutes} minutes"
exit 1`;
}

function shellBody(
  config: CITemplateConfig,
  imageExpression: string,
  externalRef: string,
  tokenVariable: string
): string {
  const base = config.publicURL.trim().replace(/\/+$/, '');
  return `payload="$(${requestJSON(config, imageExpression, externalRef)})"
response="$(curl -fsS -X POST "${base}/api/v1/orgs/${config.orgId}/pipeline-scans" \\
  -H "Authorization: Bearer ${tokenVariable}" \\
  -H "Content-Type: application/json" \\
  -d "$payload")"
status_url="$(printf '%s' "$response" | jq -r '.status_url')"
${pollingScript(config, tokenVariable)}`;
}

export function generateCITemplate(config: CITemplateConfig): string {
  switch (config.provider) {
    case 'github_actions':
      return `name: justscan

on:
  push:
    branches: [main]

jobs:
  justscan:
    runs-on: ubuntu-latest
    steps:
      - name: Scan image with JustScan
        env:
          JUSTSCAN_ORG_TOKEN: \${{ secrets.JUSTSCAN_ORG_TOKEN }}
          IMAGE_REF: \${{ vars.IMAGE_REF }}
          JUSTSCAN_CALLBACK_SECRET: \${{ secrets.JUSTSCAN_CALLBACK_SECRET }}
        run: |
${shellBody(config, '${IMAGE_REF}', '${GITHUB_RUN_ID}', '${JUSTSCAN_ORG_TOKEN}')
  .split('\n')
  .map((line) => `          ${line}`)
  .join('\n')}`;
    case 'gitlab_ci':
      return `justscan:
  image: alpine:3.20
  before_script:
    - apk add --no-cache curl jq
  script:
    - |
${shellBody(
  config,
  '${CI_REGISTRY_IMAGE}:${CI_COMMIT_SHA}',
  '${CI_PIPELINE_ID}',
  '${JUSTSCAN_ORG_TOKEN}'
)
  .split('\n')
  .map((line) => `      ${line}`)
  .join('\n')}`;
    case 'generic':
      return `#!/usr/bin/env sh
set -eu

: "\${JUSTSCAN_ORG_TOKEN:?Set JUSTSCAN_ORG_TOKEN}"
: "\${IMAGE_REF:?Set IMAGE_REF}"

${shellBody(config, '${IMAGE_REF}', '${CI_BUILD_ID:-manual}', '${JUSTSCAN_ORG_TOKEN}')}`;
    case 'n8n':
      return JSON.stringify(
        {
          name: 'JustScan pipeline verdict',
          instructions: [
            'Use an HTTP Request node to POST the trigger request.',
            'Store JUSTSCAN_ORG_TOKEN as an n8n credential; do not place it in workflow JSON.',
            'Loop with a Wait node and GET status_url until verdict is not pending.',
            'Route pass to success and fail/error to a Stop And Error node.',
          ],
          trigger: {
            method: 'POST',
            url: `${config.publicURL.trim().replace(/\/+$/, '')}/api/v1/orgs/${config.orgId}/pipeline-scans`,
            authorization: 'Bearer {{$credentials.justscanOrgToken}}',
            body: {
              image: '{{$json.image}}',
              source: 'n8n',
              external_ref: '{{$execution.id}}',
              verdict: config.verdict,
              ...(config.callbackURL
                ? {
                    callback: {
                      url: config.callbackURL,
                      secret: '{{$credentials.justscanCallbackSecret}}',
                    },
                  }
                : {}),
            },
          },
          poll: {
            method: 'GET',
            url: '{{$json.status_url}}',
            interval_seconds: 5,
            timeout_minutes: config.timeoutMinutes,
          },
        },
        null,
        2
      );
  }
}
