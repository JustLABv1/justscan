package gitrepositories

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"justscan-backend/pkg/models"
)

func TestDiscoverYAMLExtractsAndDeduplicatesWorkloadImages(t *testing.T) {
	dir := t.TempDir()
	manifest := `apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  template:
    spec:
      initContainers:
        - name: init
          image: busybox:1.36
      containers:
        - name: api
          image: registry.example.com/team/api@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: ignored
data:
  image: not-a-container-image
`
	if err := os.WriteFile(filepath.Join(dir, "deployment.yaml"), []byte(manifest), 0600); err != nil {
		t.Fatal(err)
	}
	images, err := discoverYAML(dir)
	if err != nil {
		t.Fatalf("discoverYAML() error = %v", err)
	}
	if len(images) != 2 {
		t.Fatalf("discoverYAML() images = %d, want 2", len(images))
	}
	if images[0].FullRef != "busybox:1.36" {
		t.Fatalf("first image = %q", images[0].FullRef)
	}
	if len(images[0].Locations) != 1 || images[0].Locations[0].Path != "spec.template.spec.initContainers[0].image" {
		t.Fatalf("unexpected init container location: %#v", images[0].Locations)
	}
	if images[1].ImageTag != "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" {
		t.Fatalf("digest tag = %q", images[1].ImageTag)
	}
}

func TestDiscoverRepositoryRendersKustomizeEntrypoints(t *testing.T) {
	dir := t.TempDir()
	env := filepath.Join(dir, "envs", "dev")
	if err := os.MkdirAll(filepath.Join(env, "manifests"), 0700); err != nil {
		t.Fatal(err)
	}
	kustomization := `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - manifests/deployment.yaml
`
	deployment := `apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  template:
    spec:
      containers:
        - name: api
          image: registry.example.com/team/api:1.2.3
`
	values := `image:
  repository: should-not-be-discovered
  tag: latest
`
	if err := os.WriteFile(filepath.Join(env, "kustomization.yaml"), []byte(kustomization), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(env, "manifests", "deployment.yaml"), []byte(deployment), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "values.yaml"), []byte(values), 0600); err != nil {
		t.Fatal(err)
	}
	images, err := discoverRepository(context.Background(), dir, models.GitRepository{DiscoveryMode: models.GitRepositoryDiscoveryAuto})
	if err != nil {
		t.Fatalf("discoverRepository() error = %v", err)
	}
	if len(images) != 1 || images[0].FullRef != "registry.example.com/team/api:1.2.3" {
		t.Fatalf("unexpected discovered images: %#v", images)
	}
	if got := images[0].Locations[0].Target; got != "envs/dev/kustomization.yaml" {
		t.Fatalf("render target = %q", got)
	}
}

