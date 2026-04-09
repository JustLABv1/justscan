package scanner

import (
	"net/http"
	"testing"

	"github.com/google/uuid"
)

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
