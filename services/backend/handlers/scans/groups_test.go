package scans

import (
	"context"
	"fmt"
	"testing"
)

func TestScanGroupDeletionErrorExplainsLockTimeout(t *testing.T) {
	err := fmt.Errorf("lock vulnerabilities before scan deletion: %w", context.DeadlineExceeded)
	message := scanGroupDeletionErrorMessage(err)
	if message != "database timed out while preparing scan history deletion; please retry" {
		t.Fatalf("unexpected timeout message: %q", message)
	}
}

func TestScanGroupDeletionErrorDoesNotExposeDatabaseDetails(t *testing.T) {
	err := fmt.Errorf("delete scans: constraint secret_internal_fk failed")
	if message := scanGroupDeletionErrorMessage(err); message != "failed to delete scan group" {
		t.Fatalf("unexpected database detail exposure: %q", message)
	}
}
