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
				IssueID:   "XRAY-123",
				Summary:   "Summary issue",
				Severity:  "High",
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
				IssueID:   "XRAY-456",
				Summary:   "Explicit score issue",
				Severity:  "Medium",
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