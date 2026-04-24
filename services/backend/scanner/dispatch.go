package scanner

import (
	"context"
	"fmt"
	"time"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
)

// DispatchScan routes a scan to the appropriate provider. Both built-in and
// external providers execute asynchronously via the existing worker queue.
func DispatchScan(_ context.Context, db *bun.DB, scan *models.Scan, envVars []string, platform string) error {
	provider := scan.ScanProvider
	if provider == "" {
		resolvedProvider, err := DefaultScanProvider()
		if err != nil {
			return err
		}
		provider = resolvedProvider
		scan.ScanProvider = provider
	}
	if err := ValidateProviderSelection(provider); err != nil {
		return err
	}

	switch provider {
	case models.ScanProviderTrivy:
		scan.CurrentStep = models.ScanStepQueued
		return EnqueueScan(scan.ID, db, envVars, platform)
	case models.ScanProviderArtifactoryXray:
		scan.ExternalStatus = "queued"
		scan.CurrentStep = models.ScanStepQueued
		if scan.ID != uuid.Nil {
			now := time.Now()
			if _, err := db.NewUpdate().Model((*models.Scan)(nil)).
				Set("external_status = ?", scan.ExternalStatus).
				Set("current_step = ?", scan.CurrentStep).
				Set("last_progress_at = ?", now).
				Where("id = ?", scan.ID).
				Exec(context.Background()); err != nil {
				return fmt.Errorf("failed to persist external status for scan %s: %w", scan.ID, err)
			}
		}
		return EnqueueScan(scan.ID, db, envVars, platform)
	default:
		return fmt.Errorf("unsupported scan provider %q", provider)
	}
}

// MarkScanFailed stores a failure when dispatch exits before a worker picks the scan up.
func MarkScanFailed(ctx context.Context, db *bun.DB, scanID uuid.UUID, message string) error {
	completedAt := time.Now()
	_, err := db.NewUpdate().Model((*models.Scan)(nil)).
		Set("status = ?", models.ScanStatusFailed).
		Set("error_message = ?", message).
		Set("completed_at = ?", completedAt).
		Set("last_progress_at = ?", completedAt).
		Where("id = ?", scanID).
		Exec(ctx)
	if err != nil {
		return err
	}
	if err := setScanStepByID(ctx, db, scanID, models.ScanStepFailed); err != nil {
		return err
	}
	recordScanStepOutput(ctx, db, scanID, message)
	return nil
}

func MarkScanCancelled(ctx context.Context, db *bun.DB, scanID uuid.UUID, message string) error {
	if err := setScanStepByID(ctx, db, scanID, models.ScanStepCancelled); err != nil {
		return err
	}
	recordScanStepOutput(ctx, db, scanID, message)
	return nil
}
