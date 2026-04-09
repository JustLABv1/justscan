package scanner

import (
	"testing"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
)

func TestParseGrypeVulnerabilitiesPrefersCanonicalCVE(t *testing.T) {
	scanID := uuid.New()
	output := &GrypeOutput{
		Matches: []GrypeMatch{{
			Vulnerability: GrypeVulnerability{
				GrypeVulnerabilityMetadata: GrypeVulnerabilityMetadata{
					ID:         "GHSA-xxxx-yyyy-zzzz",
					Namespace:  "github:language:go",
					Severity:   "medium",
					DataSource: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz",
					URLs:       []string{"https://github.com/advisories/GHSA-xxxx-yyyy-zzzz"},
				},
				Fix: GrypeFix{Versions: []string{"1.2.3", "1.2.3", "1.2.4"}},
				Advisories: []GrypeAdvisory{{
					ID:   "GHSA-xxxx-yyyy-zzzz",
					Link: "https://advisories.example/GHSA-xxxx-yyyy-zzzz",
				}},
			},
			RelatedVulnerabilities: []GrypeVulnerabilityMetadata{{
				ID:          "CVE-2024-1234",
				Namespace:   "nvd:cpe",
				Severity:    "critical",
				DataSource:  "https://nvd.nist.gov/vuln/detail/CVE-2024-1234",
				URLs:        []string{"https://security.example/CVE-2024-1234"},
				Description: "Canonical CVE description",
				Cvss: []GrypeCVSS{{
					Version: "3.1",
					Vector:  "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
					Metrics: GrypeCVSSMetrics{BaseScore: 9.8},
				}},
			}},
			Artifact: GrypeArtifact{Name: "openssl", Version: "1.0.2"},
		}},
	}

	vulns := ParseGrypeVulnerabilities(output, scanID)
	if len(vulns) != 1 {
		t.Fatalf("expected 1 vulnerability, got %d", len(vulns))
	}

	vuln := vulns[0]
	if vuln.ScanID != scanID {
		t.Fatalf("expected scan id %s, got %s", scanID, vuln.ScanID)
	}
	if vuln.VulnID != "CVE-2024-1234" {
		t.Fatalf("expected canonical CVE id, got %q", vuln.VulnID)
	}
	if vuln.FixedVersion != "1.2.3, 1.2.4" {
		t.Fatalf("expected merged fixed versions, got %q", vuln.FixedVersion)
	}
	if vuln.Severity != models.SeverityCritical {
		t.Fatalf("expected critical severity, got %q", vuln.Severity)
	}
	if vuln.Description != "Canonical CVE description" {
		t.Fatalf("unexpected description %q", vuln.Description)
	}
	if vuln.DataSource != "nvd:cpe" {
		t.Fatalf("expected preferred namespace as data source, got %q", vuln.DataSource)
	}
	if vuln.CVSSScore != 9.8 {
		t.Fatalf("expected CVSS score 9.8, got %v", vuln.CVSSScore)
	}
	if vuln.CVSSVector != "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" {
		t.Fatalf("unexpected CVSS vector %q", vuln.CVSSVector)
	}
	assertHasString(t, vuln.References, "https://nvd.nist.gov/vuln/detail/CVE-2024-1234")
	assertHasString(t, vuln.References, "https://security.example/CVE-2024-1234")
	assertHasString(t, vuln.References, "https://advisories.example/GHSA-xxxx-yyyy-zzzz")
}

func TestMergeLocalScannerFindingsKeepsBestDetails(t *testing.T) {
	scanID := uuid.New()
	existing := []models.Vulnerability{{
		ScanID:           scanID,
		VulnID:           "CVE-2024-9999",
		PkgName:          "openssl",
		InstalledVersion: "1.0.0",
		Severity:         models.SeverityMedium,
		Description:      "short",
		References:       []string{"https://existing.example/ref"},
		CVSSScore:        5.0,
		CVSSVector:       "CVSS:3.1/AV:L",
	}}
	incoming := []models.Vulnerability{{
		ScanID:           scanID,
		VulnID:           "CVE-2024-9999",
		PkgName:          "openssl",
		InstalledVersion: "1.0.0",
		FixedVersion:     "1.0.1",
		Severity:         models.SeverityHigh,
		Title:            "Better title",
		Description:      "much more complete description",
		References:       []string{"https://incoming.example/ref"},
		DataSource:       "nvd:cpe",
		CVSSScore:        7.5,
		CVSSVector:       "CVSS:3.1/AV:N/AC:L",
	}}

	merged := MergeLocalScannerFindings(existing, incoming)
	if len(merged) != 1 {
		t.Fatalf("expected 1 merged vulnerability, got %d", len(merged))
	}

	vuln := merged[0]
	if vuln.FixedVersion != "1.0.1" {
		t.Fatalf("expected fixed version to be merged, got %q", vuln.FixedVersion)
	}
	if vuln.Title != "Better title" {
		t.Fatalf("expected title to be merged, got %q", vuln.Title)
	}
	if vuln.Description != "much more complete description" {
		t.Fatalf("expected longer description, got %q", vuln.Description)
	}
	if vuln.DataSource != "nvd:cpe" {
		t.Fatalf("expected data source to be merged, got %q", vuln.DataSource)
	}
	if vuln.Severity != models.SeverityHigh {
		t.Fatalf("expected higher severity, got %q", vuln.Severity)
	}
	if vuln.CVSSScore != 7.5 {
		t.Fatalf("expected higher CVSS score, got %v", vuln.CVSSScore)
	}
	if vuln.CVSSVector != "CVSS:3.1/AV:N/AC:L" {
		t.Fatalf("expected higher CVSS vector, got %q", vuln.CVSSVector)
	}
	assertHasString(t, vuln.References, "https://existing.example/ref")
	assertHasString(t, vuln.References, "https://incoming.example/ref")
}

