package scanner

import (
	"context"
	"net/http"
	"testing"

	"justscan-backend/pkg/models"
)

func TestXrayContextAnalysisPathsUseDigest(t *testing.T) {
	client := &xrayClient{artifactoryID: "default", registryURL: "http://registry.test", registryHTTPClient: newTestHTTPClient(func(*http.Request) (*http.Response, error) {
		t.Fatal("digest-bound scans must not probe the tag manifest")
		return nil, nil
	})}
	scan := &models.Scan{ImageName: "docker-remote/library/nginx", ImageTag: "1.27", ImageDigest: "sha256:abc"}
	paths := xrayContextAnalysisPaths(context.Background(), client, scan, &models.Registry{URL: "https://registry.test"})
	want := []string{
		"default/docker-remote/library/nginx/sha256__abc/manifest.json",
		"default/docker-remote-cache/library/nginx/sha256__abc/manifest.json",
	}
	if len(paths) != len(want) || paths[0] != want[0] || paths[1] != want[1] {
		t.Fatalf("unexpected paths %v", paths)
	}
}

func TestXrayContextAnalysisPathsFallBackToTag(t *testing.T) {
	client := &xrayClient{artifactoryID: "default", registryURL: "http://registry.test", registryHTTPClient: newTestHTTPClient(func(*http.Request) (*http.Response, error) {
		return jsonResponse(200, map[string]any{"mediaType": "application/vnd.oci.image.index.v1+json", "manifests": []any{}}), nil
	})}
	scan := &models.Scan{ImageName: "docker-remote/library/nginx", ImageTag: "1.27"}
	paths := xrayContextAnalysisPaths(context.Background(), client, scan, &models.Registry{URL: "https://registry.test"})
	if len(paths) != 1 || paths[0] != "default/docker-remote/library/nginx/1.27/list.manifest.json" {
		t.Fatalf("unexpected paths %v", paths)
	}
}
