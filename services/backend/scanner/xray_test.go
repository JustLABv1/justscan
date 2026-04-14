package scanner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

func newTestHTTPClient(fn roundTripFunc) *http.Client {
	return &http.Client{Transport: fn}
}

func jsonResponse(statusCode int, payload any) *http.Response {
	body, err := json.Marshal(payload)
	if err != nil {
		panic(err)
	}

	return &http.Response{
		StatusCode: statusCode,
		Header:     make(http.Header),
		Body:       io.NopCloser(bytes.NewReader(body)),
	}
}

func decodeJSONBody(req *http.Request, out any) error {
	defer req.Body.Close()
	return json.NewDecoder(req.Body).Decode(out)
}

func testContext() context.Context {
	return context.Background()
}

func containsFold(value, fragment string) bool {
	return strings.Contains(strings.ToLower(value), strings.ToLower(fragment))
}

func TestParseXrayVulnerabilitiesReadsCombinedSummaryCVSS(t *testing.T) {
	scanID := uuid.New()
	summary := &xraySummaryResponse{
		Artifacts: []xraySummaryArtifact{{
			Issues: []xraySummaryIssue{{
				IssueID:  "XRAY-123",
				Summary:  "Summary issue",
				Severity: "High",
				Components: []xraySummaryComponent{{
					ComponentID:   "docker://library/nginx:1.25",
					Name:          "nginx",
					Version:       "1.25",
					FixedVersions: []string{"1.26"},
				}},
				CVEs: []xraySummaryCVE{{
					CVE:    "CVE-2024-0001",
					CVSSV3: "7.5/CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H",
				}},
			}},
		}},
	}

	vulns := ParseXrayVulnerabilities(summary, scanID)
	if len(vulns) != 1 {
		t.Fatalf("expected 1 vulnerability, got %d", len(vulns))
	}
	if vulns[0].CVSSScore != 7.5 {
		t.Fatalf("expected CVSS score 7.5, got %v", vulns[0].CVSSScore)
	}
	if vulns[0].CVSSVector != "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H" {
		t.Fatalf("unexpected CVSS vector %q", vulns[0].CVSSVector)
	}
}

func TestParseXrayVulnerabilitiesReadsExplicitScoreFields(t *testing.T) {
	scanID := uuid.New()
	summary := &xraySummaryResponse{
		Artifacts: []xraySummaryArtifact{{
			Issues: []xraySummaryIssue{{
				IssueID:  "XRAY-456",
				Summary:  "Explicit score issue",
				Severity: "Medium",
				Components: []xraySummaryComponent{{
					ComponentID: "docker://library/redis:7.2",
					Name:        "redis",
					Version:     "7.2",
				}},
				CVEs: []xraySummaryCVE{{
					CVE:          "CVE-2024-0002",
					CVSSV3Score:  "9.1",
					CVSSV3Vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N",
				}},
			}},
		}},
	}

	vulns := ParseXrayVulnerabilities(summary, scanID)
	if len(vulns) != 1 {
		t.Fatalf("expected 1 vulnerability, got %d", len(vulns))
	}
	if vulns[0].CVSSScore != 9.1 {
		t.Fatalf("expected CVSS score 9.1, got %v", vulns[0].CVSSScore)
	}
	if vulns[0].CVSSVector != "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N" {
		t.Fatalf("unexpected CVSS vector %q", vulns[0].CVSSVector)
	}
}

func TestXrayIssueScoreFallsBackToIssueMaxScore(t *testing.T) {
	score, vector := xrayIssueScore(xraySummaryIssue{
		CVSS3Max: "8.6",
		CVEs: []xraySummaryCVE{{
			CVE: "CVE-2024-0003",
		}},
	})

	if score != 8.6 {
		t.Fatalf("expected score 8.6, got %v", score)
	}
	if vector != "" {
		t.Fatalf("expected empty vector, got %q", vector)
	}
}

