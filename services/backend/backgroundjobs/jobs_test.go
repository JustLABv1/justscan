package backgroundjobs

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"testing"
	"time"

	"justscan-backend/pkg/models"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

func TestSafeErrorRetainsPrivateCauseForLogs(t *testing.T) {
	private := errors.New("pq: relation secrets must not be shown")
	err := NewSafeError("The deletion could not be completed", private)
	var safe *SafeError
	if !errors.As(err, &safe) {
		t.Fatal("expected SafeError")
	}
	if safe.Public != "The deletion could not be completed" {
		t.Fatalf("public message = %q", safe.Public)
	}
	if !errors.Is(err, private) {
		t.Fatal("safe error should retain its private cause for logs")
	}
}

func TestBuildDedupeKeyIsBinarySafeAndComponentSensitive(t *testing.T) {
	left := BuildDedupeKey("scan", "a:b", "c")
	right := BuildDedupeKey("scan", "a", "b:c")
	if left == right {
		t.Fatal("different target components must not share a dedupe key")
	}
	if BuildDedupeKey("scan", "a:b", "c") != left {
		t.Fatal("dedupe key must be deterministic")
	}
}

func TestProcessorRegistrationReplacesAProcessorForTheSameType(t *testing.T) {
	jobType := "test-processor"
	first := func(_ context.Context, _ *bun.DB, _ *models.BackgroundJob) error { return nil }
	second := func(_ context.Context, _ *bun.DB, _ *models.BackgroundJob) error {
		return errors.New("second")
	}
	Register(jobType, first)
	Register(jobType, second)
	got, ok := processorFor(jobType)
	if !ok || got == nil {
		t.Fatal("expected registered processor")
	}
	if err := got(nil, nil, nil); err == nil || err.Error() != "second" {
		t.Fatalf("processor error = %v, want replacement", err)
	}
}

func TestClaimExcludesPassiveJobsAndUsesSkipLocked(t *testing.T) {
	sqldb, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer sqldb.Close()
	db := bun.NewDB(sqldb, pgdialect.New())
	defer db.Close()

	passiveType := "passive-test-job"
	RegisterPassive(passiveType)
	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT .*FROM "background_jobs".*type NOT IN.*FOR UPDATE SKIP LOCKED`).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectCommit()

	job, claimed, err := claim(context.Background(), db, "worker-test")
	if err != nil {
		t.Fatalf("claim returned error: %v", err)
	}
	if claimed || job != nil {
		t.Fatalf("claim = (%v, %v), want no claim", job, claimed)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

type timeoutTestError struct{}

func (timeoutTestError) Error() string   { return "read tcp: i/o timeout" }
func (timeoutTestError) Timeout() bool   { return true }
func (timeoutTestError) Temporary() bool { return true }

func TestIsTransientErrorRecognizesWrappedDatabaseTimeouts(t *testing.T) {
	err := fmt.Errorf("delete sbom_components: %w", timeoutTestError{})
	if !isTransientError(err) {
		t.Fatal("wrapped network timeout should be retried")
	}
	if !isTransientError(fmt.Errorf("query canceled: %w", context.DeadlineExceeded)) {
		t.Fatal("context deadline should be retried")
	}
	if !isTransientError(driver.ErrBadConn) {
		t.Fatal("bad database connections should be retried")
	}
	if isTransientError(errors.New("duplicate key violates a permanent constraint")) {
		t.Fatal("permanent constraint errors must not be retried")
	}
}

func TestShouldAutoRetryOnlyIdempotentScanGroupDeletion(t *testing.T) {
	if !shouldAutoRetry(&models.BackgroundJob{Type: models.BackgroundJobTypeScanGroupDeletion}) {
		t.Fatal("scan-group deletion should opt into transient retries")
	}
	if shouldAutoRetry(&models.BackgroundJob{Type: "future_external_side_effect"}) {
		t.Fatal("unknown processors must not inherit automatic retries")
	}
}

func TestProcessDoesNotRetryExternalSideEffectJobs(t *testing.T) {
	tests := []struct {
		name          string
		jobType       string
		expectRequeue bool
	}{
		{name: "scan group deletion", jobType: models.BackgroundJobTypeScanGroupDeletion, expectRequeue: true},
		{name: "future external side effect", jobType: "future_external_side_effect", expectRequeue: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			sqldb, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("create sqlmock: %v", err)
			}
			defer sqldb.Close()
			db := bun.NewDB(sqldb, pgdialect.New())
			defer db.Close()

			Register(test.jobType, func(context.Context, *bun.DB, *models.BackgroundJob) error {
				return fmt.Errorf("delete sbom_components: %w", timeoutTestError{})
			})
			job := &models.BackgroundJob{
				ID:         uuid.New(),
				Type:       test.jobType,
				Status:     models.BackgroundJobStatusRunning,
				LeaseOwner: "worker-a",
				Payload:    models.JSONObject{"scan_ids": []string{uuid.NewString()}},
			}
			if test.expectRequeue {
				mock.ExpectExec(`UPDATE "background_jobs" AS "background_job" SET .*payload.*transient_retry_count.*phase.*lease_owner.*lease_until.*WHERE \(id = .*status = .*lease_owner =`).
					WillReturnResult(sqlmock.NewResult(0, 1))
			} else {
				mock.ExpectExec(`UPDATE "background_jobs" AS "background_job" SET .*status = 'failed'.*WHERE \(id = .*status = .*lease_owner =`).
					WillReturnResult(sqlmock.NewResult(0, 1))
			}

			process(context.Background(), db, job)
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("unmet SQL expectations: %v", err)
			}
		})
	}
}

func TestRetryDelayUsesBoundedExponentialBackoff(t *testing.T) {
	want := []time.Duration{2 * time.Second, 4 * time.Second, 8 * time.Second, 16 * time.Second, 30 * time.Second, 30 * time.Second}
	for attempt, expected := range want {
		if got := retryDelay(attempt + 1); got != expected {
			t.Fatalf("attempt %d delay = %s, want %s", attempt+1, got, expected)
		}
	}
}

func TestRequeueTransientPersistsRetryStateAndReleasesLease(t *testing.T) {
	sqldb, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("create sqlmock: %v", err)
	}
	defer sqldb.Close()
	db := bun.NewDB(sqldb, pgdialect.New())
	defer db.Close()

	job := &models.BackgroundJob{
		ID:         uuid.New(),
		Type:       models.BackgroundJobTypeScanGroupDeletion,
		Status:     models.BackgroundJobStatusRunning,
		LeaseOwner: "worker-a",
		Payload:    models.JSONObject{"scan_ids": []string{uuid.NewString()}},
	}
	mock.ExpectExec(`UPDATE "background_jobs" AS "background_job" SET .*payload.*phase.*error_message.*lease_owner.*lease_until.*updated_at.*WHERE \(id = .*status = .*lease_owner =`).
		WillReturnResult(sqlmock.NewResult(0, 1))

	requeued, err := requeueTransient(context.Background(), db, job)
	if err != nil {
		t.Fatalf("requeue transient: %v", err)
	}
	if !requeued {
		t.Fatal("expected retry to be persisted")
	}
	if got := retryCount(job); got != 1 {
		t.Fatalf("retry count = %d, want 1", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestRequeueTransientStopsAfterRetryBudget(t *testing.T) {
	job := &models.BackgroundJob{Payload: models.JSONObject{"transient_retry_count": maxTransientRetries}}
	requeued, err := requeueTransient(context.Background(), nil, job)
	if err != nil {
		t.Fatalf("retry budget check: %v", err)
	}
	if requeued {
		t.Fatal("retry budget exhaustion must not requeue")
	}
}
