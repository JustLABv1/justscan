package scanner

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"justscan-backend/pkg/models"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestNormalizeNVDHistoryChangePreservesPayloadAndBeforeAfter(t *testing.T) {
	payload := models.JSONObject{
		"change": models.JSONObject{
			"cveId":            "CVE-2026-0001",
			"cveChangeId":      "change-1",
			"eventName":        "CVE Modified",
			"sourceIdentifier": "cna@example.test",
			"created":          "2026-08-01T10:00:00.123Z",
			"details": []any{models.JSONObject{
				"action":   "CHANGE",
				"type":     "CVSS",
				"oldValue": "7.5",
				"newValue": "8.1",
			}},
		},
		"providerOnlyField": "retained",
	}

	change, err := normalizeNVDHistoryChange(payload)
	if err != nil {
		t.Fatalf("normalize change: %v", err)
	}
	if change.CVEID != "CVE-2026-0001" || change.SourceEventID != "change-1" {
		t.Fatalf("identity = %q/%q", change.CVEID, change.SourceEventID)
	}
	if change.Before["CVSS"] != "7.5" || change.After["CVSS"] != "8.1" {
		t.Fatalf("before/after = %#v/%#v", change.Before, change.After)
	}
	if change.RawPayload["providerOnlyField"] != "retained" {
		t.Fatalf("raw payload lost provider field: %#v", change.RawPayload)
	}
}

func TestCVEHistoryClientFetchHistoryPage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("apiKey") != "test-key" {
			t.Errorf("api key header = %q", request.Header.Get("apiKey"))
		}
		query := request.URL.Query()
		if query.Get("changeStartDate") == "" || query.Get("changeEndDate") == "" || query.Get("resultsPerPage") != "2000" || query.Get("startIndex") != "0" {
			t.Errorf("unexpected history query: %s", request.URL.RawQuery)
		}
		_, _ = writer.Write([]byte(`{"resultsPerPage":2000,"startIndex":0,"totalResults":1,"cveChanges":[{"change":{"cveId":"CVE-2026-0002","eventName":"CVE Rejected","cveChangeId":"change-2","created":"2026-08-01T11:00:00Z","details":[]}}]}`))
	}))
	defer server.Close()

	client := &cveHistoryClient{
		nvdHistoryBaseURL: server.URL,
		apiKey:            "test-key",
		httpClient:        server.Client(),
		maxRetries:        0,
		sleep:             func(context.Context, time.Duration) error { return nil },
	}
	page, err := client.fetchHistoryPage(context.Background(), time.Now().Add(-time.Hour), time.Now(), 0)
	if err != nil {
		t.Fatalf("fetch history page: %v", err)
	}
	if len(page.Changes) != 1 || page.Changes[0].EventName != "CVE Rejected" {
		t.Fatalf("history changes = %#v", page.Changes)
	}
}

func TestNewCVEHistoryClientUsesLongRequestTimeout(t *testing.T) {
	client := newCVEHistoryClient()
	if client.httpClient == nil {
		t.Fatal("HTTP client is nil")
	}
	if client.httpClient.Timeout != defaultCVEHistoryTimeout {
		t.Fatalf("HTTP timeout = %v, want %v", client.httpClient.Timeout, defaultCVEHistoryTimeout)
	}
}

func TestCVEHistoryClientRetriesRateLimit(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if requests.Add(1) == 1 {
			writer.Header().Set("Retry-After", "1")
			writer.WriteHeader(http.StatusTooManyRequests)
			_, _ = writer.Write([]byte(`{"message":"slow down"}`))
			return
		}
		_, _ = writer.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	var waits []time.Duration
	client := &cveHistoryClient{
		httpClient: server.Client(),
		maxRetries: 1,
		sleep: func(_ context.Context, delay time.Duration) error {
			waits = append(waits, delay)
			return nil
		},
	}
	var result models.JSONObject
	if err := client.getJSON(context.Background(), server.URL, &result); err != nil {
		t.Fatalf("retry request: %v", err)
	}
	if requests.Load() != 2 || len(waits) != 1 || waits[0] != time.Second {
		t.Fatalf("requests/waits = %d/%v", requests.Load(), waits)
	}
}

func TestCVEHistoryClientRetriesMalformedJSONResponse(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if requests.Add(1) < 3 {
			_, _ = writer.Write([]byte(`{"ok":`))
			return
		}
		_, _ = writer.Write([]byte(`{"ok":true}`))
	}))
	defer server.Close()

	var waits []time.Duration
	client := &cveHistoryClient{
		httpClient: server.Client(),
		maxRetries: 2,
		sleep: func(_ context.Context, delay time.Duration) error {
			waits = append(waits, delay)
			return nil
		},
	}
	var result models.JSONObject
	if err := client.getJSON(context.Background(), server.URL, &result); err != nil {
		t.Fatalf("malformed JSON retry: %v", err)
	}
	if requests.Load() != 3 || len(waits) != 2 || waits[0] != time.Second || waits[1] != 2*time.Second {
		t.Fatalf("requests/waits = %d/%v", requests.Load(), waits)
	}
	if result["ok"] != true {
		t.Fatalf("decoded response = %#v", result)
	}
}

