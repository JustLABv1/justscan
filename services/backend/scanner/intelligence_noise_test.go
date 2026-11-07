package scanner

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
)

func TestFeedEvidenceRecordKeyHasNoNULByte(t *testing.T) {
	for _, key := range []string{feedEvidenceRecordKey("CVE-1", ""), feedEvidenceRecordKey("CVE-1", "openssl")} {
		if strings.ContainsRune(key, 0) {
			t.Fatalf("record key %q contains a NUL byte", key)
		}
	}
	if got := feedEvidenceRecordKey("CVE-1", ""); got != "feed:CVE-1" {
		t.Fatalf("package-less key changed, existing rows would stop deduplicating: %q", got)
	}
}

func TestFixedVersionsAreNew(t *testing.T) {
	cases := []struct {
		scan    string
		current []string
		want    bool
	}{
		{"1.26.10, 1.27.3", []string{"1.26.10", "1.27.3"}, false},
		{"v1.2.3", []string{"1.2.3"}, false},
		{"", []string{"1.2.3"}, true},
		{"1.2.3", []string{"1.2.3", "1.3.0"}, true},
		{"1.2.3", nil, false},
	}
	for _, tc := range cases {
		if got := fixedVersionsAreNew(tc.scan, tc.current); got != tc.want {
			t.Errorf("fixedVersionsAreNew(%q, %v) = %v, want %v", tc.scan, tc.current, got, tc.want)
		}
	}
}

func TestRepeatedScanFixIsNotReportedAsChange(t *testing.T) {
	finding := models.Vulnerability{PkgName: "stdlib", InstalledVersion: "v1.27.1", FixedVersion: "1.26.9, 1.27.2", Severity: "HIGH"}
	evidence := models.VulnerabilityIntelligenceEvidence{
		Source: "go", CVEState: models.IntelligenceCVEStateAffected, Severity: "HIGH",
		FixedVersions: []string{"1.26.9", "1.27.2"},
	}
	if state, _ := derivePostureState(finding, evidence); state != models.PostureStateUnchanged {
		t.Fatalf("state = %q, want unchanged", state)
	}
	finding.FixedVersion = ""
	if state, _ := derivePostureState(finding, evidence); state != models.PostureStateFixAvailable {
		t.Fatalf("state = %q, want fix_available", state)
	}
}

func TestMultiSourcePostureKeepsNewestChangeEvent(t *testing.T) {
	older, newer := uuid.New(), uuid.New()
	now := time.Now().UTC()
	finding := models.Vulnerability{PkgName: "pkg", InstalledVersion: "1.0.0", Severity: "HIGH"}
	latest := []models.VulnerabilityIntelligenceEvidence{
		{Source: "a", CVEState: models.IntelligenceCVEStateAffected, Severity: "HIGH", ObservedAt: now, ChangeEventID: &newer},
		{Source: "b", CVEState: models.IntelligenceCVEStateAffected, Severity: "HIGH", ObservedAt: now.Add(-time.Hour), ChangeEventID: &older},
	}
	posture := derivePostureForIdentity(finding, vulnerabilityFindingIdentity{PackageName: "pkg", InstalledVersion: "1.0.0"}, latest, nil)
	if posture.ChangeEventID == nil || *posture.ChangeEventID != newer {
		t.Fatalf("change event = %v, want %v", posture.ChangeEventID, newer)
	}
}

func TestRawJSONObjectStripsNUL(t *testing.T) {
	object, err := rawJSONObject([]byte(`{"a\u0000b":"x\u0000y","lit":"escape \\u0000 here","n":[{"k":"\u0000"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(object)
	if strings.Contains(string(encoded), `u0000`) && !strings.Contains(string(encoded), `\\ u0000`) || strings.Contains(string(encoded), `\u0000`) {
		t.Fatalf("NUL survived: %s", encoded)
	}
}
