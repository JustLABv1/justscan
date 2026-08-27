package gitrepositories

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"justscan-backend/pkg/models"
)

func TestNormalizeRegistryDiscoveryPrefix(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "host and path", input: " Registry.Example.com/Team/ ", want: "registry.example.com/team"},
		{name: "port", input: "localhost:5000/apps", want: "localhost:5000/apps"},
		{name: "scheme", input: "https://registry.example.com/team", wantErr: true},
		{name: "traversal", input: "registry.example.com/../team", wantErr: true},
		{name: "wildcard", input: "registry.example.com/team/*", wantErr: true},
		{name: "leading slash", input: "/registry.example.com/team", wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := NormalizeRegistryDiscoveryPrefix(test.input)
			if test.wantErr {
				if err == nil {
					t.Fatalf("NormalizeRegistryDiscoveryPrefix(%q) accepted unsafe input as %q", test.input, got)
				}
				return
			}
			if err != nil || got != test.want {
				t.Fatalf("NormalizeRegistryDiscoveryPrefix(%q) = %q, %v; want %q", test.input, got, err, test.want)
			}
		})
	}
}

func TestDiscoverRegistryScansTextWithBoundedLocationsAndExclusions(t *testing.T) {
	root := t.TempDir()
	files := map[string]string{
		"src/config.yaml":  "image: registry.example.com/team/api:1.0\nagain: registry.example.com/team/api:1.0\nother: registry.example.com/team/worker@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
		"src/app.go":       `const image = "registry.example.com/team/api:1.0"` + "\n",
		"vendor/deps.go":   `var image = "registry.example.com/team/vendor:1.0"`,
		"generated/out.go": `var image = "registry.example.com/team/generated:1.0"`,
		"src/other.txt":    `image: registry.example.com/team-evil/app:1.0`,
	}
	for name, content := range files {
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(root, "src", "payload.bin"), []byte{0, 'r', 'e', 'g'}, 0600); err != nil {
		t.Fatal(err)
	}
	images, err := discoverRegistry(root, "registry.example.com/team/")
	if err != nil {
		t.Fatalf("discoverRegistry() error = %v", err)
	}
	if len(images) != 2 {
		t.Fatalf("discoverRegistry() returned %d images: %#v", len(images), images)
	}
	if images[0].FullRef != "registry.example.com/team/api:1.0" {
		t.Fatalf("first image = %q", images[0].FullRef)
	}
	if len(images[0].Locations) != 3 {
		t.Fatalf("api locations = %#v; want one per source line", images[0].Locations)
	}
	if images[0].Locations[0].File != "src/app.go" || images[0].Locations[1].File != "src/config.yaml" || images[0].Locations[2].File != "src/config.yaml" {
		t.Fatalf("api locations = %#v", images[0].Locations)
	}
	if !strings.Contains(images[1].FullRef, "@sha256:") {
		t.Fatalf("digest image = %q", images[1].FullRef)
	}
}

func TestDiscoverRegistryRequiresExplicitTagOrDigest(t *testing.T) {
	root := t.TempDir()
	content := strings.Join([]string{
		"tagged: registry.example.com/team/app:1.2.3",
		"digest: registry.example.com/team/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"tagless: registry.example.com/team/tagless",
		"port tagged: registry.example.com:5000/team/app:1.2.3",
		"port digest: registry.example.com:5000/team/app@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		"port tagless: registry.example.com:5000/team/tagless",
	}, "\n")
	if err := os.WriteFile(filepath.Join(root, "images.txt"), []byte(content), 0600); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		prefix string
		want   []string
	}{
		{
			prefix: "registry.example.com/team",
			want: []string{
				"registry.example.com/team/app:1.2.3",
				"registry.example.com/team/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			},
		},
		{
			prefix: "registry.example.com:5000/team",
			want: []string{
				"registry.example.com:5000/team/app:1.2.3",
				"registry.example.com:5000/team/app@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
			},
		},
	}
	for _, test := range tests {
		t.Run(test.prefix, func(t *testing.T) {
			images, err := discoverRegistry(root, test.prefix)
			if err != nil {
				t.Fatalf("discoverRegistry() error = %v", err)
			}
			got := make(map[string]bool, len(images))
			for _, image := range images {
				got[image.FullRef] = true
			}
			if len(got) != len(test.want) {
				t.Fatalf("discoverRegistry() found %d images: %#v; want %#v", len(got), got, test.want)
			}
			for _, want := range test.want {
				if !got[want] {
					t.Errorf("discoverRegistry() missing explicit reference %q; got %#v", want, got)
				}
			}
			for ref := range got {
				if strings.HasSuffix(ref, "/tagless") {
					t.Errorf("discoverRegistry() accepted tagless reference %q", ref)
				}
			}
		})
	}
}

func TestDiscoverRepositoryRegistryModeDoesNotNeedEntrypoints(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("registry.example.com/team/app:latest\n"), 0600); err != nil {
		t.Fatal(err)
	}
	images, err := discoverRepository(t.Context(), root, models.GitRepository{
		DiscoveryMode:     models.GitRepositoryDiscoveryRegistry,
		DiscoveryRegistry: "registry.example.com/team",
		Entrypoints:       nil,
	})
	if err != nil {
		t.Fatalf("discoverRepository() error = %v", err)
	}
	if len(images) != 1 || images[0].FullRef != "registry.example.com/team/app:latest" {
		t.Fatalf("registry discovery images = %#v", images)
	}
}