func TestCVEHistoryClientReportsMalformedJSONResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte(`{"ok":`))
	}))
	defer server.Close()

	client := &cveHistoryClient{
		httpClient: server.Client(),
		maxRetries: 0,
		sleep:      func(context.Context, time.Duration) error { return nil },
	}
	var result models.JSONObject
	err := client.getJSON(context.Background(), server.URL, &result)
	if err == nil {
		t.Fatal("expected malformed JSON error")
	}
	for _, expected := range []string{server.URL, "HTTP 200", "6 response bytes", "unexpected end of JSON input"} {
		if !strings.Contains(err.Error(), expected) {
			t.Fatalf("error %q does not contain %q", err, expected)
		}
	}
}

func TestCVEHistoryClientRejectsOversizedResponse(t *testing.T) {
	var requests atomic.Int32
	body := strings.Repeat("x", maxCVEHistoryResponseBytes+1)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests.Add(1)
		_, _ = writer.Write([]byte(body))
	}))
	defer server.Close()

	client := &cveHistoryClient{
		httpClient: server.Client(),
		maxRetries: 2,
		sleep:      func(context.Context, time.Duration) error { return nil },
	}
	var result models.JSONObject
	err := client.getJSON(context.Background(), server.URL, &result)
	if err == nil {
		t.Fatal("expected oversized response error")
	}
	if requests.Load() != 1 {
		t.Fatalf("requests = %d, want 1", requests.Load())
	}
	for _, expected := range []string{server.URL, "HTTP 200", "exceeded", fmt.Sprintf("%d", maxCVEHistoryResponseBytes)} {
		if !strings.Contains(err.Error(), expected) {
			t.Fatalf("error %q does not contain %q", err, expected)
		}
	}
}

