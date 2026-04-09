package dashboard

import (
	"testing"

	"justscan-backend/pkg/models"
)

func TestIsBlockedByXrayPolicyStatus(t *testing.T) {
	if !isBlockedByXrayPolicyStatus(models.ScanStatusFailed, models.ScanExternalStatusBlockedByXrayPolicy) {
		t.Fatal("expected blocked xray policy status to be detected")
	}
	if isBlockedByXrayPolicyStatus(models.ScanStatusRunning, models.ScanExternalStatusBlockedByXrayPolicy) {
		t.Fatal("did not expect non-failed scans to be treated as blocked by policy")
	}
}

func TestSummarizeActiveXrayScansUsesQueuedFallback(t *testing.T) {
	count, steps := summarizeActiveXrayScans([]models.Scan{
		{CurrentStep: models.ScanStepWaitingForXray},
		{CurrentStep: ""},
	})

	if count != 2 {
		t.Fatalf("expected 2 active xray scans, got %d", count)
	}
	if steps[models.ScanStepWaitingForXray] != 1 {
		t.Fatalf("expected waiting_for_xray step count of 1, got %d", steps[models.ScanStepWaitingForXray])
	}
	if steps[models.ScanStepQueued] != 1 {
		t.Fatalf("expected queued fallback step count of 1, got %d", steps[models.ScanStepQueued])
	}
}
