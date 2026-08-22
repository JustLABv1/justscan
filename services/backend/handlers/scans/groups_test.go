package scans

import (
	"context"
	"fmt"
	"testing"
)

func TestScanGroupDeletionErrorExplainsLockTimeout(t *testing.T) {
	err := fmt.Errorf("lock vulnerability mutations before scan deletion: %w", context.DeadlineExceeded)
	message := scanGroupDeletionErrorMessage(err)
	if message != "database timed out while preparing scan history deletion; please retry" {
		t.Fatalf("unexpected timeout message: %q", message)
	}
}

func TestScanGroupDeletionErrorExplainsSBOMReadTimeout(t *testing.T) {
	err := fmt.Errorf("delete sbom_components: %w", context.DeadlineExceeded)
	message := scanGroupDeletionErrorMessage(err)
	if message != "database timed out while deleting scan history; please retry" {
		t.Fatalf("unexpected timeout message: %q", message)
	}
}

func TestScanGroupDeletionErrorDoesNotExposeDatabaseDetails(t *testing.T) {
	err := fmt.Errorf("delete scans: constraint secret_internal_fk failed")
	if message := scanGroupDeletionErrorMessage(err); message != "failed to delete scan group" {
		t.Fatalf("unexpected database detail exposure: %q", message)
	}
}

func TestScanDeletionRecognizesTransientDatabaseErrors(t *testing.T) {
	for _, message := range []string{
		"delete sbom_components: read tcp: i/o timeout",
		"delete scans: deadlock detected",
		"delete scans: canceling statement due to lock timeout",
	} {
		if !isRetryableScanDeletionError(fmt.Errorf("%s", message)) {
			t.Fatalf("expected transient deletion error to be retryable: %q", message)
		}
	}
}

func TestScanDeletionDoesNotRetryCancellation(t *testing.T) {
	if isRetryableScanDeletionError(context.Canceled) {
		t.Fatal("context cancellation must not be retried")
	}
}
