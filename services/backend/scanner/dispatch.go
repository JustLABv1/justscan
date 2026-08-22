package scanner

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"justscan-backend/pipelines"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

// IsScanQueueCapacityError identifies a transient in-process queue failure.
// Durable pending rows must remain pending so the recovery dispatcher can
// retry them once workers become available.
func IsScanQueueCapacityError(err error) bool {
	return errors.Is(err, ErrScanQueueFull) || errors.Is(err, ErrScanQueueUnavailable)
}

// IsScanQueueCapacityMessage preserves the same queue-defer semantic for
// legacy callers that only pass err.Error() to MarkScanFailed.
func IsScanQueueCapacityMessage(message string) bool {
	message = strings.TrimSpace(message)
	return strings.Contains(message, ErrScanQueueFull.Error()) || strings.Contains(message, ErrScanQueueUnavailable.Error())
}

// DispatchScan routes a scan to the appropriate provider. Both built-in and
// external providers execute asynchronously via the existing worker queue.
func DispatchScan(ctx context.Context, db *bun.DB, scan *models.Scan, envVars []string, platform string) error {
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
	if err := enqueueScanBackgroundJob(ctx, db, scan); err != nil {
		return err
	}

	var err error
	switch provider {
	case models.ScanProviderTrivy:
		scan.CurrentStep = models.ScanStepQueued
		archivePath := ""
		if scan.ScanSource == models.ScanSourceUploadedArchive {
			archivePath = scan.ImageLocation
		}
		err = EnqueueScanContext(ctx, scan.ID, db, envVars, platform, archivePath)
	case models.ScanProviderArtifactoryXray:
		scan.CurrentStep = models.ScanStepQueued
		err = EnqueueScanContext(ctx, scan.ID, db, envVars, platform, "")
	default:
		return fmt.Errorf("unsupported scan provider %q", provider)
	}
	if IsScanQueueCapacityError(err) {
		log.Warnf("Scan %s dispatch deferred while the scanner queue is saturated: %v", scan.ID, err)
		return nil
	}
	return err
}

// MarkScanFailed stores a failure when dispatch exits before a worker picks the scan up.
func MarkScanFailed(ctx context.Context, db *bun.DB, scanID uuid.UUID, message string) error {
	if IsScanQueueCapacityMessage(message) {
		// Queue saturation is recoverable and must never convert durable pending
		// work into a terminal failure.
		return nil
	}
	completedAt := time.Now()
	result, err := db.NewUpdate().Model((*models.Scan)(nil)).
		Set("status = ?", models.ScanStatusFailed).
		Set("current_step = ?", models.ScanStepFailed).
		Set("error_message = ?", message).
		Set("completed_at = ?", completedAt).
		Set("last_progress_at = ?", completedAt).
		Where("id = ? AND status IN (?)", scanID, bun.In([]string{models.ScanStatusPending, models.ScanStatusRunning})).
		Exec(ctx)
	if err != nil {
		return err
	}
	rows, rowsErr := result.RowsAffected()
	if rowsErr != nil {
		return rowsErr
	}
	if rows == 0 {
		// Cancellation or another terminal writer won the race.
		return nil
	}
	if err := appendTerminalScanStepLog(ctx, db, scanID, models.ScanStepFailed); err != nil {
		return err
	}
	recordScanStepOutput(ctx, db, scanID, message)
	if queueErr := pipelines.QueueCallbackForScan(ctx, db, scanID.String()); queueErr != nil && queueErr != sql.ErrNoRows {
		return queueErr
	}
	return nil
}

func MarkScanCancelled(ctx context.Context, db *bun.DB, scanID uuid.UUID, message string) error {
	if err := appendTerminalScanStepLog(ctx, db, scanID, models.ScanStepCancelled); err != nil {
		return err
	}
	recordScanStepOutput(ctx, db, scanID, message)
	return nil
}