func TestExtractXrayKBEntriesDeduplicatesAndKeepsBestScore(t *testing.T) {
	summary := &xraySummaryResponse{
		Artifacts: []xraySummaryArtifact{{
			Issues: []xraySummaryIssue{
				{
					IssueID:     "XRAY-9000",
					Description: "First description",
					Severity:    "Medium",
					CVSS3Max:    "7.1",
					References:  []any{"https://research.example/advisory"},
					Components:  []xraySummaryComponent{{ComponentID: "docker://library/a:1", Name: "a", Version: "1"}},
					CVEs:        []xraySummaryCVE{{CVE: "CVE-2024-1111"}},
				},
				{
					IssueID:     "XRAY-9000",
					Description: "Updated description",
					Severity:    "High",
					References: []any{
						map[string]any{"url": "https://exploit-db.com/exploits/12345", "source": "Exploit DB"},
					},
					Components: []xraySummaryComponent{{ComponentID: "docker://library/b:2", Name: "b", Version: "2"}},
					CVEs: []xraySummaryCVE{{
						CVE:          "CVE-2024-1111",
						CVSSV3Score:  "9.4",
						CVSSV3Vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
					}},
				},
			},
		}},
	}

	entries := ExtractXrayKBEntries(summary)
	if len(entries) != 1 {
		t.Fatalf("expected 1 KB entry, got %d", len(entries))
	}
	entry := entries[0]
	if entry.VulnID != "CVE-2024-1111" {
		t.Fatalf("unexpected vuln id %q", entry.VulnID)
	}
	if entry.CVSSScore != 9.4 {
		t.Fatalf("expected CVSS score 9.4, got %v", entry.CVSSScore)
	}
	if entry.CVSSVector != "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" {
		t.Fatalf("unexpected vector %q", entry.CVSSVector)
	}
	if entry.Severity != "HIGH" {
		t.Fatalf("expected highest severity to be retained, got %q", entry.Severity)
	}
	if len(entry.References) != 2 {
		t.Fatalf("expected merged references, got %d", len(entry.References))
	}
	if !entry.ExploitAvailable {
		t.Fatal("expected exploit_available to be true")
	}
}

func TestParseXrayViolationVulnerabilitiesBuildsFallbackFindings(t *testing.T) {
	scanID := uuid.New()
	response := &xrayViolationsResponse{
		Violations: []xrayViolationRecord{
			{
				IssueID:     "CVE-2026-0001",
				Summary:     "Blocked issue",
				Description: "Xray reported this issue while a blocking policy rejected the image.",
				Severity:    "High",
			},
			{
				IssueID:     "CVE-2026-0001",
				Summary:     "Duplicate blocked issue",
				Description: "Duplicate record should be deduplicated.",
				Severity:    "High",
			},
		},
	}

	vulns := ParseXrayViolationVulnerabilities(response, scanID, "n8nio/n8n", "2.16.0")
	if len(vulns) != 1 {
		t.Fatalf("expected 1 fallback vulnerability, got %d", len(vulns))
	}
	if vulns[0].VulnID != "CVE-2026-0001" {
		t.Fatalf("unexpected vuln id %q", vulns[0].VulnID)
	}
	if vulns[0].PkgName != "n8nio/n8n" {
		t.Fatalf("unexpected package name %q", vulns[0].PkgName)
	}
	if vulns[0].InstalledVersion != "2.16.0" {
		t.Fatalf("unexpected installed version %q", vulns[0].InstalledVersion)
	}
	if vulns[0].Severity != "HIGH" {
		t.Fatalf("unexpected severity %q", vulns[0].Severity)
	}
	if vulns[0].Title != "Blocked issue" {
		t.Fatalf("unexpected title %q", vulns[0].Title)
	}
	if vulns[0].DataSource != xrayDataSource {
		t.Fatalf("unexpected data source %q", vulns[0].DataSource)
	}
}

