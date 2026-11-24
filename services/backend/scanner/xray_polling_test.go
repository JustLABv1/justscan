package scanner

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestXrayPollDelayBacksOff(t *testing.T) {
	cases := map[int]time.Duration{0: 10 * time.Second, 5: 10 * time.Second, 6: 20 * time.Second, 12: 30 * time.Second, 18: 60 * time.Second, 500: 60 * time.Second}
	for attempt, want := range cases {
		if got := xrayPollDelay(attempt); got != want {
			t.Errorf("attempt %d: got %s want %s", attempt, got, want)
		}
	}
}

func withXrayIndexRequestDelay(t *testing.T, delay time.Duration) {
	previous := xrayIndexRequestDelay
	xrayIndexRequestDelay = delay
	t.Cleanup(func() { xrayIndexRequestDelay = previous })
}

func TestXrayRequestsOnDemandIndexingForUnknownArtifact(t *testing.T) {
	withXrayIndexRequestDelay(t, 0)
	scanRequests := 0
	client := &xrayClient{baseURL: "http://xray.test", missingArtifactWindow: time.Nanosecond, indexComponentID: "docker://image:tag", httpClient: newTestHTTPClient(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path == "/xray/api/v1/scanArtifact" {
			scanRequests++
			return jsonResponse(200, map[string]string{"info": "accepted"}), nil
		}
		return jsonResponse(404, map[string]string{"error": "not found"}), nil
	})}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	_, _, err := client.waitForArtifactStatus(ctx, []xrayArtifactPathCandidate{{Path: "a", ArtifactPath: "repo/a"}}, nil, false)
	if scanRequests != 1 {
		t.Fatalf("expected one on-demand index request, got %d", scanRequests)
	}
	if err == nil || strings.Contains(err.Error(), "did not expose") {
		t.Fatalf("accepted index request should extend the missing window, got %v", err)
	}
}

func TestXrayFailedIndexRequestKeepsMissingWindow(t *testing.T) {
	withXrayIndexRequestDelay(t, 0)
	client := &xrayClient{baseURL: "http://xray.test", missingArtifactWindow: time.Nanosecond, indexComponentID: "docker://image:tag", httpClient: newTestHTTPClient(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path == "/xray/api/v1/scanArtifact" {
			return jsonResponse(403, map[string]string{"error": "forbidden"}), nil
		}
		return jsonResponse(404, map[string]string{"error": "not found"}), nil
	})}
	_, _, err := client.waitForArtifactStatus(context.Background(), []xrayArtifactPathCandidate{{Path: "a", ArtifactPath: "repo/a"}}, nil, false)
	if err == nil || !strings.Contains(err.Error(), "did not expose") {
		t.Fatalf("failed index request should keep the original missing window, got %v", err)
	}
}
