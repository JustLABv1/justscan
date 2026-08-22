package scanner

import (
	"context"
	"database/sql"
	"testing"

	"justscan-backend/pkg/models"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
)

func TestEnqueueScanBackgroundJobSkipsAnonymousScan(t *testing.T) {
	scan := &models.Scan{ID: uuid.New(), ImageName: "alpine", ImageTag: "latest"}
	if err := enqueueScanBackgroundJob(context.Background(), nil, scan); err != nil {
		t.Fatalf("anonymous scan enqueue returned error: %v", err)
	}
}

func TestEnqueueScanBackgroundJobUsesOrganizationScope(t *testing.T) {
	db, mock, cleanup := newMockBunDB(t)
	defer cleanup()

	scanID := uuid.New()
	userID := uuid.New()
	orgID := uuid.New()
	mock.ExpectQuery(`SELECT .* FROM "background_jobs" AS "background_job"`).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(`INSERT INTO "background_jobs"`).
		WillReturnResult(sqlmock.NewResult(0, 1))

	err := enqueueScanBackgroundJob(context.Background(), db, &models.Scan{
		ID:           scanID,
		ImageName:    "registry.example/app",
		ImageTag:     "1.2.3",
		ScanProvider: models.ScanProviderTrivy,
		CurrentStep:  models.ScanStepQueued,
		UserID:       &userID,
		OwnerOrgID:   &orgID,
	})
	if err != nil {
		t.Fatalf("enqueueScanBackgroundJob returned error: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestScanBackgroundPhaseFallsBackToPersistedStatus(t *testing.T) {
	if got := scanBackgroundPhase(persistedScanBackgroundState{Status: models.ScanStatusPending}); got != models.ScanStepQueued {
		t.Fatalf("pending phase = %q, want %q", got, models.ScanStepQueued)
	}
	if got := scanBackgroundPhase(persistedScanBackgroundState{Status: models.ScanStatusRunning}); got != models.ScanStatusRunning {
		t.Fatalf("running fallback phase = %q, want %q", got, models.ScanStatusRunning)
	}
}

func TestReconcileBackgroundScanCompletedUsesIndeterminateProgress(t *testing.T) {
	db, mock, cleanup := newMockBunDB(t)
	defer cleanup()

	scanID := uuid.New()
	jobID := uuid.New()
	leaseOwner := "worker-1"
	mock.ExpectQuery(`SELECT .* FROM "scans" AS "scan"`).
		WillReturnRows(sqlmock.NewRows([]string{"status", "current_step", "error_message"}).
			AddRow(models.ScanStatusCompleted, models.ScanStepCompleted, ""))
	mock.ExpectExec(`(?s)UPDATE "background_jobs" AS "background_job" SET .*progress_current = 0.*progress_total = 0.*phase = 'completed'.*status IN`).
		WillReturnResult(sqlmock.NewResult(0, 1))

	done, err := reconcileBackgroundScanOnce(context.Background(), db, &models.BackgroundJob{
		ID:         jobID,
		LeaseOwner: leaseOwner,
		Metadata:   models.JSONObject{"scan_id": scanID.String()},
	})
	if err != nil {
		t.Fatalf("reconcileBackgroundScanOnce returned error: %v", err)
	}
	if !done {
		t.Fatal("completed scan should finish the background process")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestReconcileBackgroundScanRunningUsesPersistedPhase(t *testing.T) {
	db, mock, cleanup := newMockBunDB(t)
	defer cleanup()

	scanID := uuid.New()
	jobID := uuid.New()
	mock.ExpectQuery(`SELECT .* FROM "scans" AS "scan"`).
		WillReturnRows(sqlmock.NewRows([]string{"status", "current_step", "error_message"}).
			AddRow(models.ScanStatusRunning, models.ScanStepScanningImage, ""))
	mock.ExpectExec(`(?s)UPDATE "background_jobs" AS "background_job" SET .*status = 'running'.*progress_current = 0.*progress_total = 0.*phase = 'scanning_image'`).
		WillReturnResult(sqlmock.NewResult(0, 1))

	done, err := reconcileBackgroundScanOnce(context.Background(), db, &models.BackgroundJob{
		ID:       jobID,
		Metadata: models.JSONObject{"resource_id": scanID.String()},
	})
	if err != nil {
		t.Fatalf("reconcileBackgroundScanOnce returned error: %v", err)
	}
	if done {
		t.Fatal("running scan should remain active")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestReconcileBackgroundScanFailedPersistsError(t *testing.T) {
	db, mock, cleanup := newMockBunDB(t)
	defer cleanup()

	scanID := uuid.New()
	jobID := uuid.New()
	mock.ExpectQuery(`SELECT .* FROM "scans" AS "scan"`).
		WillReturnRows(sqlmock.NewRows([]string{"status", "current_step", "error_message"}).
			AddRow(models.ScanStatusFailed, models.ScanStepFailed, "registry timeout"))
	mock.ExpectExec(`(?s)UPDATE "background_jobs" AS "background_job" SET .*status = 'failed'.*phase = 'failed'.*error_message = 'registry timeout'`).
		WillReturnResult(sqlmock.NewResult(0, 1))

	done, err := reconcileBackgroundScanOnce(context.Background(), db, &models.BackgroundJob{
		ID:       jobID,
		Metadata: models.JSONObject{"scan_id": scanID.String()},
	})
	if err != nil {
		t.Fatalf("reconcileBackgroundScanOnce returned error: %v", err)
	}
	if !done {
		t.Fatal("failed scan should finish the background process")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestReconcileScanBackgroundJobsRoundRobinsByUpdatedAt(t *testing.T) {
	db, mock, cleanup := newMockBunDB(t)
	defer cleanup()

	mock.ExpectQuery(`(?s)SELECT .* FROM "background_jobs" AS "background_job".*ORDER BY updated_at ASC, created_at ASC.*LIMIT 256`).
		WillReturnError(sql.ErrNoRows)
	if err := reconcileScanBackgroundJobs(context.Background(), db); err != nil {
		t.Fatalf("reconcileScanBackgroundJobs returned error: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}
