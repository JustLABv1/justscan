package gitrepositories

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"justscan-backend/pkg/models"
)

func TestNormalizeDiscoveryExcludesValidatesSafeRelativeGlobs(t *testing.T) {
	got, err := NormalizeDiscoveryExcludes([]string{" .archive/** ", "envs/*/generated", "envs/*/generated"})
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{".archive/**", "envs/*/generated"}; !sameStrings(got, want) {
		t.Fatalf("normalized exclusions = %#v, want %#v", got, want)
	}

	for _, pattern := range []string{"", "/tmp/archive", "../archive", "envs/../archive", "C:/archive", "envs\\archive", "envs/[broken"} {
		if _, err := NormalizeDiscoveryExcludes([]string{pattern}); err == nil {
			t.Errorf("NormalizeDiscoveryExcludes(%q) accepted an unsafe pattern", pattern)
		}
	}
}

func TestDiscoveryPathMatcherPrunesArchiveDirectoriesAndDescendants(t *testing.T) {
	root := t.TempDir()
	matcher, err := newDiscoveryPathMatcher(root, []string{".archive/**", "**/generated/**", "*.secret"})
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{
		filepath.Join(root, ".archive"),
		filepath.Join(root, ".archive", "old", "kustomization.yaml"),
		filepath.Join(root, "envs", "generated"),
		filepath.Join(root, "envs", "generated", "nested", "manifest.yaml"),
		filepath.Join(root, "credentials.secret"),
	} {
		if !matcher.Excluded(path) {
			t.Errorf("matcher did not exclude %q", path)
		}
	}
	for _, path := range []string{root, filepath.Join(root, "envs", "dev", "deployment.yaml")} {
		if matcher.Excluded(path) {
			t.Errorf("matcher unexpectedly excluded %q", path)
		}
	}
}

func TestDiscoveryExcludesApplyToManifestGitLabRegistryAndCandidates(t *testing.T) {
	root := t.TempDir()
	writeDiscoveryTestFile(t, filepath.Join(root, "kept", "manifest.yaml"), discoveryManifest("kept.example.com/app:1"))
	writeDiscoveryTestFile(t, filepath.Join(root, ".archive", "manifest.yaml"), discoveryManifest("archive.example.com/app:1"))
	writeDiscoveryTestFile(t, filepath.Join(root, "ci", "kept.yml"), "build:\n  image: kept.example.com/ci:1\n")
	writeDiscoveryTestFile(t, filepath.Join(root, "ci", ".archive", "ignored.yml"), "build:\n  image: archive.example.com/ci:1\n")
	writeDiscoveryTestFile(t, filepath.Join(root, "images.txt"), "kept.example.com/app:1\narchive.example.com/app:1\n")
	writeDiscoveryTestFile(t, filepath.Join(root, "envs", "kept", "values.yaml"), "image: kept.example.com/app:1\n")
	writeDiscoveryTestFile(t, filepath.Join(root, ".archive", "envs", "values.yaml"), "image: archive.example.com/app:1\n")

	matcher, err := newDiscoveryPathMatcher(root, []string{".archive/**", "ci/.archive/**"})
	if err != nil {
		t.Fatal(err)
	}
	manifests, err := discoverYAMLWithMatcher(root, matcher)
	if err != nil {
		t.Fatal(err)
	}
	if !hasDiscoveredRef(manifests, "kept.example.com/app:1") || hasDiscoveredRef(manifests, "archive.example.com/app:1") {
		t.Fatalf("manifest exclusions failed: %#v", manifests)
	}

	ci, err := discoverGitLabCIWithMatcher(root, []string{"ci"}, matcher)
	if err != nil {
		t.Fatal(err)
	}
	if !hasDiscoveredRef(ci, "kept.example.com/ci:1") || hasDiscoveredRef(ci, "archive.example.com/ci:1") {
		t.Fatalf("GitLab CI exclusions failed: %#v", ci)
	}

	registry, err := discoverRegistryWithMatcher(root, "kept.example.com", matcher)
	if err != nil {
		t.Fatal(err)
	}
	if !hasDiscoveredRef(registry, "kept.example.com/app:1") || !hasDiscoveredRef(registry, "kept.example.com/ci:1") || hasDiscoveredRef(registry, "archive.example.com/app:1") {
		t.Fatalf("registry exclusions failed: %#v", registry)
	}

	candidates := findDiscoveryCandidatesWithMatcher(root, nil, justScanConfig{}, nil, matcher)
	if len(candidates) != 1 || candidates[0].Path != "envs/kept/values.yaml" {
		t.Fatalf("candidate exclusions failed: %#v", candidates)
	}
}

func TestDiscoverRepositoryRejectsExplicitExcludedKustomizeEntrypoint(t *testing.T) {
	root := t.TempDir()
	writeDiscoveryTestFile(t, filepath.Join(root, ".archive", "kustomization.yaml"), "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\n")
	_, err := discoverRepository(context.Background(), root, models.GitRepository{
		DiscoveryMode:     models.GitRepositoryDiscoveryAuto,
		Entrypoints:       []string{".archive/kustomization.yaml"},
		DiscoveryExcludes: []string{".archive/**"},
	})
	if err == nil || !strings.Contains(err.Error(), "is excluded") {
		t.Fatalf("explicit excluded entrypoint error = %v", err)
	}
}

func TestAutomaticKustomizeDiscoveryContinuesAfterBrokenRoot(t *testing.T) {
	root := t.TempDir()
	writeDiscoveryTestFile(t, filepath.Join(root, "broken", "kustomization.yaml"), "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n  - missing.yaml\n")
	writeDiscoveryTestFile(t, filepath.Join(root, "valid", "kustomization.yaml"), "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\nresources:\n  - deployment.yaml\n")
	writeDiscoveryTestFile(t, filepath.Join(root, "valid", "deployment.yaml"), discoveryManifest("valid.example.com/app:1"))

	matcher, err := newDiscoveryPathMatcher(root, nil)
	if err != nil {
		t.Fatal(err)
	}
	discovery, err := discoverRepositoryWithMatcher(context.Background(), root, models.GitRepository{DiscoveryMode: models.GitRepositoryDiscoveryAuto}, matcher)
	if err != nil {
		t.Fatalf("automatic discovery returned an error: %v", err)
	}
	if len(discovery.images) != 1 || discovery.images[0].FullRef != "valid.example.com/app:1" {
		t.Fatalf("automatic discovery images = %#v", discovery.images)
	}
	if len(discovery.warnings) != 1 || discovery.warnings[0].Path != "broken/kustomization.yaml" || discovery.warnings[0].Status != models.GitRepositoryCandidateUnresolved {
		t.Fatalf("automatic discovery warnings = %#v", discovery.warnings)
	}
}

func writeDiscoveryTestFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}

func discoveryManifest(image string) string {
	return "apiVersion: v1\nkind: Pod\nmetadata:\n  name: discovery-test\nspec:\n  containers:\n    - name: app\n      image: " + image + "\n"
}

func hasDiscoveredRef(images []DiscoveredImage, fullRef string) bool {
	for _, image := range images {
		if image.FullRef == fullRef {
			return true
		}
	}
	return false
}

func sameStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
