package scanner

import (
	"strings"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

func TestDerivePostureState(t *testing.T) {
	tests := []struct {
		name          string
		finding       models.Vulnerability
		evidence      models.VulnerabilityIntelligenceEvidence
		wantState     string
		wantReasonHas string
	}{
		{
			name: "fixed version is actionable",
			finding: models.Vulnerability{
				Severity:  models.SeverityHigh,
				CVSSScore: 7.5,
			},
			evidence: models.VulnerabilityIntelligenceEvidence{
				Source:        "NVD",
				CVEState:      models.IntelligenceCVEStateAffected,
				Severity:      models.SeverityHigh,
				FixedVersions: []string{"1.2.4"},
				ObservedAt:    time.Now(),
			},
			wantState:     models.PostureStateFixAvailable,
			wantReasonHas: "1.2.4",
		},
		{
			name: "severity increase is separate from scan finding",
			finding: models.Vulnerability{
				Severity:  models.SeverityMedium,
				CVSSScore: 5.0,
			},
			evidence: models.VulnerabilityIntelligenceEvidence{
				Source:     "NVD",
				CVEState:   models.IntelligenceCVEStateAffected,
				Severity:   models.SeverityHigh,
				CVSSScore:  8.1,
				ObservedAt: time.Now(),
			},
			wantState:     models.PostureStateSeverityIncreased,
			wantReasonHas: "NVD",
		},
		{
			name: "unknown applicability requires rescan",
			finding: models.Vulnerability{
				Severity:  models.SeverityHigh,
				CVSSScore: 8.1,
			},
			evidence: models.VulnerabilityIntelligenceEvidence{
				Source:     "OSV",
				CVEState:   models.IntelligenceCVEStateUnknown,
				Severity:   models.SeverityUnknown,
				ObservedAt: time.Now(),
			},
			wantState:     models.PostureStateNeedsRescan,
			wantReasonHas: "rescan",
		},
		{
			name: "explicit not affected can be represented",
			finding: models.Vulnerability{
				Severity: models.SeverityHigh,
			},
			evidence: models.VulnerabilityIntelligenceEvidence{
				Source:     "vendor",
				CVEState:   models.IntelligenceCVEStateNotAffected,
				Severity:   models.SeverityUnknown,
				ObservedAt: time.Now(),
			},
			wantState:     models.PostureStateNotAffected,
			wantReasonHas: "explicitly",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			state, reason := derivePostureState(tt.finding, tt.evidence)
			if state != tt.wantState {
				t.Fatalf("state = %q, want %q", state, tt.wantState)
			}
			if !strings.Contains(strings.ToLower(reason), strings.ToLower(tt.wantReasonHas)) {
				t.Fatalf("reason = %q, want it to contain %q", reason, tt.wantReasonHas)
			}
		})
	}
}

func TestDerivePostureStoresConflictingSources(t *testing.T) {
	findingID := uuid.New()
	scanID := uuid.New()
	finding := models.Vulnerability{
		ID:       findingID,
		ScanID:   scanID,
		Severity: models.SeverityHigh,
	}
	latest := []models.VulnerabilityIntelligenceEvidence{
		{
			IntelligenceVersionID: uuid.New(),
			Source:                "NVD",
			CVEState:              models.IntelligenceCVEStateAffected,
			Severity:              models.SeverityHigh,
			CVSSScore:             7.5,
			ObservedAt:            time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC),
		},
		{
			IntelligenceVersionID: uuid.New(),
			Source:                "OSV",
			CVEState:              models.IntelligenceCVEStateAffected,
			Severity:              models.SeverityMedium,
			CVSSScore:             5.0,
			ObservedAt:            time.Date(2026, 8, 1, 10, 0, 1, 0, time.UTC),
		},
	}

	posture := derivePosture(finding, latest, map[uuid.UUID]string{})
	if posture.State != models.PostureStateNeedsRescan {
		t.Fatalf("state = %q, want %q", posture.State, models.PostureStateNeedsRescan)
	}
	if len(posture.ConflictSources) != 2 || posture.ConflictSources[0] != "NVD" || posture.ConflictSources[1] != "OSV" {
		t.Fatalf("conflict sources = %#v, want [NVD OSV]", posture.ConflictSources)
	}
	if posture.FindingID != findingID || posture.ScanID != scanID {
		t.Fatalf("posture identity = finding %s / scan %s, want finding %s / scan %s", posture.FindingID, posture.ScanID, findingID, scanID)
	}
	if posture.Severity != models.SeverityUnknown || posture.CVSSScore != 0 {
		t.Fatalf("conflicting posture selected a score: severity=%q score=%v", posture.Severity, posture.CVSSScore)
	}
}

