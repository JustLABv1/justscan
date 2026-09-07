package scanner

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"justscan-backend/config"
	"justscan-backend/pkg/models"
)

func TestXrayDeadlinesIndependentOfStaleTimeout(t *testing.T) {
	previous := config.Config
	config.Config = &config.RestfulConf{Scanner: config.ScannerConf{StaleTimeoutSeconds: 7200}}
	t.Cleanup(func() { config.Config = previous })
	if registryWarmupWaitWindow() != 10*time.Minute || xraySummaryWaitWindow() != 15*time.Minute {
		t.Fatal("Xray stage deadlines inherited worker stale timeout")
	}
	config.Config.Scanner.XrayWarmupTimeoutSeconds = 45
	config.Config.Scanner.XrayProviderTimeoutSeconds = 120
	if registryWarmupWaitWindow() != 45*time.Second || xraySummaryWaitWindow() != 2*time.Minute {
		t.Fatal("explicit Xray deadlines ignored")
	}
}

func TestXrayWarmupRetriesPreserveCompletedBlobs(t *testing.T) {
	calls := map[string]int{}
	client := &xrayClient{registryURL: "http://registry.test"}
	client.registryHTTPClient = newTestHTTPClient(func(req *http.Request) (*http.Response, error) {
		calls[req.URL.Path]++
		if strings.Contains(req.URL.Path, "/manifests/") {
			return jsonResponse(200, map[string]any{"mediaType": "application/vnd.oci.image.manifest.v1+json", "config": map[string]string{"digest": "sha256:config"}, "layers": []map[string]string{{"digest": "sha256:first"}, {"digest": "sha256:last"}}}), nil
		}
		if strings.HasSuffix(req.URL.Path, "sha256:last") && calls[req.URL.Path] == 1 {
			return jsonResponse(503, map[string]string{"error": "temporary"}), nil
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("blob"))}, nil
	})
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := client.warmImageInArtifactory(ctx, "repo/image", "sha256:manifest", ""); err != nil {
		t.Fatal(err)
	}
	for _, blob := range []string{"config", "first"} {
		if got := calls["/v2/repo/image/blobs/sha256:"+blob]; got != 1 {
			t.Fatalf("successful %s downloaded %d times", blob, got)
		}
	}
	if calls["/v2/repo/image/blobs/sha256:last"] != 2 {
		t.Fatal("failed blob was not retried")
	}
}

func TestXrayPreparationRetriesEOF(t *testing.T) {
	attempts := 0
	var progress []string
	client := &xrayClient{progress: func(message string) { progress = append(progress, message) }}
	err := client.retryRegistryPreparation(context.Background(), "digest resolution", time.Millisecond, func() error {
		attempts++
		if attempts == 1 {
			return io.EOF
		}
		return nil
	})
	if err != nil {
		t.Fatalf("expected EOF to be retried, got %v", err)
	}
	if attempts != 2 {
		t.Fatalf("expected two attempts, got %d", attempts)
	}
	if len(progress) != 1 || !strings.Contains(progress[0], "Preparing image retry 1") {
		t.Fatalf("expected a visible preparation retry update, got %#v", progress)
	}
}

func TestXrayPreparationDoesNotRetryPermanentError(t *testing.T) {
	attempts := 0
	client := &xrayClient{}
	want := errors.New("invalid manifest")
	err := client.retryRegistryPreparation(context.Background(), "digest resolution", time.Millisecond, func() error {
		attempts++
		return want
	})
	if !errors.Is(err, want) {
		t.Fatalf("expected permanent error, got %v", err)
	}
	if attempts != 1 {
		t.Fatalf("expected one attempt, got %d", attempts)
	}
}

func TestXrayWarmupAndPollingCancelInFlightRequests(t *testing.T) {
	for _, operation := range []string{"warm", "status", "summary"} {
		t.Run(operation, func(t *testing.T) {
			client := &xrayClient{registryURL: "http://registry.test", baseURL: "http://xray.test"}
			transport := newTestHTTPClient(func(req *http.Request) (*http.Response, error) {
				<-req.Context().Done()
				return nil, req.Context().Err()
			})
			client.registryHTTPClient, client.httpClient = transport, transport
			ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
			defer cancel()
			candidates := []xrayArtifactPathCandidate{{Repository: "repo", Path: "image/manifest.json", ArtifactPath: "repo/image/manifest.json"}}
			var err error
			switch operation {
			case "warm":
				err = client.warmImageInArtifactory(ctx, "repo/image", "tag", "")
			case "status":
				_, _, err = client.waitForArtifactStatus(ctx, candidates, nil, false)
			case "summary":
				_, _, err = client.pollArtifactSummary(ctx, candidates)
			}
			if !errors.Is(err, context.DeadlineExceeded) {
				t.Fatalf("deadline not propagated: %v", err)
			}
		})
	}
}

func TestXrayFreshnessCannotCrossCandidates(t *testing.T) {
	baseline := time.Now().Add(-time.Hour)
	client := &xrayClient{baseURL: "http://xray.test", httpClient: newTestHTTPClient(func(req *http.Request) (*http.Response, error) {
		var body map[string]string
		if err := decodeJSONBody(req, &body); err != nil {
			return nil, err
		}
		status := "DONE"
		if body["path"] == "a" {
			status = "PENDING"
		}
		return jsonResponse(200, map[string]any{"overall": map[string]string{"status": status, "time": baseline.Format(time.RFC3339)}}), nil
	})}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()
	_, _, err := client.waitForArtifactStatus(ctx, []xrayArtifactPathCandidate{{Path: "a", ArtifactPath: "repo/a"}, {Path: "b", ArtifactPath: "repo/b"}}, &baseline, true)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("accepted stale completion after another candidate was pending: %v", err)
	}
}

