package scanner

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"justscan-backend/pkg/models"
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
	if vulns[0].XrayIssueID != "XRAY-123" {
		t.Fatalf("expected xray issue id XRAY-123, got %q", vulns[0].XrayIssueID)
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
				ID:                     "2052541046701252608",
				IssueID:                "CVE-2026-0001",
				Watch:                  "bbsr-watch",
				Summary:                "Blocked issue",
				Description:            "Xray reported this issue while a blocking policy rejected the image.",
				Severity:               "High",
				Source:                 "GitPython",
				SourceVersion:          "3.1.46",
				SourceID:               "pypi://GitPython",
				ImpactArtifacts:        []string{"default/docker-remote-cache/openwebui/open-webui/sha256__abc/manifest.json"},
				ComponentPhysicalPaths: []string{"sha256__layer/usr/local/lib/python3.11/site-packages/gitpython-3.1.46.dist-info/GitPython:3.1.46"},
				Policies: []xrayViolationPolicy{{
					PolicyName: "bbsr-cve-policy",
					Rule:       "bbsr-cve-policy-rule",
					IsBlocking: true,
				}},
				IsBlocking: true,
				Raw: models.JSONObject{
					"issue_id":     "CVE-2026-0001",
					"watcher_name": "bbsr-watch",
				},
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
	if vulns[0].XrayIssueID != "CVE-2026-0001" {
		t.Fatalf("unexpected xray issue id %q", vulns[0].XrayIssueID)
	}
	if vulns[0].XrayViolationID != "2052541046701252608" {
		t.Fatalf("unexpected xray violation id %q", vulns[0].XrayViolationID)
	}
	if vulns[0].XrayWatchName != "bbsr-watch" {
		t.Fatalf("unexpected xray watch name %q", vulns[0].XrayWatchName)
	}
	if len(vulns[0].XrayWatchNames) != 1 || vulns[0].XrayWatchNames[0] != "bbsr-watch" {
		t.Fatalf("unexpected xray watch names %+v", vulns[0].XrayWatchNames)
	}
	if len(vulns[0].XrayWatchPolicyMatches) != 1 {
		t.Fatalf("expected 1 xray watch-policy match, got %d", len(vulns[0].XrayWatchPolicyMatches))
	}
	if !vulns[0].XrayIsBlocking {
		t.Fatal("expected xray_is_blocking to be true")
	}
	if vulns[0].XraySource != "GitPython" || vulns[0].XraySourceVersion != "3.1.46" || vulns[0].XraySourceID != "pypi://GitPython" {
		t.Fatalf("unexpected source fields: %q %q %q", vulns[0].XraySource, vulns[0].XraySourceVersion, vulns[0].XraySourceID)
	}
	if len(vulns[0].XrayMatchedPolicies) != 1 {
		t.Fatalf("expected 1 matched policy, got %d", len(vulns[0].XrayMatchedPolicies))
	}
	if len(vulns[0].XrayViolationPaths) != 1 {
		t.Fatalf("expected 1 violation path, got %d", len(vulns[0].XrayViolationPaths))
	}
	if len(vulns[0].XrayComponentPhysicalPaths) != 1 {
		t.Fatalf("expected 1 component physical path, got %d", len(vulns[0].XrayComponentPhysicalPaths))
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

func TestIsRetriableXrayScanArtifactErrorTreatsGatewayTimeoutAsRetriable(t *testing.T) {
	if got := isRetriableXrayScanArtifactError(&xrayHTTPError{StatusCode: http.StatusGatewayTimeout}); !got {
		t.Fatal("expected gateway timeout to be treated as retriable for scanArtifact")
	}
}

func TestIsNonFatalXrayIndexErrorTreatsPermissionDeniedAsNonFatal(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{name: "forbidden", err: &xrayHTTPError{StatusCode: http.StatusForbidden}, want: true},
		{name: "unauthorized", err: &xrayHTTPError{StatusCode: http.StatusUnauthorized}, want: true},
		{name: "conflict", err: &xrayHTTPError{StatusCode: http.StatusConflict}, want: true},
		{name: "bad gateway", err: &xrayHTTPError{StatusCode: http.StatusBadGateway}, want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isNonFatalXrayIndexError(test.err); got != test.want {
				t.Fatalf("isNonFatalXrayIndexError() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestIsNonFatalXrayScanArtifactErrorTreatsPermissionDeniedAsNonFatal(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{name: "forbidden", err: &xrayHTTPError{StatusCode: http.StatusForbidden}, want: true},
		{name: "unauthorized", err: &xrayHTTPError{StatusCode: http.StatusUnauthorized}, want: true},
		{name: "conflict", err: &xrayHTTPError{StatusCode: http.StatusConflict}, want: true},
		{name: "bad request", err: &xrayHTTPError{StatusCode: http.StatusBadRequest}, want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isNonFatalXrayScanArtifactError(test.err); got != test.want {
				t.Fatalf("isNonFatalXrayScanArtifactError() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestParseXrayIgnoredViolationRulesFromExport(t *testing.T) {
	payload, err := buildTestExportZip(map[string]any{
		"violations": []any{
			map[string]any{
				"issue_id":       "CVE-2026-9999",
				"is_ignored":     true,
				"ignore_rule_id": "rule-xyz",
				"policy_name":    "Runtime Risk",
				"watch_name":     "prod-watch",
				"justification":  "Accepted by platform team",
				"expires_at":     "2026-12-01T00:00:00Z",
			},
			map[string]any{
				"issue_id":   "CVE-2026-0000",
				"is_ignored": false,
			},
		},
	})
	if err != nil {
		t.Fatalf("failed to build test export zip: %v", err)
	}

	rules, err := parseXrayIgnoredViolationRulesFromExport(payload)
	if err != nil {
		t.Fatalf("parseXrayIgnoredViolationRulesFromExport returned error: %v", err)
	}
	if len(rules) != 1 {
		t.Fatalf("expected 1 ignored violation rule, got %d", len(rules))
	}

	rule := rules[0]
	if rule.VulnID != "CVE-2026-9999" {
		t.Fatalf("unexpected vuln id %q", rule.VulnID)
	}
	if rule.Rule.RuleID != "rule-xyz" {
		t.Fatalf("unexpected rule id %q", rule.Rule.RuleID)
	}
	if rule.Rule.PolicyName != "Runtime Risk" {
		t.Fatalf("unexpected policy name %q", rule.Rule.PolicyName)
	}
	if rule.Rule.WatchName != "prod-watch" {
		t.Fatalf("unexpected watch name %q", rule.Rule.WatchName)
	}
	if rule.Rule.Justification != "Accepted by platform team" {
		t.Fatalf("unexpected justification %q", rule.Rule.Justification)
	}
	if rule.Rule.ExpiresAt == nil {
		t.Fatal("expected expires_at to be parsed")
	}
}

func TestParseXrayIgnoredViolationRulesFromExportStatusFallback(t *testing.T) {
	payload, err := buildTestExportZip(map[string]any{
		"data": []any{
			map[string]any{
				"issue_id":   "XRAY-4242",
				"status":     "ignored",
				"policy":     "Policy A",
				"watch":      "Watch A",
				"comment":    "Temporary allow",
				"expired_at": "2027-01-01T00:00:00Z",
			},
		},
	})
	if err != nil {
		t.Fatalf("failed to build test export zip: %v", err)
	}

	rules, err := parseXrayIgnoredViolationRulesFromExport(payload)
	if err != nil {
		t.Fatalf("parseXrayIgnoredViolationRulesFromExport returned error: %v", err)
	}
	if len(rules) != 1 {
		t.Fatalf("expected 1 ignored violation rule, got %d", len(rules))
	}

	rule := rules[0]
	if rule.VulnID != "XRAY-4242" {
		t.Fatalf("unexpected vuln id %q", rule.VulnID)
	}
	if rule.Rule.PolicyName != "Policy A" {
		t.Fatalf("unexpected policy name %q", rule.Rule.PolicyName)
	}
	if rule.Rule.WatchName != "Watch A" {
		t.Fatalf("unexpected watch name %q", rule.Rule.WatchName)
	}
	if rule.Rule.RuleID == "" {
		t.Fatal("expected fallback rule id to be generated")
	}
}

func TestParseXrayIgnoredViolationRulesFromExportPlainJSON(t *testing.T) {
	payload, err := json.Marshal(map[string]any{
		"violations": []any{
			map[string]any{
				"issue_id":      "CVE-2027-1111",
				"ignored":       true,
				"policy_name":   "Policy JSON",
				"watch_name":    "Watch JSON",
				"justification": "Ignored in plain JSON export",
			},
		},
	})
	if err != nil {
		t.Fatalf("failed to marshal json payload: %v", err)
	}

	rules, err := parseXrayIgnoredViolationRulesFromExport(payload)
	if err != nil {
		t.Fatalf("parseXrayIgnoredViolationRulesFromExport returned error: %v", err)
	}
	if len(rules) != 1 {
		t.Fatalf("expected 1 ignored violation rule, got %d", len(rules))
	}

	rule := rules[0]
	if rule.VulnID != "CVE-2027-1111" {
		t.Fatalf("unexpected vuln id %q", rule.VulnID)
	}
	if rule.Rule.PolicyName != "Policy JSON" {
		t.Fatalf("unexpected policy name %q", rule.Rule.PolicyName)
	}
	if rule.Rule.WatchName != "Watch JSON" {
		t.Fatalf("unexpected watch name %q", rule.Rule.WatchName)
	}
}

func TestParseXrayViolationsExportPlainJSON(t *testing.T) {
	payload, err := json.Marshal(map[string]any{
		"violations": []any{
			map[string]any{
				"user_issue_id":  "2052541046701252608",
				"issue_id":       "XRAY-971174",
				"watcher_id":     "99ad3de1b189264e660c88ce",
				"watcher_name":   "bbsr-watch",
				"source":         "GitPython",
				"source_version": "3.1.46",
				"source_id":      "pypi://GitPython",
				"summary":        "GitPython command injection",
				"severity":       "Critical",
				"paths": []any{
					"default/docker-remote-cache/openwebui/open-webui/sha256__abc/manifest.json",
				},
				"component_physical_paths": []any{
					"sha256__layer/usr/local/lib/python3.11/site-packages/gitpython-3.1.46.dist-info/GitPython:3.1.46",
				},
				"matched_policies": []any{
					map[string]any{
						"policy":      "bbsr-cve-policy",
						"rule":        "bbsr-cve-policy-rule",
						"is_blocking": true,
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("failed to marshal json payload: %v", err)
	}

	parsed, err := parseXrayViolationsExport(payload)
	if err != nil {
		t.Fatalf("parseXrayViolationsExport returned error: %v", err)
	}
	if parsed == nil || len(parsed.Violations) != 1 {
		t.Fatalf("expected 1 violation, got %+v", parsed)
	}

	v := parsed.Violations[0]
	if v.ID != "2052541046701252608" {
		t.Fatalf("unexpected violation id %q", v.ID)
	}
	if v.IssueID != "XRAY-971174" {
		t.Fatalf("unexpected issue id %q", v.IssueID)
	}
	if v.Watch != "bbsr-watch" {
		t.Fatalf("unexpected watch %q", v.Watch)
	}
	if v.WatchID != "99ad3de1b189264e660c88ce" {
		t.Fatalf("unexpected watch id %q", v.WatchID)
	}
	if v.Source != "GitPython" || v.SourceVersion != "3.1.46" || v.SourceID != "pypi://GitPython" {
		t.Fatalf("unexpected source fields: %q %q %q", v.Source, v.SourceVersion, v.SourceID)
	}
	if len(v.Policies) != 1 || v.Policies[0].PolicyName != "bbsr-cve-policy" || !v.Policies[0].IsBlocking {
		t.Fatalf("unexpected policies %+v", v.Policies)
	}
	if !v.IsBlocking {
		t.Fatal("expected violation to be blocking")
	}
	if len(v.ImpactArtifacts) != 1 {
		t.Fatalf("unexpected impact artifacts %+v", v.ImpactArtifacts)
	}
	if len(v.ComponentPhysicalPaths) != 1 {
		t.Fatalf("unexpected component physical paths %+v", v.ComponentPhysicalPaths)
	}
}

func TestParseXrayViolationsExportZipJSON(t *testing.T) {
	payload, err := buildTestExportZip(map[string]any{
		"violations": []any{
			map[string]any{
				"issue_id":     "XRAY-980135",
				"watcher_name": "bmz-watch",
				"severity":     "High",
				"matched_policies": []any{
					map[string]any{"policy": "bmz-cve-policy", "rule": "bmz-cve-policy-rule", "is_blocking": true},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("failed to build zip payload: %v", err)
	}

	parsed, err := parseXrayViolationsExport(payload)
	if err != nil {
		t.Fatalf("parseXrayViolationsExport returned error: %v", err)
	}
	if parsed == nil || len(parsed.Violations) != 1 {
		t.Fatalf("expected 1 violation, got %+v", parsed)
	}
	if parsed.Violations[0].IssueID != "XRAY-980135" {
		t.Fatalf("unexpected issue id %q", parsed.Violations[0].IssueID)
	}
}

func TestXrayViolationCandidateVulnIDsIncludesCVEsFromRaw(t *testing.T) {
	violation := xrayViolationRecord{
		ID:      "2052541046701252608",
		IssueID: "XRAY-971174",
		Raw: models.JSONObject{
			"cves": []any{
				map[string]any{"cve": "CVE-2025-66034"},
				map[string]any{"cve": "CVE-2025-7458"},
			},
		},
	}

	ids := xrayViolationCandidateVulnIDs(violation)
	joined := strings.Join(ids, ",")
	if !strings.Contains(joined, "XRAY-971174") {
		t.Fatalf("expected XRAY issue id in candidate ids, got %v", ids)
	}
	if !strings.Contains(joined, "CVE-2025-66034") || !strings.Contains(joined, "CVE-2025-7458") {
		t.Fatalf("expected CVE ids in candidate ids, got %v", ids)
	}
}

func TestXrayExportComponentNamePrefersDigest(t *testing.T) {
	got := xrayExportComponentName("openwebui/open-webui", "main", "sha256:6403a9b0e6ec71956466300dbcde0dca373f9aa0f597aff3d4c24fbb3b10bec3")
	want := "openwebui/open-webui:sha256__6403a9b0e6ec71956466300dbcde0dca373f9aa0f597aff3d4c24fbb3b10bec3"
	if got != want {
		t.Fatalf("xrayExportComponentName() = %q, want %q", got, want)
	}
}

func TestXrayExportComponentNameFallsBackToTag(t *testing.T) {
	got := xrayExportComponentName("openwebui/open-webui", "main", "")
	want := "openwebui/open-webui:main"
	if got != want {
		t.Fatalf("xrayExportComponentName() = %q, want %q", got, want)
	}
}

func TestPreferredXrayArtifactCandidatePrefersDigestCacheManifest(t *testing.T) {
	candidates := []xrayArtifactPathCandidate{
		{Repository: "docker-remote", Path: "openwebui/open-webui/0.8-slim/list.manifest.json"},
		{Repository: "docker-remote-cache", Path: "openwebui/open-webui/sha256__6403a9/manifest.json"},
		{Repository: "docker-remote", Path: "openwebui/open-webui/sha256__6403a9/manifest.json"},
	}

	got := preferredXrayArtifactCandidate(candidates)
	if got.Repository != "docker-remote-cache" {
		t.Fatalf("preferredXrayArtifactCandidate() repository = %q, want docker-remote-cache", got.Repository)
	}
	if got.Path != "openwebui/open-webui/sha256__6403a9/manifest.json" {
		t.Fatalf("preferredXrayArtifactCandidate() path = %q", got.Path)
	}
}

func TestXrayExportComponentNameFromArtifactStripsRegistryPrefixInput(t *testing.T) {
	got := xrayExportComponentName("openwebui/open-webui", "0.8-slim", "sha256:6403a9")
	want := "openwebui/open-webui:sha256__6403a9"
	if got != want {
		t.Fatalf("xrayExportComponentName() = %q, want %q", got, want)
	}
}

func buildTestExportZip(payload map[string]any) ([]byte, error) {
	buffer := bytes.NewBuffer(nil)
	writer := zip.NewWriter(buffer)

	file, err := writer.Create("report.json")
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	if _, err := file.Write(body); err != nil {
		return nil, err
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}

	return buffer.Bytes(), nil
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

func TestBuildXrayArtifactPathCandidatesIncludesDigestFallback(t *testing.T) {
	candidates := buildXrayArtifactPathCandidates("default", "docker-remote", "n8nio/n8n", "2.17.5", "list.manifest.json", "sha256:f462b5d11bae72b5d4b36c984c2459d4bf2ce17a59c933ddd7db468ef6754e69")
	if len(candidates) != 4 {
		t.Fatalf("expected 4 candidates, got %d (%#v)", len(candidates), candidates)
	}
	if candidates[0].ArtifactPath != "default/docker-remote/n8nio/n8n/2.17.5/list.manifest.json" {
		t.Fatalf("unexpected primary artifact path %q", candidates[0].ArtifactPath)
	}
	if candidates[1].ArtifactPath != "default/docker-remote/n8nio/n8n/sha256__f462b5d11bae72b5d4b36c984c2459d4bf2ce17a59c933ddd7db468ef6754e69/manifest.json" {
		t.Fatalf("unexpected digest fallback artifact path %q", candidates[1].ArtifactPath)
	}
	if candidates[2].ArtifactPath != "default/docker-remote-cache/n8nio/n8n/2.17.5/list.manifest.json" {
		t.Fatalf("unexpected cache tag artifact path %q", candidates[2].ArtifactPath)
	}
	if candidates[3].ArtifactPath != "default/docker-remote-cache/n8nio/n8n/sha256__f462b5d11bae72b5d4b36c984c2459d4bf2ce17a59c933ddd7db468ef6754e69/manifest.json" {
		t.Fatalf("unexpected cache digest fallback artifact path %q", candidates[3].ArtifactPath)
	}
}

func TestPollArtifactSummaryFallsBackToCacheRepositoryCandidate(t *testing.T) {
	client := &xrayClient{
		baseURL: "http://example.com",
		httpClient: newTestHTTPClient(func(req *http.Request) (*http.Response, error) {
			if req.URL.Path != "/xray/api/v2/summary/artifact" {
				return jsonResponse(http.StatusNotFound, map[string]string{"error": "not found"}), nil
			}

			var body map[string][]string
			if err := decodeJSONBody(req, &body); err != nil {
				return nil, err
			}
			path := ""
			if len(body["paths"]) > 0 {
				path = body["paths"][0]
			}

			switch path {
			case "default/docker-remote-cache/n8nio/n8n/sha256__f462b5d11bae72b5d4b36c984c2459d4bf2ce17a59c933ddd7db468ef6754e69/manifest.json":
				return jsonResponse(http.StatusOK, map[string]any{
					"artifacts": []map[string]any{{
						"issues": []any{},
					}},
				}), nil
			default:
				return jsonResponse(http.StatusOK, map[string]any{
					"artifacts": []any{},
					"errors": []map[string]string{{
						"identifier": path,
						"error":      "Artifact doesn't exist or not indexed/cached in Xray",
					}},
				}), nil
			}
		}),
	}

	candidates := buildXrayArtifactPathCandidates("default", "docker-remote", "n8nio/n8n", "2.17.5", "list.manifest.json", "sha256:f462b5d11bae72b5d4b36c984c2459d4bf2ce17a59c933ddd7db468ef6754e69")
	summary, resolvedCandidate, err := client.pollArtifactSummaryWithin(testContext(), candidates, 50*time.Millisecond)
	if err != nil {
		t.Fatalf("expected cache repository fallback summary lookup to succeed, got %v", err)
	}
	if len(summary.Artifacts) != 1 {
		t.Fatalf("expected 1 artifact summary, got %d", len(summary.Artifacts))
	}
	if resolvedCandidate.ArtifactPath != "default/docker-remote-cache/n8nio/n8n/sha256__f462b5d11bae72b5d4b36c984c2459d4bf2ce17a59c933ddd7db468ef6754e69/manifest.json" {
		t.Fatalf("unexpected resolved artifact path %q", resolvedCandidate.ArtifactPath)
	}
}

func TestPollArtifactSummaryFallsBackToDigestCandidate(t *testing.T) {
	client := &xrayClient{
		baseURL: "http://example.com",
		httpClient: newTestHTTPClient(func(req *http.Request) (*http.Response, error) {
			if req.URL.Path != "/xray/api/v2/summary/artifact" {
				return jsonResponse(http.StatusNotFound, map[string]string{"error": "not found"}), nil
			}

			var body map[string][]string
			if err := decodeJSONBody(req, &body); err != nil {
				return nil, err
			}
			path := ""
			if len(body["paths"]) > 0 {
				path = body["paths"][0]
			}

			switch path {
			case "default/docker-remote/n8nio/n8n/2.17.5/list.manifest.json":
				return jsonResponse(http.StatusOK, map[string]any{
					"artifacts": []any{},
					"errors": []map[string]string{{
						"identifier": path,
						"error":      "Artifact doesn't exist or not indexed/cached in Xray",
					}},
				}), nil
			case "default/docker-remote/n8nio/n8n/sha256__f462b5d11bae72b5d4b36c984c2459d4bf2ce17a59c933ddd7db468ef6754e69/manifest.json":
				return jsonResponse(http.StatusOK, map[string]any{
					"artifacts": []map[string]any{{
						"issues": []any{},
					}},
				}), nil
			default:
				return jsonResponse(http.StatusBadRequest, map[string]string{"error": path}), nil
			}
		}),
	}

	candidates := buildXrayArtifactPathCandidates("default", "docker-remote", "n8nio/n8n", "2.17.5", "list.manifest.json", "sha256:f462b5d11bae72b5d4b36c984c2459d4bf2ce17a59c933ddd7db468ef6754e69")
	summary, resolvedCandidate, err := client.pollArtifactSummaryWithin(testContext(), candidates, 50*time.Millisecond)
	if err != nil {
		t.Fatalf("expected fallback summary lookup to succeed, got %v", err)
	}
	if len(summary.Artifacts) != 1 {
		t.Fatalf("expected 1 artifact summary, got %d", len(summary.Artifacts))
	}
	if resolvedCandidate.ArtifactPath != "default/docker-remote/n8nio/n8n/sha256__f462b5d11bae72b5d4b36c984c2459d4bf2ce17a59c933ddd7db468ef6754e69/manifest.json" {
		t.Fatalf("unexpected resolved artifact path %q", resolvedCandidate.ArtifactPath)
	}
}

func TestPollArtifactSummaryPrefersCandidateWithFindings(t *testing.T) {
	client := &xrayClient{
		baseURL: "http://example.com",
		httpClient: newTestHTTPClient(func(req *http.Request) (*http.Response, error) {
			if req.URL.Path != "/xray/api/v2/summary/artifact" {
				return jsonResponse(http.StatusNotFound, map[string]string{"error": "not found"}), nil
			}

			var body map[string][]string
			if err := decodeJSONBody(req, &body); err != nil {
				return nil, err
			}
			path := ""
			if len(body["paths"]) > 0 {
				path = body["paths"][0]
			}

			switch path {
			case "default/docker-remote/n8nio/n8n/2.17.5/list.manifest.json":
				return jsonResponse(http.StatusOK, map[string]any{
					"artifacts": []map[string]any{{
						"issues": []any{},
					}},
				}), nil
			case "default/docker-remote/n8nio/n8n/sha256__f462b5d11bae72b5d4b36c984c2459d4bf2ce17a59c933ddd7db468ef6754e69/manifest.json":
				return jsonResponse(http.StatusOK, map[string]any{
					"artifacts": []map[string]any{{
						"issues": []map[string]any{{
							"issue_id":   "CVE-2026-9999",
							"severity":   "High",
							"summary":    "digest-only issue",
							"components": []map[string]any{{"component_id": "docker://n8nio/n8n:2.17.5"}},
						}},
					}},
				}), nil
			default:
				return jsonResponse(http.StatusBadRequest, map[string]string{"error": path}), nil
			}
		}),
	}

	candidates := buildXrayArtifactPathCandidates("default", "docker-remote", "n8nio/n8n", "2.17.5", "list.manifest.json", "sha256:f462b5d11bae72b5d4b36c984c2459d4bf2ce17a59c933ddd7db468ef6754e69")
	summary, resolvedCandidate, err := client.pollArtifactSummaryWithin(testContext(), candidates[:2], 50*time.Millisecond)
	if err != nil {
		t.Fatalf("expected summary lookup to prefer candidate with findings, got %v", err)
	}
	if len(summary.Artifacts) != 1 || len(summary.Artifacts[0].Issues) != 1 {
		t.Fatalf("expected digest candidate issues to be returned, got %#v", summary.Artifacts)
	}
	if resolvedCandidate.ArtifactPath != "default/docker-remote/n8nio/n8n/sha256__f462b5d11bae72b5d4b36c984c2459d4bf2ce17a59c933ddd7db468ef6754e69/manifest.json" {
		t.Fatalf("unexpected resolved artifact path %q", resolvedCandidate.ArtifactPath)
	}
}

func TestPollArtifactSummaryIgnoresTransientGatewayTimeout(t *testing.T) {
	client := &xrayClient{
		baseURL: "http://example.com",
		httpClient: newTestHTTPClient(func(req *http.Request) (*http.Response, error) {
			if req.URL.Path != "/xray/api/v2/summary/artifact" {
				return jsonResponse(http.StatusNotFound, map[string]string{"error": "not found"}), nil
			}

			var body map[string][]string
			if err := decodeJSONBody(req, &body); err != nil {
				return nil, err
			}
			path := ""
			if len(body["paths"]) > 0 {
				path = body["paths"][0]
			}

			switch path {
			case "default/docker-remote/n8nio/n8n/2.17.5/list.manifest.json":
				return &http.Response{
					StatusCode: http.StatusGatewayTimeout,
					Header:     make(http.Header),
					Body:       io.NopCloser(strings.NewReader("<html><body><h1>504 Gateway Time-out</h1></body></html>")),
				}, nil
			case "default/docker-remote/n8nio/n8n/sha256__f462b5d11bae72b5d4b36c984c2459d4bf2ce17a59c933ddd7db468ef6754e69/manifest.json":
				return jsonResponse(http.StatusOK, map[string]any{
					"artifacts": []map[string]any{{
						"issues": []map[string]any{{
							"issue_id":   "CVE-2026-9998",
							"severity":   "High",
							"summary":    "digest issue after transient timeout",
							"components": []map[string]any{{"component_id": "docker://n8nio/n8n:2.17.5"}},
						}},
					}},
				}), nil
			default:
				return jsonResponse(http.StatusBadRequest, map[string]string{"error": path}), nil
			}
		}),
	}

	candidates := buildXrayArtifactPathCandidates("default", "docker-remote", "n8nio/n8n", "2.17.5", "list.manifest.json", "sha256:f462b5d11bae72b5d4b36c984c2459d4bf2ce17a59c933ddd7db468ef6754e69")
	summary, resolvedCandidate, err := client.pollArtifactSummaryWithin(testContext(), candidates[:2], 50*time.Millisecond)
	if err != nil {
		t.Fatalf("expected transient gateway timeout to be ignored, got %v", err)
	}
	if len(summary.Artifacts) != 1 || len(summary.Artifacts[0].Issues) != 1 {
		t.Fatalf("expected digest candidate issues to be returned, got %#v", summary.Artifacts)
	}
	if resolvedCandidate.ArtifactPath != "default/docker-remote/n8nio/n8n/sha256__f462b5d11bae72b5d4b36c984c2459d4bf2ce17a59c933ddd7db468ef6754e69/manifest.json" {
		t.Fatalf("unexpected resolved artifact path %q", resolvedCandidate.ArtifactPath)
	}
}

func TestDoRegistryRequestUsesDedicatedRegistryClient(t *testing.T) {
	registryClientUsed := false
	client := &xrayClient{
		registryURL: "http://registry.example",
		httpClient: newTestHTTPClient(func(req *http.Request) (*http.Response, error) {
			return nil, fmt.Errorf("xray client should not be used for registry requests")
		}),
		registryHTTPClient: newTestHTTPClient(func(req *http.Request) (*http.Response, error) {
			registryClientUsed = true
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader("ok")),
			}, nil
		}),
	}

	response, err := client.doRegistryRequest(testContext(), http.MethodGet, "/v2/docker-remote/example/blobs/sha256:test", nil)
	if err != nil {
		t.Fatalf("expected registry request to succeed, got %v", err)
	}
	defer response.Body.Close()
	if !registryClientUsed {
		t.Fatal("expected registryHTTPClient to service registry requests")
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
