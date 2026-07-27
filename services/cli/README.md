# JustScan CLI

`justscan` is the command-line client for a running JustScan instance. It submits registry and
archive scans for remote analysis; it does not run a scanner locally.

For installation, authentication, every scan source, CI/CD examples, best practices, command
reference, and troubleshooting, open `/docs/integrations/cli` on your JustScan instance.

Download prebuilt macOS, Linux, or Windows binaries from the [latest JustScan CLI
release](https://github.com/JustLABv1/justscan/releases/latest). The guide includes installation
steps and the required macOS Gatekeeper workaround for current releases.

Check for a newer published release with:

```sh
justscan version --check
```

## Container image

For CI systems that prefer containers, use `ghcr.io/justlabv1/justscan-cli:<version>`. It contains
the CLI and Docker client, so a local-image scan only needs the host Docker socket mounted:

```sh
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  -e JUSTSCAN_URL -e JUSTSCAN_ORG_ID -e JUSTSCAN_TOKEN \
  ghcr.io/justlabv1/justscan-cli:latest scan --local my-app:ci
```

Pin a release version outside this repository. A Docker socket grants broad access to the host
daemon; use it only in a trusted, isolated CI runner.

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

## Archive scans without a registry

Upload a Docker or OCI archive and let the JustScan instance perform the scan. The CLI transfers
the archive only; it does not run a scanner locally.

```sh
justscan scan --local my-app:local
```

This asks Docker to stream the local image archive directly to JustScan—there is no temporary
archive file and no local vulnerability scan. Use `--engine podman` for Podman or
`--engine container` for Apple's Container CLI. Apple Container writes an OCI archive to a
temporary file while it is uploaded, then the CLI removes it. You can still upload an archive
you already have:

The image must already be present in the selected local engine. Use `docker pull IMAGE`,
`podman pull IMAGE`, or `container image pull IMAGE` first; omit `local` when JustScan should
pull the image from a registry.

```sh
justscan scan --archive ./my-app.tar --name my-app --tag local
```

An HTTPS archive URL is streamed by the CLI to JustScan. This works with S3 presigned download
URLs, Google Drive direct-download URLs, and other HTTPS file hosts; cloud credentials remain on
the developer or CI machine, never on the JustScan server.

```sh
justscan scan --archive "https://example.com/download/my-app.tar.gz" --name my-app --tag 1.2.3
```

For URLs whose path does not include an archive filename (common with Google Drive), provide one:

```sh
justscan scan --archive "https://drive.google.com/uc?export=download&id=..." \\
  --filename my-app.tar --name my-app --tag 1.2.3
```

Archives must be `.tar`, `.tar.gz`, or `.tgz` and may be up to 5 GB.

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
