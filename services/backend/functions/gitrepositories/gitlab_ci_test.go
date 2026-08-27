package gitrepositories

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"justscan-backend/pkg/models"
)

func TestDiscoverGitLabCIExtractsDeclaredImagesAcrossConfigFiles(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "ci"), 0700); err != nil {
		t.Fatal(err)
	}
	configs := map[string]string{
		filepath.Join(root, ".gitlab-ci.yml"): `variables:
  REGISTRY: registry.example.com
image: alpine:3.20
default:
  image:
    name: ${REGISTRY}/base:1.0
  services:
    - name: docker:27-dind
build:
  image: ${REGISTRY}/team/build:2.0
  services:
    - postgres:16
    - name: ${REGISTRY}/team/cache:3.0
  variables:
    JOB_REGISTRY: jobs.example.com
  script:
    - echo this is not an image declaration
not-a-job:
  description: this mapping intentionally has no image
`,
		filepath.Join(root, "ci", "release.yml"): `release:
  image: jobs.example.com/release:latest
  services:
    - name: redis:7
variables:
  EXAMPLE: https://docs.example.com/image:1
`,
	}
	for path, content := range configs {
		if err := os.WriteFile(path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}

	images, err := discoverGitLabCI(root, []string{".gitlab-ci.yml", "ci/release.yml"})
	if err != nil {
		t.Fatalf("discoverGitLabCI() error = %v", err)
	}
	refs := map[string]DiscoveredImage{}
	for _, image := range images {
		refs[image.FullRef] = image
	}
	for _, want := range []string{
		"alpine:3.20",
		"registry.example.com/base:1.0",
		"docker:27-dind",
		"registry.example.com/team/build:2.0",
		"postgres:16",
		"registry.example.com/team/cache:3.0",
		"jobs.example.com/release:latest",
		"redis:7",
	} {
		if _, ok := refs[want]; !ok {
			t.Errorf("missing discovered image %q; got %#v", want, images)
		}
	}
	if len(images) != 8 {
		t.Fatalf("discovered %d images, want 8: %#v", len(images), images)
	}
	build := refs["registry.example.com/team/build:2.0"]
	if len(build.Locations) != 1 || build.Locations[0].File != ".gitlab-ci.yml" || build.Locations[0].Path != "build.image" || build.Locations[0].Name != "build" {
		t.Fatalf("unexpected build image location: %#v", build.Locations)
	}
	release := refs["jobs.example.com/release:latest"]
	if len(release.Locations) != 1 || release.Locations[0].File != "ci/release.yml" || release.Locations[0].Path != "release.image" {
		t.Fatalf("unexpected release image location: %#v", release.Locations)
	}
}

func TestDiscoverGitLabCIFollowsLocalIncludesAndSkipsUnresolvedImages(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, ".gitlab-ci.yml"), []byte(`include:
  - local: ci/jobs.yml
  - remote: https://example.com/remote.yml
image: $CI_REGISTRY_IMAGE:$CI_COMMIT_SHA
`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "ci"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "ci", "jobs.yml"), []byte(`test:
  image: ${REGISTRY}/test:1.0
variables:
  REGISTRY: custom.example.com
`), 0600); err != nil {
		t.Fatal(err)
	}

	images, err := discoverGitLabCI(root, nil)
	if err != nil {
		t.Fatalf("discoverGitLabCI() error = %v", err)
	}
	if len(images) != 1 || images[0].FullRef != "custom.example.com/test:1.0" {
		t.Fatalf("unexpected included images: %#v", images)
	}
	if got := images[0].Locations[0].File; got != "ci/jobs.yml" {
		t.Fatalf("include location file = %q, want ci/jobs.yml", got)
	}
}

func TestDiscoverGitLabCISupportsCRLFDocumentBoundaries(t *testing.T) {
	root := t.TempDir()
	content := "spec:\r\n  inputs: {}\r\n--- # pipeline\r\nbuild:\r\n  image: registry.example.com/team/app:1.0\r\n"
	if err := os.WriteFile(filepath.Join(root, ".gitlab-ci.yml"), []byte(content), 0600); err != nil {
		t.Fatal(err)
	}

	images, err := discoverGitLabCI(root, nil)
	if err != nil {
		t.Fatalf("discoverGitLabCI() error = %v", err)
	}
	if len(images) != 1 || images[0].FullRef != "registry.example.com/team/app:1.0" {
		t.Fatalf("unexpected multi-document images: %#v", images)
	}
	if got := images[0].Locations[0].Document; got != 2 {
		t.Fatalf("document = %d, want 2", got)
	}
}

func TestDiscoverRepositoryGitLabCIModeUsesEntrypoints(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "pipeline.yml"), []byte(`build:
  image: custom.example.com/app:latest
`), 0600); err != nil {
		t.Fatal(err)
	}
	images, err := discoverRepository(context.Background(), root, models.GitRepository{
		DiscoveryMode: models.GitRepositoryDiscoveryGitLabCI,
		Entrypoints:   []string{"pipeline.yml"},
	})
	if err != nil {
		t.Fatalf("discoverRepository() error = %v", err)
	}
	if len(images) != 1 || images[0].FullRef != "custom.example.com/app:latest" {
		t.Fatalf("unexpected GitLab CI images: %#v", images)
	}
}

func TestDiscoverGitLabCIRejectsOutsidePaths(t *testing.T) {
	root := t.TempDir()
	if _, err := discoverGitLabCI(root, []string{"../pipeline.yml"}); err == nil {
		t.Fatal("discoverGitLabCI accepted a path outside the repository")
	}
}
