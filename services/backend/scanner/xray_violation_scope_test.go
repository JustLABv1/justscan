package scanner

import (
	"testing"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
)

func TestParseXrayViolationsPayloadSkipsIgnoredViolations(t *testing.T) {
	payload := map[string]any{"violations": []any{
		map[string]any{"issue_id": "CVE-2026-1", "watch_name": "prod", "is_ignored": true, "matched_policies": []any{map[string]any{"policy": "block", "is_blocking": true}}},
		map[string]any{"issue_id": "CVE-2026-2", "watch_name": "prod", "status": "Ignored"},
		map[string]any{"issue_id": "CVE-2026-3", "watch_name": "prod", "is_ignored": false, "infected_components": []any{"deb://debian:bookworm:openssl:3.0.11"}},
	}}
	response := parseXrayViolationsPayload(payload)
	if response == nil || len(response.Violations) != 1 || response.Violations[0].IssueID != "CVE-2026-3" {
		t.Fatalf("ignored violations were not dropped: %#v", response)
	}
	if got := response.Violations[0].InfectedComponents; len(got) != 1 || got[0] != "deb://debian:bookworm:openssl:3.0.11" {
		t.Fatalf("infected components not captured: %v", got)
	}
}

func TestXrayViolationComponentRefsReadsObjects(t *testing.T) {
	refs := xrayViolationComponentRefs(models.JSONObject{
		"impacted_components": []any{
			map[string]any{"component_id": "npm://lodash:4.17.20"},
			map[string]any{"name": "deb://debian:bookworm:libssl3", "version": "3.0.11"},
		},
	})
	if len(refs) != 2 || refs[0] != "npm://lodash:4.17.20" || refs[1] != "deb://debian:bookworm:libssl3:3.0.11" {
		t.Fatalf("unexpected component refs: %v", refs)
	}
}

func TestXrayViolationFindingIDsRespectsComponents(t *testing.T) {
	openssl := models.Vulnerability{ID: uuid.New(), VulnID: "CVE-2026-3", PkgName: "openssl", InstalledVersion: "3.0.11", ExternalComponentID: "deb://debian:bookworm:openssl:3.0.11"}
	libssl := models.Vulnerability{ID: uuid.New(), VulnID: "CVE-2026-3", PkgName: "libssl3", InstalledVersion: "3.0.11", ExternalComponentID: "deb://debian:bookworm:libssl3:3.0.11"}
	other := models.Vulnerability{ID: uuid.New(), VulnID: "CVE-2026-4", PkgName: "openssl", InstalledVersion: "3.0.11"}
	findings := []models.Vulnerability{openssl, libssl, other}

	scoped := xrayViolationFindingIDs(xrayViolationRecord{IssueID: "CVE-2026-3", InfectedComponents: []string{"deb://debian:bookworm:openssl:3.0.11"}}, findings)
	if len(scoped) != 1 || scoped[0] != openssl.ID {
		t.Fatalf("component-scoped violation matched %v", scoped)
	}

	unscoped := xrayViolationFindingIDs(xrayViolationRecord{IssueID: "CVE-2026-3"}, findings)
	if len(unscoped) != 2 {
		t.Fatalf("violation without components should match every finding with the ID, got %v", unscoped)
	}

	unmatched := xrayViolationFindingIDs(xrayViolationRecord{IssueID: "CVE-2026-3", InfectedComponents: []string{"rpm://unknown-format"}}, findings)
	if len(unmatched) != 2 {
		t.Fatalf("unmatchable components should fall back to ID matching, got %v", unmatched)
	}
}

func TestXrayComponentRefMatchesFindingByPackageAndVersion(t *testing.T) {
	finding := &models.Vulnerability{PkgName: "openssl", InstalledVersion: "3.0.11"}
	for ref, want := range map[string]bool{
		"deb://debian:bookworm:openssl:3.0.11": true,
		"deb://debian:bookworm:openssl":        true,
		"deb://debian:bookworm:openssl:1.1.1":  false,
		"deb://debian:bookworm:libssl3:3.0.11": false,
	} {
		if got := xrayComponentRefMatchesFinding(ref, finding); got != want {
			t.Errorf("%s: got %v want %v", ref, got, want)
		}
	}
}