func TestFetchCurrentSnapshotNormalizesOfficialAndNVDData(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch {
		case strings.HasPrefix(request.URL.Path, "/official/"):
			_, _ = writer.Write([]byte(`{"cveMetadata":{"state":"PUBLISHED"},"containers":{"cna":{"affected":[{"product":"openssl","package":{"name":"openssl","purl":"pkg:deb/debian/openssl@3.0.0"},"versions":[{"status":"affected","versionStartIncluding":"3.0.0","fixed":"3.0.5"}]}],"metrics":[{"cvssV3_1":{"baseScore":8.1,"baseSeverity":"HIGH","vectorString":"CVSS:3.1/AV:N"}}]}}}`))
		case request.URL.Path == "/nvd":
			_, _ = writer.Write([]byte(`{"vulnerabilities":[{"cve":{"vulnStatus":"Analyzed","id":"CVE-2026-0003","configurations":[{"nodes":[{"cpeMatch":[{"vulnerable":true,"criteria":"cpe:2.3:a:openssl:openssl:*:*:*:*:*:*:*:*"}]}]}]}}]}`))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	client := &cveHistoryClient{
		nvdCVEsBaseURL:     server.URL + "/nvd",
		officialCVEBaseURL: server.URL + "/official",
		httpClient:         server.Client(),
		maxRetries:         0,
		sleep:              func(context.Context, time.Duration) error { return nil },
	}
	snapshot, err := client.fetchCurrentSnapshot(context.Background(), "CVE-2026-0003")
	if err != nil {
		t.Fatalf("fetch current snapshot: %v", err)
	}
	if snapshot.CVEState != models.IntelligenceCVEStateAffected || snapshot.Severity != models.SeverityHigh || snapshot.CVSSScore != 8.1 {
		t.Fatalf("snapshot summary = %#v", snapshot)
	}
	if len(snapshot.AffectedRanges) < 2 || len(snapshot.FixedVersions) != 1 || snapshot.FixedVersions[0] != "3.0.5" {
		t.Fatalf("ranges/fixes = %#v/%#v", snapshot.AffectedRanges, snapshot.FixedVersions)
	}
}

func TestCVEHistoryRunContextCachesCurrentSnapshot(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requests.Add(1)
		switch {
		case strings.HasPrefix(request.URL.Path, "/official/"):
			_, _ = writer.Write([]byte(`{"cveMetadata":{"state":"PUBLISHED"}}`))
		case request.URL.Path == "/nvd":
			_, _ = writer.Write([]byte(`{"vulnerabilities":[]}`))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	client := &cveHistoryClient{
		nvdCVEsBaseURL:     server.URL + "/nvd",
		officialCVEBaseURL: server.URL + "/official",
		httpClient:         server.Client(),
		maxRetries:         0,
		sleep:              func(context.Context, time.Duration) error { return nil },
	}
	runContext := newCVEHistoryRunContext(client)
	if _, err := runContext.fetchCurrentSnapshot(context.Background(), "CVE-2026-0005"); err != nil {
		t.Fatalf("first snapshot: %v", err)
	}
	if _, err := runContext.fetchCurrentSnapshot(context.Background(), "cve-2026-0005"); err != nil {
		t.Fatalf("cached snapshot: %v", err)
	}
	if requests.Load() != 2 {
		t.Fatalf("upstream requests = %d, want 2", requests.Load())
	}
}

func TestEvaluateAffectedRangesRequiresSufficientIdentity(t *testing.T) {
	ranges := []models.JSONObject{{
		"purl":       "pkg:deb/debian/openssl",
		"introduced": "3.0.0",
		"fixed":      "3.0.5",
	}}

	if state := evaluateAffectedRanges(vulnerabilityFindingIdentity{
		InstalledVersion: "3.0.1",
		PURLs:            []string{"pkg:deb/debian/openssl@3.0.1"},
	}, ranges); state != applicabilityAffected {
		t.Fatalf("affected state = %v", state)
	}
	if state := evaluateAffectedRanges(vulnerabilityFindingIdentity{
		InstalledVersion: "3.0.5",
		PURLs:            []string{"pkg:deb/debian/openssl@3.0.5"},
	}, ranges); state != applicabilityNotAffected {
		t.Fatalf("outside state = %v", state)
	}
	if state := evaluateAffectedRanges(vulnerabilityFindingIdentity{InstalledVersion: "3.0.1"}, ranges); state != applicabilityUnknown {
		t.Fatalf("missing PURL state = %v", state)
	}
	if state := evaluateAffectedRanges(vulnerabilityFindingIdentity{
		PackageName:      "openssl",
		InstalledVersion: "3.0.1",
	}, []models.JSONObject{{"identity_kind": "cpe", "cpe": "cpe:2.3:a:openssl:openssl:*"}}); state != applicabilityUnknown {
		t.Fatalf("CPE-only state = %v", state)
	}
}

func TestEvaluateAffectedRangeChangesTimeline(t *testing.T) {
	rangeValue := models.JSONObject{
		"status": "affected",
		"changes": []any{
			models.JSONObject{"at": "1.0.0", "status": "affected"},
			models.JSONObject{"at": "2.0.0", "status": "unaffected"},
		},
	}
	identity := vulnerabilityFindingIdentity{InstalledVersion: "1.5.0"}
	if state := evaluateAffectedRanges(identity, []models.JSONObject{rangeValue}); state != applicabilityAffected {
		t.Fatalf("timeline affected state = %v", state)
	}
	identity.InstalledVersion = "2.0.0"
	if state := evaluateAffectedRanges(identity, []models.JSONObject{rangeValue}); state != applicabilityNotAffected {
		t.Fatalf("timeline unaffected state = %v", state)
	}
}

func TestNormalizeConstraintExpression(t *testing.T) {
	if got := normalizeConstraintExpression(">= 1.0.0, < 2.0.0"); got != ">=1.0.0,<2.0.0" {
		t.Fatalf("normalized constraint = %q", got)
	}
	if _, err := url.Parse("https://example.test/" + normalizeConstraintExpression(">= 1.0.0")); err != nil {
		t.Fatalf("constraint unexpectedly unusable: %v", err)
	}
}

func TestCurrentSnapshotRawPayloadIsJSONSerializable(t *testing.T) {
	snapshot := cveCurrentSnapshot{RawOfficial: models.JSONObject{"state": "PUBLISHED"}, RawNVD: models.JSONObject{"id": "CVE-2026-0004"}}
	if _, err := json.Marshal(snapshot.RawOfficial); err != nil {
		t.Fatalf("official payload: %v", err)
	}
}

func TestCancelCVEHistorySyncCancelsActiveContext(t *testing.T) {
	endCVEHistorySync()
	_, runCtx, ok := beginCVEHistorySync(context.Background())
	if !ok {
		t.Fatal("expected sync to start")
	}
	defer endCVEHistorySync()

	if !CancelCVEHistorySync() {
		t.Fatal("expected active sync cancellation to be requested")
	}
	select {
	case <-runCtx.Done():
	case <-time.After(time.Second):
		t.Fatal("sync context was not cancelled")
	}
	status := CurrentCVEHistorySyncStatus()
	if !status.Running || !status.CancelRequested {
		t.Fatalf("status after cancellation = %+v", status)
	}
}

func TestReconcileOrphanedCVEHistoryRuns(t *testing.T) {
	endCVEHistorySync()
	db, mock, cleanup := newMockBunDB(t)
	defer cleanup()
	mock.ExpectQuery(`SELECT pg_try_advisory_lock`).WillReturnRows(
		sqlmock.NewRows([]string{"pg_try_advisory_lock"}).AddRow(true),
	)
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE "vulnerability_intelligence_sync_runs"`)).
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectExec(`SELECT pg_advisory_unlock`).WillReturnResult(sqlmock.NewResult(0, 1))

	recovered, err := ReconcileOrphanedCVEHistoryRuns(context.Background(), db)
	if err != nil {
		t.Fatalf("reconcile orphaned runs: %v", err)
	}
	if recovered != 2 {
		t.Fatalf("recovered runs = %d, want 2", recovered)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}
