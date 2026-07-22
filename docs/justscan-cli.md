# JustScan CLI guide

JustScan CLI is a client for a running JustScan instance. It submits work to JustScan; it does not
include or run a vulnerability scanner locally. Local operations are limited to reading an archive,
downloading an explicitly supplied HTTPS archive, or asking Docker/Podman to stream an image
archive. The JustScan instance performs analysis and applies the organization's policies.

## Choose the right scan source

| Image location | Command | Who transfers the image |
| --- | --- | --- |
| Container registry | justscan scan IMAGE | JustScan pulls from the registry. |
| Local Docker or Podman daemon | justscan scan --local IMAGE | The CLI streams image-save output to JustScan. |
| Archive already on disk | justscan scan --archive FILE | The CLI uploads the archive to JustScan. |
| S3, Google Drive, or another file host | justscan scan --archive HTTPS_URL | The CLI downloads and forwards the archive. |

Archive scans accept Docker/OCI archives ending in .tar, .tar.gz, or .tgz, up to 5 GB. Remote URLs
must use HTTPS. Use a direct or presigned download URL rather than a browser share page.

## Install

### Download a release (recommended)

Download the archive for your operating system and CPU architecture from the [latest JustScan CLI
release](https://github.com/JustLABv1/justscan/releases/latest). The **CI/CD & CLI** tab in a
JustScan organization also links there. Choose `Darwin_arm64` for Apple Silicon Macs and
`Darwin_x86_64` for Intel Macs, then unpack the archive and put `justscan` on your `PATH`.

For example, after downloading a macOS archive:

~~~sh
tar -xzf justscan_*_Darwin_arm64.tar.gz
sudo install -m 0755 justscan_*/justscan /usr/local/bin/justscan
justscan version
~~~

### macOS Gatekeeper

Current CLI releases are not yet Apple-notarized, so macOS may block the first launch with a
Gatekeeper warning. After verifying that you downloaded the archive from the official release
page, remove the quarantine attribute from the installed binary:

~~~sh
xattr -d com.apple.quarantine "$(command -v justscan)"
justscan version
~~~

Do not use this command for binaries from untrusted sources. Apple-signing and notarization are
planned for future releases.

### Build from source

~~~sh
cd services/cli
go build -o justscan ./cmd/justscan
./justscan version
~~~

Install the binary on your PATH if desired. Generate shell completion with:

~~~sh
justscan completion zsh > "$HOME/.zfunc/_justscan"
~~~

Bash, fish, and PowerShell completion are also supported.

### Find updates

The CI/CD & CLI tab in JustScan links to the latest release and this guide. From a terminal, check
the installed version against the latest GitHub release on demand:

~~~sh
justscan version --check
~~~

The check is opt-in; normal CLI commands never contact GitHub. Development builds show the latest
release but are not compared as a semantic version.

## First-time setup

Every command needs a JustScan server URL and organization UUID. Store these non-secret values in
a profile:

~~~sh
justscan config set production \
  --server https://justscan.example.com \
  --org 00000000-0000-0000-0000-000000000000
~~~

The first profile becomes active automatically. Inspect or switch profiles:

~~~sh
justscan config list
justscan config show production
justscan config use production
~~~

Profiles live in the operating system configuration directory and contain only the server,
organization UUID, and optional CA certificate path. They never contain a password or access token.

## Authentication

### Personal use

Use interactive login for a person working from a terminal:

~~~sh
justscan login --profile production --email you@example.com
~~~

The password prompt is hidden. The returned session credential is stored in the operating-system
keychain, not in the profile file or shell history. Remove it with:

~~~sh
justscan logout --profile production
~~~

Local password authentication must be enabled on the JustScan instance. OIDC-only installations
currently need an organization token for CLI use.

### CI/CD

Create a pipeline_scan token in Organization → People & Access → CLI & API Tokens. Put it in the
CI secret store, then expose it only for the job that runs JustScan:

~~~sh
export JUSTSCAN_TOKEN="<pipeline-token>"
justscan scan registry.example.com/team/app:1.2.3
~~~

Pipeline tokens are organization-scoped and can create/read pipeline scans and upload archives to
that organization. Do not use an org_admin token in CI unless broader access is intentional.

### Credential precedence

The CLI uses the first available credential in this order:

1. --token-stdin
2. JUSTSCAN_TOKEN
3. Stored keychain credential from justscan login

Use token stdin with a secret manager:

~~~sh
secret-manager read justscan-token | justscan --token-stdin scan registry.example.com/app:1.2.3
~~~

Never put a token in a command argument, repository, build log, shell profile, or image layer.

## Scan an image from a registry

~~~sh
justscan scan registry.example.com/team/app:1.2.3
~~~

The command waits for the server-computed policy verdict by default:

| Exit code | Meaning |
| --- | --- |
| 0 | Organization policies passed. |
| 1 | One or more organization policies failed. |
| 2 | Authentication, network, timeout, or scan-execution error. |

Useful options:

~~~sh
justscan scan registry.example.com/team/app:1.2.3 \
  --registry-id 00000000-0000-0000-0000-000000000000 \
  --platform linux/amd64 \
  --source github_actions \
  --external-ref "$GITHUB_RUN_ID" \
  --timeout 45m \
  --output json
~~~

Use --no-wait to submit asynchronously. Save the returned scan_id, then inspect it with
justscan status SCAN_ID or justscan status SCAN_ID --wait.

The verdict always comes from organization policies. The CLI intentionally has no local severity
threshold or fail-on setting.

## Scan a local Docker or Podman image

~~~sh
justscan scan --local my-app:latest
~~~

This streams docker image save output straight to JustScan. It does not create a temporary archive,
and Docker/Podman does not scan the image.

~~~sh
justscan scan --local my-app:latest \
  --engine podman \
  --name my-app \
  --tag dev \
  --platform linux/amd64
~~~

Requirements:

- Docker is available by default; use --engine podman for Podman.
- The image must already exist in that local engine. For example, run `podman pull
  docker.io/appwrite/appwrite` first. To let JustScan pull an image from its registry instead, use
  `justscan scan docker.io/appwrite/appwrite` (without `local`).
- Archive upload scanning is enabled on the JustScan instance (Trivy-backed archive scans).
- The CLI shows streamed-byte progress for local images. It rejects images whose reported local
  size already exceeds the 5 GiB archive limit. Archive transfers use an upload session with
  8 MiB chunks, so each request completes quickly and a lost response only affects one chunk.
  Ensure any reverse proxy accepts 8 MiB request bodies and permits the final scan-creation
  request. The bundled Compose Nginx configuration requires `docker compose restart nginx` after
  an update.

Local-image and archive commands create organization-owned JustScan CLI runs. They wait for the
same server-computed policy verdict and use the same exit codes as `justscan scan IMAGE`. Add
`--no-wait` to return after the upload is accepted; `justscan status SCAN_ID --wait` can continue
the wait later. The older `justscan scan local IMAGE`, `justscan scan archive FILE`, `justscan
local IMAGE`, and `justscan archive FILE` forms remain compatibility aliases.

## Scan an archive from disk

~~~sh
justscan scan --archive ./dist/my-app.tar --name my-app --tag 1.2.3
~~~

This is useful for an archive created by docker save, an OCI build tool, or a CI artifact.
The --name and --tag values control how the image is identified in JustScan.

## Scan an archive from an HTTPS URL

~~~sh
justscan scan --archive "https://storage.example.com/releases/my-app.tar.gz?signature=…" \
  --name my-app \
  --tag 1.2.3
~~~

The CLI downloads and immediately forwards the bytes to JustScan. JustScan does not fetch the URL,
so it never needs S3, Google Drive, or other cloud credentials.

For S3, create a presigned download URL. For Google Drive, use a direct-download URL. If a URL
does not include an archive filename (common with Google Drive), supply one:

~~~sh
justscan scan --archive "https://drive.google.com/uc?export=download&id=FILE_ID" \
  --filename my-app.tar \
  --name my-app \
  --tag 1.2.3
~~~

The CLI refuses HTTP URLs and redirects to HTTP. Use a CI job's cloud identity to create a
short-lived presigned URL; do not embed permanent cloud credentials in a URL or command.

## CI/CD examples

### Registry image

~~~sh
export JUSTSCAN_URL="https://justscan.example.com"
export JUSTSCAN_ORG_ID="00000000-0000-0000-0000-000000000000"
export JUSTSCAN_TOKEN="$CI_SECRET_JUSTSCAN_TOKEN"

justscan scan "$IMAGE_REF" \
  --source github_actions \
  --external-ref "$GITHUB_RUN_ID"
~~~

### Image built in the CI Docker daemon

~~~sh
docker build -t my-app:"$CI_COMMIT_SHA" .
justscan scan --local my-app:"$CI_COMMIT_SHA"
~~~

Use a pipeline token for both examples. Both commands wait for the organization-policy verdict by
default; pass `--no-wait` when the job should only submit the scan.

### GitHub Actions: validate images before merge

Build the image into the pull-request runner's Docker daemon and scan that exact local image. This
repository does that for the backend, minimal backend, frontend, combined, and CLI images through
`.github/actions/justscan-local-image-gate`. The release workflow then publishes the validated
commit instead of discovering a policy failure at release time.

Add these repository or environment secrets in GitHub before enabling the workflow:

| Secret | Value |
| --- | --- |
| `JUSTSCAN_URL` | HTTPS URL of the JustScan instance. |
| `JUSTSCAN_ORG_ID` | Organization UUID that owns the CI policy. |
| `JUSTSCAN_TOKEN` | A least-privilege organization pipeline token. |

The gate runs `justscan scan --local IMAGE` in the CLI container and waits for the organization's
policy verdict. A failed policy, upload error, or missing secret fails the internal pull-request
check. Keep the pipeline token in GitHub Secrets only; never write it into workflow YAML or an
image build argument. Forked pull requests cannot receive repository secrets, so their image
policy gate is intentionally skipped; never replace this with `pull_request_target`, which would
run untrusted pull-request code with secrets.

### CLI container image

The release workflow also publishes a small CLI image at
`ghcr.io/justlabv1/justscan-cli`. It contains the JustScan CLI, CA certificates, and the Docker
client—enough to scan a local image through a mounted Docker socket, but no scanner or JustScan
server.

For a registry image, no Docker socket is required:

~~~sh
docker run --rm \
  -e JUSTSCAN_URL -e JUSTSCAN_ORG_ID -e JUSTSCAN_TOKEN \
  ghcr.io/justlabv1/justscan-cli:latest \
  scan registry.example.com/team/app:1.2.3
~~~

For an image already built in the host Docker daemon, mount its socket:

~~~sh
docker run --rm \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e JUSTSCAN_URL -e JUSTSCAN_ORG_ID -e JUSTSCAN_TOKEN \
  ghcr.io/justlabv1/justscan-cli:latest \
  scan --local my-app:ci
~~~

Mounting the Docker socket gives the container control of that Docker daemon. Use this only in an
isolated CI runner you trust, and pin a released CLI version (for example `:1.2.3`) in external
workflows rather than `:latest`.

## Global options and environment variables

| Option / variable | Purpose |
| --- | --- |
| --server / JUSTSCAN_URL | Instance URL. |
| --org / JUSTSCAN_ORG_ID | Organization UUID. |
| --profile / JUSTSCAN_PROFILE | Configuration profile. |
| --config | Override the profile configuration file path. |
| --ca-cert / JUSTSCAN_CA_CERT | Custom CA certificate for an internal TLS PKI. |
| --output human or json | Human-readable or machine-readable output. |
| --token-stdin | Read a bearer token from standard input. |
| --insecure-skip-tls-verify | Disable TLS verification. Avoid except during controlled troubleshooting. |
| --allow-insecure-http | Allow HTTP for a non-loopback host. Avoid in production. |

Flag values take precedence over environment variables, which take precedence over the active
profile.

## Command reference

| Command | Purpose |
| --- | --- |
| justscan scan IMAGE | Submit a registry image scan and wait for its policy verdict. |
| justscan scan --local IMAGE | Stream a Docker/Podman image archive to JustScan. |
| justscan scan --archive FILE_OR_HTTPS_URL | Upload a saved or remote archive. |
| justscan status SCAN_ID | Read a submitted pipeline scan; add --wait to poll. |
| justscan login / logout | Manage the local keychain credential. |
| justscan config set/use/show/list/delete | Manage non-secret profiles. |
| justscan completion SHELL | Generate completion for bash, zsh, fish, or PowerShell. |
| justscan version | Print version and build metadata. |

Run justscan --help or justscan COMMAND --help for exact flags in the installed version.
`justscan scan local IMAGE`, `justscan scan archive FILE_OR_HTTPS_URL`, `justscan local IMAGE`,
and `justscan archive FILE_OR_HTTPS_URL` remain supported as compatibility aliases. Prefer the
flag-based `justscan scan --local` and `justscan scan --archive` forms for new scripts.

## Best practices

- Use a personal login for interactive work and a short-lived, least-privilege pipeline_scan token
  for CI/CD.
- Use a secret manager or CI secret store. Never store tokens in source code, build logs, shell
  profiles, or image layers.
- Prefer immutable tags or digests in CI so a scan is tied to the artifact you deploy.
- Set --source and --external-ref on registry pipeline scans to make scan history traceable.
- Keep archive URLs short-lived and HTTPS-only. The CLI transfers the content; it does not forward
  cloud credentials to JustScan.
- Use the organization policy configuration as the only release gate. Do not duplicate severity
  thresholds in shell scripts.
- Use --output json when another tool consumes a result; retain human output for people.
- For private registries, configure registry access in JustScan rather than passing credentials on
  the command line.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| authentication required | Run justscan login for interactive work, or set JUSTSCAN_TOKEN in CI. |
| Login prompt fails in CI | Use a pipeline token; interactive login is not for CI. |
| Archive upload scanning is unavailable | Enable Trivy/archive scanning on the JustScan instance. |
| Docker image export fails | Confirm the image exists with docker image inspect IMAGE; use --engine podman where appropriate. |
| Archive rejected | Use a non-empty .tar, .tar.gz, or .tgz archive no larger than 5 GB. |
| Remote URL fails | Supply a direct HTTPS URL; use --filename for Google Drive; verify a presigned S3 URL has not expired. |
| Internal TLS error | Supply the corporate CA with --ca-cert. Do not default to --insecure-skip-tls-verify. |
| Scan times out | Increase --timeout only after checking scan details and JustScan worker capacity. |

## Reports

The web UI currently provides its PDF option through the browser print view. It is not yet a
server-side PDF export API, so the CLI cannot download a PDF report today. Use the scan details
page to save a PDF until a dedicated server-rendered report endpoint is available.
