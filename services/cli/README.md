# JustScan CLI

`justscan` is the command-line client for a running JustScan instance. It submits remote
pipeline scans and evaluates the verdict produced by that instance; it does not run a scanner
locally.

## Build locally

```sh
cd services/cli
go build ./cmd/justscan
```

## CI usage

Create an organization token with the `pipeline_scan` scope, then provide it only through the
environment:

```sh
export JUSTSCAN_URL="https://justscan.example.com"
export JUSTSCAN_ORG_ID="00000000-0000-0000-0000-000000000000"
export JUSTSCAN_TOKEN="<pipeline-token>"

justscan scan registry.example.com/my-app:1.2.3
```

CLI-submitted scans are recorded in the organization’s **Recent pipeline runs** and display the
token label that initiated them in the scan list and scan details.

The command waits for a final verdict by default. Exit code `0` is a pass, `1` is a policy
failure, and `2` indicates an operational or scan-execution error.

## Interactive login

For a person running scans locally, create or select a profile and sign in once:

```sh
justscan config set production \
  --server https://justscan.example.com \
  --org 00000000-0000-0000-0000-000000000000
justscan login --profile production --email you@example.com
```

The password is hidden while typing. The resulting user credential is stored in the operating
system keychain, never in the profile file or shell history. Use `justscan logout` to remove it.
`JUSTSCAN_TOKEN` remains the recommended authentication method for CI/CD.

## Profiles

Profiles hold only the instance URL, organization ID, and optional CA certificate path. They
never store access tokens.

```sh
justscan config set staging \
  --server https://justscan.staging.example.com \
  --org 00000000-0000-0000-0000-000000000000
justscan config use staging
export JUSTSCAN_TOKEN="<pipeline-token>"
justscan scan registry.example.com/my-app:1.2.3
```