func TestExtractGrypeKBEntriesMergesDuplicateAliases(t *testing.T) {
	output := &GrypeOutput{
		Matches: []GrypeMatch{
			{
				Vulnerability: GrypeVulnerability{
					GrypeVulnerabilityMetadata: GrypeVulnerabilityMetadata{
						ID:          "GHSA-alias-1234",
						Severity:    "medium",
						Description: "Short description",
						URLs:        []string{"https://github.example/GHSA-alias-1234"},
					},
					Advisories: []GrypeAdvisory{{
						ID:   "exploit-db",
						Link: "https://exploit-db.com/exploits/12345",
					}},
				},
				RelatedVulnerabilities: []GrypeVulnerabilityMetadata{{
					ID:          "CVE-2024-7777",
					Namespace:   "nvd:cpe",
					Severity:    "high",
					Description: "Longer canonical description",
					DataSource:  "https://nvd.nist.gov/vuln/detail/CVE-2024-7777",
					Cvss: []GrypeCVSS{{
						Version: "3.1",
						Vector:  "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N",
						Metrics: GrypeCVSSMetrics{BaseScore: 8.4},
					}},
				}},
			},
			{
				Vulnerability: GrypeVulnerability{
					GrypeVulnerabilityMetadata: GrypeVulnerabilityMetadata{
						ID:          "CVE-2024-7777",
						Namespace:   "nvd:cpe",
						Severity:    "critical",
						Description: "Longest canonical description available",
						URLs:        []string{"https://security.example/CVE-2024-7777"},
						Cvss: []GrypeCVSS{{
							Version: "3.1",
							Vector:  "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H",
							Metrics: GrypeCVSSMetrics{BaseScore: 9.7},
						}},
					},
				},
			},
		},
	}

	entries := ExtractGrypeKBEntries(output)
	if len(entries) != 1 {
		t.Fatalf("expected 1 KB entry, got %d", len(entries))
	}

	entry := entries[0]
	if entry.VulnID != "CVE-2024-7777" {
		t.Fatalf("expected canonical vuln id, got %q", entry.VulnID)
	}
	if entry.Severity != models.SeverityCritical {
		t.Fatalf("expected highest severity, got %q", entry.Severity)
	}
	if entry.Description != "Longest canonical description available" {
		t.Fatalf("expected longest description, got %q", entry.Description)
	}
	if entry.CVSSScore != 9.7 {
		t.Fatalf("expected highest CVSS score, got %v", entry.CVSSScore)
	}
	if entry.CVSSVector != "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H" {
		t.Fatalf("unexpected CVSS vector %q", entry.CVSSVector)
	}
	if !entry.ExploitAvailable {
		t.Fatal("expected exploit availability to be detected")
	}
	assertHasKBRef(t, entry.References, "https://nvd.nist.gov/vuln/detail/CVE-2024-7777")
	assertHasKBRef(t, entry.References, "https://exploit-db.com/exploits/12345")
	assertHasKBRef(t, entry.References, "https://security.example/CVE-2024-7777")
}

func assertHasString(t *testing.T, values []string, want string) {
	t.Helper()
	for _, value := range values {
		if value == want {
			return
		}
	}
	t.Fatalf("expected %q in %v", want, values)
}

func assertHasKBRef(t *testing.T, refs []models.KBRef, wantURL string) {
	t.Helper()
	for _, ref := range refs {
		if ref.URL == wantURL {
			return
		}
	}
	t.Fatalf("expected KB reference %q in %#v", wantURL, refs)
}