func TestHistoricalFindingsQueryRequiresExistingScan(t *testing.T) {
	sqldb, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock database: %v", err)
	}
	defer sqldb.Close()

	db := bun.NewDB(sqldb, pgdialect.New())
	defer db.Close()

	query := historicalFindingsForPostureRefreshQuery(db, []string{"CVE-2026-0001"}).String()
	if !strings.Contains(query, "JOIN scans AS s ON s.id = v.scan_id") {
		t.Fatalf("historical finding query does not require a valid scan: %s", query)
	}
	if !strings.Contains(query, "v.vuln_id IN") {
		t.Fatalf("historical finding query lost the vulnerability filter: %s", query)
	}
}

func TestIntelligenceDescriptorUsesFeedVersion(t *testing.T) {
	updatedAt := time.Date(2026, 7, 30, 12, 0, 0, 0, time.UTC)
	scan := &models.Scan{
		ID:                      uuid.New(),
		ScanProvider:            models.ScanProviderTrivy,
		TrivyVersion:            "0.61.0",
		TrivyVulnDBUpdatedAt:    &updatedAt,
		TrivyVulnDBDownloadedAt: &updatedAt,
	}

	descriptor := intelligenceDescriptorForScan(scan)
	if descriptor.Source != models.IntelligenceSourceTrivy {
		t.Fatalf("source = %q, want %q", descriptor.Source, models.IntelligenceSourceTrivy)
	}
	if descriptor.Version != "vuln-db:2026-07-30T12:00:00Z" {
		t.Fatalf("version = %q, want feed timestamp version", descriptor.Version)
	}
	if descriptor.FeedObservedAt == nil || !descriptor.FeedObservedAt.Equal(updatedAt) {
		t.Fatalf("feed observed at = %v, want %v", descriptor.FeedObservedAt, updatedAt)
	}
}

func TestNormalizeIntelligenceIngestRequest(t *testing.T) {
	feedObservedAt := time.Date(2026, 8, 1, 12, 0, 0, 0, time.FixedZone("CEST", 2*60*60))
	request, err := normalizeIntelligenceIngestRequest(IntelligenceIngestRequest{
		Source:         " NVD ",
		Version:        " 2026-08-01 ",
		FeedObservedAt: &feedObservedAt,
		Records: []IntelligenceIngestRecord{{
			VulnID:        "CVE-2026-0001",
			CVEState:      "not affected",
			Severity:      "critical",
			CVSSScore:     9.8,
			FixedVersions: []string{" 1.2.4 ", "1.2.4", ""},
		}},
	})
	if err != nil {
		t.Fatalf("normalize request: %v", err)
	}
	if request.Source != "nvd" || request.Version != "2026-08-01" {
		t.Fatalf("normalized descriptor = %q/%q", request.Source, request.Version)
	}
	record := request.Records[0]
	if record.CVEState != models.IntelligenceCVEStateNotAffected {
		t.Fatalf("cve state = %q, want %q", record.CVEState, models.IntelligenceCVEStateNotAffected)
	}
	if record.Severity != models.SeverityCritical {
		t.Fatalf("severity = %q, want %q", record.Severity, models.SeverityCritical)
	}
	if len(record.FixedVersions) != 1 || record.FixedVersions[0] != "1.2.4" {
		t.Fatalf("fixed versions = %#v", record.FixedVersions)
	}
	if record.ObservedAt == nil || !record.ObservedAt.Equal(feedObservedAt.UTC()) {
		t.Fatalf("observed at = %v, want %v", record.ObservedAt, feedObservedAt.UTC())
	}
}

