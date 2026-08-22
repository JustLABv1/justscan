package scanner

import (
	"context"
	"database/sql"
	"regexp"
	"testing"

	"justscan-backend/config"
	"justscan-backend/pkg/models"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
)

func TestDispatchXrayKeepsScanInJustScanQueueUntilWorkerHandoff(t *testing.T) {
	db, mock, cleanup := newMockBunDB(t)
	defer cleanup()

	scanID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	previousQueue := jobQueue
	jobQueue = make(chan ScanJob, 1)
	t.Cleanup(func() { jobQueue = previousQueue })

	mock.ExpectQuery(`SELECT .* FROM "scan_step_logs" AS "scan_step_log"`).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE "scans" AS "scan" SET current_step = 'queued', last_progress_at = `) + `.*WHERE \(id = '11111111-1111-1111-1111-111111111111' AND status IN \('pending', 'running'\)\)`).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`INSERT INTO "scan_step_logs" .*`).WillReturnRows(
		sqlmock.NewRows([]string{"id", "position", "completed_at"}).AddRow(uuid.New(), 0, nil),
	)

	scan := &models.Scan{ID: scanID, ScanProvider: models.ScanProviderArtifactoryXray}
	if err := DispatchScan(context.Background(), db, scan, nil, ""); err != nil {
		t.Fatalf("DispatchScan returned error: %v", err)
	}
	if scan.ExternalStatus != "" {
		t.Fatalf("external status = %q, want empty before Xray receives the scan", scan.ExternalStatus)
	}
	if scan.CurrentStep != models.ScanStepQueued {
		t.Fatalf("current step = %q, want %q", scan.CurrentStep, models.ScanStepQueued)
	}
	if queued := <-jobQueue; queued.ScanID != scanID {
		t.Fatalf("queued scan ID = %s, want %s", queued.ScanID, scanID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestWorkerConcurrencyDefaultsToTwo(t *testing.T) {
	previous := config.Config
	config.Config = &config.RestfulConf{}
	t.Cleanup(func() { config.Config = previous })

	if got := WorkerConcurrency(); got != 2 {
		t.Fatalf("WorkerConcurrency() = %d, want 2", got)
	}
}

func TestEnqueueScanIsIdempotentForAlreadyOwnedQueueEntry(t *testing.T) {
	db, mock, cleanup := newMockBunDB(t)
	defer cleanup()

	scanID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	previousQueue := jobQueue
	jobQueue = make(chan ScanJob, 1)
	queuedScanIDs.Store(scanID, struct{}{})
	t.Cleanup(func() {
		jobQueue = previousQueue
		queuedScanIDs.Delete(scanID)
	})

	if err := EnqueueScanContext(context.Background(), scanID, db, nil, "", ""); err != nil {
		t.Fatalf("duplicate enqueue returned error: %v", err)
	}
	if len(jobQueue) != 0 {
		t.Fatalf("duplicate enqueue added a second job")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unexpected database activity: %v", err)
	}
}

func TestMarkScanFailedDefersQueueCapacityWithoutDatabaseWrite(t *testing.T) {
	if err := MarkScanFailed(context.Background(), nil, uuid.New(), ErrScanQueueFull.Error()); err != nil {
		t.Fatalf("MarkScanFailed queue result = %v, want nil", err)
	}
}