func TestExtractXrayIgnoreRulesParsesNestedPayload(t *testing.T) {
	payload := map[string]any{
		"data": []any{
			map[string]any{
				"external_id": "rule-123",
				"filters": map[string]any{
					"policy_name": "Policy One",
					"watch_name":  "Watch One",
				},
				"notes":      "Ignored for provider reasons",
				"expires_at": "2026-05-01T00:00:00Z",
			},
		},
	}

	rules := extractXrayIgnoreRules(payload)
	if len(rules) != 1 {
		t.Fatalf("expected 1 ignore rule, got %d", len(rules))
	}
	if rules[0].RuleID != "rule-123" {
		t.Fatalf("unexpected rule id %q", rules[0].RuleID)
	}
	if rules[0].PolicyName != "Policy One" {
		t.Fatalf("unexpected policy name %q", rules[0].PolicyName)
	}
	if rules[0].WatchName != "Watch One" {
		t.Fatalf("unexpected watch name %q", rules[0].WatchName)
	}
	if rules[0].Justification != "Ignored for provider reasons" {
		t.Fatalf("unexpected justification %q", rules[0].Justification)
	}
	if rules[0].ExpiresAt == nil {
		t.Fatal("expected expires_at to be parsed")
	}
}

func TestXrayIgnoreRuleVulnerabilityFilter(t *testing.T) {
	tests := []struct {
		name            string
		vulnerabilityID string
		wantKey         string
		wantValue       string
		wantOK          bool
	}{
		{name: "cve", vulnerabilityID: "CVE-2026-1000", wantKey: "cve", wantValue: "CVE-2026-1000", wantOK: true},
		{name: "xray issue", vulnerabilityID: "XRAY-12345", wantKey: "vulnerability", wantValue: "XRAY-12345", wantOK: true},
		{name: "unsupported advisory id", vulnerabilityID: "GHSA-abcd-1234", wantOK: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gotKey, gotValue, gotOK := xrayIgnoreRuleVulnerabilityFilter(test.vulnerabilityID)
			if gotKey != test.wantKey || gotValue != test.wantValue || gotOK != test.wantOK {
				t.Fatalf("xrayIgnoreRuleVulnerabilityFilter(%q) = (%q, %q, %v), want (%q, %q, %v)", test.vulnerabilityID, gotKey, gotValue, gotOK, test.wantKey, test.wantValue, test.wantOK)
			}
		})
	}
}

