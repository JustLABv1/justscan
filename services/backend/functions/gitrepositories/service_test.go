package gitrepositories

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"justscan-backend/config"
	"justscan-backend/pkg/crypto"
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

func TestAppendHelmChartBuildsDependenciesBeforeRendering(t *testing.T) {
	dir := t.TempDir()
	chartDir := filepath.Join(dir, "charts", "demo")
	if err := os.MkdirAll(chartDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(chartDir, "Chart.yaml"), []byte("apiVersion: v2\nname: demo\nversion: 0.1.0\n"), 0600); err != nil {
		t.Fatal(err)
	}
	binDir := t.TempDir()
	logPath := filepath.Join(t.TempDir(), "helm.log")
	command := "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$JUSTSCAN_HELM_LOG\"\nif [ \"$1\" = template ]; then\n  printf '%s\\n' 'apiVersion: v1' 'kind: Pod' 'spec:' '  containers:' '    - name: demo' '      image: registry.example.com/demo:1.0.0'\nfi\n"
	if err := os.WriteFile(filepath.Join(binDir, "helm"), []byte(command), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("JUSTSCAN_HELM_LOG", logPath)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	byRef := map[string]*DiscoveredImage{}
	if err := appendHelmChart(context.Background(), dir, byRef, justScanSource{Chart: "charts/demo"}); err != nil {
		t.Fatalf("appendHelmChart() error = %v", err)
	}
	output, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	if len(lines) != 2 || !strings.HasPrefix(lines[0], "dependency build ") || !strings.HasPrefix(lines[1], "template demo ") {
		t.Fatalf("unexpected Helm invocation order: %#v", lines)
	}
	if _, ok := byRef["registry.example.com/demo:1.0.0"]; !ok {
		t.Fatalf("rendered image was not discovered: %#v", byRef)
	}
}

func TestAppendHelmChartFromExternalRootUsesDeploymentValues(t *testing.T) {
	deploymentRoot := t.TempDir()
	chartRoot := t.TempDir()
	chartDir := filepath.Join(chartRoot, "apps", "demo")
	valuesPath := filepath.Join(deploymentRoot, "envs", "dev", "demo", "values.yaml")
	if err := os.MkdirAll(filepath.Join(chartDir, "templates"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(valuesPath), 0700); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		filepath.Join(chartDir, "Chart.yaml"):            "apiVersion: v2\nname: demo\nversion: 0.1.0\n",
		filepath.Join(chartDir, "values.yaml"):           "image: registry.example.com/demo:default\n",
		filepath.Join(chartDir, "templates", "pod.yaml"): "apiVersion: v1\nkind: Pod\nmetadata:\n  name: demo\nspec:\n  containers:\n    - name: demo\n      image: {{ .Values.image }}\n",
		valuesPath: "image: registry.example.com/demo:effective\n",
	}
	for path, content := range files {
		if err := os.WriteFile(path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	byRef := map[string]*DiscoveredImage{}
	err := appendHelmChartFromRoots(context.Background(), deploymentRoot, chartRoot, byRef, justScanSource{
		Chart: "apps/demo", Values: []string{"envs/dev/demo/values.yaml"},
	}, "chart-repository@main:apps/demo", models.GitRepository{}, nil)
	if err != nil {
		t.Fatalf("appendHelmChartFromRoots() error = %v", err)
	}
	image := byRef["registry.example.com/demo:effective"]
	if image == nil {
		t.Fatalf("external chart did not use deployment values: %#v", byRef)
	}
	if target := image.Locations[0].Target; target != "Helm values envs/dev/demo/values.yaml" {
		t.Fatalf("render target = %q", target)
	}
}

func TestManagedHelmChartRepositoryUsesDirectSourceCredentials(t *testing.T) {
	source := models.GitRepositoryHelmSource{
		SourceType:          "url",
		CloneURL:            "https://git.example.com/team/chart.git",
		Ref:                 "release",
		AuthType:            models.GitRepositoryAuthToken,
		Username:            "git-user",
		EncryptedCredential: "encrypted",
	}
	repository, err := managedHelmChartRepository(context.Background(), nil, source)
	if err != nil {
		t.Fatal(err)
	}
	if repository.CloneURL != source.CloneURL || repository.Ref != "release" || repository.EncryptedCredential != "encrypted" {
		t.Fatalf("direct source was not mapped to a clone connector: %#v", repository)
	}
}

func TestWriteHelmRegistryCredentialsSupportsTokenAuthFlows(t *testing.T) {
	home := t.TempDir()
	err := writeHelmRegistryCredentials(home, []helmRegistryCredential{
		{Host: "cloud.de", AuthType: models.RegistryAuthToken, Username: "jfrog-user", Password: "access-token"},
		{Host: "bearer.example.com", AuthType: models.RegistryAuthToken, Password: "bearer-token"},
		{Host: "basic.example.com", AuthType: models.RegistryAuthBasic, Username: "registry-user", Password: "registry-password"},
	})
	if err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(filepath.Join(home, "registry.json"))
	if err != nil {
		t.Fatal(err)
	}
	var configuration helmRegistryFile
	if err := json.Unmarshal(content, &configuration); err != nil {
		t.Fatal(err)
	}
	if got := configuration.Auths["cloud.de"].Auth; got != base64.StdEncoding.EncodeToString([]byte("jfrog-user:access-token")) {
		t.Fatalf("Artifactory token auth = %q", got)
	}
	if got := configuration.Auths["cloud.de"].RegistryToken; got != "" {
		t.Fatalf("Artifactory token stored as direct Bearer token = %q", got)
	}
	if got := configuration.Auths["bearer.example.com"].RegistryToken; got != "bearer-token" {
		t.Fatalf("direct Bearer token = %q", got)
	}
	if got := configuration.Auths["basic.example.com"].Auth; got != base64.StdEncoding.EncodeToString([]byte("registry-user:registry-password")) {
		t.Fatalf("basic auth = %q", got)
	}
}

func TestHelmRegistryMatchScorePrefersDependencyRepository(t *testing.T) {
	dependency := helmRepositoryPath("oci://cloud.de/ki-helm-local")
	if got := helmRegistryMatchScore(dependency, helmRepositoryPath("https://cloud.de/ki-helm-local")); got <= helmRegistryMatchScore(dependency, helmRepositoryPath("https://cloud.de/docker-remote")) {
		t.Fatalf("exact dependency repository did not outrank a different repository: %d", got)
	}
	if got := helmRegistryMatchScore(dependency, helmRepositoryPath("https://cloud.de")); got <= 0 {
		t.Fatalf("host-wide registry score = %d", got)
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
	candidates := findDiscoveryCandidates(dir, nil, configuration, nil)
	if len(candidates) != 1 {
		t.Fatalf("candidates = %#v, want one candidate", candidates)
	}
	if candidates[0].Status != models.GitRepositoryCandidateAutoAccepted {
		t.Fatalf("candidate status = %q, want auto_accepted", candidates[0].Status)
	}

	rule := models.GitRepositoryDiscoveryRule{PathPattern: "envs/demo/app2/values.yaml", Resolution: "ignore"}
	candidates = findDiscoveryCandidates(dir, []models.GitRepositoryDiscoveryRule{rule}, justScanConfig{}, nil)
	if candidates[0].Status != models.GitRepositoryCandidateIgnored {
		t.Fatalf("candidate status = %q, want ignored", candidates[0].Status)
	}

	candidates = findDiscoveryCandidates(dir, nil, justScanConfig{}, []models.GitRepositoryHelmSource{{Values: []string{"envs/demo/app2/values.yaml"}}})
	if candidates[0].Status != models.GitRepositoryCandidateResolved {
		t.Fatalf("managed Helm candidate status = %q, want resolved", candidates[0].Status)
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

func TestCreateGitCredentialHelperUsesUniquePrivateFiles(t *testing.T) {
	dir := t.TempDir()
	first, err := createGitCredentialHelper(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(first)
	second, err := createGitCredentialHelper(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(second)

	if first == second {
		t.Fatalf("credential helper paths are identical: %s", first)
	}
	for _, path := range []string{first, second} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0700 {
			t.Fatalf("credential helper mode = %o, want 700", info.Mode().Perm())
		}
	}
}

func TestCloneSuppliesStoredCredentialsAfterHTTPChallenge(t *testing.T) {
	const (
		username = "git-user"
		secret   = "token-$-percent%"
		key      = "git-repository-test-encryption-key"
	)

	var authenticated atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		actualUsername, actualSecret, ok := r.BasicAuth()
		if ok && actualUsername == username && actualSecret == secret {
			authenticated.Store(true)
			http.Error(w, "authenticated test endpoint", http.StatusNotFound)
			return
		}
		w.Header().Set("WWW-Authenticate", `Basic realm="git"`)
		http.Error(w, "authentication required", http.StatusUnauthorized)
	}))
	defer server.Close()

	previousConfig := config.Config
	config.Config = &config.RestfulConf{Encryption: config.EncryptionConf{Key: key}}
	defer func() { config.Config = previousConfig }()

	encryptedSecret, err := crypto.Encrypt(crypto.KeyFromString(key), secret)
	if err != nil {
		t.Fatal(err)
	}
	repository := models.GitRepository{
		CloneURL:            server.URL + "/group/repository.git",
		Ref:                 "HEAD",
		AuthType:            models.GitRepositoryAuthToken,
		Username:            username,
		EncryptedCredential: encryptedSecret,
	}

	_ = clone(context.Background(), repository, filepath.Join(t.TempDir(), "checkout"))
	if !authenticated.Load() {
		t.Fatal("Git did not send the stored connector credentials after the HTTP challenge")
	}
}

func TestCloneRejectsIncompleteStoredAuthentication(t *testing.T) {
	tests := []struct {
		name       string
		repository models.GitRepository
		want       string
	}{
		{
			name: "missing username",
			repository: models.GitRepository{
				AuthType:            models.GitRepositoryAuthToken,
				EncryptedCredential: "configured",
			},
			want: "Git username is missing",
		},
		{
			name: "missing credential",
			repository: models.GitRepository{
				AuthType: models.GitRepositoryAuthToken,
				Username: "git-user",
			},
			want: "Git token or password is missing",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := clone(context.Background(), test.repository, filepath.Join(t.TempDir(), "checkout"))
			if err == nil || !strings.Contains(err.Error(), test.want) {
				t.Fatalf("clone() error = %v, want message containing %q", err, test.want)
			}
		})
	}
}
