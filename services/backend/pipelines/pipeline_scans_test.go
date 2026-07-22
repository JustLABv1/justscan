package pipelines

import (
	"testing"

	"justscan-backend/pkg/models"
)

func TestComputeVerdictReturnsPendingForActiveScan(t *testing.T) {
	scan := &models.Scan{Status: models.ScanStatusRunning}
	if verdict := ComputeVerdict(scan, 0, nil); verdict != models.PipelineVerdictPending {
		t.Fatalf("ComputeVerdict() = %q, want %q", verdict, models.PipelineVerdictPending)
	}
}

func TestComputeVerdictFailsOnOrganizationPolicy(t *testing.T) {
	scan := &models.Scan{Status: models.ScanStatusCompleted, HighCount: 2}
	results := []models.ComplianceResult{{Status: "fail"}}
	if verdict := ComputeVerdict(scan, 1, results); verdict != models.PipelineVerdictFail {
		t.Fatalf("ComputeVerdict() = %q, want %q", verdict, models.PipelineVerdictFail)
	}
}

func TestComputeVerdictReturnsErrorForScanFailure(t *testing.T) {
	scan := &models.Scan{Status: models.ScanStatusFailed, CurrentStep: models.ScanStepFailed}
	if verdict := ComputeVerdict(scan, 0, nil); verdict != models.PipelineVerdictError {
		t.Fatalf("ComputeVerdict() = %q, want %q", verdict, models.PipelineVerdictError)
	}
}

func TestComputeVerdictWaitsForOrganizationPolicies(t *testing.T) {
	scan := &models.Scan{Status: models.ScanStatusCompleted}
	if verdict := ComputeVerdict(scan, 1, nil); verdict != models.PipelineVerdictPending {
		t.Fatalf("ComputeVerdict() = %q, want %q", verdict, models.PipelineVerdictPending)
	}
}
