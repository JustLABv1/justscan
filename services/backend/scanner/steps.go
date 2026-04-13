package scanner

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

func isTerminalScanStep(step string) bool {
	switch step {
	case models.ScanStepCompleted, models.ScanStepFailed, models.ScanStepCancelled:
		return true
	default:
		return false
	}
}

func setScanStep(ctx context.Context, db *bun.DB, scan *models.Scan, step string) error {
	if scan == nil {
		return nil
	}
	scan.CurrentStep = step
	return setScanStepByID(ctx, db, scan.ID, step)
}

func setScanStepByID(ctx context.Context, db *bun.DB, scanID uuid.UUID, step string) error {
	if scanID == uuid.Nil {
		return nil
	}
	now := time.Now()

	var latest models.ScanStepLog
	hasLatest := true
	if err := db.NewSelect().Model(&latest).
		Where("scan_id = ?", scanID).
		OrderExpr("position DESC").
		Limit(1).
		Scan(ctx); err != nil {
		if err != sql.ErrNoRows {
			return fmt.Errorf("failed to load latest step log for scan %s: %w", scanID, err)
		}
		hasLatest = false
	}

	if hasLatest && latest.Step == step {
		if _, err := db.NewUpdate().Model((*models.Scan)(nil)).
			Set("current_step = ?", step).
			Set("last_progress_at = ?", now).
			Where("id = ?", scanID).
			Exec(ctx); err != nil {
			return fmt.Errorf("failed to update current step for scan %s: %w", scanID, err)
		}
		if latest.CompletedAt == nil || isTerminalScanStep(step) {
			return nil
		}
	}

	if hasLatest && latest.CompletedAt == nil {
		if _, err := db.NewUpdate().Model((*models.ScanStepLog)(nil)).
			Set("completed_at = ?", now).
			Where("id = ?", latest.ID).
			Exec(ctx); err != nil {
			return fmt.Errorf("failed to complete previous step log for scan %s: %w", scanID, err)
		}
	}

	if _, err := db.NewUpdate().Model((*models.Scan)(nil)).
		Set("current_step = ?", step).
		Set("last_progress_at = ?", now).
		Where("id = ?", scanID).
		Exec(ctx); err != nil {
		return fmt.Errorf("failed to update current step for scan %s: %w", scanID, err)
	}

	nextPosition := 0
	if hasLatest {
		nextPosition = latest.Position + 1
	}
	entry := &models.ScanStepLog{
		ScanID:    scanID,
		Step:      step,
		Position:  nextPosition,
		StartedAt: now,
		Output:    []string{},
	}
	if isTerminalScanStep(step) {
		entry.CompletedAt = &now
	}
	if _, err := db.NewInsert().Model(entry).Exec(ctx); err != nil {
		return fmt.Errorf("failed to create step log for scan %s: %w", scanID, err)
	}
	return nil
}

func appendScanStepOutput(ctx context.Context, db *bun.DB, scanID uuid.UUID, message string) error {
	message = strings.TrimSpace(message)
	if scanID == uuid.Nil || message == "" {
		return nil
	}

	var latest models.ScanStepLog
	if err := db.NewSelect().Model(&latest).
		Where("scan_id = ?", scanID).
		OrderExpr("position DESC").
		Limit(1).
		Scan(ctx); err != nil {
		if err == sql.ErrNoRows {
			return nil
		}
		return fmt.Errorf("failed to load step log output target for scan %s: %w", scanID, err)
	}

	output := append(append([]string{}, latest.Output...), message)
	if _, err := db.NewUpdate().Model((*models.ScanStepLog)(nil)).
		Set("output = ?", output).
		Where("id = ?", latest.ID).
		Exec(ctx); err != nil {
		return fmt.Errorf("failed to append step output for scan %s: %w", scanID, err)
	}
	if err := touchScanProgress(ctx, db, scanID, time.Now()); err != nil {
		return err
	}
	return nil
}

func recordScanStepOutput(ctx context.Context, db *bun.DB, scanID uuid.UUID, message string) {
	if err := appendScanStepOutput(ctx, db, scanID, message); err != nil {
		log.Warnf("Failed to append step output for scan %s: %v", scanID, err)
	}
}

func xrayCurrentStep(externalStatus string) string {
	switch externalStatus {
	case "warming_artifactory_cache":
		return models.ScanStepWarmingCache
	case "indexing":
		return models.ScanStepIndexingArtifact
	case "queued":
		return models.ScanStepQueuedInXray
	case "waiting_for_xray":
		return models.ScanStepWaitingForXray
	case "importing":
		return models.ScanStepImportingResults
	case "completed":
		return models.ScanStepCompleted
	case models.ScanStatusCancelled:
		return models.ScanStepCancelled
	case models.ScanExternalStatusBlockedByXrayPolicy:
		return models.ScanStepFailed
	default:
		return models.ScanStepQueued
	}
}