func TestDiscoverRepositoryUsesEffectiveKustomizeHelmValues(t *testing.T) {
	dir := t.TempDir()
	chartDir := filepath.Join(dir, "charts", "demo")
	envDir := filepath.Join(dir, "envs", "dev")
	if err := os.MkdirAll(filepath.Join(chartDir, "templates"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(envDir, 0700); err != nil {
		t.Fatal(err)
	}
	chart := "apiVersion: v2\nname: demo\nversion: 0.1.0\n"
	values := "image:\n  repository: default.example.com/demo\n  tag: default\n"
	template := `apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
spec:
  selector:
    matchLabels:
      app: demo
  template:
    metadata:
      labels:
        app: demo
    spec:
      containers:
        - name: demo
          image: {{ .Values.image.repository }}:{{ .Values.image.tag }}
`
	kustomization := `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
helmGlobals:
  chartHome: ../../charts
helmCharts:
  - name: demo
    releaseName: demo
    valuesInline:
      image:
        repository: registry.example.com/demo
        tag: effective
`
	for path, content := range map[string]string{
		filepath.Join(chartDir, "Chart.yaml"):               chart,
		filepath.Join(chartDir, "values.yaml"):              values,
		filepath.Join(chartDir, "templates", "deploy.yaml"): template,
		filepath.Join(envDir, "kustomization.yaml"):         kustomization,
	} {
		if err := os.WriteFile(path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	images, err := discoverRepository(context.Background(), dir, models.GitRepository{DiscoveryMode: models.GitRepositoryDiscoveryAuto})
	if err != nil {
		t.Fatalf("discoverRepository() error = %v", err)
	}
	if len(images) != 1 || images[0].FullRef != "registry.example.com/demo:effective" {
		t.Fatalf("expected effective Helm image, got %#v", images)
	}
}

func TestDiscoverRepositoryUsesJustScanConfiguredSources(t *testing.T) {
	dir := t.TempDir()
	chartDir := filepath.Join(dir, "charts", "demo")
	if err := os.MkdirAll(filepath.Join(chartDir, "templates"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "raw"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "envs", "dev", "demo"), 0700); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		filepath.Join(chartDir, "Chart.yaml"): "apiVersion: v2\nname: demo\nversion: 0.1.0\n",
		filepath.Join(chartDir, "templates", "deploy.yaml"): `apiVersion: apps/v1
kind: Deployment
metadata:
  name: chart-demo
spec:
  template:
    spec:
      containers:
        - name: demo
          image: registry.example.com/chart-demo:1.0.0
`,
		filepath.Join(dir, "raw", "deployment.yaml"): `apiVersion: apps/v1
kind: Deployment
metadata:
  name: raw-demo
spec:
  template:
    spec:
      containers:
        - name: demo
          image: registry.example.com/raw-demo:2.0.0
`,
		filepath.Join(dir, "envs", "dev", "demo", "values.yaml"): "replicas: 1\n",
		filepath.Join(dir, ".justscan.yaml"): `version: 1
discovery:
  sources:
    - type: helm
      chart: charts/demo
      values:
        - envs/dev/demo/values.yaml
    - type: manifests
      paths:
        - raw
`,
	}
	for path, content := range files {
		if err := os.WriteFile(path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	images, err := discoverRepository(context.Background(), dir, models.GitRepository{})
	if err != nil {
		t.Fatalf("discoverRepository() error = %v", err)
	}
	if len(images) != 2 || images[0].FullRef != "registry.example.com/chart-demo:1.0.0" || images[1].FullRef != "registry.example.com/raw-demo:2.0.0" {
		t.Fatalf("unexpected configured images: %#v", images)
	}
	if target := images[0].Locations[0].Target; target != "Helm values envs/dev/demo/values.yaml" {
		t.Fatalf("Helm target = %q, want final values file", target)
	}
}

func TestFindDiscoveryCandidatesHonorsRepositoryRules(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "envs", "demo", "app2", "values.yaml")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("image: example/app2\n"), 0600); err != nil {
		t.Fatal(err)
	}

	configuration := justScanConfig{}
	configuration.Discovery.Rules = []justScanRule{{
		Match: "envs/demo/app2/values.yaml", Type: "helm", Chart: "charts/app2",
	}}
	candidates := findDiscoveryCandidates(dir, nil, configuration)
	if len(candidates) != 1 {
		t.Fatalf("candidates = %#v, want one candidate", candidates)
	}
	if candidates[0].Status != models.GitRepositoryCandidateAutoAccepted {
		t.Fatalf("candidate status = %q, want auto_accepted", candidates[0].Status)
	}

	rule := models.GitRepositoryDiscoveryRule{PathPattern: "envs/demo/app2/values.yaml", Resolution: "ignore"}
	candidates = findDiscoveryCandidates(dir, []models.GitRepositoryDiscoveryRule{rule}, justScanConfig{})
	if candidates[0].Status != models.GitRepositoryCandidateIgnored {
		t.Fatalf("candidate status = %q, want ignored", candidates[0].Status)
	}
}

func TestFindKustomizationRootsSkipsDocumentationFixtures(t *testing.T) {
	dir := t.TempDir()
	for _, path := range []string{
		filepath.Join(dir, ".guide", "example", "kustomization.yaml"),
		filepath.Join(dir, "envs", "dev", "kustomization.yaml"),
	} {
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\n"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	roots, err := findKustomizationRoots(dir, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(roots) != 1 || roots[0] != filepath.Join(dir, "envs", "dev") {
		t.Fatalf("unexpected Kustomize roots: %#v", roots)
	}
}

func TestValidateCloneURL(t *testing.T) {
	for _, raw := range []string{"file:///tmp/repository", "ssh://git@example.com/repository.git", "https://token@example.com/repository.git"} {
		if err := validateCloneURL(raw); err == nil {
			t.Fatalf("validateCloneURL(%q) accepted unsafe URL", raw)
		}
	}
	if err := validateCloneURL("https://git.example.com/group/repository.git"); err != nil {
		t.Fatalf("validateCloneURL() error = %v", err)
	}
}
