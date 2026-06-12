package middlewares

import (
	"net/http"
	"testing"
)

func TestPipelineTokenRouteAllowed(t *testing.T) {
	tests := []struct {
		name   string
		method string
		route  string
		want   bool
	}{
		{"create pipeline scan", http.MethodPost, "/api/v1/orgs/:id/pipeline-scans", true},
		{"read pipeline scan", http.MethodGet, "/api/v1/orgs/:id/pipeline-scans/:scanId", true},
		{"list org tokens", http.MethodGet, "/api/v1/orgs/:id/tokens", false},
		{"create org token", http.MethodPost, "/api/v1/orgs/:id/tokens", false},
		{"wrong method", http.MethodDelete, "/api/v1/orgs/:id/pipeline-scans/:scanId", false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := pipelineTokenRouteAllowed(test.method, test.route); got != test.want {
				t.Fatalf("pipelineTokenRouteAllowed(%q, %q) = %v, want %v", test.method, test.route, got, test.want)
			}
		})
	}
}
