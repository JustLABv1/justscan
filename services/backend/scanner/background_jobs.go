package scanner

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync/atomic"
	"time"

	"justscan-backend/backgroundjobs"
	"justscan-backend/pkg/models"

	"github.com/google/uuid"
	log "github.com/sirupsen/logrus"
	"github.com/uptrace/bun"
)

// ScanBackgroundJobType identifies a passive Process Center mirror. The
// scanner owns provider execution; generic background workers must not claim
// this type as an actionable job.
const ScanBackgroundJobType = "scan"

const (
	scanBackgroundJobReconcileInterval = 2 * time.Second
	backgroundJobStatusCancelled       = "cancelled"
)

var scanBackgroundReconcilerStarted atomic.Bool

func init() {
	// RegisterPassive keeps scan mirrors out of the generic worker's claim
	// loop. The reconciler below updates them from the durable scan row.
	backgroundjobs.RegisterPassive(ScanBackgroundJobType)
}

func scanBackgroundMetadata(scan *models.Scan) models.JSONObject {
	metadata := models.JSONObject{
		"resource_type": "scan",
		"resource_id":   scan.ID.String(),
		"scan_id":       scan.ID.String(),
		"image_name":    scan.ImageName,
		"image_tag":     scan.ImageTag,
		"scan_provider": scan.ScanProvider,
	}
	if scan.WatchlistID != nil && *scan.WatchlistID != uuid.Nil {
		metadata["trigger_source"] = "watchlist"
		metadata["watchlist_id"] = scan.WatchlistID.String()
	}
	return metadata
}

func enqueueScanBackgroundJob(ctx context.Context, db *bun.DB, scan *models.Scan) error {
	if db == nil || scan == nil || scan.ID == uuid.Nil {
		return nil
	}

	userID := scan.UserID
	if userID == nil {
		userID = scan.OwnerUserID
	}
	// Anonymous/public scans deliberately have no Process Center entry. An
	// organization token can also have no user identity; the core job store
	// must support an org-only actor before that case can be represented here.
	if userID == nil || *userID == uuid.Nil {
		return nil
	}

	scopeType := models.BackgroundJobScopeUser
	scopeRef := userID.String()
	if scan.OwnerOrgID != nil {
		scopeType = models.BackgroundJobScopeOrg
		scopeRef = scan.OwnerOrgID.String()
	}

	phase := strings.TrimSpace(scan.CurrentStep)
	if phase == "" {
		phase = models.ScanStepQueued
	}
	_, err := backgroundjobs.Enqueue(ctx, db, backgroundjobs.EnqueueRequest{
		UserID:      *userID,
		ScopeType:   scopeType,
		ScopeRef:    scopeRef,
		Type:        ScanBackgroundJobType,
		Title:       fmt.Sprintf("Scan %s:%s", scan.ImageName, scan.ImageTag),
		Description: "Container image scan",
		Phase:       phase,
		Metadata:    scanBackgroundMetadata(scan),
		DedupeKey:   "scan:" + scan.ID.String(),
	})
	if err != nil {
		return fmt.Errorf("enqueue durable scan process: %w", err)
	}
	return nil
}

type persistedScanBackgroundState struct {
	Status       string `bun:"status"`
	CurrentStep  string `bun:"current_step"`
	ErrorMessage string `bun:"error_message"`
}

func loadScanBackgroundState(ctx context.Context, db *bun.DB, scanID uuid.UUID) (persistedScanBackgroundState, error) {
	var state persistedScanBackgroundState
	if db == nil {
		return state, errors.New("database is required")
	}
	if err := db.NewSelect().Model((*models.Scan)(nil)).
		Column("status", "current_step", "error_message").
		Where("id = ?", scanID).
		Scan(ctx, &state); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return state, fmt.Errorf("scan %s no longer exists: %w", scanID, err)
		}
		return state, fmt.Errorf("load scan state: %w", err)
	}
	return state, nil
}

func scanBackgroundID(job *models.BackgroundJob) (uuid.UUID, error) {
	if job == nil {
		return uuid.Nil, errors.New("background scan job is nil")
	}
	for _, document := range []models.JSONObject{job.Metadata, job.Payload} {
		if document == nil {
			continue
		}
		for _, key := range []string{"scan_id", "resource_id"} {
			if raw, ok := document[key].(string); ok {
				if id, err := uuid.Parse(strings.TrimSpace(raw)); err == nil {
					return id, nil
				}
			}
		}
	}
	return uuid.Nil, errors.New("background scan job has no scan id")
}

func scanBackgroundPhase(state persistedScanBackgroundState) string {
	if phase := strings.TrimSpace(state.CurrentStep); phase != "" {
		return phase
	}
	if state.Status == models.ScanStatusPending {
		return models.ScanStepQueued
	}
	return strings.TrimSpace(state.Status)
}

