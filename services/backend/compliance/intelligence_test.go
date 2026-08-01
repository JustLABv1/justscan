package compliance

import (
	"context"
	"testing"
	"time"

	"justscan-backend/pkg/models"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

func intelligencePolicy(rule models.PolicyRule) *models.OrgPolicy {
	return &models.OrgPolicy{
		ID:    uuid.New(),
		Name:  "intelligence test policy",
		Rules: models.PolicyRuleList{rule},
	}
}

func intelligenceFinding(posture *models.VulnerabilityPosture) (models.Vulnerability, map[uuid.UUID]struct{}) {
	finding := models.Vulnerability{
		ID:             uuid.New(),
		VulnID:         "CVE-2026-0001",
		PkgName:        "example",
		Severity:       models.SeverityHigh,
		CVSSScore:      7.5,
		FixedVersion:   "",
		CurrentPosture: posture,
	}
	return finding, map[uuid.UUID]struct{}{finding.ID: {}}
}

func TestEvaluateScanIntelligencePolicyImpactsScopesResultsToVisibleOrganizations(t *testing.T) {
	sqldb, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to create mock database: %v", err)
	}
	defer sqldb.Close()
	db := bun.NewDB(sqldb, pgdialect.New())
	defer db.Close()
	mock.MatchExpectationsInOrder(false)

	scanID := uuid.New()
	visibleOrgID := uuid.New()
	hiddenOrgID := uuid.New()
	visiblePolicyID := uuid.New()
	hiddenPolicyID := uuid.New()
	finding, _ := intelligenceFinding(&models.VulnerabilityPosture{
		State:    models.PostureStateRejected,
		CVEState: models.IntelligenceCVEStateRejected,
		Reason:   "source rejected the CVE",
	})
	finding.ScanID = scanID
	policyChanges := map[uuid.UUID]models.IntelligencePostureChange{
		finding.ID: {FindingID: finding.ID, ScanID: scanID, VulnID: finding.VulnID, Reason: "source rejected the CVE"},
	}
	now := time.Now().UTC()
	policyRuleJSON := []byte(`[{"type":"max_total","value":0}]`)

	mock.ExpectQuery(`(?s)SELECT .*FROM "compliance_results"`).WillReturnRows(
		sqlmock.NewRows([]string{"id", "scan_id", "policy_id", "org_id", "status", "violations", "evaluated_at"}).
			AddRow(uuid.New(), scanID, visiblePolicyID, visibleOrgID, "fail", []byte(`[]`), now).
			AddRow(uuid.New(), scanID, hiddenPolicyID, hiddenOrgID, "fail", []byte(`[]`), now),
	)
	mock.ExpectQuery(`(?s)SELECT .*FROM "org_policies"`).WillReturnRows(
		sqlmock.NewRows([]string{"id", "org_id", "name", "rules", "include_suppressed", "created_at", "updated_at"}).
			AddRow(visiblePolicyID, visibleOrgID, "Visible policy", policyRuleJSON, true, now, now),
	)

	response, err := evaluateScanPolicyImpacts(
		context.Background(),
		db,
		&models.Scan{ID: scanID, Status: models.ScanStatusCompleted},
		[]models.Vulnerability{finding},
		policyChanges,
		[]uuid.UUID{visibleOrgID},
		false,
	)
	if err != nil {
		t.Fatalf("evaluateScanPolicyImpacts() error = %v", err)
	}
	if len(response.Policies) != 1 {
		t.Fatalf("got %d policy impacts, want one visible impact", len(response.Policies))
	}
	if response.Policies[0].OrgID != visibleOrgID || response.Policies[0].PolicyID != visiblePolicyID {
		t.Fatalf("returned unauthorized policy impact: %#v", response.Policies[0])
	}
	if response.Policies[0].Impact != IntelligencePolicyImpactResolved {
		t.Fatalf("impact = %q, want resolved", response.Policies[0].Impact)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestEvaluatePolicyWithCurrentIntelligenceExcludesRejectedAndNotAffected(t *testing.T) {
	policy := intelligencePolicy(models.PolicyRule{Type: "max_total", Value: 0})

	for _, state := range []string{models.PostureStateRejected, models.PostureStateNotAffected} {
		t.Run(state, func(t *testing.T) {
			finding, changed := intelligenceFinding(&models.VulnerabilityPosture{
				State:    state,
				CVEState: state,
				Reason:   "source no longer considers this finding affected",
			})
			evaluation := EvaluatePolicyWithCurrentIntelligence(policy, []models.Vulnerability{finding}, changed)
			if evaluation.Status != IntelligencePolicyStatusPass {
				t.Fatalf("status = %q, want pass", evaluation.Status)
			}
			if len(evaluation.Violations) != 0 {
				t.Fatalf("violations = %#v, want none", evaluation.Violations)
			}
		})
	}
}

func TestEvaluatePolicyWithCurrentIntelligenceOverlaysRescoredSeverityAndCVSS(t *testing.T) {
	finding, changed := intelligenceFinding(&models.VulnerabilityPosture{
		State:      models.PostureStateSeverityIncreased,
		CVEState:   models.IntelligenceCVEStateAffected,
		Severity:   models.SeverityCritical,
		CVSSScore:  9.1,
		CVSSVector: "CVSS:4.0/AV:N",
	})

	maxCVSS := EvaluatePolicyWithCurrentIntelligence(
		intelligencePolicy(models.PolicyRule{Type: "max_cvss", Value: 9}),
		[]models.Vulnerability{finding},
		changed,
	)
	if maxCVSS.Status != IntelligencePolicyStatusFail || len(maxCVSS.Violations) != 1 {
		t.Fatalf("max_cvss evaluation = %#v, want one violation", maxCVSS)
	}

	maxCritical := EvaluatePolicyWithCurrentIntelligence(
		intelligencePolicy(models.PolicyRule{Type: "max_count", Severity: models.SeverityCritical, Value: 0}),
		[]models.Vulnerability{finding},
		changed,
	)
	if maxCritical.Status != IntelligencePolicyStatusFail || len(maxCritical.Violations) != 1 {
		t.Fatalf("max_count evaluation = %#v, want one violation", maxCritical)
	}
	if len(maxCritical.ChangedCVEIDs) != 1 || maxCritical.ChangedCVEIDs[0] != finding.VulnID {
		t.Fatalf("changed CVEs = %#v, want %q", maxCritical.ChangedCVEIDs, finding.VulnID)
	}
}

func TestEvaluatePolicyWithCurrentIntelligenceUsesNewFixedVersions(t *testing.T) {
	finding, changed := intelligenceFinding(&models.VulnerabilityPosture{
		State:         models.PostureStateFixAvailable,
		CVEState:      models.IntelligenceCVEStateAffected,
		Severity:      models.SeverityHigh,
		FixedVersions: []string{"2.0.0"},
	})
	policy := intelligencePolicy(models.PolicyRule{Type: "require_fix", Severity: models.SeverityHigh})

	evaluation := EvaluatePolicyWithCurrentIntelligence(policy, []models.Vulnerability{finding}, changed)
	if evaluation.Status != IntelligencePolicyStatusPass {
		t.Fatalf("status = %q, want pass", evaluation.Status)
	}
}

func TestEvaluatePolicyWithCurrentIntelligenceRetainsUncertainFailure(t *testing.T) {
	finding, changed := intelligenceFinding(&models.VulnerabilityPosture{
		State:    models.PostureStateDisputed,
		CVEState: models.IntelligenceCVEStateDisputed,
		Reason:   "provider marked the CVE disputed",
	})
	policy := intelligencePolicy(models.PolicyRule{Type: "blocked_cve", CVEID: finding.VulnID})

	evaluation := EvaluatePolicyWithCurrentIntelligence(policy, []models.Vulnerability{finding}, changed)
	if evaluation.Status != IntelligencePolicyStatusNeedsValidation {
		t.Fatalf("status = %q, want needs_validation", evaluation.Status)
	}
	if len(evaluation.Violations) != 1 || evaluation.Violations[0].VulnID != finding.VulnID {
		t.Fatalf("violations = %#v, want the original finding retained", evaluation.Violations)
	}
}

func TestClassifyPolicyImpact(t *testing.T) {
	violation := models.Violation{Message: "CVE violates policy", VulnID: "CVE-2026-0001"}
	tests := []struct {
		name                 string
		historical           string
		current              string
		historicalV          models.ViolationList
		currentV             models.ViolationList
		needsValidate        bool
		intelligenceAffected bool
		wantImpact           string
		wantMaterial         bool
	}{
		{name: "resolved", historical: "fail", current: "pass", wantImpact: IntelligencePolicyImpactResolved, wantMaterial: true},
		{name: "new failure", historical: "pass", current: "fail", wantImpact: IntelligencePolicyImpactNewFailure, wantMaterial: true},
		{name: "still failed", historical: "fail", current: "fail", historicalV: models.ViolationList{violation}, currentV: models.ViolationList{violation}, intelligenceAffected: true, wantImpact: IntelligencePolicyImpactStillFailed, wantMaterial: true},
		{name: "unchanged failure", historical: "fail", current: "fail", historicalV: models.ViolationList{violation}, currentV: models.ViolationList{violation}, wantMaterial: false},
		{name: "validation", historical: "fail", current: IntelligencePolicyStatusNeedsValidation, needsValidate: true, wantImpact: IntelligencePolicyImpactNeedsValidation, wantMaterial: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			impact, material := classifyPolicyImpact(tt.historical, tt.current, tt.historicalV, tt.currentV, tt.needsValidate, tt.intelligenceAffected)
			if impact != tt.wantImpact || material != tt.wantMaterial {
				t.Fatalf("classifyPolicyImpact() = (%q, %t), want (%q, %t)", impact, material, tt.wantImpact, tt.wantMaterial)
			}
		})
	}
}

func TestIntelligencePolicyImpactDedupeKeyIsDeterministic(t *testing.T) {
	scanID := uuid.New()
	findingA := uuid.New()
	findingB := uuid.New()
	eventA := uuid.New()
	eventB := uuid.New()
	first := map[uuid.UUID]models.IntelligencePostureChange{
		findingA: {FindingID: findingA, PostureEventID: eventA},
		findingB: {FindingID: findingB, PostureEventID: eventB},
	}
	second := map[uuid.UUID]models.IntelligencePostureChange{
		findingB: {FindingID: findingB, PostureEventID: eventB},
		findingA: {FindingID: findingA, PostureEventID: eventA},
	}

	left := intelligencePolicyImpactDedupeKey(scanID, IntelligencePolicyImpactResolved, first)
	right := intelligencePolicyImpactDedupeKey(scanID, IntelligencePolicyImpactResolved, second)
	if left != right {
		t.Fatalf("dedupe keys differ for the same changes: %q != %q", left, right)
	}
}
