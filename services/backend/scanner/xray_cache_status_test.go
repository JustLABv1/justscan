package scanner

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

// xrayStatusByRepo answers artifact/status like Xray does for a remote
// repository: the remote key reports NOT_SCANNED (with the request time as
// `time`), while its -cache repository is the path that actually gets scanned.
func xrayStatusByRepo(t *testing.T, cacheStatuses func(call int) (string, string)) *http.Client {
	t.Helper()
	cacheCalls := 0
	return newTestHTTPClient(func(req *http.Request) (*http.Response, error) {
		var body struct {
			Repo string `json:"repo"`
		}
		_ = json.NewDecoder(req.Body).Decode(&body)
		now := time.Now().UTC().Format(time.RFC3339)
		if strings.HasSuffix(body.Repo, "-cache") {
			cacheCalls++
			status, at := cacheStatuses(cacheCalls)
			return jsonResponse(200, map[string]any{"overall": map[string]string{"status": status, "time": at}}), nil
		}
		return jsonResponse(200, map[string]any{"overall": map[string]string{"status": "NOT_SCANNED", "time": now}}), nil
	})
}

func remoteAndCacheCandidates() []xrayArtifactPathCandidate {
	return buildXrayArtifactPathCandidates("default", "m029-ghcr-remote", "justlabv1/justapps", "frontend-2.0.3", "manifest.json", "sha256:abc")
}

func TestXrayBaselinePrefersScannedCacheOverNotScannedRemote(t *testing.T) {
	completed := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	client := &xrayClient{baseURL: "http://xray.test", httpClient: xrayStatusByRepo(t, func(int) (string, string) { return "DONE", completed })}

	status, candidate, err := client.waitForArtifactStatusUntil(context.Background(), remoteAndCacheCandidates(), nil, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if candidate.Repository != "m029-ghcr-remote-cache" || status.Status != "DONE" {
		t.Fatalf("baseline pinned to %s (%s); want the scanned -cache path", candidate.Repository, status.Status)
	}
}

func TestXrayNotScannedStatusHasNoCompletionTime(t *testing.T) {
	client := &xrayClient{baseURL: "http://xray.test", httpClient: xrayStatusByRepo(t, func(int) (string, string) { return "NOT_SCANNED", time.Now().UTC().Format(time.RFC3339) })}

	status, _, err := client.waitForArtifactStatusUntil(context.Background(), remoteAndCacheCandidates(), nil, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if status.Status != "NOT_SCANNED" || status.Time != nil {
		t.Fatalf("NOT_SCANNED must be returned without a completion time, got %#v", status)
	}
}

func TestXrayFreshWaitFollowsCacheWhenRemoteStaysNotScanned(t *testing.T) {
	before := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)
	client := &xrayClient{baseURL: "http://xray.test", httpClient: xrayStatusByRepo(t, func(call int) (string, string) {
		if call == 1 {
			return "IN_PROGRESS", before
		}
		return "DONE", time.Now().UTC().Format(time.RFC3339)
	})}
	requestedAt := time.Now().UTC()
	client.freshRequestedAt = &requestedAt

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	status, candidate, err := client.waitForArtifactStatus(ctx, remoteAndCacheCandidates(), nil, true)
	if err != nil {
		t.Fatalf("fresh wait failed while the cache path completed: %v", err)
	}
	if candidate.Repository != "m029-ghcr-remote-cache" || status.Status != "DONE" {
		t.Fatalf("unexpected fresh result %s (%s)", candidate.Repository, status.Status)
	}
}

func TestXrayFreshTimeoutNamesLastStatuses(t *testing.T) {
	client := &xrayClient{baseURL: "http://xray.test", httpClient: xrayStatusByRepo(t, func(int) (string, string) { return "NOT_SCANNED", "" })}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, _, err := client.waitForArtifactStatus(ctx, remoteAndCacheCandidates(), nil, true)
	if err == nil || !strings.Contains(err.Error(), "m029-ghcr-remote-cache/justlabv1/justapps/sha256__abc/manifest.json (NOT_SCANNED)") {
		t.Fatalf("timeout should list each path with its last status, got %v", err)
	}
}

func withXrayExistingResultGrace(t *testing.T, grace time.Duration) {
	previous := xrayExistingResultGrace
	xrayExistingResultGrace = grace
	t.Cleanup(func() { xrayExistingResultGrace = previous })
}

// Xray answers scanArtifact for an already scanned artifact with "Scan of
// artifact is in progress" but keeps reporting the earlier DONE result.
func TestXrayFreshWaitAcceptsExistingResultForScannedImage(t *testing.T) {
	withXrayExistingResultGrace(t, 0)
	completed := time.Date(2026, 11, 23, 9, 37, 24, 0, time.UTC)
	client := &xrayClient{baseURL: "http://xray.test", httpClient: xrayStatusByRepo(t, func(int) (string, string) {
		return "DONE", completed.Format(time.RFC3339)
	})}
	requestedAt := time.Now().UTC()
	client.freshRequestedAt = &requestedAt
	client.baselineCompleted = true

	status, candidate, err := client.waitForArtifactStatus(context.Background(), remoteAndCacheCandidates(), &completed, true)
	if err != nil {
		t.Fatalf("existing result should be accepted after the grace period: %v", err)
	}
	if !status.ExistingResult || candidate.Repository != "m029-ghcr-remote-cache" || status.Time == nil || !status.Time.Equal(completed) {
		t.Fatalf("unexpected result: %#v from %s", status, candidate.Repository)
	}
}

func TestXrayFreshWaitStillRequiresNewScanForUnscannedImage(t *testing.T) {
	withXrayExistingResultGrace(t, 0)
	old := time.Now().Add(-time.Hour).UTC()
	client := &xrayClient{baseURL: "http://xray.test", httpClient: xrayStatusByRepo(t, func(int) (string, string) {
		return "DONE", old.Format(time.RFC3339)
	})}
	requestedAt := time.Now().UTC()
	client.freshRequestedAt = &requestedAt
	client.baselineCompleted = false

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, _, err := client.waitForArtifactStatus(ctx, remoteAndCacheCandidates(), nil, true); err == nil {
		t.Fatal("a stale DONE must not be accepted when Xray had not finished a scan before the request")
	}
}
