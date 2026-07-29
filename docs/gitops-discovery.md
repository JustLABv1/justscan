# GitOps repository discovery

JustScan discovers images from the deployment outputs of a connected Git repository. A dry run never creates scans.

## Automatic discovery

Without repository configuration, JustScan uses the connector's selected mode:

- **Auto** renders detected Kustomize deployment roots. If none exist, it reads plain Kubernetes workload manifests.
- **Kustomize entrypoints** renders the paths selected in the connector settings.
- **Plain Kubernetes manifests** reads `containers`, `initContainers`, and `ephemeralContainers` from YAML files.

Automatic Kustomize discovery skips common documentation and fixture directories such as `.guide`, `docs`, `examples`, and `testdata`.

## Repository-owned configuration

Place a `.justscan.yaml` file at the repository root to compose several deployment mechanisms in one discovery. When present, it takes precedence over the connector's discovery mode.

The repository page also records unresolved markers as review candidates. Resolve one in the UI to apply it immediately; export the saved rules when you are ready to commit the same decision to Git. A committed `.justscan.yaml` takes precedence over any saved UI rule.

```yaml
version: 1
discovery:
  sources:
    - type: kustomize
      root: envs

    - type: manifests
      paths:
        - manifests

    - type: helm
      chart: charts/standalone-service
      releaseName: standalone-service
      values:
        - apps/standalone-service/values.yaml
        - envs/demo/dev/standalone-service/values.yaml
```

### `kustomize` source

Use one of the following:

- `root`: a repository-relative directory beneath which JustScan automatically finds Kustomize deployment roots.
- `paths`: explicit repository-relative paths to `kustomization.yaml` files or their directories.

Kustomize rendering enables its built-in Helm support, so `helmCharts`, `valuesFile`, and `valuesInline` are resolved together. Only images in the rendered Kubernetes workloads are discovered.

### `manifests` source

`paths` is required. Each path may name a YAML file or a directory of plain Kubernetes manifests. JustScan ignores Helm values files unless they are rendered through a Kustomize or Helm source.

### `helm` source

`chart` is required and must be a repository-relative local Helm chart directory. `values` is optional and is applied in order. Before rendering, JustScan runs `helm dependency build` inside the short-lived clone, so `Chart.lock` is honored and downloaded dependencies are never written back to Git. OCI and HTTP dependency credentials are taken from the dedicated Helm registry credential resource in the same workspace.

### Managed Helm sources

The repository page can also store a Helm source outside `.justscan.yaml`. Choose a local chart, another registered Git repository in the same workspace, or a direct HTTPS Git URL. Direct-source credentials are encrypted at rest; values files always remain paths in the deployment repository. Managed sources are rendered alongside `.justscan.yaml`, because connector IDs and credentials cannot be exported safely.

Each managed source may select a dedicated Helm registry credential. The default automatically matches protocol, host, and repository path to accessible Helm credentials. An explicit selection takes precedence for matching dependencies, which makes credential choice deterministic when multiple credentials use the same upstream host. Existing `dependency_registry_id` links remain a legacy compatibility path only; new sources never resolve normal image registries.

## Setup-infra example

For the `setup-infra` layout, add this at the repository root:

```yaml
version: 1
discovery:
  sources:
    # Environment overlays render the local charts with their final overrides.
    - type: kustomize
      root: envs

    # Include independently deployed raw resources, if any contain workloads.
    - type: manifests
      paths:
        - manifests
```

The `charts` and `apps` directories are intentionally not standalone manifest sources: they are inputs to the environment Kustomize renders. Add a `helm` source only for a chart that is actually deployed directly rather than through `envs`.

## Review-rule export

Exported rules are intentionally small: automatic discovery continues to handle high-confidence targets, while the file records only exceptions that needed operator input.

```yaml
version: 1
discovery:
  rules:
    - match: envs/demo/app2/values.yaml
      type: helm
      chart: charts/app2
      values:
        - apps/app2/values.yaml
        - envs/demo/app2/values.yaml
```
