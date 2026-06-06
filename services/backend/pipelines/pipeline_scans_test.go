package pipelines

import (
	"testing"

	"justscan-backend/pkg/models"
)

func TestComputeVerdictReturnsPendingForActiveScan(t *testing.T) {
	scan := &models.Scan{Status: models.ScanStatusRunning}
	cfg := models.PipelineVerdictConfig{FailOnSeverity: "high", FailOnScanError: true, FailOnXrayBlock: true}

	if verdict := ComputeVerdict(cfg, scan); verdict != models.PipelineVerdictPending {
		t.Fatalf("ComputeVerdict() = %q, want %q", verdict, models.PipelineVerdictPending)
	}
}

func TestComputeVerdictFailsOnSeverityThreshold(t *testing.T) {
	scan := &models.Scan{
		Status:        models.ScanStatusCompleted,
		CriticalCount: 0,
		HighCount:     2,
	}
	cfg := models.PipelineVerdictConfig{FailOnSeverity: "high", FailOnScanError: true, FailOnXrayBlock: true}

	if verdict := ComputeVerdict(cfg, scan); verdict != models.PipelineVerdictFail {
		t.Fatalf("ComputeVerdict() = %q, want %q", verdict, models.PipelineVerdictFail)
	}
}

func TestComputeVerdictReturnsErrorForScanFailure(t *testing.T) {
	scan := &models.Scan{
		Status:       models.ScanStatusFailed,
		CurrentStep:  models.ScanStepFailed,
		ErrorMessage: "worker crashed",
	}
	cfg := models.PipelineVerdictConfig{FailOnSeverity: "high", FailOnScanError: true, FailOnXrayBlock: true}

	if verdict := ComputeVerdict(cfg, scan); verdict != models.PipelineVerdictError {
		t.Fatalf("ComputeVerdict() = %q, want %q", verdict, models.PipelineVerdictError)
	}
}

func TestComputeVerdictFailsOnBlockedXrayPolicy(t *testing.T) {
	scan := &models.Scan{
		Status:         models.ScanStatusFailed,
		ExternalStatus: models.ScanExternalStatusBlockedByXrayPolicy,
	}
	cfg := models.PipelineVerdictConfig{FailOnSeverity: "none", FailOnScanError: true, FailOnXrayBlock: true}

	if verdict := ComputeVerdict(cfg, scan); verdict != models.PipelineVerdictFail {
		t.Fatalf("ComputeVerdict() = %q, want %q", verdict, models.PipelineVerdictFail)
	}
}
