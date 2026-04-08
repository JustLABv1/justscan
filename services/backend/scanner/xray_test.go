package scanner

import (
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