func TestXrayFullModeDoesNotWaitForInitialCompletion(t *testing.T) {
	client := &xrayClient{baseURL: "http://xray.test", httpClient: newTestHTTPClient(func(*http.Request) (*http.Response, error) {
		return jsonResponse(200, map[string]any{"overall": map[string]string{"status": "IN_PROGRESS"}}), nil
	})}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()
	status, _, err := client.waitForArtifactStatusUntil(ctx, []xrayArtifactPathCandidate{{Path: "a", ArtifactPath: "repo/a"}}, nil, false, false)
	if err != nil || status.Status != "IN_PROGRESS" {
		t.Fatalf("Full mode waited for DONE: %v", err)
	}
}

func TestXrayFreshCompletionWithoutBaselineTimestamp(t *testing.T) {
	requested := time.Now()
	completed := requested.Add(time.Second)
	old := requested.Add(-time.Hour)
	if !xrayCompletionIsFresh(&completed, nil, &requested) {
		t.Fatal("missed fast scan with new completion timestamp")
	}
	if xrayCompletionIsFresh(&old, nil, &requested) || xrayCompletionIsFresh(nil, nil, &requested) {
		t.Fatal("accepted unverified result")
	}
}

func TestXrayExplicitPlatformNeverFallsBack(t *testing.T) {
	items := []registryManifestDescriptor{{Digest: "sha256:a", Platform: &registryManifestPlatform{OS: "linux", Architecture: "amd64"}}}
	if len(selectManifestDescriptors(items, "linux/arm64")) != 0 {
		t.Fatal("silently selected amd64")
	}
	if len(selectManifestDescriptors(items, "")) != 1 {
		t.Fatal("default platform selection broken")
	}
	if err := validateXrayImagePlatform(models.JSONObject{"os": "linux", "architecture": "amd64"}, "linux/arm64"); err == nil {
		t.Fatal("single manifest platform mismatch accepted")
	}
}

func TestXrayDigestCandidatesExcludeMutableTag(t *testing.T) {
	candidates := buildXrayArtifactPathCandidates("default", "repo", "image", "latest", "list.manifest.json", "sha256:abc")
	selected := xrayDigestCandidates(candidates, "sha256:abc")
	if len(selected) != 2 {
		t.Fatalf("expected digest candidates for repository and cache, got %v", selected)
	}
	for _, candidate := range selected {
		if !strings.HasSuffix(candidate.Path, "/sha256__abc/manifest.json") {
			t.Fatal("tag candidate can substitute for digest")
		}
	}
}

func TestXrayPermitReleasedWhilePollingAndCancellation(t *testing.T) {
	pool := make(chan struct{}, 1)
	first, second := &xrayWorkPermit{pool: pool}, &xrayWorkPermit{pool: pool}
	if err := first.acquire(context.Background()); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := second.acquire(ctx); !errors.Is(err, context.Canceled) {
		t.Fatal("waiting import did not cancel")
	}
	first.release()
	if err := second.acquire(context.Background()); err != nil {
		t.Fatal(err)
	}
	second.release()
	second.release()
	if len(pool) != 0 {
		t.Fatal("execution permit leaked")
	}
}

func TestXrayImportDoesNotWaitBehindDownloads(t *testing.T) {
	previous := xrayImportPool
	xrayImportPool = make(chan struct{}, 1)
	t.Cleanup(func() { xrayImportPool = previous })
	downloads := make(chan struct{}, 1)
	downloads <- struct{}{}
	permit := &xrayWorkPermit{pool: downloads}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()
	if err := permit.acquireImport(ctx); err != nil {
		t.Fatalf("import blocked behind unrelated download: %v", err)
	}
	permit.release()
	if len(downloads) != 1 || len(xrayImportPool) != 0 {
		t.Fatal("wrong capacity pool released")
	}
}

func TestXrayProviderFailureStopsImmediately(t *testing.T) {
	client := &xrayClient{baseURL: "http://xray.test", httpClient: newTestHTTPClient(func(*http.Request) (*http.Response, error) {
		return jsonResponse(200, map[string]any{"overall": map[string]string{"status": "FAILED"}}), nil
	})}
	_, _, err := client.waitForArtifactStatus(context.Background(), []xrayArtifactPathCandidate{{Path: "a", ArtifactPath: "repo/a"}}, nil, false)
	if err == nil || !strings.Contains(err.Error(), "Xray reported FAILED") {
		t.Fatalf("provider failure not surfaced: %v", err)
	}
}

func TestXrayTagMovementRejected(t *testing.T) {
	client := &xrayClient{registryURL: "http://registry.test", registryHTTPClient: newTestHTTPClient(func(*http.Request) (*http.Response, error) {
		response := jsonResponse(200, map[string]string{"mediaType": "application/vnd.oci.image.manifest.v1+json"})
		response.Header.Set("Docker-Content-Digest", "sha256:new")
		return response, nil
	})}
	if err := client.verifyImageDigest(context.Background(), "repo/image", "latest", "", "sha256:old"); err == nil || !strings.Contains(err.Error(), "tag changed") {
		t.Fatalf("tag change accepted: %v", err)
	}
}