func TestShouldTreatIgnoreRuleLookupAsUnavailable(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{name: "bad request", err: &xrayHTTPError{StatusCode: http.StatusBadRequest}, want: true},
		{name: "forbidden", err: &xrayHTTPError{StatusCode: http.StatusForbidden}, want: true},
		{name: "internal server error", err: &xrayHTTPError{StatusCode: http.StatusInternalServerError}, want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := shouldTreatIgnoreRuleLookupAsUnavailable(test.err); got != test.want {
				t.Fatalf("shouldTreatIgnoreRuleLookupAsUnavailable() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestDescribeNonFatalXrayIgnoreRuleSyncErrorExplainsPermissionIssue(t *testing.T) {
	message := describeNonFatalXrayIgnoreRuleSyncError(&xrayHTTPError{StatusCode: http.StatusForbidden})
	if want := "permission to read ignore rules"; !containsFold(message, want) {
		t.Fatalf("expected %q to contain %q", message, want)
	}
}

func TestShouldWarnBlockedReindexErrorSuppressesExpectedStatuses(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{name: "forbidden", err: &xrayHTTPError{StatusCode: http.StatusForbidden}, want: false},
		{name: "unauthorized", err: &xrayHTTPError{StatusCode: http.StatusUnauthorized}, want: false},
		{name: "conflict", err: &xrayHTTPError{StatusCode: http.StatusConflict}, want: false},
		{name: "bad gateway", err: &xrayHTTPError{StatusCode: http.StatusBadGateway}, want: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := shouldWarnBlockedReindexError(test.err); got != test.want {
				t.Fatalf("shouldWarnBlockedReindexError() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestExportComponentCycloneDXSkipsEmptyPathFallbackWhenPathsProvided(t *testing.T) {
	requestedPaths := make([]string, 0, 2)
	client := &xrayClient{
		baseURL: "http://example.com",
		httpClient: newTestHTTPClient(func(req *http.Request) (*http.Response, error) {
			if req.URL.Path != "/xray/api/v2/component/exportDetails" {
				return jsonResponse(http.StatusNotFound, map[string]string{"error": "not found"}), nil
			}

			var body map[string]any
			if err := decodeJSONBody(req, &body); err != nil {
				return nil, err
			}
			if path, _ := body["path"].(string); path != "" {
				requestedPaths = append(requestedPaths, path)
			}

			return jsonResponse(http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("path %v failed", body["path"])}), nil
		}),
	}

	_, _, err := client.exportComponentCycloneDX(testContext(), "plain-images/alpine:3.23", "default/plain-images/alpine/3.23/manifest.json", "plain-images/alpine/3.23/manifest.json", "")
	if err == nil {
		t.Fatal("expected exportComponentCycloneDX to fail")
	}
	if len(requestedPaths) != 2 {
		t.Fatalf("expected exactly 2 non-empty path attempts, got %d (%#v)", len(requestedPaths), requestedPaths)
	}
	if requestedPaths[0] != "default/plain-images/alpine/3.23/manifest.json" {
		t.Fatalf("unexpected first path %q", requestedPaths[0])
	}
	if requestedPaths[1] != "plain-images/alpine/3.23/manifest.json" {
		t.Fatalf("unexpected second path %q", requestedPaths[1])
	}
	if got := err.Error(); got != "xray API returned HTTP 400: {\"error\":\"path plain-images/alpine/3.23/manifest.json failed\"}" {
		t.Fatalf("unexpected error %q", got)
	}
}

func TestDescribeNonFatalXrayIndexErrorExplainsPermissionIssue(t *testing.T) {
	message := describeNonFatalXrayIndexError("plain-images/alpine/3.23/manifest.json", &xrayHTTPError{StatusCode: http.StatusForbidden})
	if want := "re-index permissions"; !containsFold(message, want) {
		t.Fatalf("expected %q to contain %q", message, want)
	}
}

func TestDescribeNonFatalXrayScanArtifactErrorExplainsKnownServerFailure(t *testing.T) {
	message := describeNonFatalXrayScanArtifactError("docker://plain-images/alpine:3.23", &xrayHTTPError{StatusCode: http.StatusInternalServerError, Body: `{"error":"Failed to scan component"}`})
	if want := "explicit scanArtifact request"; !containsFold(message, want) {
		t.Fatalf("expected %q to contain %q", message, want)
	}
}

func TestDescribeNonFatalXraySBOMImportErrorExplainsOptionalSkip(t *testing.T) {
	message := describeNonFatalXraySBOMImportError(&xrayHTTPError{StatusCode: http.StatusBadRequest, Body: `{"error":"One parameter or more are missing"}`})
	if want := "SBOM components were skipped"; !containsFold(message, want) {
		t.Fatalf("expected %q to contain %q", message, want)
	}
}

func TestParseCycloneDXVulnerabilitiesBuildsAffectedComponentFindings(t *testing.T) {
	scanID := uuid.New()
	sbom := &TrivySBOMOutput{
		BOMFormat: "CycloneDX",
		Components: []TrivySBOMComp{
			{BOMRef: "pkg:apk/alpine/openssl@3.2.1", Name: "openssl", Version: "3.2.1", PURL: "pkg:apk/alpine/openssl@3.2.1"},
			{BOMRef: "pkg:apk/alpine/busybox@1.36.1", Name: "busybox", Version: "1.36.1", PURL: "pkg:apk/alpine/busybox@1.36.1"},
		},
		Vulnerabilities: []TrivySBOMVulnerability{
			{
				ID:          "CVE-2026-1111",
				Description: "openssl issue",
				Ratings:     []TrivySBOMVulnRating{{Severity: "critical", Score: 9.8, Vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"}},
				Advisories:  []TrivySBOMVulnAdvisory{{URL: "https://example.test/CVE-2026-1111"}},
				Affects:     []TrivySBOMVulnerabilityAffect{{Ref: "pkg:apk/alpine/openssl@3.2.1"}},
			},
			{
				ID:             "CVE-2026-2222",
				Description:    "busybox issue",
				Recommendation: "Upgrade to 1.36.2-r0",
				Ratings:        []TrivySBOMVulnRating{{Severity: "medium", Score: "5.6"}},
				Affects:        []TrivySBOMVulnerabilityAffect{{Ref: "pkg:apk/alpine/busybox@1.36.1"}},
			},
		},
	}

	vulns := ParseCycloneDXVulnerabilities(sbom, scanID)
	if len(vulns) != 2 {
		t.Fatalf("expected 2 vulnerabilities, got %d", len(vulns))
	}
	if vulns[0].PkgName != "openssl" || vulns[1].PkgName != "busybox" {
		t.Fatalf("unexpected package names %#v", []string{vulns[0].PkgName, vulns[1].PkgName})
	}
	if vulns[0].Severity != "CRITICAL" {
		t.Fatalf("unexpected severity %q", vulns[0].Severity)
	}
	if vulns[0].CVSSScore != 9.8 {
		t.Fatalf("unexpected score %v", vulns[0].CVSSScore)
	}
	if len(vulns[0].References) != 1 {
		t.Fatalf("expected advisory reference, got %d", len(vulns[0].References))
	}
	if vulns[1].InstalledVersion != "1.36.1" {
		t.Fatalf("unexpected installed version %q", vulns[1].InstalledVersion)
	}
}

func TestExtractCycloneDXKBEntriesDeduplicatesAndKeepsBestSeverity(t *testing.T) {
	sbom := &TrivySBOMOutput{
		BOMFormat: "CycloneDX",
		Vulnerabilities: []TrivySBOMVulnerability{
			{
				ID:          "CVE-2026-3333",
				Description: "First description",
				Ratings:     []TrivySBOMVulnRating{{Severity: "medium", Score: 5.4, Vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N"}},
				Advisories:  []TrivySBOMVulnAdvisory{{URL: "https://example.test/CVE-2026-3333"}},
				Source:      &TrivySBOMVulnSource{Name: "NVD", URL: "https://nvd.nist.gov/vuln/detail/CVE-2026-3333"},
			},
			{
				ID:          "CVE-2026-3333",
				Description: "Updated description",
				Ratings:     []TrivySBOMVulnRating{{Severity: "critical", Score: 9.8, Vector: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"}},
				Advisories:  []TrivySBOMVulnAdvisory{{URL: "https://exploit-db.com/exploits/54321"}},
			},
		},
	}

	entries := ExtractCycloneDXKBEntries(sbom)
	if len(entries) != 1 {
		t.Fatalf("expected 1 KB entry, got %d", len(entries))
	}
	entry := entries[0]
	if entry.VulnID != "CVE-2026-3333" {
		t.Fatalf("unexpected vuln id %q", entry.VulnID)
	}
	if entry.Description != "First description" {
		t.Fatalf("expected first non-empty description to be retained, got %q", entry.Description)
	}
	if entry.Severity != "CRITICAL" {
		t.Fatalf("expected highest severity to be retained, got %q", entry.Severity)
	}
	if entry.CVSSScore != 9.8 {
		t.Fatalf("expected highest score to be retained, got %v", entry.CVSSScore)
	}
	if len(entry.References) != 3 {
		t.Fatalf("expected merged references, got %d", len(entry.References))
	}
	if !entry.ExploitAvailable {
		t.Fatal("expected exploit_available to be true")
	}
}