func scanBackgroundError(state persistedScanBackgroundState) string {
	if message := strings.TrimSpace(state.ErrorMessage); message != "" {
		return message
	}
	return "The image scan failed."
}

func updateActiveScanBackgroundJob(ctx context.Context, db *bun.DB, job *models.BackgroundJob, state persistedScanBackgroundState, now time.Time) error {
	status := models.BackgroundJobStatusQueued
	if state.Status == models.ScanStatusRunning {
		status = models.BackgroundJobStatusRunning
	}
	query := db.NewUpdate().Model((*models.BackgroundJob)(nil)).
		Set("status = ?", status).
		Set("progress_current = 0").
		Set("progress_total = 0").
		Set("phase = ?", scanBackgroundPhase(state)).
		Set("error_message = ''").
		Set("finished_at = NULL").
		Set("lease_owner = ''").
		Set("lease_until = NULL").
		Set("updated_at = ?", now).
		Where("id = ?", job.ID).
		Where("status IN (?)", bun.In([]string{models.BackgroundJobStatusQueued, models.BackgroundJobStatusRunning}))
	if status == models.BackgroundJobStatusRunning {
		query = query.Set("started_at = COALESCE(started_at, ?)", now)
	}
	_, err := query.Exec(ctx)
	return err
}

func finishScanBackgroundJob(ctx context.Context, db *bun.DB, job *models.BackgroundJob, state persistedScanBackgroundState, now time.Time) error {
	status := models.BackgroundJobStatusSucceeded
	errorMessage := ""
	phase := scanBackgroundPhase(state)
	if state.Status == models.ScanStatusFailed {
		status = models.BackgroundJobStatusFailed
		errorMessage = scanBackgroundError(state)
	} else if state.Status == models.ScanStatusCancelled {
		status = backgroundJobStatusCancelled
		phase = models.ScanStepCancelled
		errorMessage = "The image scan was cancelled."
	}
	_, err := db.NewUpdate().Model((*models.BackgroundJob)(nil)).
		Set("status = ?", status).
		Set("progress_current = 0").
		Set("progress_total = 0").
		Set("phase = ?", phase).
		Set("error_message = ?", errorMessage).
		Set("finished_at = ?", now).
		Set("lease_owner = ''").
		Set("lease_until = NULL").
		Set("updated_at = ?", now).
		Where("id = ?", job.ID).
		Where("status IN (?)", bun.In([]string{models.BackgroundJobStatusQueued, models.BackgroundJobStatusRunning})).
		Exec(ctx)
	return err
}

// reconcileBackgroundScanOnce performs one persisted-state reconciliation.
// The zero progress total is intentional: scanner commands do not expose a
// trustworthy total, so the Process Center renders an indeterminate spinner.
func reconcileBackgroundScanOnce(ctx context.Context, db *bun.DB, job *models.BackgroundJob) (bool, error) {
	scanID, err := scanBackgroundID(job)
	if err != nil {
		return false, err
	}
	state, err := loadScanBackgroundState(ctx, db, scanID)
	if err != nil {
		return false, err
	}
	now := time.Now().UTC()
	switch state.Status {
	case models.ScanStatusCompleted, models.ScanStatusFailed, models.ScanStatusCancelled:
		return true, finishScanBackgroundJob(ctx, db, job, state, now)
	default:
		return false, updateActiveScanBackgroundJob(ctx, db, job, state, now)
	}
}

func reconcileScanBackgroundJobs(ctx context.Context, db *bun.DB) error {
	if db == nil {
		return nil
	}
	var jobs []models.BackgroundJob
	if err := db.NewSelect().Model(&jobs).
		Where("type = ?", ScanBackgroundJobType).
		Where("status IN (?)", bun.In([]string{models.BackgroundJobStatusQueued, models.BackgroundJobStatusRunning})).
		// Round-robin by update time so a large old backlog cannot starve
		// newer mirrors behind the first 256 rows forever.
		OrderExpr("updated_at ASC, created_at ASC").
		Limit(256).
		Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		return err
	}
	for i := range jobs {
		if _, err := reconcileBackgroundScanOnce(ctx, db, &jobs[i]); err != nil {
			return fmt.Errorf("reconcile scan background job %s: %w", jobs[i].ID, err)
		}
	}
	return nil
}

func startScanBackgroundJobReconciler(db *bun.DB) {
	if db == nil || !scanBackgroundReconcilerStarted.CompareAndSwap(false, true) {
		return
	}
	go func() {
		ticker := time.NewTicker(scanBackgroundJobReconcileInterval)
		defer ticker.Stop()
		for {
			if err := reconcileScanBackgroundJobs(context.Background(), db); err != nil {
				// Reconciliation is best-effort; the next tick retries while the
				// scan row remains durable.
				log.Warnf("scan background-job reconciliation failed: %v", err)
			}
			<-ticker.C
		}
	}()
}