func TestNormalizeIntelligenceIngestRequestUnknownApplicabilityRequiresRescan(t *testing.T) {
	request, err := normalizeIntelligenceIngestRequest(IntelligenceIngestRequest{
		Source:  "osv",
		Version: "feed-1",
		Records: []IntelligenceIngestRecord{{
			VulnID:   "CVE-2026-0002",
			CVEState: "",
		}},
	})
	if err != nil {
		t.Fatalf("normalize request: %v", err)
	}
	if request.Records[0].CVEState != models.IntelligenceCVEStateUnknown {
		t.Fatalf("cve state = %q, want unknown", request.Records[0].CVEState)
	}
	state, _ := derivePostureState(models.Vulnerability{}, models.VulnerabilityIntelligenceEvidence{
		Source:   request.Records[0].Source,
		CVEState: request.Records[0].CVEState,
	})
	if state != models.PostureStateNeedsRescan {
		t.Fatalf("state = %q, want %q", state, models.PostureStateNeedsRescan)
	}
}

func TestLatestEvidenceForFindingPrefersFeedAndPackageSpecificRecords(t *testing.T) {
	oldScan := models.VulnerabilityIntelligenceEvidence{
		Source:       "NVD",
		EvidenceKind: "scan",
		CVEState:     models.IntelligenceCVEStateAffected,
		Severity:     models.SeverityMedium,
		ObservedAt:   time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC),
	}
	wildcardFeed := models.VulnerabilityIntelligenceEvidence{
		Source:        "nvd",
		EvidenceKind:  "feed",
		CVEState:      models.IntelligenceCVEStateAffected,
		Severity:      models.SeverityHigh,
		FixedVersions: []string{"2.0.0"},
		ObservedAt:    time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC),
	}
	exactFeed := wildcardFeed
	exactFeed.Severity = models.SeverityCritical
	exactFeed.FixedVersions = []string{"2.1.0"}

	latest := latestEvidenceForFinding(
		[]models.VulnerabilityIntelligenceEvidence{exactFeed},
		[]models.VulnerabilityIntelligenceEvidence{oldScan, wildcardFeed},
	)
	if len(latest) != 1 {
		t.Fatalf("latest evidence count = %d, want 1", len(latest))
	}
	if latest[0].Source != "nvd" || latest[0].EvidenceKind != "feed" || latest[0].Severity != models.SeverityCritical {
		t.Fatalf("selected evidence = %#v", latest[0])
	}
}

func TestDerivePostureCarriesFeedEvidenceFields(t *testing.T) {
	finding := models.Vulnerability{
		ID:               uuid.New(),
		ScanID:           uuid.New(),
		Severity:         models.SeverityMedium,
		InstalledVersion: "1.1.0",
	}
	ranges := []models.JSONObject{{"introduced": "1.0.0", "fixed": "1.2.0"}}
	exploits := []models.JSONObject{{"type": "known_exploit", "available": true}}
	posture := derivePosture(finding, []models.VulnerabilityIntelligenceEvidence{{
		IntelligenceVersionID: uuid.New(),
		Source:                "nvd",
		CVEState:              models.IntelligenceCVEStateAffected,
		Severity:              models.SeverityHigh,
		CVSSScore:             8.2,
		AffectedRanges:        ranges,
		FixedVersions:         []string{"1.2.0"},
		ExploitSignals:        exploits,
		ObservedAt:            time.Now().UTC(),
	}}, map[uuid.UUID]string{})
	if posture.CVEState != models.IntelligenceCVEStateAffected {
		t.Fatalf("cve state = %q", posture.CVEState)
	}
	if len(posture.AffectedRanges) != 1 || len(posture.ExploitSignals) != 1 {
		t.Fatalf("posture evidence fields = ranges %#v exploits %#v", posture.AffectedRanges, posture.ExploitSignals)
	}
	if posture.State != models.PostureStateFixAvailable {
		t.Fatalf("state = %q, want %q", posture.State, models.PostureStateFixAvailable)
	}
}
