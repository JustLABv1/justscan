package mcpserver

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"justscan-backend/config"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestReadOnlyServerAdvertisesScanTools(t *testing.T) {
	ctx := context.Background()
	server := NewReadOnlyServer(nil, Identity{}, 50)
	serverTransport, clientTransport := sdk.NewInMemoryTransports()

	serverSession, err := server.Connect(ctx, serverTransport, nil)
	if err != nil {
		t.Fatalf("connect server: %v", err)
	}
	defer serverSession.Close()

	client := sdk.NewClient(&sdk.Implementation{Name: "test-client", Version: "v1"}, nil)
	clientSession, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatalf("connect client: %v", err)
	}
	defer clientSession.Close()

	tools, err := clientSession.ListTools(ctx, nil)
	if err != nil {
		t.Fatalf("list tools: %v", err)
	}
	if len(tools.Tools) != 2 {
		t.Fatalf("tool count = %d, want 2", len(tools.Tools))
	}

	seen := map[string]bool{}
	for _, tool := range tools.Tools {
		seen[tool.Name] = true
	}
	for _, name := range []string{"list_scans", "get_scan"} {
		if !seen[name] {
			t.Errorf("tool %q was not advertised", name)
		}
	}
	if seen["rescan"] || seen["delete_scan"] {
		t.Fatal("read-only server advertised a mutation tool")
	}
}

func TestServerAdvertisesTriageAndConfirmedActionTools(t *testing.T) {
	ctx := context.Background()
	server := NewServer(nil, Identity{}, 50)
	serverTransport, clientTransport := sdk.NewInMemoryTransports()

	serverSession, err := server.Connect(ctx, serverTransport, nil)
	if err != nil {
		t.Fatalf("connect server: %v", err)
	}
	defer serverSession.Close()

	client := sdk.NewClient(&sdk.Implementation{Name: "test-client", Version: "v1"}, nil)
	clientSession, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatalf("connect client: %v", err)
	}
	defer clientSession.Close()

	tools, err := clientSession.ListTools(ctx, nil)
	if err != nil {
		t.Fatalf("list tools: %v", err)
	}
	want := []string{
		"list_scans", "get_scan", "list_watchlists", "get_watchlist",
		"get_scan_intelligence", "list_intelligence_impacts",
		"rescan_scan", "trigger_watchlist_scan",
	}
	if len(tools.Tools) != len(want) {
		t.Fatalf("tool count = %d, want %d", len(tools.Tools), len(want))
	}
	seen := map[string]bool{}
	for _, tool := range tools.Tools {
		seen[tool.Name] = true
	}
	for _, name := range want {
		if !seen[name] {
			t.Errorf("tool %q was not advertised", name)
		}
	}
}

func TestConfirmedActionInputRequiresExplicitConfirmationAndKey(t *testing.T) {
	if _, err := parseConfirmedResource("11111111-1111-1111-1111-111111111111", false, "key", "scan_id"); err == nil {
		t.Fatal("expected confirmation to be required")
	}
	if _, err := parseConfirmedResource("11111111-1111-1111-1111-111111111111", true, "", "scan_id"); err == nil {
		t.Fatal("expected idempotency key to be required")
	}
	if _, err := parseConfirmedResource("11111111-1111-1111-1111-111111111111", true, "key", "scan_id"); err != nil {
		t.Fatalf("valid confirmed action rejected: %v", err)
	}
}

func TestHTTPHandlerRejectsMissingBearerToken(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/mcp", nil)
	NewHTTPHandler(nil, config.MCPConf{MaxPageSize: 50}).ServeHTTP(recorder, request)
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusUnauthorized)
	}
	if recorder.Header().Get("WWW-Authenticate") == "" {
		t.Fatal("missing WWW-Authenticate challenge")
	}
}

func TestApplyListFiltersRejectsUnknownIntelligenceFilter(t *testing.T) {
	input := ListScansInput{Intelligence: "delete_everything"}
	if _, _, supported := intelligenceFilterCondition("scan.id", input.Intelligence); supported {
		t.Fatal("unknown intelligence filter was accepted")
	}
}

func TestSummarizeScanIncludesIntelligenceImpact(t *testing.T) {
	detectedAt := time.Date(2026, 8, 19, 12, 0, 0, 0, time.UTC)
	summary := summarizeScan(models.Scan{
		ID:        uuid.MustParse("11111111-1111-1111-1111-111111111111"),
		ImageName: "registry.example.com/team/api",
		ImageTag:  "1.2.3",
	}, &models.IntelligenceSummary{
		State:                models.IntelligenceSummaryStateConfirmationPending,
		ChangedCVECount:      2,
		ChangedFindingCount:  3,
		NeedsValidationCount: 1,
		FixAvailableCount:    1,
		DetectedAt:           &detectedAt,
	})

	if summary.Intelligence == nil {
		t.Fatal("expected CVE intelligence impact in scan summary")
	}
	if summary.Intelligence.State != models.IntelligenceSummaryStateConfirmationPending {
		t.Fatalf("intelligence state = %q", summary.Intelligence.State)
	}
	if summary.Intelligence.NeedsValidationCount != 1 {
		t.Fatalf("needs validation count = %d, want 1", summary.Intelligence.NeedsValidationCount)
	}
	if summary.Intelligence.DetectedAt != detectedAt.Format(time.RFC3339) {
		t.Fatalf("detected_at = %q, want %q", summary.Intelligence.DetectedAt, detectedAt.Format(time.RFC3339))
	}
}
